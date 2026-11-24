// Quick series estimate: plays a series round by round from the two lineups' attributes and the
// teams' map pools, without the match engine. The desktop's default for AI-vs-AI series (a whole
// season of ~520 series in a second or two; the full engine is a setting), the instant result, the
// browser build and the package tests. Its constants are calibrated against the engine
// (tools/career/calibrate-quick-sim.mts, docs/CAREER_MODE.md §4).
//
//   s_team      = mean of the five's ability attributes TODAY (readiness — fatigue and sharpness —
//                 applied, career/readiness.ts)
//   map pool    = each team's win share on a map from its real record since 2025 (when records are
//                 registered), shrunk to ½ with MAP_PRIOR games of prior:
//                   share = (wins + MAP_PRIOR/2) / (games + MAP_PRIOR)
//                 Both teams ban the map they are relatively worst on, then the picks alternate
//                 (home first), each team picking the remaining map it is relatively best on; the
//                 decider is the best remaining for the team that did not pick last.
//   P(round)    = sigmoid(roundSlope · (s_home − s_away) + mapSlope · (share_home − share_away) + σ · z)
//                 z ~ N(0,1) drawn once per MAP (the day's form of the two teams on that map): rounds are
//                 not independent in the engine, so series are more upset-prone than independent rounds
//                 imply. σ = mapNoiseSd is fitted on engine series (docs/CAREER_MODE.md §4).
//   a map       = rounds until one team has 13 with a 2-round lead (overtime past 12–12)
// Teams without a record, and every map when no records are registered, get a stable seeded lean
// N(0, comfortSd) instead.
import { caOf } from "../season.ts";
import { matchAttributes } from "./readiness.ts";
import { UNRATED_ABILITY } from "../scouting.ts";
import { deriveSeed, mulberry32, normal, streamFor } from "../rng.ts";
import type { CareerState, MapResult, SeriesOutcome, SeriesRequest, SeriesSimulator } from "./types.ts";

export const QUICK_SIM = {
  /**
   * Round-win slope per unit of lineup-ability difference, fitted to the match engine by maximum
   * likelihood (tools/career/calibrate-quick-sim.mts, docs/CAREER_MODE.md §4).
   */
  roundSlope: 7.9,
  /** Round-win logit per unit of map-share difference (fitted together; weak evidence, SE ≈ 0.24 on 0.37). */
  mapSlope: 0.4,
  /** Per-map form noise on the round logit (sd). Fitted on engine series: see calibrate-quick-sim.mts. */
  mapNoiseSd: 0.3,
  /** Games of ½-prior in a team's map share. */
  mapPrior: 6,
  /** Seeded map lean for teams without records (ability units). */
  comfortSd: 0.01,
  /** The pool the quick estimate draws maps from (the engine's DEFAULT_MAP_POOL). */
  pool: ["Abyss", "Ascent", "Haven", "Lotus", "Split", "Summit", "Sunset"],
  maxRounds: 40,
} as const;

/** `[games, wins]` per map per team id (the shape of the desktop's team_maps.json). */
export type MapRecords = Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>;
let RECORDS: MapRecords | null = null;
/** Register the teams' real map records (the desktop passes team_maps.json; absent → seeded leans). */
export function setMapRecords(r: MapRecords | null): void { RECORDS = r; }

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** A team's shrunk win share on a map, or null without a record for the team. */
export function mapShare(teamId: string, map: string): number | null {
  const rec = RECORDS?.[teamId];
  if (!rec) return null;
  const [g, w] = rec[map] ?? [0, 0];
  return (w + QUICK_SIM.mapPrior / 2) / (g + QUICK_SIM.mapPrior);
}

export function lineupStrength(career: CareerState, lineup: readonly string[]): number {
  const w = career.world;
  if (lineup.length === 0) return UNRATED_ABILITY;
  let sum = 0;
  for (const id of lineup) {
    const p = w.players[id];
    // Today's ability: readiness (fatigue, sharpness) applied to the attributes (career/readiness.ts).
    const attrs = p ? matchAttributes(career, p) : null;
    sum += p ? (attrs ? caOf(w, { ...p, attributes: attrs }) : p.ca) ?? UNRATED_ABILITY : UNRATED_ABILITY;
  }
  // A short roster plays with empty seats filled by the league's unrated level.
  return (sum + UNRATED_ABILITY * Math.max(0, 5 - lineup.length)) / Math.max(5, lineup.length);
}

/** Map term of the round logit: slope · (share_home − share_away), or the seeded leans without records. */
export function mapEdge(career: CareerState, home: string, away: string, map: string): number {
  const a = mapShare(home, map); const b = mapShare(away, map);
  if (a !== null && b !== null) return QUICK_SIM.mapSlope * (a - b);
  const lean = (t: string) => QUICK_SIM.comfortSd * QUICK_SIM.roundSlope * normal(streamFor(career.seed, `comfort:${career.season.season}:${t}:${map}`));
  return lean(home) - lean(away);
}

/** The maps of a series: bans, alternating picks, decider (see the header). Returns `games` maps in order. */
export function pickMaps(career: CareerState, home: string, away: string, games: number, rng: () => number): string[] {
  const pool: string[] = [...QUICK_SIM.pool];
  const edge = (m: string) => mapEdge(career, home, away, m); // + favours home
  if (games === 1) return [pool[Math.floor(rng() * pool.length)]!];
  const left = [...pool];
  const take = (m: string) => { left.splice(left.indexOf(m), 1); return m; };
  const best = (sign: 1 | -1) => [...left].sort((a, b) => sign * (edge(b) - edge(a)) || a.localeCompare(b))[0]!;
  take(best(-1)); // home bans the map it is relatively worst on …
  take(best(1)); // … away bans the one it is relatively worst on
  const out: string[] = [];
  for (let g = 0; g < games; g++) {
    if (g === games - 1) out.push(take(best(g % 2 === 0 ? -1 : 1))); // decider: the picker's opponent's choice
    else out.push(take(best(g % 2 === 0 ? 1 : -1))); // home picks first
  }
  return out;
}

/**
 * Kills per player on a quick-sim map. A team's kills ≈ 3.6 · its rounds won + 1.4 · its rounds
 * lost (the other team's deaths are the same number); each player's share is ∝
 * exp(8 · (ca − team mean) + noise), deaths spread evenly with noise. Only the shape matters (it
 * feeds form), not exact box scores.
 */
function killLines(career: CareerState, req: SeriesRequest, h: number, a: number, rng: () => number): Record<string, { k: number; d: number }> {
  const out: Record<string, { k: number; d: number }> = {};
  const side = (lineup: readonly string[], won: number, lost: number, deaths: number) => {
    const cas = lineup.map((id) => career.world.players[id]?.ca ?? UNRATED_ABILITY);
    const mean = cas.reduce((s, x) => s + x, 0) / Math.max(1, cas.length);
    const kw = cas.map((c) => Math.exp(8 * (c - mean) + 0.35 * (rng() * 2 - 1)));
    const dw = cas.map(() => 1 + 0.4 * (rng() * 2 - 1));
    const kills = Math.round(3.6 * won + 1.4 * lost);
    const sk = kw.reduce((s, x) => s + x, 0); const sd = dw.reduce((s, x) => s + x, 0);
    lineup.forEach((id, i) => { out[id] = { k: Math.round((kills * kw[i]!) / sk), d: Math.round((deaths * dw[i]!) / sd) }; });
    return kills;
  };
  const awayKills = Math.round(3.6 * a + 1.4 * h);
  const homeKills = side(req.home.lineup, h, a, awayKills);
  side(req.away.lineup, a, h, homeKills);
  return out;
}

/** Constants a calibration run can override (defaults: QUICK_SIM). */
export interface QuickTuning { roundSlope?: number; mapNoiseSd?: number }

export function quickSeriesWith(req: SeriesRequest, career: CareerState, tuning: QuickTuning = {}): Omit<SeriesOutcome, "lineups"> {
  const slope = tuning.roundSlope ?? QUICK_SIM.roundSlope;
  const noise = tuning.mapNoiseSd ?? QUICK_SIM.mapNoiseSd;
  const rng = mulberry32(deriveSeed(req.seed, "quick"));
  const games = req.format === "bo5" ? 5 : req.format === "bo3" ? 3 : 1;
  const need = Math.floor(games / 2) + 1;
  const maps = pickMaps(career, req.home.teamId, req.away.teamId, games, rng);
  const base = slope * (lineupStrength(career, req.home.lineup) - lineupStrength(career, req.away.lineup));
  const results: MapResult[] = [];
  const won: [number, number] = [0, 0];
  for (let g = 0; g < games && won[0] < need && won[1] < need; g++) {
    const map = maps[g]!;
    const z = normal(rng);
    const p = sigmoid(base + mapEdge(career, req.home.teamId, req.away.teamId, map) + noise * z);
    let h = 0; let a = 0;
    while (!((h >= 13 || a >= 13) && Math.abs(h - a) >= 2) && h + a < QUICK_SIM.maxRounds) {
      if (rng() < p) h += 1; else a += 1;
    }
    if (h === a) { if (rng() < p) h += 1; else a += 1; } // round cap reached level: one deciding round
    results.push({ map, score: [h, a], ...(h + a > 24 ? { overtime: true } : {}), players: killLines(career, req, h, a, rng) });
    won[h > a ? 0 : 1] += 1;
  }
  return { winner: won[0] > won[1] ? req.home.teamId : req.away.teamId, mapsWon: won, maps: results, source: "quick" };
}

export const quickSeries: SeriesSimulator = (req, career) => quickSeriesWith(req, career);
