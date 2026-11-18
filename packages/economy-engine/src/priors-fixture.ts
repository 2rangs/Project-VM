/**
 * Win-probability priors, copied from PV-2's real derived priors so this engine is self-contained
 * and deterministic. These are REAL aggregates (not synthetic), but they are a *fixture snapshot* —
 * at integration, load them from datasets/derived/priors/ instead of hard-coding.
 *
 * Source: datasets/derived/priors/*.json, from VCT Reference vct.duckdb
 *   sha256 a1a189d0ec7d9a71d7586645a3ce5d39bfea719c2f782bb287a23a300cea4890, build 2026-11-12,
 *   international events. See docs/VALIDATION_BASELINES.md for the full tables + intervals.
 */

export const PRIORS_SOURCE = {
  sourceId: "vct-reference",
  sha256: "a1a189d0ec7d9a71d7586645a3ce5d39bfea719c2f782bb287a23a300cea4890",
  build: "2026-11-12",
  file: "datasets/derived/priors/",
  synthetic: false,
} as const;

export type BuyTier = "pistol" | "eco" | "semi" | "full";

/** Round win rate for (ownBuy vs oppBuy), international, all maps. Diagonals are 0.5 by symmetry. */
export const ECONOMY_MATCHUP_WIN_RATE: Readonly<Record<string, number>> = {
  "pistol:pistol": 0.5,
  "eco:eco": 0.5,
  "eco:semi": 0.086,
  "eco:full": 0.115,
  "semi:eco": 0.914,
  "semi:semi": 0.5,
  "semi:full": 0.34,
  "full:eco": 0.885,
  "full:semi": 0.66,
  "full:full": 0.5,
};

/** Same, Ascent only (international). */
export const ECONOMY_MATCHUP_WIN_RATE_ASCENT: Readonly<Record<string, number>> = {
  "pistol:pistol": 0.5,
  "eco:semi": 0.072,
  "eco:full": 0.04,
  "semi:eco": 0.928,
  "semi:semi": 0.5,
  "semi:full": 0.319,
  "full:eco": 0.96,
  "full:semi": 0.681,
  "full:full": 0.5,
};

/** P(pistol winner also wins the next round) and the next two rounds. */
export const PISTOL_CONVERSION = {
  winNextRound: 0.879,
  winNextTwoRounds: 0.375,
} as const;

/**
 * P(team wins the NEXT round | its buy THIS round). The eco→0.598 vs full→0.506 gap is the
 * economic-snowball evidence behind saving (Handoff §15). Per-team baseline is 0.5.
 */
export const NEXT_ROUND_WIN_RATE_BY_BUY: Readonly<Record<BuyTier, number>> = {
  pistol: 0.5,
  eco: 0.598,
  semi: 0.52,
  full: 0.506,
};

/** Attacker win rate, Ascent (overall / first half / second half). */
export const ASCENT_ATTACK_WIN_RATE = {
  overall: 0.509,
  firstHalf: 0.58,
  secondHalf: 0.413,
} as const;

/** Lookup helper: direct cell, else the mirror (1 - inverse), else 0.5 for unseen matchups. */
export function matchupWinRate(own: BuyTier, opp: BuyTier, ascent = false): number {
  const table = ascent ? ECONOMY_MATCHUP_WIN_RATE_ASCENT : ECONOMY_MATCHUP_WIN_RATE;
  const direct = table[`${own}:${opp}`];
  if (direct !== undefined) return direct;
  const inverse = table[`${opp}:${own}`];
  if (inverse !== undefined) return 1 - inverse;
  return 0.5;
}
