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
 * w = 1 for a call made this instant, 0.5 after one half-life; 0 when there is no call. A cue that
 * only loosely localises the enemy (a heard shot) scales w by its `confidence`.
 */
export function infoWeight(ageMs: number, baseHalfLifeMs: number, trading: number, confidence = 1): number {
  if (baseHalfLifeMs <= 0 || ageMs < 0) return 0;
  return Math.max(0, Math.min(1, confidence)) * 2 ** (-ageMs / (baseHalfLifeMs * traitScale(trading, INFO_TRADING_SLOPE)));
}

/** Gunfire is audible when its propagated strength reaches this (sound-graph units, 0..1). */
export const GUNFIRE_AUDIBLE_THRESHOLD = 0.15;
/** A heard shot localises the shooter to a zone, loosely: confidence = this × propagated strength. */
export const SOUND_CUE_CONFIDENCE = 0.6;
/** A seen tracer points back along the line of fire: a firm localisation. */
export const TRACER_CUE_CONFIDENCE = 0.9;

/**
 * Confidence of a heard shot: SOUND_CUE_CONFIDENCE × strength × weapon loudness, or 0 when the
 * propagated strength is under the audible threshold.
 */
export function soundCueConfidence(propagatedStrength: number, fireLoudness = 1): number {
  const s = propagatedStrength * fireLoudness;
  return s >= GUNFIRE_AUDIBLE_THRESHOLD ? Math.min(1, SOUND_CUE_CONFIDENCE * s) : 0;
}

/**
 * Clutch composure — last player alive against 2+: reaction shift = (0.6 − clutch) · 250ms
 * (clutch 1.0 → −100ms, 0.2 → +100ms). Negative values offset other penalties, never below zero.
 */
export function clutchReactionMs(clutch: number): number {
  return (TRAIT_BASELINE - clutch) * CLUTCH_REACTION_MS_PER_POINT;
}

/** Half the width of a player's body: how far the shoulder leads the eye around a corner (world units ≈ cm). */
export const BODY_HALF_WIDTH = 35;

/**
 * Angle advantage — not a tuned bonus but the geometry of a corner. A peeker strafes out at
 * `strafeSpeed`, `peekerDist` from the corner; a holder waits `holderDist` from it. Pivoting the
 * sightline on the corner (similar triangles):
 *   - the holder sees the peeker's leading shoulder when the peeker's eye is one body half-width short of the line;
 *   - the peeker sees the holder's shoulder when its eye is (half-width × peekerDist / holderDist) short of it.
 * So the holder sees first by
 *     Δt = (BODY_HALF_WIDTH / strafeSpeed) · (1 − peekerDist / holderDist)
 * positive when the holder is the farther one (a deep holder sees the shoulder first), negative when
 * the holder hugs the corner (then the peeker sees first). A slower peek (walking, a heavy weapon)
 * widens it. Returns each side's resulting delay in ms (one of the two is always 0); the holder's
 * disadvantage is capped at two body half-widths of strafing.
 */
export function angleAdvantageDelays(peekerDist: number, holderDist: number, strafeSpeedPerSec: number): { peekerMs: number; holderMs: number } {
  if (peekerDist <= 0 || holderDist <= 0 || strafeSpeedPerSec <= 0) return { peekerMs: 0, holderMs: 0 };
  const unitMs = (BODY_HALF_WIDTH / strafeSpeedPerSec) * 1000;
  const lead = unitMs * (1 - peekerDist / holderDist);
  return lead >= 0 ? { peekerMs: lead, holderMs: 0 } : { peekerMs: 0, holderMs: Math.min(2 * unitMs, -lead) };
}
