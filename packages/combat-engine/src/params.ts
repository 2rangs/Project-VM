// PROJECT V — combat tuning parameters.
//
// Every value is manual-approx (NOT measured). They map player skill ratings and
// situational modifiers to hit/headshot probabilities and timings. PV-2 is producing
// real VCT combat statistics (e.g. first-kill win rate); `CombatCalibration` below is
// the seam to recalibrate against them later — nothing here hard-codes an outcome.

export interface CombatParams {
  readonly reaction: {
    /** Reaction time (ms) at skill.reaction = 0 and = 1 (linear between). */
    readonly slowMs: number;
    readonly fastMs: number;
    /** Reaction time when pre-aiming the expected angle (minimal). */
    readonly preAimMs: number;
    /** Extra reaction delay (ms) added by being fully flash-blinded. */
    readonly flashReactionPenaltyMs: number;
  };
  readonly accuracy: {
    /** Base hit chance contributed at point-blank for an average weapon (before skill). */
    readonly pointBlank: number;
    /** Multiplier on hit chance when firing while moving (before skill.movement offset). */
    readonly movingPenalty: number;
    /** Multiplier on hit chance while flash-blinded. */
    readonly flashedAccuracy: number;
    /** First-shot accuracy bonus (added) when pre-aiming. */
    readonly preAimFirstShotBonus: number;
    /** How fast hit chance falls with distance beyond a band edge, per meter. */
    readonly rangeFalloffPerMeter: number;
    /** Hit chance floor so long-range fights still resolve. */
    readonly minHitChance: number;
    readonly maxHitChance: number;
  };
  readonly headshot: {
    /** Headshot probability at crosshairPlacement 0 and 1 (given a hit). */
    readonly baseLow: number;
    readonly baseHigh: number;
    /** Multiplier on headshot chance while moving / flashed. */
    readonly movingMultiplier: number;
    readonly flashedMultiplier: number;
  };
  readonly armor: {
    /** Fraction of a hit absorbed by shield while shield remains (rest hits health). */
    readonly shieldAbsorb: number;
  };
  /** Hard cap so a duel where both keep missing still terminates. */
  readonly timeBudgetMs: number;
}

export const DEFAULT_PARAMS: CombatParams = {
  reaction: { slowMs: 260, fastMs: 140, preAimMs: 30, flashReactionPenaltyMs: 700 },
  accuracy: {
    pointBlank: 0.9,
    movingPenalty: 0.55,
    flashedAccuracy: 0.15,
    preAimFirstShotBonus: 0.15,
    rangeFalloffPerMeter: 0.012,
    minHitChance: 0.05,
    maxHitChance: 0.98,
  },
  headshot: { baseLow: 0.05, baseHigh: 0.45, movingMultiplier: 0.5, flashedMultiplier: 0.2 },
  armor: { shieldAbsorb: 0.66 },
  timeBudgetMs: 12000,
};

/**
 * Optional external calibration hook. Supply measured multipliers (from PV-2's VCT
 * stats) to nudge the model toward real first-kill / range win-rates without editing
 * the engine. Identity by default.
 */
export interface CombatCalibration {
  readonly hitChanceScale?: number;
  readonly headshotScale?: number;
  readonly reactionScale?: number;
}
