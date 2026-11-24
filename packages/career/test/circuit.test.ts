// The international circuit: four regional leagues in parallel, Kickoff → Stage 1 → Masters 1 →
// Stage 2 → Masters 2 → Champions, Champions Points qualification, double-elimination brackets,
// the news the manager gets, and the world sim depth setting.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData, mapRecordsFromGameData } from "../src/game-data.ts";
import {
  allFixtures, answerInbox, batchOf, CIRCUIT_MODEL, continueCareer, eventOf, fixtureScope, INTL_EVENTS, newCareer, pickMaps,
  quickSeries, QUICK_SIM, recordResult, regionTeams, REGIONS, seriesRequest, setMapRecords, SIM_DEPTHS, usesEngine, mapEdge, mapShare,
  teamStrength, stageFirstFriday, SCHEDULE_MODEL, type CareerState, type ContinueResult, type Fixture, type World,
} from "../src/index.ts";

let base: World;
const sim = batchOf(quickSeries);
const fresh = (): World => JSON.parse(JSON.stringify(base)) as World;
beforeAll(() => { base = worldFromGameData(4242); setMapRecords(mapRecordsFromGameData()); });

function career(seed: number, userTeam?: string): CareerState {
  const w = fresh();
  return newCareer(w, { seed, manager: { name: "T", nationality: "kr" }, userTeamId: userTeam ?? regionTeams(w, "pacific")[0]! });
}

function playMatch(c: CareerState, r: ContinueResult): void {
  const q = seriesRequest(c, r.fixture!);
  recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: "user", lineups: { home: q.home.lineup, away: q.away.lineup } });
}

/** Play until the season's last day (the review), or through it into the next season when `through`. */
async function playSeason(c: CareerState, through = false): Promise<void> {
  const target = c.season.season;
  for (let i = 0; i < 600; i++) {
    const r = await continueCareer(c, sim);
    if (r.stop === "seasonEnd") { if (through) await continueCareer(c, sim); return; }
    if (r.stop === "message") for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? "reject" : m.options![0]!.id);
    else if (r.stop === "matchDay") playMatch(c, r);
    if (c.season.season !== target) return;
  }
  throw new Error("season did not end");
}

describe("regional leagues in parallel", () => {
  it("every region has its own league; regions only meet at the international events", () => {
    const c = career(1);
    expect(c.others).toHaveLength(3);
    expect(new Set([c.season, ...c.others].map((l) => l.region)).size).toBe(4);
    for (const l of [c.season, ...c.others]) {
      expect(l.teams.length).toBeGreaterThanOrEqual(11);
      for (const f of l.fixtures) {
        expect(f.region).toBe(l.region);
        for (const t of [f.home, f.away]) if (t) expect(c.world.teams[t]!.region).toBe(l.region);
      }
    }
  });

  it("scopes: the manager's league, other regions' leagues, internationals", async () => {
    const c = career(2);
    expect(new Set(allFixtures(c).map((f) => fixtureScope(c, f)))).toEqual(new Set(["league", "other"]));
    await playSeason(c);
    expect(new Set(allFixtures(c).map((f) => fixtureScope(c, f)))).toEqual(new Set(["league", "other", "international"]));
  }, 120_000);
});

describe("the calendar fits every year", () => {
  it("Kickoff … Champions follow each other and end before the season does, 2026–2040", () => {
    const REGIONAL_DAYS = 44; // five group weeks, then the playoff weekends (schedule.ts drawStage)
    const EVENT_DAYS = 12; // groups Fri–Sun, playoffs from the next Friday for six days (circuit.ts drawEvent)
    const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const [em, ed] = SCHEDULE_MODEL.seasonEnd;
    for (let y = 2026; y <= 2040; y++) {
      let end: string | null = null;
      for (const id of ["kickoff", "stage1", "masters1", "stage2", "masters2", "champions"] as const) {
        const start = stageFirstFriday(y, id, end);
        if (end) expect(start > end, `${y} ${id}`).toBe(true);
        end = add(start, id === "kickoff" || id === "stage1" || id === "stage2" ? REGIONAL_DAYS : EVENT_DAYS);
      }
      expect(end! < `${y}-${String(em).padStart(2, "0")}-${String(ed).padStart(2, "0")}`, `${y}: Champions end ${end}`).toBe(true);
    }
  });
});

describe("a whole circuit season", () => {
  let c: CareerState;
  beforeAll(async () => {
    // A top team of its region: qualifies for several events, so its own inbox shows them.
    const w = fresh();
    c = newCareer(w, { seed: 7, manager: { name: "T", nationality: "kr" }, userTeamId: regionTeams(w, "americas")[0]! });
    await playSeason(c);
  }, 300_000);

  it("plays every fixture of the four leagues and the three events", () => {
    const fx = allFixtures(c);
    expect(fx.length).toBeGreaterThan(500);
    expect(fx.every((f) => !!f.result)).toBe(true);
    for (const e of c.circuit.events) expect(e.champion).toBeTruthy();
  });

  it("the calendar runs Kickoff, Stage 1, Masters 1, Stage 2, Masters 2, Champions in order without overlapping", () => {
    const span = (fs: Fixture[]) => [fs.map((f) => f.date).sort()[0]!, fs.map((f) => f.date).sort().pop()!] as const;
    const all = [...c.season.fixtures, ...c.others.flatMap((l) => l.fixtures)];
    const spans = [
      span(all.filter((f) => f.stage === "kickoff")), span(all.filter((f) => f.stage === "stage1")),
      span(eventOf(c.circuit, "masters1").fixtures), span(all.filter((f) => f.stage === "stage2")),
      span(eventOf(c.circuit, "masters2").fixtures), span(eventOf(c.circuit, "champions").fixtures),
    ];
    for (let i = 1; i < spans.length; i++) expect(spans[i]![0] > spans[i - 1]![1], `competition ${i}: ${spans[i]![0]} after ${spans[i - 1]![1]}`).toBe(true);
    expect(spans[5]![1] < c.season.end).toBe(true);
  });

  it("fields 12 / 12 / 16 teams, 3 / 3 / 4 per region, ranked by Champions Points at the draw", () => {
    const order = ["kickoff", "stage1", "masters1", "stage2", "masters2", "champions"];
    const pointsBefore = (event: string) => {
      const pts: Record<string, number> = {};
      for (const a of c.circuit.awards) if (order.indexOf(a.event) < order.indexOf(event)) pts[a.teamId] = (pts[a.teamId] ?? 0) + a.points;
      return pts;
    };
    for (const id of INTL_EVENTS) {
      const ev = eventOf(c.circuit, id);
      expect(ev.teams).toHaveLength(CIRCUIT_MODEL.field[id]);
      const pts = pointsBefore(id);
      for (const r of REGIONS) {
        const mine = ev.teams.filter((t) => c.world.teams[t]!.region === r);
        expect(mine, `${id} ${r}`).toHaveLength(CIRCUIT_MODEL.quota[id]);
        // Everyone qualified from a region has at least the points of every non-qualified team of it.
        const league = [c.season, ...c.others].find((l) => l.region === r)!;
        const worstIn = Math.min(...mine.map((t) => pts[t] ?? 0));
        for (const t of league.teams.filter((x) => !ev.teams.includes(x))) expect(pts[t] ?? 0, `${id} ${c.world.teams[t]!.name}`).toBeLessThanOrEqual(worstIn);
      }
    }
  });

  it("each event is groups then an 8-team double-elimination bracket: 14 series, Bo5 grand final", () => {
    for (const id of INTL_EVENTS) {
      const ev = eventOf(c.circuit, id);
      const po = ev.fixtures.filter((f) => f.phase === "playoff");
      expect(po).toHaveLength(14);
      expect(po.filter((f) => f.format === "bo5").map((f) => f.round)).toEqual(["gf"]);
      expect(ev.fixtures.filter((f) => f.phase === "group")).toHaveLength(id === "champions" ? 24 : 12);
      expect(new Set(po.flatMap((f) => [f.home!, f.away!])).size).toBe(8);
      const losses = new Map<string, number>();
      for (const f of po) { const l = f.result!.winner === f.home ? f.away! : f.home!; losses.set(l, (losses.get(l) ?? 0) + 1); }
      for (const [t, n] of losses) expect(n, c.world.teams[t]!.name).toBeLessThanOrEqual(2);
      expect(losses.get(ev.champion!) ?? 0).toBeLessThanOrEqual(1);
      // 3rd–8th are out on their second defeat; the placings cover the whole field once.
      expect(ev.placings).toHaveLength(ev.teams.length);
      expect(new Set(ev.placings).size).toBe(ev.teams.length);
      for (const t of ev.placings.slice(2, 8)) expect(losses.get(t)).toBe(2);
    }
  });

  it("Champions Points: the placing table awarded, summed per team", () => {
    const total: Record<string, number> = {};
    for (const a of c.circuit.awards) total[a.teamId] = (total[a.teamId] ?? 0) + a.points;
    expect(total).toEqual(c.circuit.points);
    const champ = eventOf(c.circuit, "champions");
    const a = c.circuit.awards.find((x) => x.event === "champions" && x.place === 1)!;
    expect(a.teamId).toBe(champ.champion);
    expect(a.points).toBe(CIRCUIT_MODEL.championsPoints[0]);
    expect(c.circuit.awards.filter((x) => x.event === "kickoff")).toHaveLength(CIRCUIT_MODEL.stagePoints.length * 4);
  });

  it("the manager hears about it: the race, qualification or the miss, draws, results and upsets", () => {
    const keys = c.inbox.map((m) => m.key);
    for (const k of ["circuit.race", "circuit.draw", "circuit.champion"]) expect(keys, k).toContain(k);
    expect(keys.filter((k) => k === "circuit.draw")).toHaveLength(3);
    expect(keys.filter((k) => k === "circuit.champion")).toHaveLength(3);
    expect(keys.filter((k) => k === "circuit.qualified" || k === "circuit.missed")).toHaveLength(3);
    expect(keys.filter((k) => k === "circuit.upset").length).toBeLessThan(25);
    if (eventOf(c.circuit, "masters1").teams.includes(c.userTeamId)) expect(keys).toContain("circuit.result");
  });
});

describe("the next season", () => {
  it("plays two seasons: a fresh circuit, points reset, history kept", async () => {
    const c = career(9);
    await playSeason(c, true);
    expect(c.season.season).toBe(2027);
    expect(c.circuit.season).toBe(2027);
    expect(Object.keys(c.circuit.points)).toHaveLength(0);
    expect(c.history).toHaveLength(1);
    expect(Object.keys(c.history[0]!.champions)).toEqual(expect.arrayContaining(["kickoff", "stage1", "stage2", "masters1", "masters2", "champions"]));
    await playSeason(c);
    expect(eventOf(c.circuit, "champions").champion).toBeTruthy();
    expect(allFixtures(c).every((f) => !!f.result)).toBe(true);
  }, 300_000);
});

describe("world sim depth", () => {
  it("quick plays nothing through the engine, league only the manager's league, full everything", () => {
    for (const scope of ["league", "international", "other"] as const) {
      expect(usesEngine("quick", scope)).toBe(false);
      expect(usesEngine("full", scope)).toBe(true);
    }
    expect(usesEngine("league", "league")).toBe(true);
    expect(usesEngine("league", "other")).toBe(false);
    expect(usesEngine("league", "international")).toBe(false);
    expect(SIM_DEPTHS).toEqual(["quick", "league", "full"]);
  });
});

describe("quick sim: strength and map pool", () => {
  it("a stronger lineup wins more series; the same request gives the same result", () => {
    const c = career(3);
    const teams = regionTeams(c.world, "emea");
    const strong = teams[0]!; const weak = teams[teams.length - 1]!;
    const fx = { id: "x", season: 2026, stage: "stage1", phase: "group", round: 1, date: "2026-03-06", format: "bo3", home: strong, away: weak } as Fixture;
    const mk = (seed: number) => ({ ...seriesRequest(c, fx), seed });
    let wins = 0;
    for (let i = 0; i < 200; i++) if (quickSeries(mk(i), c).winner === strong) wins += 1;
    expect(teamStrength(c.world, strong)).toBeGreaterThan(teamStrength(c.world, weak));
    expect(wins).toBeGreaterThan(110);
    expect(JSON.stringify(quickSeries(mk(5), c))).toBe(JSON.stringify(quickSeries(mk(5), c)));
  });

  it("map pools: a team's real record moves the map edge and its picks", () => {
    const c = career(4);
    const [a, b] = regionTeams(c.world, "emea");
    setMapRecords({ [a!]: { Lotus: [40, 36], Haven: [40, 8] }, [b!]: { Lotus: [40, 10], Haven: [40, 30] } });
    try {
      expect(mapShare(a!, "Lotus")).toBeGreaterThan(0.8);
      expect(mapEdge(c, a!, b!, "Lotus")).toBeGreaterThan(0);
      expect(mapEdge(c, a!, b!, "Haven")).toBeLessThan(0);
      const maps = pickMaps(c, a!, b!, 3, () => 0.5);
      expect(new Set(maps).size).toBe(3);
      expect(maps).not.toContain("Haven"); // a, the home side, bans the map it is relatively worst on
      expect(QUICK_SIM.pool).toEqual(expect.arrayContaining(maps));
    } finally { setMapRecords(mapRecordsFromGameData()); }
  });
});
