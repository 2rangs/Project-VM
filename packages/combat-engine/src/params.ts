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
    /**
     * Stopping time (ms): how long after it first perceives the enemy a shooter who was moving at
     * contact needs to stand still, from a run and from a walk, at movement skill 0.5. Shots fired
     * before that are moving shots (movingPenalty, headshot.movingMultiplier, and a moving target
     * for the opponent); shots after it are standing shots. Movement skill scales it ×1.4 (skill 0)
     * … ×0.6 (skill 1): a good mover counter-strafes. Infinity = the shooter never stops.
     * It is the time until a player caught on the move fights like a set one — feet planted and
     * aim settled — not the bare deceleration of the body, so it is longer than a counter-strafe.
     */
    readonly stopMs: { readonly run: number; readonly walk: number };
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
  /**
   * Gaze-based time to first shot (used when a posture carries `aimOffsetDeg`):
   *   ready = seesEnemyAt + perception(reaction) + a + b(aim) · log2(1 + D/W)
   * perception = simple visual reaction time; the Fitts term is the time to bring the crosshair
   * onto the target (Fitts 1954; MacKenzie 1992 for mouse pointing: throughput ≈ 4.9 bit/s for
   * ordinary users — skilled FPS players are faster, hence b(aim) below). D = angle off target,
   * widened by the crosshair-height error σ·(1 − crosshairPlacement); W = the body's angular width.
   * All manual-approx (literature ranges, not fitted to win rates).
   */
  readonly aim: {
    /** Simple visual reaction time (ms) at skill.reaction = 0 and = 1. */
    readonly perceptionSlowMs: number;
    readonly perceptionFastMs: number;
    /** Fitts intercept a (ms): the click with the crosshair already on target. */
    readonly fittsA: number;
    /** Fitts slope b (ms per bit) at skill.aim = 0 and = 1. */
    readonly fittsBSlowMs: number;
    readonly fittsBFastMs: number;
    /** Half the body's width (m) — the target a first shot has to land on. */
    readonly bodyHalfWidthM: number;
    /** Crosshair height error (deg) at crosshairPlacement 0; it shrinks linearly to 0 at 1. */
    readonly placementSigmaDeg: number;
  };
  /** Hard cap so a duel where both keep missing still terminates. */
  readonly timeBudgetMs: number;
}

export const DEFAULT_PARAMS: CombatParams = {
  reaction: { slowMs: 260, fastMs: 140, preAimMs: 30, flashReactionPenaltyMs: 700 },
  accuracy: {
    pointBlank: 0.9,
    movingPenalty: 0.55,
    // physical (manual-approx): perceive (~180 ms at reaction 0.5) + counter-strafe to standing
    // accuracy (~80 ms from a run at 6.75 m/s, ~40 ms from a walk). The legacy flag model used a
    // calibrated 700 / 350 aggregate that also stood in for aim time and tracking (round-simulator
    // LEGACY_STOP_MS); the gaze model has those explicitly.
    stopMs: { run: 260, walk: 220 },
    flashedAccuracy: 0.15,
    preAimFirstShotBonus: 0.15,
    rangeFalloffPerMeter: 0.012,
    minHitChance: 0.05,
    maxHitChance: 0.98,
  },
  headshot: { baseLow: 0.05, baseHigh: 0.45, movingMultiplier: 0.5, flashedMultiplier: 0.2 },
  armor: { shieldAbsorb: 0.66 },
  aim: {
    perceptionSlowMs: 220, // ordinary gamer simple RT (human-benchmark median ≈ 250–270 ms incl. click)
    perceptionFastMs: 140, // top-end pro simple RT
    fittsA: 30, // the old pre-aim reaction (crosshair already on target)
    fittsBSlowMs: 150, // ≈ 6.7 bit/s
    fittsBFastMs: 75, // ≈ 13 bit/s (flick specialists)
    bodyHalfWidthM: 0.35,
    placementSigmaDeg: 10,
  },
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
  /** Multiplier on accuracy.stopMs (the time a moving shooter needs to stop). Infinity = never stops. */
  readonly stopTimeScale?: number;
}
