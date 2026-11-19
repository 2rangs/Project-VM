/**
 * Situational duel formulas — the layer between "who is the better aimer" (combat-engine) and
 * "what situation is the duel fought in" (crossfire, info, clutch). Each is a published model
 * with one tunable constant; a 0.6-rated player gets exactly the base value.
 * Full stat → outcome table: docs/STAT_OUTCOME_MATRIX.md.
 */
import { TRAIT_BASELINE } from "./types.js";

/** gameSense 1.0 halves the crossfire penalty; 0.2 raises it by half. */
export const CROSSFIRE_SENSE_SLOPE = 1.25;
/** trading 1.0 → info half-life ×1.6; 0.2 → ×0.4. */
export const INFO_TRADING_SLOPE = 1.5;
/** clutch: ms of reaction per rating point off the baseline when last alive vs 2+. */
export const CLUTCH_REACTION_MS_PER_POINT = 250;

/** Effect multiplier for a trait: 1 at the 0.6 baseline, moving `slope` per rating point (floored at 0.1). */
export function traitScale(value: number, slope: number): number {
  return Math.max(0.1, 1 + (value - TRAIT_BASELINE) * slope);
}

/**
 * Crossfire (양각) — Hick–Hyman law. Choice reaction time grows with the log of the alternatives:
 *     penalty = b · log2(n + 1) · senseScale
 * n = extra enemy guns with line of sight on the player (beyond the duel opponent), b = ms per bit,
 * senseScale = 1 − 1.25·(gameSense − 0.6). n = 0 → no penalty.
 */
export function crossfirePenaltyMs(slopeMsPerBit: number, extraGuns: number, gameSense: number): number {
  if (extraGuns <= 0 || slopeMsPerBit <= 0) return 0;
  return slopeMsPerBit * Math.log2(1 + extraGuns) * traitScale(gameSense, -CROSSFIRE_SENSE_SLOPE);
}

/**
 * Info freshness — exponential decay: w = 2^(−Δt / halfLife), halfLife = base · (1 + 1.5·(trading − 0.6)).
 * w = 1 for a call made this instant, 0.5 after one half-life; 0 when there is no call.
 */
export function infoWeight(ageMs: number, baseHalfLifeMs: number, trading: number): number {
  if (baseHalfLifeMs <= 0 || ageMs < 0) return 0;
  return 2 ** (-ageMs / (baseHalfLifeMs * traitScale(trading, INFO_TRADING_SLOPE)));
}

/**
 * Clutch composure — last player alive against 2+: reaction shift = (0.6 − clutch) · 250ms
 * (clutch 1.0 → −100ms, 0.2 → +100ms). Negative values offset other penalties, never below zero.
 */
export function clutchReactionMs(clutch: number): number {
  return (TRAIT_BASELINE - clutch) * CLUTCH_REACTION_MS_PER_POINT;
}
