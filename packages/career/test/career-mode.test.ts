// Career mode: season schedule, the Continue loop, the season end, saves and hooks.
// Fixtures are played with the quick estimate (quickSeries) so a whole season runs in seconds;
// the desktop plays the same requests through the match engine.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  answerInbox, batchOf, continueCareer, dayAgenda, deserializeCareer, groupStandings, newCareer, quickSeries,
  recordResult, registerCareerHook, serializeCareer, seriesRequest, weekday,
  type CareerState, type ContinueResult, type World,
} from "../src/index.ts";

let base: World;
const fresh = (): World => JSON.parse(JSON.stringify(base)) as World;
const sim = batchOf(quickSeries);
const USER = (w: World): string => Object.values(w.teams).filter((t) => t.region === "pacific" && t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!.teamId;

function career(seed = 11): CareerState {
  const w = fresh();
  return newCareer(w, { seed, manager: { name: "Test Manager", nationality: "kr" }, userTeamId: USER(w) });
}

/** Play the manager's own match with the quick estimate (stand-in for the desktop's series screen). */
function playUserMatch(state: CareerState, r: ContinueResult): void {
  const req = seriesRequest(state, r.fixture!);
  const out = quickSeries(req, state);
  recordResult(state, req.fixtureId, { ...out, source: "user", lineups: { home: req.home.lineup, away: req.away.lineup } });
}

/** Continue until `until` (answering messages with the first option and playing the user's matches). */
async function playUntil(state: CareerState, until: (r: ContinueResult) => boolean, maxStops = 400): Promise<ContinueResult> {
  for (let i = 0; i < maxStops; i++) {
    const r = await continueCareer(state, sim);
    if (until(r)) return r;
    if (r.stop === "message") for (const m of r.items!) answerInbox(state, m.id, m.options![0]!.id);
    else if (r.stop === "matchDay") playUserMatch(state, r);
  }
  throw new Error("did not reach the stop");
}

beforeAll(() => { base = worldFromGameData(4242); });

describe("season schedule", () => {
  it("builds a 12-team league with two round-robin groups and a playoff bracket", () => {
    const c = career();
    const s = c.season;
    expect(s.teams).toHaveLength(12);
    expect(s.teams).toContain(c.userTeamId);
    const st1 = s.stages[0]!;
    expect(st1.groups.alpha).toHaveLength(6);
    expect(st1.groups.omega).toHaveLength(6);
    const group = s.fixtures.filter((f) => f.stage === "stage1" && f.phase === "group");
    expect(group).toHaveLength(30);
    for (const id of s.teams) expect(group.filter((f) => f.home === id || f.away === id)).toHaveLength(5);
    for (const f of group) expect([5, 6, 0]).toContain(weekday(f.date)); // Friday–Sunday
    const po = s.fixtures.filter((f) => f.stage === "stage1" && f.phase === "playoff");
    expect(po.map((f) => f.round)).toEqual(["qf", "qf", "qf", "qf", "sf", "sf", "final"]);
    expect(po.find((f) => f.round === "final")!.format).toBe("bo5");
    expect(s.stages[1]!.start).toBeNull(); // stage 2 is drawn after stage 1
  });

  it("is the same schedule for the same seed and a different one for another seed", () => {
    const a = career(5); const b = career(5); const c = career(6);
    expect(JSON.stringify(a.season)).toBe(JSON.stringify(b.season));
    expect(JSON.stringify(a.season.fixtures.map((f) => [f.home, f.away]))).not.toBe(JSON.stringify(c.season.fixtures.map((f) => [f.home, f.away])));
  });
});

describe("continue loop", () => {
  it("stops for the board's question, then at the manager's first match day", async () => {
    const c = career();
    const first = await continueCareer(c, sim);
    expect(first.stop).toBe("message");
    expect(first.items!.some((m) => m.key === "board.objective")).toBe(true);
    for (const m of first.items!) answerInbox(c, m.id, "playoffs");
    expect(c.objective).toBe("playoffs");
    const md = await continueCareer(c, sim);
    expect(md.stop).toBe("matchDay");
    expect(md.fixture!.home === c.userTeamId || md.fixture!.away === c.userTeamId).toBe(true);
    // Leaving the match day without playing is refused: Continue stays on it.
    const again = await continueCareer(c, sim);
    expect(again.stop).toBe("matchDay");
    expect(again.daysAdvanced).toBe(0);
    playUserMatch(c, md);
    const rows = groupStandings(c.season, "stage1", c.season.stages[0]!.groups.alpha.includes(c.userTeamId) ? "alpha" : "omega");
    expect(rows.find((r) => r.teamId === c.userTeamId)!.played).toBe(1);
    expect(c.inbox.some((m) => m.key === "result.win" || m.key === "result.loss")).toBe(true);
  });

  it("plays a whole season to the season end and opens the next one with advanceSeason", async () => {
    const c = career();
    const startSeason = c.season.season;
    const end = await playUntil(c, (r) => r.stop === "seasonEnd");
    expect(end.date).toBe(c.season.end);
    expect(c.season.fixtures.every((f) => !!f.result)).toBe(true);
    expect(c.season.stages.every((s) => !!s.champion)).toBe(true);
    expect(c.inbox.some((m) => m.key === "season.review")).toBe(true);
    // Development uses the maps actually played: a starter's career maps grow by exactly that.
    const starter = Object.entries(c.stats).filter(([id]) => c.world.players[id]?.hasRatings).sort((a, b) => b[1].maps - a[1].maps || a[0].localeCompare(b[0]))[0]!;
    const before = c.world.players[starter[0]]!.careerMaps;
    expect(starter[1].maps).toBeGreaterThan(10);
    expect(starter[1].kills).toBeGreaterThan(0);
    expect(new Set(Object.values(c.stats).map((l) => l.form)).size).toBeGreaterThan(20); // form is per player
    const rosterBefore = new Set([...c.world.teams[c.userTeamId]!.roster, ...c.world.teams[c.userTeamId]!.academy]);
    await continueCareer(c, sim); // leaves the season's last day → transition
    // The season loop left the manager's squad alone: no signings, academy picks or releases for it.
    const rec = c.world.history[c.world.history.length - 1]!;
    expect(rec.signings.filter((x) => x.teamId === c.userTeamId)).toHaveLength(0);
    expect(rec.academyPicks.filter((x) => x.teamId === c.userTeamId)).toHaveLength(0);
    expect(rec.releases.filter((x) => x.teamId === c.userTeamId)).toHaveLength(0);
    for (const id of [...c.world.teams[c.userTeamId]!.roster, ...c.world.teams[c.userTeamId]!.academy]) expect(rosterBefore.has(id), id).toBe(true);
    expect(c.world.season).toBe(startSeason + 1);
    expect(c.season.season).toBe(startSeason + 1);
    expect(c.history).toHaveLength(1);
    expect(c.history[0]!.objectiveMet).toBeTypeOf("boolean");
    const p = c.world.players[starter[0]];
    if (p) expect(p.careerMaps).toBe(before + starter[1].maps);
    expect(c.season.fixtures.length).toBeGreaterThan(30);
    expect(Object.keys(c.stats)).toHaveLength(0);
  });

  it("is deterministic: the same seed gives the same season, result for result", async () => {
    const a = career(21); const b = career(21);
    await playUntil(a, (r) => r.stop === "seasonEnd");
    await playUntil(b, (r) => r.stop === "seasonEnd");
    expect(serializeCareer(a, "t")).toBe(serializeCareer(b, "t"));
  });
});

describe("saves", () => {
  it("round-trips mid-season: a loaded career plays on exactly like the live one", async () => {
    const live = career(33);
    await playUntil(live, (r) => r.stop === "matchDay" && live.season.fixtures.filter((f) => f.result).length > 20);
    const text = serializeCareer(live, "t");
    const loaded = deserializeCareer(text);
    expect(serializeCareer(loaded, "t")).toBe(text);
    expect(dayAgenda(loaded)).toEqual(dayAgenda(live));
    await playUntil(live, (r) => r.stop === "seasonEnd");
    await playUntil(loaded, (r) => r.stop === "seasonEnd");
    expect(serializeCareer(loaded, "t")).toBe(serializeCareer(live, "t"));
  });
});

describe("hooks", () => {
  it("runs registered hooks on days, months, results and the season end, with saved state and inbox posts", async () => {
    const seen = { days: 0, months: [] as string[], results: 0, seasonEnd: 0, seasonStart: 0 };
    const off = registerCareerHook({
      id: "test-ops",
      onDay(_w, _d, ctx) { seen.days += 1; ctx.ext(() => ({ n: 0 })).n += 1; },
      onMonth(_w, date, ctx) { seen.months.push(date); ctx.post({ category: "finance", key: "test.month", from: "board", params: { r: Math.round(ctx.rng("x")() * 100) } }); },
      onMatchResult() { seen.results += 1; },
      onSeasonEnd() { seen.seasonEnd += 1; },
      onSeasonStart() { seen.seasonStart += 1; },
    });
    try {
      const c = career(44);
      await playUntil(c, (r) => r.stop === "seasonEnd");
      await continueCareer(c, sim);
      expect(seen.days).toBeGreaterThan(200);
      expect((c.ext["test-ops"] as { n: number }).n).toBe(seen.days);
      expect(seen.months[0]).toBe("2026-02-01");
      expect(c.inbox.filter((m) => m.source === "test-ops")).toHaveLength(seen.months.length);
      expect(seen.results).toBe(74);
      expect(seen.seasonEnd).toBe(1);
      expect(seen.seasonStart).toBe(1);
    } finally { off(); }
  });
});
