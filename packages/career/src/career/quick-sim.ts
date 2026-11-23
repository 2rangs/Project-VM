// Quick series estimate: plays a series round by round from the two lineups' attributes, without
// the match engine. Used by the package tests, the browser build and the "quick" background-sim
// setting; the desktop's default is the full engine (match-runner, off the UI thread).
//
//   s_team      = mean over the five of the ability attributes (current ability, 0..1)
//   comfort_map = a stable per-team, per-map lean ~ N(0, QUICK_SIM.mapComfortSd), seeded by
//                 (career seed, team, map, season) — some teams are simply better on some maps
//   P(round)    = sigmoid(QUICK_SIM.roundSlope · (s_home − s_away + comfort_home − comfort_away))
//   a map       = rounds until one team has 13 with a 2-round lead (overtime past 12–12)
//   map order   = the pool shuffled per fixture; a series ends when one side has won enough maps
import { caOf } from "../season.ts";
import { UNRATED_ABILITY } from "../scouting.ts";
import { deriveSeed, mulberry32, normal, streamFor } from "../rng.ts";
import type { CareerState, MapResult, SeriesOutcome, SeriesRequest, SeriesSimulator } from "./types.ts";

export const QUICK_SIM = {
  /**
   * Round-win slope per unit of ability difference. Set so the region's strongest team beats the
   * twelfth-strongest on about two maps in three (ability gap ≈ 0.08 → round share ≈ 0.55).
   */
  roundSlope: 2.5,
  mapComfortSd: 0.01,
  /** The pool the quick estimate draws maps from (the engine's DEFAULT_MAP_POOL). */
  pool: ["Abyss", "Ascent", "Haven", "Lotus", "Split", "Summit", "Sunset"],
  maxRounds: 40,
} as const;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function lineupStrength(career: CareerState, lineup: readonly string[]): number {
  const w = career.world;
  if (lineup.length === 0) return UNRATED_ABILITY;
  let sum = 0;
  for (const id of lineup) {
    const p = w.players[id];
    sum += p ? p.ca ?? caOf(w, p) ?? UNRATED_ABILITY : UNRATED_ABILITY;
  }
  // A short roster plays with empty seats filled by the league's unrated level.
  return (sum + UNRATED_ABILITY * Math.max(0, 5 - lineup.length)) / Math.max(5, lineup.length);
}

const comfort = (career: CareerState, teamId: string, map: string): number =>
  QUICK_SIM.mapComfortSd * normal(streamFor(career.seed, `comfort:${career.season.season}:${teamId}:${map}`));

/**
 * Kills per player on a quick-sim map. A team's kills ≈ KILLS_PER_ROUND_WON · its rounds won +
 * KILLS_PER_ROUND_LOST · its rounds lost (the other team's deaths are the same number); each
 * player's share is ∝ exp(KILL_SHARE_SLOPE · (ca − team mean) + noise), deaths spread evenly
 * with noise. Only the shape matters (it feeds form), not exact box scores.
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

export const quickSeries: SeriesSimulator = (req: SeriesRequest, career: CareerState): Omit<SeriesOutcome, "lineups"> => {
  const rng = mulberry32(deriveSeed(req.seed, "quick"));
  const pool = [...QUICK_SIM.pool];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  const games = req.format === "bo5" ? 5 : req.format === "bo3" ? 3 : 1;
  const need = Math.floor(games / 2) + 1;
  const sH = lineupStrength(career, req.home.lineup);
  const sA = lineupStrength(career, req.away.lineup);
  const maps: MapResult[] = [];
  const won: [number, number] = [0, 0];
  for (let g = 0; g < games && won[0] < need && won[1] < need; g++) {
    const map = pool[g % pool.length]!;
    const p = sigmoid(QUICK_SIM.roundSlope * (sH - sA + comfort(career, req.home.teamId, map) - comfort(career, req.away.teamId, map)));
    let h = 0; let a = 0;
    while (!((h >= 13 || a >= 13) && Math.abs(h - a) >= 2) && h + a < QUICK_SIM.maxRounds) {
      if (rng() < p) h += 1; else a += 1;
    }
    if (h === a) { if (rng() < p) h += 1; else a += 1; } // round cap reached level: one deciding round
    maps.push({ map, score: [h, a], ...(h + a > 24 ? { overtime: true } : {}), players: killLines(career, req, h, a, rng) });
    won[h > a ? 0 : 1] += 1;
  }
  return { winner: won[0] > won[1] ? req.home.teamId : req.away.teamId, mapsWon: won, maps, source: "quick" };
};
