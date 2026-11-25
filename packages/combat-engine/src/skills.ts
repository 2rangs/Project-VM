import type { Combatant, WeaponSpec } from "./types.js";
import type { CombatCalibration, CombatParams } from "./params.js";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);

/** Angular width (deg) of a body at a range — the W of the Fitts term. */
export function bodyAngularWidthDeg(distanceMeters: number, p: CombatParams): number {
  return (2 * Math.atan(p.aim.bodyHalfWidthM / Math.max(0.5, distanceMeters)) * 180) / Math.PI;
}

/** The crosshair's effective distance (deg) from the target: gaze error ⊕ height error from placement. */
export function effectiveAimOffsetDeg(offsetDeg: number, crosshairPlacement: number, p: CombatParams): number {
  const v = p.aim.placementSigmaDeg * (1 - clamp(crosshairPlacement, 0, 1));
  return Math.hypot(Math.max(0, offsetDeg), v);
}

/** Fitts aim time (ms): a + b(aim) · log2(1 + D/W). D = 0 → a; each doubling of D/W adds ≈ b. */
export function aimTimeMs(offsetDeg: number, widthDeg: number, aim: number, p: CombatParams): number {
  const b = lerp(p.aim.fittsBSlowMs, p.aim.fittsBFastMs, aim);
  return p.aim.fittsA + b * Math.log2(1 + Math.max(0, offsetDeg) / Math.max(1e-3, widthDeg));
}

/** When (ms after t0) a combatant can first pull the trigger. */
/**
 * How far (deg) a target moving across the line of sight gets from where it was first seen while the
 * shooter is still perceiving it: ω · t = (lateral / distance) · perception. It is added to the gaze
 * offset the Fitts term has to cover — the physical part of the peeker's advantage (a holder whose
 * crosshair sits on the peek point still has to catch a swing that runs past it).
 */
export function trackingOffsetDeg(targetLateralMps: number, distanceMeters: number, perceptionMs: number): number {
  if (targetLateralMps <= 0 || perceptionMs <= 0) return 0;
  return (Math.atan2(targetLateralMps * (perceptionMs / 1000), Math.max(0.5, distanceMeters)) * 180) / Math.PI;
}

export function readyDelayMs(c: Combatant, p: CombatParams, cal: CombatCalibration = {}, distanceMeters = 15, targetLateralMps = 0): number {
  if (c.posture.aimOffsetDeg !== undefined) {
    const perception = lerp(p.aim.perceptionSlowMs, p.aim.perceptionFastMs, c.skills.reaction);
    const track = trackingOffsetDeg(targetLateralMps, distanceMeters, perception);
    const d = effectiveAimOffsetDeg(c.posture.aimOffsetDeg + track, c.skills.crosshairPlacement, p);
    const aimMs = aimTimeMs(d, bodyAngularWidthDeg(distanceMeters, p), c.skills.aim, p);
    const flash = c.posture.flashBlindMs > 0 ? c.posture.flashBlindMs + p.reaction.flashReactionPenaltyMs : 0;
    return c.posture.seesEnemyAtMs + (perception + aimMs) * (cal.reactionScale ?? 1) + flash;
  }
  const base = c.posture.preAim
    ? p.reaction.preAimMs
    : lerp(p.reaction.slowMs, p.reaction.fastMs, c.skills.reaction);
  const flash = c.posture.flashBlindMs > 0 ? c.posture.flashBlindMs + p.reaction.flashReactionPenaltyMs : 0;
  const scaled = base * (cal.reactionScale ?? 1);
  return c.posture.seesEnemyAtMs + scaled + flash;
}

/**
 * When (ms after t0) a combatant that was moving at contact has stopped: it starts stopping the
 * moment it perceives the enemy, and needs stopMs — by its pace, scaled by its movement skill.
 * 0 for a combatant that was standing.
 */
export function stoppedAtMs(c: Combatant, p: CombatParams, cal: CombatCalibration = {}): number {
  if (!c.posture.moving) return 0;
  if (c.posture.keepsMoving) return Number.POSITIVE_INFINITY;
  const base = c.posture.pace === "walk" ? p.accuracy.stopMs.walk : p.accuracy.stopMs.run;
  return c.posture.seesEnemyAtMs + base * lerp(1.4, 0.6, c.skills.movement) * (cal.stopTimeScale ?? 1);
}

/**
 * Does a moving shooter fight on the move? Only with a run-and-gun weapon (`movingAccuracy`), when it
 * keeps at least as much of its own accuracy moving as the opponent keeps against a moving target.
 */
export function keepsMovingAgainst(c: Combatant, opponent: Combatant): boolean {
  const kept = c.weapon.movingAccuracy;
  return c.posture.moving && kept !== undefined && kept >= lerp(0.7, 1, opponent.skills.tracking);
}

/** Is this combatant still moving at time `atMs` of the duel? Without a time: as it was at contact. */
export function movingAt(c: Combatant, p: CombatParams, cal: CombatCalibration, atMs?: number): boolean {
  if (!c.posture.moving) return false;
  return atMs === undefined || atMs < stoppedAtMs(c, p, cal);
}

/**
 * Share of a pull's pellets that land on a body at a range: the body's visible area (0.7 m × 1.6 m)
 * over the area of the pellet cone there, capped at 1. Point blank every pellet lands; past the
 * range where the cone outgrows the body the share falls with the square of the range.
 */
export function pelletLandChance(spreadDeg: number, distanceMeters: number): number {
  const r = Math.max(0.05, distanceMeters) * Math.tan((Math.max(0.01, spreadDeg) * Math.PI) / 180);
  return clamp((0.7 * 1.6) / (Math.PI * r * r), 0, 1);
}

/** The comfortable range of a weapon = the edge of its first (full-damage) band. */
function weaponComfortRange(w: WeaponSpec): number {
  return w.damageBands[0]?.maxRangeMeters ?? 30;
}

/** Probability a shot lands, from weapon, range, shooter skill and situation. */
export function hitChance(
  shooter: Combatant,
  target: Combatant,
  distanceMeters: number,
  isFirstShot: boolean,
  p: CombatParams,
  cal: CombatCalibration = {},
  atMs?: number,
): number {
  let chance = p.accuracy.pointBlank;

  // skill: aim scales the whole thing; first-bullet precision helps the opening shot.
  chance *= lerp(0.5, 1.1, shooter.skills.aim);
  if (isFirstShot) {
    chance += lerp(0, 0.1, shooter.skills.firstBulletAccuracy);
    // crosshair already on the body when the fight starts (gaze model), or the legacy pre-aim flag
    const onTarget = shooter.posture.aimOffsetDeg !== undefined
      ? effectiveAimOffsetDeg(shooter.posture.aimOffsetDeg, shooter.skills.crosshairPlacement, p) <= bodyAngularWidthDeg(distanceMeters, p) / 2
      : shooter.posture.preAim;
    if (onTarget) chance += p.accuracy.preAimFirstShotBonus;
  }

  // range: falloff beyond the weapon's comfortable range (SMGs suffer more than rifles).
  const over = Math.max(0, distanceMeters - weaponComfortRange(shooter.weapon));
  chance -= over * p.accuracy.rangeFalloffPerMeter;

  // moving shooter: big penalty, partially offset by movement skill — until it has stopped.
  if (movingAt(shooter, p, cal, atMs)) {
    const movingMult = p.accuracy.movingPenalty + (1 - p.accuracy.movingPenalty) * shooter.skills.movement * 0.5;
    chance *= Math.max(movingMult, shooter.weapon.movingAccuracy ?? 0);
  }
  // flash-blinded shooter.
  if (shooter.posture.flashBlindMs > 0) chance *= p.accuracy.flashedAccuracy;

  // target behind cover / hard angle.
  chance *= 1 - clamp(target.posture.behindCover, 0, 1);
  // moving target is harder to hit; tracking skill recovers some of it.
  if (movingAt(target, p, cal, atMs)) chance *= lerp(0.7, 1, shooter.skills.tracking);

  chance *= cal.hitChanceScale ?? 1;
  return clamp(chance, p.accuracy.minHitChance, p.accuracy.maxHitChance);
}

/** Probability a landed shot is a headshot, from crosshair placement and situation. */
export function headshotChance(shooter: Combatant, p: CombatParams, cal: CombatCalibration = {}, atMs?: number): number {
  let hs = lerp(p.headshot.baseLow, p.headshot.baseHigh, shooter.skills.crosshairPlacement);
  if (movingAt(shooter, p, cal, atMs)) hs *= p.headshot.movingMultiplier;
  if (shooter.posture.flashBlindMs > 0) hs *= p.headshot.flashedMultiplier;
  hs *= cal.headshotScale ?? 1;
  return clamp(hs, 0, 0.95);
}
