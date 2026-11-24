// Scouting knowledge (attribute fog), scout reports and the manager's academy inside a career.
// docs/GENERATED_PEOPLE.md §9, §11.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  ABILITY_KEYS, answerInbox, assignScoutMut, batchOf, clubScouts, continueCareer, demoteMut, deserializeCareer, estimateAbility,
  estimateForTeam, inviteToAcademyMut, knowledgeOf, loanOutMut, loanTargets, newCareer, priorKnowledge, promoteMut, quickSeries,
  recordResult, reportList, scoutGain, scoutingWeekMut, serializeCareer, seriesRequest, teamScout, viewPlayer, watchMatchMut,
  KNOWLEDGE_MODEL, SEASON_MODEL, estimateAttributes, attributeRangesForTeam,
  type CareerState, type ContinueResult, type World, type WorldPlayer,
} from "../src/index.ts";

let base: World;
const sim = batchOf(quickSeries);
const USER = (w: World): string => Object.values(w.teams).filter((t) => t.region === "pacific" && t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!.teamId;
function career(seed = 21): CareerState {
  const w = JSON.parse(JSON.stringify(base)) as World;
  return newCareer(w, { seed, manager: { name: "Test Manager", nationality: "kr" }, userTeamId: USER(w) });
}
function playUserMatch(state: CareerState, r: ContinueResult): void {
  const req = seriesRequest(state, r.fixture!);
  const out = quickSeries(req, state);
  recordResult(state, req.fixtureId, { ...out, source: "user", lineups: { home: req.home.lineup, away: req.away.lineup } });
}
async function playUntil(state: CareerState, until: (r: ContinueResult) => boolean, maxStops = 400): Promise<ContinueResult> {
  for (let i = 0; i < maxStops; i++) {
    const r = await continueCareer(state, sim);
    if (until(r)) return r;
    if (r.stop === "message") for (const m of r.items!) answerInbox(state, m.id, m.options![0]!.id);
    else if (r.stop === "matchDay") playUserMatch(state, r);
  }
  throw new Error("did not reach the stop");
}
const others = (c: CareerState) => Object.values(c.world.players).filter((p) => p.teamId !== c.userTeamId && p.hasRatings);
const width = (c: CareerState, p: WorldPlayer) => { const v = viewPlayer(c.world, p, c.date); return v.ca.hi - v.ca.lo; };

beforeAll(() => { base = worldFromGameData(4242); });

describe("attribute fog", () => {
  it("shows other clubs' players as ranges that hold the true values; own players almost exactly", () => {
    const c = career();
    expect(c.world.scouting?.teamId).toBe(c.userTeamId);
    for (const p of others(c).slice(0, 300)) {
      const v = viewPlayer(c.world, p, c.date);
      expect(v.own).toBe(false);
      for (const k of ABILITY_KEYS) {
        const r = v.attributes[k];
        if (!r) continue;
        const truth = (p.attributes![k] as { value: number }).value;
        expect(truth).toBeGreaterThanOrEqual(r.lo - 1e-4);
        expect(truth).toBeLessThanOrEqual(r.hi + 1e-4);
      }
      expect(p.ca!).toBeGreaterThanOrEqual(v.ca.lo - 1e-4);
      expect(p.ca!).toBeLessThanOrEqual(v.ca.hi + 1e-4);
      expect(p.pa!).toBeGreaterThanOrEqual(v.pa.lo - 1e-4);
      expect(p.pa!).toBeLessThanOrEqual(v.pa.hi + 1e-4);
      expect(v.pa.est).toBeGreaterThanOrEqual(v.ca.est);
    }
    const own = c.world.teams[c.userTeamId]!.roster.map((id) => c.world.players[id]!);
    for (const p of own) {
      const v = viewPlayer(c.world, p, c.date);
      expect(v.own).toBe(true);
      expect(v.ca.hi - v.ca.lo).toBeLessThan(2 * (KNOWLEDGE_MODEL.hOwnMin + KNOWLEDGE_MODEL.hOwnSpan) + 1e-9);
    }
  });

  it("knows famous players better than unknown prospects (reputation)", () => {
    const c = career();
    const pool = others(c);
    const famous = pool.filter((p) => !p.generated).sort((a, b) => priorKnowledge(b) - priorKnowledge(a))[0]!;
    const unknown = pool.find((p) => p.generated && p.careerMaps === 0)!;
    expect(priorKnowledge(famous)).toBeGreaterThan(priorKnowledge(unknown) + 0.2);
    expect(width(c, famous)).toBeLessThan(width(c, unknown));
  });

  it("narrows with a player assignment, fades when not refreshed, and a better scout learns faster", () => {
    const c = career();
    const w = c.world;
    const target = others(c).find((p) => p.generated && p.careerMaps === 0 && p.region !== w.teams[c.userTeamId]!.region)!;
    const scout = clubScouts(w, c.userTeamId)[0]!;
    const k0 = knowledgeOf(w, target, c.date);
    const w0 = width(c, target);
    expect(assignScoutMut(w, scout.staffId, "player", target.playerId, c.date)).toBeNull();
    let d = c.date;
    for (let i = 0; i < 4; i++) { d = new Date(Date.parse(d) + 7 * 864e5).toISOString().slice(0, 10); scoutingWeekMut(w, d); }
    const k1 = knowledgeOf(w, target, d);
    expect(k1).toBeGreaterThan(k0 + 0.4);
    expect(width({ ...c, date: d } as CareerState, target)).toBeLessThan(w0 * 0.7);
    expect(w.scouting!.reports[target.playerId]!.length).toBe(4);
    // Fade: half a year later without scouting.
    const later = new Date(Date.parse(d) + 180 * 864e5).toISOString().slice(0, 10);
    expect(knowledgeOf(w, target, later)).toBeLessThan(k1);
    expect(knowledgeOf(w, target, later)).toBeGreaterThanOrEqual(priorKnowledge(target));
    // The scout attribute → knowledge gain (the staff-market interface).
    expect(scoutGain({ ...scout, attributes: { ...scout.attributes, judgingAbility: 0.9 } })).toBeGreaterThan(scoutGain({ ...scout, attributes: { ...scout.attributes, judgingAbility: 0.2 } }));
  });

  it("learns about the players on the field when the club plays them", () => {
    const c = career();
    const opp = Object.values(c.world.teams).find((t) => t.teamId !== c.userTeamId && t.roster.length >= 5)!;
    const ids = opp.roster.slice(0, 5);
    const before = ids.map((id) => knowledgeOf(c.world, c.world.players[id]!, c.date));
    watchMatchMut(c.world, ids, 3, c.date);
    ids.forEach((id, i) => expect(knowledgeOf(c.world, c.world.players[id]!, c.date)).toBeGreaterThan(before[i]!));
  });

  it("routes only the manager's club through the fog; AI clubs keep their scout's estimate", () => {
    const c = career();
    const p = others(c)[0]!;
    const ai = Object.keys(c.world.teams).find((id) => id !== c.userTeamId)!;
    expect(estimateForTeam(c.world, ai, p)).toEqual(estimateAbility(c.world, teamScout(c.world, ai), p));
    const mine = estimateForTeam(c.world, c.userTeamId, p);
    const v = viewPlayer(c.world, p);
    expect(mine.ca).toBe(v.ca.est);
  });
});

describe("per-attribute ranges for the club screens ({value, lo, hi})", () => {
  it("hold the true value; a better scout gives narrower AI ranges; the manager's club gets the fog", () => {
    const c = career();
    const w = c.world;
    const p = others(c).find((x) => x.careerMaps === 0)!;
    const ai = Object.keys(w.teams).find((id) => id !== c.userTeamId)!;
    const scout = teamScout(w, ai)!;
    const good = estimateAttributes(w, { ...scout, attributes: { ...scout.attributes, judgingAbility: 0.95 } }, p);
    const bad = estimateAttributes(w, { ...scout, attributes: { ...scout.attributes, judgingAbility: 0.05 } }, p);
    for (const [k, r] of Object.entries(good)) {
      const truth = (p.attributes![k] as { value: number }).value;
      expect(truth).toBeGreaterThanOrEqual(r.lo - 1e-9);
      expect(truth).toBeLessThanOrEqual(r.hi + 1e-9);
      expect(r.hi - r.lo).toBeLessThan(bad[k]!.hi - bad[k]!.lo);
    }
    expect(attributeRangesForTeam(w, ai, p)).toEqual(estimateAttributes(w, scout, p));
    const mine = attributeRangesForTeam(w, c.userTeamId, p);
    expect(mine.aim!.value).toBe(viewPlayer(w, p).attributes.aim!.est);
  });
});

describe("scouting through the season", () => {
  it("writes reports on Mondays, posts them to the inbox, and survives save/load", async () => {
    const c = career();
    await playUntil(c, (r) => r.stop === "matchDay");
    expect(reportList(c.world).length).toBeGreaterThan(0);
    expect(c.inbox.some((m) => m.key === "scouting.weekly")).toBe(true);
    const loaded = deserializeCareer(serializeCareer(c));
    expect(loaded.world.scouting).toEqual(c.world.scouting);
  });

  it("holds a youth trial for the region's new prospects at the season start", async () => {
    const c = career(33);
    await playUntil(c, (r) => r.stop === "seasonEnd" || c.world.season > 2026, 800);
    if (c.world.season === 2026) await continueCareer(c, sim);
    await playUntil(c, () => c.world.season > 2026 && c.inbox.some((m) => m.key === "scouting.youthIntake"), 50).catch(() => undefined);
    expect(c.world.season).toBe(2027);
    expect(c.inbox.some((m) => m.key === "scouting.youthIntake")).toBe(true);
    const region = c.world.teams[c.userTeamId]!.region;
    const pros = c.world.history.at(-1)!.newPlayers.map((id) => c.world.players[id]!).filter((p) => p && p.region === region && p.teamId !== c.userTeamId);
    expect(pros.length).toBeGreaterThan(0);
    for (const p of pros) expect(knowledgeOf(c.world, p, c.date)).toBeGreaterThan(priorKnowledge(p));
  }, 120_000);
});

describe("the manager's academy", () => {
  it("invites a free prospect, promotes, demotes and loans out", () => {
    const c = career();
    const w = c.world;
    const t = w.teams[c.userTeamId]!;
    while (t.academy.length >= SEASON_MODEL.academySize) t.academy.pop();
    const pro = Object.values(w.players).filter((p) => p.status === "free" && p.age <= SEASON_MODEL.academyMaxAge && p.hasRatings).sort((a, b) => a.age - b.age || a.playerId.localeCompare(b.playerId))[0]!;
    expect(inviteToAcademyMut(w, pro.playerId, c.date)).toBeNull();
    expect(pro.status).toBe("academy");
    expect(w.club!.contracts[pro.playerId]!.squadRole).toBe("academy");
    expect(inviteToAcademyMut(w, pro.playerId, c.date)).toBe("notFree");
    const old = Object.values(w.players).find((p) => p.status === "free" && p.age > SEASON_MODEL.academyMaxAge)!;
    expect(inviteToAcademyMut(w, old.playerId, c.date)).toBe("tooOld");
    // own players are seen through the coaching staff
    expect(viewPlayer(w, pro).own).toBe(true);
    const rosterBefore = t.roster.length;
    if (rosterBefore < SEASON_MODEL.maxRoster) {
      expect(promoteMut(w, pro.playerId)).toBeNull();
      expect(t.roster).toContain(pro.playerId);
      expect(demoteMut(w, pro.playerId)).toBeNull();
      expect(t.academy).toContain(pro.playerId);
    }
    // Loan out (the career opens on 5 January, inside the pre-season window).
    const targets = loanTargets(w, pro.playerId);
    if (targets.length) {
      const err = loanOutMut(w, pro.playerId, targets[0]!, c.date);
      if (err === null) {
        expect(pro.teamId).toBe(targets[0]);
        expect(w.club!.loans.find((l) => l.playerId === pro.playerId)?.returnTo).toBe("academy");
      } else expect(["playerDeclined", "borrowerDeclined"]).toContain(err);
    }
  });
});
