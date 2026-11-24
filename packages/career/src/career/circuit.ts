// The international side of the season, built like the real circuit's shape:
//
//   Kickoff ─ Stage 1 ─ MASTERS 1 ─ Stage 2 ─ MASTERS 2 ─ CHAMPIONS      (regional stages in all four
//                                                                          regions in parallel)
//
// Champions Points (CP) are what qualifies. Every competition awards points by final placing
// (CIRCUIT_MODEL.points); a region's teams are ranked by their CP so far:
//   Masters 1   top 3 per region by CP after Kickoff and Stage 1   → 12 teams
//   Masters 2   top 3 per region by CP after Stage 2 (all events so far count) → 12 teams
//   Champions   top 4 per region by CP after Masters 2             → 16 teams
// A region with fewer eligible teams sends what it has (the field is topped up from the best
// remaining CP in the other regions, so every event is full).
//
// Format of an international event: the field is seeded by CP (snake) into four groups — three
// teams at Masters, four at Champions — each a round robin of Bo3 series on Friday–Sunday; the top
// two of each group go to an 8-team DOUBLE-ELIMINATION bracket, Bo3 throughout and a Bo5 grand
// final (no bracket reset): 14 series, played on six consecutive days from the next Friday.
//
//   UB R1  A1–B2, C1–D2, B1–A2, D1–C2          LB R1  L(UB R1 a)–L(UB R1 b), L(UB R1 c)–L(UB R1 d)
//   UB R2  W(a)–W(b), W(c)–W(d)                LB R2  W(LB R1 a)–L(UB R2 b), W(LB R1 b)–L(UB R2 a)
//   UB F   the two UB R2 winners               LB R3  the two LB R2 winners
//   LB F   W(LB R3)–L(UB F)                    GF     W(UB F)–W(LB F), Bo5
//
// Not modelled: region-protected draws, per-region slot guarantees beyond the quotas above,
// double elimination in the regional stages (their playoffs are single elimination).
import type { World } from "../model.ts";
import { REGIONS, type Region } from "../regions.ts";
import { deriveSeed, mulberry32 } from "../rng.ts";
import { teamStrength } from "../club/market.ts";
import { addDays, type IsoDate } from "./calendar.ts";
import { roundRobin, stageFirstFriday, SCHEDULE_MODEL, stagePlacings, stageDone, tableOf, resolveSlots } from "./schedule.ts";
import type {
  BracketRound, CareerState, CircuitState, CompetitionId, Fixture, IntlEvent, IntlId, PointsAward, SeasonState, SlotSource, StageId,
} from "./types.ts";

export const CIRCUIT_MODEL = {
  /** Champions Points for a final placing (1 = champion) in a regional stage; 0 below the table. */
  stagePoints: [8, 6, 5, 4, 2, 2, 2, 2] as readonly number[],
  /** … in Masters. */
  mastersPoints: [12, 10, 8, 7, 5, 5, 4, 4, 1, 1, 1, 1] as readonly number[],
  /** … in Champions. */
  championsPoints: [16, 13, 10, 8, 6, 6, 5, 5, 2, 2, 2, 2, 1, 1, 1, 1] as readonly number[],
  /** Teams a region sends. */
  quota: { masters1: 3, masters2: 3, champions: 4 } as Record<IntlId, number>,
  /** Field size and group size. */
  field: { masters1: 12, masters2: 12, champions: 16 } as Record<IntlId, number>,
  groupSize: { masters1: 3, masters2: 3, champions: 4 } as Record<IntlId, number>,
  /** Competitions that must be over before an event is drawn. */
  after: { masters1: "stage1", masters2: "stage2", champions: "masters2" } as Record<IntlId, CompetitionId>,
  /** Series format of a bracket round. */
  gfFormat: "bo5" as const,
} as const;

export const INTL_EVENTS: readonly IntlId[] = ["masters1", "masters2", "champions"];
export const isIntl = (id: string): id is IntlId => (INTL_EVENTS as readonly string[]).includes(id);

export function newCircuit(season: number): CircuitState {
  return {
    season, points: {}, awards: [], done: [],
    events: INTL_EVENTS.map((id): IntlEvent => ({ id, teams: [], qualified: {}, groups: {}, fixtures: [], start: null, end: null, champion: null, placings: [] })),
  };
}

// --- leagues, fixtures, helpers ------------------------------------------------------------------

/** Every league of the season: the manager's own first, then the other regions'. */
export const leaguesOf = (state: Pick<CareerState, "season" | "others">): SeasonState[] => [state.season, ...state.others];

/** Every fixture of the season (all regions' leagues and the international events). */
export function allFixtures(state: Pick<CareerState, "season" | "others" | "circuit">): Fixture[] {
  return [...state.season.fixtures, ...state.others.flatMap((l) => l.fixtures), ...state.circuit.events.flatMap((e) => e.fixtures)];
}

export const eventOf = (circuit: CircuitState, id: IntlId): IntlEvent => circuit.events.find((e) => e.id === id)!;

/** The competition a fixture belongs to for display: its league's region or the international event. */
export const isInternational = (f: Fixture): boolean => isIntl(f.stage);

// --- Champions Points --------------------------------------------------------------------------

/** Points for a 1-based placing in a competition. */
export function pointsFor(competition: CompetitionId, place: number): number {
  const table = competition === "champions" ? CIRCUIT_MODEL.championsPoints : isIntl(competition) ? CIRCUIT_MODEL.mastersPoints : CIRCUIT_MODEL.stagePoints;
  return table[place - 1] ?? 0;
}

export function award(circuit: CircuitState, competition: CompetitionId, placings: readonly string[], world: World): PointsAward[] {
  const out: PointsAward[] = [];
  placings.forEach((teamId, i) => {
    const points = pointsFor(competition, i + 1);
    if (points <= 0) return;
    const a: PointsAward = { event: competition, region: world.teams[teamId]?.region, teamId, place: i + 1, points };
    circuit.awards.push(a);
    circuit.points[teamId] = (circuit.points[teamId] ?? 0) + points;
    out.push(a);
  });
  return out;
}

/** A region's teams ranked by Champions Points (ties: the better strength, then id). */
export function regionRanking(world: World, circuit: CircuitState, region: Region, teams: readonly string[]): string[] {
  return teams.filter((id) => world.teams[id]?.region === region)
    .sort((a, b) => (circuit.points[b] ?? 0) - (circuit.points[a] ?? 0) || teamStrength(world, b) - teamStrength(world, a) || a.localeCompare(b));
}

/** The qualified field of an international event, seed order (best CP first). */
export function qualifiers(world: World, circuit: CircuitState, leagues: readonly SeasonState[], id: IntlId): { teams: string[]; qualified: IntlEvent["qualified"] } {
  const q = CIRCUIT_MODEL.quota[id];
  const field = CIRCUIT_MODEL.field[id];
  const chosen: string[] = [];
  for (const l of leagues) chosen.push(...regionRanking(world, circuit, l.region, l.teams).slice(0, q));
  if (chosen.length < field) {
    const rest = leagues.flatMap((l) => l.teams).filter((t) => !chosen.includes(t))
      .sort((a, b) => (circuit.points[b] ?? 0) - (circuit.points[a] ?? 0) || teamStrength(world, b) - teamStrength(world, a) || a.localeCompare(b));
    chosen.push(...rest.slice(0, field - chosen.length));
  }
  const teams = chosen.sort((a, b) => (circuit.points[b] ?? 0) - (circuit.points[a] ?? 0) || teamStrength(world, b) - teamStrength(world, a) || a.localeCompare(b));
  return { teams, qualified: Object.fromEntries(teams.map((t) => [t, { region: world.teams[t]!.region, points: circuit.points[t] ?? 0 }])) };
}

// --- drawing an event ---------------------------------------------------------------------------------

const GROUP_IDS = ["a", "b", "c", "d"] as const;

/** Snake the seeded field into the four groups. */
export function snakeInto(teams: readonly string[]): Record<string, string[]> {
  const g: Record<string, string[]> = { a: [], b: [], c: [], d: [] };
  teams.forEach((t, i) => {
    const row = Math.floor(i / 4);
    const col = row % 2 === 0 ? i % 4 : 3 - (i % 4);
    g[GROUP_IDS[col]!]!.push(t);
  });
  return g;
}

/** Fill an event: its groups (round robins on Fri–Sun) and the double-elimination bracket. */
export function drawEvent(event: IntlEvent, season: number, teams: readonly string[], qualified: IntlEvent["qualified"], firstFriday: IsoDate, seed: number): void {
  event.teams = [...teams];
  event.qualified = qualified;
  event.groups = snakeInto(teams);
  event.fixtures = [];
  const rng = mulberry32(deriveSeed(seed, `draw:${season}:${event.id}`));
  const prefix = `${season}-${event.id}`;
  const groupFormat = "bo3";
  for (const g of GROUP_IDS) {
    roundRobin(event.groups[g]!, rng).forEach((round, r) => {
      round.forEach(([home, away], i) => {
        event.fixtures.push({ id: `${prefix}-${g}${r + 1}-${i + 1}`, season, stage: event.id, phase: "group", group: g, round: r + 1, date: addDays(firstFriday, r), format: groupFormat, home, away });
      });
    });
  }
  // Playoffs from the next Friday.
  const d0 = addDays(firstFriday, 7);
  const seedOf = (group: string, rank: number): SlotSource => ({ kind: "seed", group, rank });
  const win = (fixtureId: string): SlotSource => ({ kind: "winner", fixtureId });
  const lose = (fixtureId: string): SlotSource => ({ kind: "loser", fixtureId });
  const po = (id: string, round: BracketRound, day: number, homeFrom: SlotSource, awayFrom: SlotSource, format: "bo3" | "bo5" = "bo3"): string => {
    event.fixtures.push({ id: `${prefix}-${id}`, season, stage: event.id, phase: "playoff", round, date: addDays(d0, day), format, home: null, away: null, homeFrom, awayFrom });
    return `${prefix}-${id}`;
  };
  const u1 = [po("ub1a", "ubr1", 0, seedOf("a", 1), seedOf("b", 2)), po("ub1b", "ubr1", 0, seedOf("c", 1), seedOf("d", 2)),
    po("ub1c", "ubr1", 0, seedOf("b", 1), seedOf("a", 2)), po("ub1d", "ubr1", 0, seedOf("d", 1), seedOf("c", 2))];
  const l1 = [po("lb1a", "lbr1", 1, lose(u1[0]!), lose(u1[1]!)), po("lb1b", "lbr1", 1, lose(u1[2]!), lose(u1[3]!))];
  const u2 = [po("ub2a", "ubr2", 1, win(u1[0]!), win(u1[1]!)), po("ub2b", "ubr2", 1, win(u1[2]!), win(u1[3]!))];
  const l2 = [po("lb2a", "lbr2", 2, win(l1[0]!), lose(u2[1]!)), po("lb2b", "lbr2", 2, win(l1[1]!), lose(u2[0]!))];
  const uf = po("ubf", "ubf", 2, win(u2[0]!), win(u2[1]!));
  const l3 = po("lb3", "lbr3", 3, win(l2[0]!), win(l2[1]!));
  const lf = po("lbf", "lbf", 4, win(l3), lose(uf));
  po("gf", "gf", 5, win(uf), win(lf), CIRCUIT_MODEL.gfFormat);
  event.fixtures.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  event.start = firstFriday;
  event.end = addDays(d0, 5);
}

/** The first Friday an event may start: its anchor, and a week after the previous competition. */
export function eventStart(season: number, id: IntlId, notBefore: IsoDate | null): IsoDate {
  return stageFirstFriday(season, id, notBefore);
}

// --- standings and placings of an event ------------------------------------------------------------

export function eventGroupTable(event: IntlEvent, group: string) {
  return tableOf(event.groups[group] ?? [], event.fixtures.filter((f) => f.phase === "group" && f.group === group));
}

export const eventGroupsDone = (event: IntlEvent): boolean => {
  const fx = event.fixtures.filter((f) => f.phase === "group");
  return fx.length > 0 && fx.every((f) => !!f.result);
};

export const eventDone = (event: IntlEvent): boolean => !!event.fixtures.find((f) => f.round === "gf")?.result;

/** Put teams into the bracket as their sources resolve. Returns the fixtures that just got both teams. */
export function resolveEvent(event: IntlEvent): Fixture[] {
  return resolveSlots(event.fixtures, (_stage, group, rank) => (eventGroupsDone(event) ? eventGroupTable(event, group)[rank - 1]?.teamId ?? null : null));
}

/** Final placings: GF winner/loser, LB final loser, LB R3 loser, LB R2 losers, LB R1 losers, then group exits by record. */
export function eventPlacings(event: IntlEvent): string[] {
  const fx = (round: BracketRound) => event.fixtures.filter((f) => f.round === round);
  const loser = (f: Fixture): string => (f.result!.winner === f.home ? f.away! : f.home!);
  const out: string[] = [];
  const gf = fx("gf")[0];
  if (!gf?.result) return out;
  out.push(gf.result.winner, loser(gf));
  out.push(loser(fx("lbf")[0]!), loser(fx("lbr3")[0]!));
  out.push(...fx("lbr2").map(loser).sort());
  out.push(...fx("lbr1").map(loser).sort());
  const rest = event.teams.filter((t) => !out.includes(t));
  // Group exits: ordered by their group-stage record (all groups pooled).
  const pooled = tableOf(rest, event.fixtures.filter((f) => f.phase === "group" && f.home && f.away && rest.includes(f.home) && rest.includes(f.away)));
  out.push(...rest.slice().sort((a, b) => pooledRank(pooled, a) - pooledRank(pooled, b)));
  return out;
}
const pooledRank = (rows: ReturnType<typeof tableOf>, id: string): number => {
  const r = rows.find((x) => x.teamId === id);
  return r ? -(r.wins * 1000 + (r.mapsWon - r.mapsLost) * 10 + (r.roundsWon - r.roundsLost) / 100) : 0;
};

// --- stage placings across the manager's season and the others' --------------------------------------

/** Placings of a regional stage in one league (empty until its final is played). */
export const leaguePlacings = (league: SeasonState, stage: StageId): string[] => (stageDone(league, stage) ? stagePlacings(league, stage) : []);

export { SCHEDULE_MODEL, REGIONS };
