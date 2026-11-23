// The season's competition for the manager's region, loosely on the real circuit's league stages:
//
//   Stage 1 and Stage 2, each:
//     · group stage — the league split into two groups (Alpha / Omega), a single round robin of
//       Bo3 series, one round per week, played Friday–Sunday;
//     · playoffs    — the top four of each group: quarter-finals (Bo3, cross-group 1v4 / 2v3),
//       semi-finals (Bo3) and a Bo5 final.
//   Stage 1 is drawn at the start of the season by strength (snake seeding); Stage 2 is drawn the
//   day after the Stage 1 final from the Stage 1 placings. The season ends on 1 September.
//
// Not modelled (docs/CAREER_MODE.md §7): the Kickoff, international events (Masters/Champions),
// double-elimination brackets, promotion/relegation, other regions' leagues.
import { caOf } from "../season.ts";
import { UNRATED_ABILITY } from "../scouting.ts";
import type { World } from "../model.ts";
import type { Region } from "../regions.ts";
import { deriveSeed, mulberry32, type Rng } from "../rng.ts";
import { addDays, isoDate, nextWeekday, type IsoDate } from "./calendar.ts";
import type { Fixture, GroupId, PlayoffRound, SeasonState, SlotSource, StageId, StageState } from "./types.ts";

export const SCHEDULE_MODEL = {
  /** League size per region (the real partner leagues have 12). */
  leagueSize: 12,
  /** Playoff places per group. */
  playoffPerGroup: 4,
  /** Group-stage weeks start on the first Friday on/after these dates (month, day). */
  stageStart: { stage1: [2, 1], stage2: [5, 1] } as Record<StageId, [number, number]>,
  /** At least this many days between a stage final and the next stage's first match. */
  minGapDays: 21,
  /** The season ends (review, development, intake) on this date (month, day). */
  seasonEnd: [9, 1] as [number, number],
  /** A brand-new career opens on this date of its first season (month, day). */
  careerStart: [1, 5] as [number, number],
  format: { group: "bo3", qf: "bo3", sf: "bo3", final: "bo5" } as const,
  /** A team needs this many rostered players to enter the league. */
  minRoster: 5,
} as const;

export const GROUPS: readonly GroupId[] = ["alpha", "omega"];
export const STAGES: readonly StageId[] = ["stage1", "stage2"];
const FRIDAY = 5;

/** Team strength: mean current ability of today's five (unrated players count as UNRATED_ABILITY). */
export function teamStrength(w: World, teamId: string): number {
  const t = w.teams[teamId];
  if (!t) return 0;
  const five = t.roster.slice(0, 5).map((id) => w.players[id]).filter((p) => !!p);
  if (five.length === 0) return 0;
  return five.reduce((s, p) => s + (p!.ca ?? caOf(w, p!) ?? UNRATED_ABILITY), 0) / 5;
}

/** Teams of a region that can field five, strongest first (ties by id). */
export function regionTeams(w: World, region: Region): string[] {
  return Object.values(w.teams)
    .filter((t) => t.region === region && t.roster.length >= SCHEDULE_MODEL.minRoster)
    .map((t) => ({ id: t.teamId, s: teamStrength(w, t.teamId) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

/** The league: the region's strongest teams, always including the manager's team. */
export function leagueTeams(w: World, region: Region, userTeamId: string): string[] {
  const all = regionTeams(w, region);
  const n = SCHEDULE_MODEL.leagueSize;
  const top = all.slice(0, n);
  if (!top.includes(userTeamId) && w.teams[userTeamId]) {
    if (top.length >= n) top.pop();
    top.push(userTeamId);
  }
  return top;
}

const shuffled = <T>(rng: Rng, xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

/** Snake seeding of a ranked list into the two groups: 1,4,5,8,… → Alpha; 2,3,6,7,… → Omega. */
export function snakeGroups(ranked: readonly string[]): Record<GroupId, string[]> {
  const g: Record<GroupId, string[]> = { alpha: [], omega: [] };
  ranked.forEach((id, i) => { (i % 4 === 0 || i % 4 === 3 ? g.alpha : g.omega).push(id); });
  return g;
}

/** Single round robin by the circle method; a bye pads an odd group. Returns rounds of [home, away]. */
export function roundRobin(teams: readonly string[], rng: Rng): Array<Array<[string, string]>> {
  const list: Array<string | null> = shuffled(rng, teams);
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]!; const b = list[n - 1 - i]!;
      if (a === null || b === null) continue;
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!); // rotate all but the first
  }
  return rounds;
}

function stageFirstFriday(season: number, stage: StageId, notBefore: IsoDate | null): IsoDate {
  const [m, d] = SCHEDULE_MODEL.stageStart[stage];
  let start = nextWeekday(isoDate(season, m, d), FRIDAY);
  if (notBefore) {
    const min = nextWeekday(addDays(notBefore, SCHEDULE_MODEL.minGapDays), FRIDAY);
    if (min > start) start = min;
  }
  return start;
}

/**
 * Draw a stage: the group round robins on consecutive weekends from `firstFriday`, then the
 * playoff bracket (teams filled in as the groups and earlier rounds finish).
 */
export function drawStage(season: SeasonState, stageId: StageId, groups: Record<GroupId, string[]>, firstFriday: IsoDate, seed: number): void {
  const stage = season.stages.find((s) => s.id === stageId)!;
  stage.groups = { alpha: [...groups.alpha], omega: [...groups.omega] };
  const rng = mulberry32(deriveSeed(seed, `draw:${season.season}:${stageId}`));
  const rr = { alpha: roundRobin(groups.alpha, rng), omega: roundRobin(groups.omega, rng) };
  const weeks = Math.max(rr.alpha.length, rr.omega.length);
  const prefix = `${season.season}-${stageId}`;
  for (let w = 0; w < weeks; w++) {
    const friday = addDays(firstFriday, 7 * w);
    const games = [
      ...(rr.alpha[w] ?? []).map((p) => ({ g: "alpha" as GroupId, p })),
      ...(rr.omega[w] ?? []).map((p) => ({ g: "omega" as GroupId, p })),
    ];
    const order = shuffled(rng, games);
    order.forEach(({ g, p }, i) => {
      season.fixtures.push({
        id: `${prefix}-${g[0]}${w + 1}-${i + 1}`,
        season: season.season, stage: stageId, phase: "group", group: g, round: w + 1,
        date: addDays(friday, i % 3), format: SCHEDULE_MODEL.format.group, home: p[0], away: p[1],
      });
    });
  }
  // Playoffs: the weekend after the last group round, then semis and the final a week later.
  const pf = addDays(firstFriday, 7 * weeks);
  const sat = addDays(pf, 7 + 1);
  const sun = addDays(pf, 7 + 2);
  const seedOf = (group: GroupId, rank: number): SlotSource => ({ kind: "seed", group, rank });
  const winner = (fixtureId: string): SlotSource => ({ kind: "winner", fixtureId });
  const po = (id: string, round: PlayoffRound, date: IsoDate, homeFrom: SlotSource, awayFrom: SlotSource): Fixture => ({
    id: `${prefix}-${id}`, season: season.season, stage: stageId, phase: "playoff", round, date,
    format: SCHEDULE_MODEL.format[round], home: null, away: null, homeFrom, awayFrom,
  });
  const qf = [
    po("qf1", "qf", pf, seedOf("alpha", 1), seedOf("omega", 4)),
    po("qf2", "qf", pf, seedOf("omega", 2), seedOf("alpha", 3)),
    po("qf3", "qf", addDays(pf, 1), seedOf("omega", 1), seedOf("alpha", 4)),
    po("qf4", "qf", addDays(pf, 1), seedOf("alpha", 2), seedOf("omega", 3)),
  ];
  const sf = [
    po("sf1", "sf", sat, winner(qf[0]!.id), winner(qf[1]!.id)),
    po("sf2", "sf", sat, winner(qf[2]!.id), winner(qf[3]!.id)),
  ];
  const fin = po("final", "final", sun, winner(sf[0]!.id), winner(sf[1]!.id));
  season.fixtures.push(...qf, ...sf, fin);
  season.fixtures.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  stage.start = firstFriday;
  stage.end = sun;
}

/** A new season: the league, Stage 1 drawn by strength, Stage 2 waiting for its draw. */
export function buildSeason(w: World, region: Region, userTeamId: string, season: number, seed: number): SeasonState {
  const teams = leagueTeams(w, region, userTeamId);
  const [em, ed] = SCHEDULE_MODEL.seasonEnd;
  const end = isoDate(season, em, ed);
  const st: SeasonState = {
    season, region, teams,
    stages: STAGES.map((id): StageState => ({ id, groups: { alpha: [], omega: [] }, start: null, end: null, drawDate: id === "stage1" ? isoDate(season, 1, 1) : end, champion: null })),
    fixtures: [],
    end,
    nextStart: addDays(end, 1),
    ended: false,
  };
  drawStage(st, "stage1", snakeGroups(teams), stageFirstFriday(season, "stage1", null), seed);
  return st;
}

// --- standings ------------------------------------------------------------------------------------

export interface StandingRow {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  mapsWon: number;
  mapsLost: number;
  roundsWon: number;
  roundsLost: number;
}

const emptyRow = (teamId: string): StandingRow => ({ teamId, played: 0, wins: 0, losses: 0, mapsWon: 0, mapsLost: 0, roundsWon: 0, roundsLost: 0 });

function addResult(rows: Map<string, StandingRow>, f: Fixture): void {
  if (!f.result || !f.home || !f.away) return;
  const h = rows.get(f.home); const a = rows.get(f.away);
  if (!h || !a) return;
  const r = f.result;
  h.played += 1; a.played += 1;
  if (r.winner === f.home) { h.wins += 1; a.losses += 1; } else { a.wins += 1; h.losses += 1; }
  h.mapsWon += r.mapsWon[0]; h.mapsLost += r.mapsWon[1];
  a.mapsWon += r.mapsWon[1]; a.mapsLost += r.mapsWon[0];
  for (const m of r.maps) {
    h.roundsWon += m.score[0]; h.roundsLost += m.score[1];
    a.roundsWon += m.score[1]; a.roundsLost += m.score[0];
  }
}

/** Order: series wins, map difference, round difference, head-to-head winner, team id. */
export function sortStandings(rows: StandingRow[], fixtures: readonly Fixture[]): StandingRow[] {
  const h2h = (a: string, b: string): number => {
    const f = fixtures.find((x) => x.result && ((x.home === a && x.away === b) || (x.home === b && x.away === a)));
    if (!f?.result) return 0;
    return f.result.winner === a ? -1 : 1;
  };
  return [...rows].sort((a, b) =>
    b.wins - a.wins
    || (b.mapsWon - b.mapsLost) - (a.mapsWon - a.mapsLost)
    || (b.roundsWon - b.roundsLost) - (a.roundsWon - a.roundsLost)
    || h2h(a.teamId, b.teamId)
    || a.teamId.localeCompare(b.teamId));
}

export function groupStandings(season: SeasonState, stageId: StageId, group: GroupId): StandingRow[] {
  const stage = season.stages.find((s) => s.id === stageId)!;
  const fixtures = season.fixtures.filter((f) => f.stage === stageId && f.phase === "group" && f.group === group);
  const rows = new Map(stage.groups[group].map((id) => [id, emptyRow(id)]));
  for (const f of fixtures) addResult(rows, f);
  return sortStandings([...rows.values()], fixtures);
}

export const groupStageDone = (season: SeasonState, stageId: StageId): boolean => {
  const fx = season.fixtures.filter((f) => f.stage === stageId && f.phase === "group");
  return fx.length > 0 && fx.every((f) => !!f.result);
};

export const stageDone = (season: SeasonState, stageId: StageId): boolean => {
  const fin = season.fixtures.find((f) => f.stage === stageId && f.round === "final");
  return !!fin?.result;
};

/**
 * Fill in playoff slots whose source is now known (group finished / earlier round played).
 * Returns the fixtures that got both teams in this call.
 */
export function resolvePlayoffs(season: SeasonState): Fixture[] {
  const filled: Fixture[] = [];
  for (const f of season.fixtures) {
    if (f.phase !== "playoff" || (f.home && f.away)) continue;
    const resolve = (src: SlotSource | undefined): string | null => {
      if (!src) return null;
      if (src.kind === "seed") {
        if (!groupStageDone(season, f.stage)) return null;
        return groupStandings(season, f.stage, src.group)[src.rank - 1]?.teamId ?? null;
      }
      return season.fixtures.find((x) => x.id === src.fixtureId)?.result?.winner ?? null;
    };
    const before = !!(f.home && f.away);
    f.home ??= resolve(f.homeFrom);
    f.away ??= resolve(f.awayFrom);
    if (!before && f.home && f.away) filled.push(f);
  }
  return filled;
}

/**
 * Final placing of every team in a stage (1 = champion): finalist, semi-finalists, quarter-
 * finalists, then the rest by group record. Used to seed the next stage and in the season review.
 */
export function stagePlacings(season: SeasonState, stageId: StageId): string[] {
  const fx = season.fixtures.filter((f) => f.stage === stageId);
  const loser = (f: Fixture | undefined): string | null => (f?.result && f.home && f.away ? (f.result.winner === f.home ? f.away : f.home) : null);
  const fin = fx.find((f) => f.round === "final");
  const out: string[] = [];
  if (fin?.result) out.push(fin.result.winner, loser(fin)!);
  const stage = season.stages.find((s) => s.id === stageId)!;
  const groupRank = new Map<string, number>();
  const all: StandingRow[] = [];
  for (const g of GROUPS) groupStandings(season, stageId, g).forEach((r, i) => { groupRank.set(r.teamId, i); all.push(r); });
  const byGroupRecord = (ids: string[]): string[] => sortStandings(all.filter((r) => ids.includes(r.teamId)), fx).map((r) => r.teamId);
  for (const round of ["sf", "qf"] as const) {
    const losers = fx.filter((f) => f.round === round).map(loser).filter((x): x is string => !!x && !out.includes(x));
    out.push(...byGroupRecord(losers));
  }
  const rest = [...stage.groups.alpha, ...stage.groups.omega].filter((id) => !out.includes(id));
  out.push(...byGroupRecord(rest));
  return out;
}

/** Draw Stage 2 from the Stage 1 placings (snake), first match at least three weeks after the final. */
export function drawNextStage(season: SeasonState, seed: number): StageId | null {
  const s2 = season.stages.find((s) => s.id === "stage2")!;
  if (s2.start || !stageDone(season, "stage1")) return null;
  const s1 = season.stages.find((s) => s.id === "stage1")!;
  drawStage(season, "stage2", snakeGroups(stagePlacings(season, "stage1")), stageFirstFriday(season.season, "stage2", s1.end), seed);
  return "stage2";
}

/** A brand-new career's first day. */
export const careerStartDate = (season: number): IsoDate => isoDate(season, SCHEDULE_MODEL.careerStart[0], SCHEDULE_MODEL.careerStart[1]);
