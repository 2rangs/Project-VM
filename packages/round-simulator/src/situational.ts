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

// ---------------------------------------------------------------------------------------------
// Abilities as part of the world (smoke exits, ground patches, ability cues).
// Every constant below that is not a catalog value is marked manual-approx: it is a modelling
// assumption, not a confirmed game rule.
// ---------------------------------------------------------------------------------------------

/**
 * Leaving a vision blocker. The occluding surface is at the pusher's own body, so this is the
 * corner geometry of `angleAdvantageDelays` in the limit peekerDist → 0: the watcher sees the
 * leading half of the body one body half-width of travel before the pusher's eye is clear,
 *     Δt = BODY_HALF_WIDTH / speed.
 * It is NOT a success chance: it only says who can see first. What that is worth is decided by the
 * same surprise / info / pre-aim / flash terms as any other duel.
 */
export function smokeExitDelayMs(speedPerSec: number): number {
  return speedPerSec > 0 ? (BODY_HALF_WIDTH / speedPerSec) * 1000 : 0;
}

/**
 * Radius used for a ground patch whose catalog record has no radius (manual-approx, ≈4.5 m — the
 * order of the catalogued patches: Nanoswarm 5.25 m). Not a confirmed value for any ability.
 */
export const DEFAULT_PATCH_RADIUS_UNITS = 450;

/**
 * How long a body is inside a circular ground patch of radius r, moving at `speedPerSec`:
 *  - `through` — enters on one side and leaves on the other: the chord through the centre, 2r / v;
 *  - otherwise — is on the patch when it lands, `travelledUnits` from its centre along its own
 *    route, and leaves by continuing: (r − travelled) / v (0 once it is already past the edge).
 * Damage / delay follow from this time; nothing is rolled.
 */
export function patchExposureMs(radiusUnits: number, speedPerSec: number, through: boolean, travelledUnits = 0): number {
  if (radiusUnits <= 0 || speedPerSec <= 0) return 0;
  const units = through ? 2 * radiusUnits : Math.max(0, radiusUnits - Math.max(0, travelledUnits));
  return (units / speedPerSec) * 1000;
}

/**
 * Extra travel time a slow field costs a body crossing it: the chord at reduced speed minus the
 * chord at full speed, (2r / v) · (1 / multiplier − 1).
 */
export function slowFieldDelayMs(radiusUnits: number, speedPerSec: number, speedMultiplier: number): number {
  if (speedMultiplier <= 0 || speedMultiplier >= 1) return 0;
  return patchExposureMs(radiusUnits, speedPerSec, true) * (1 / speedMultiplier - 1);
}

/** Loudness of an ability cast relative to gunfire (manual-approx; perception-engine LOUDNESS.abilityCast). */
export const ABILITY_CAST_LOUDNESS = 0.7;
/** An ability cast is audible when its propagated strength reaches this (manual-approx; perception hearing threshold). */
export const ABILITY_CAST_AUDIBLE_THRESHOLD = 0.3;
/**
 * Seeing a deployed effect (smoke, wall, fire) is firm about where the EFFECT is and only loose
 * about where the enemy team is: utility is thrown from range and is also used to fake. Its weight
 * as evidence of commitment toward that zone (manual-approx; below a heard shot from the zone).
 */
export const DEPLOYED_EFFECT_CUE_CONFIDENCE = 0.5;

/**
 * Confidence of a heard cast: SOUND_CUE_CONFIDENCE × strength × ABILITY_CAST_LOUDNESS, or 0 under
 * the audible threshold. Same form as `soundCueConfidence`; it localises the caster to a zone.
 */
export function abilityCastCueConfidence(propagatedStrength: number): number {
  const s = propagatedStrength * ABILITY_CAST_LOUDNESS;
  return s >= ABILITY_CAST_AUDIBLE_THRESHOLD ? Math.min(1, SOUND_CUE_CONFIDENCE * s) : 0;
}
