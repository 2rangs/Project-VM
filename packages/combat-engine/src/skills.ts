import type { Combatant, WeaponSpec } from "./types.js";
import type { CombatCalibration, CombatParams } from "./params.js";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);

/** When (ms after t0) a combatant can first pull the trigger. */
export function readyDelayMs(c: Combatant, p: CombatParams, cal: CombatCalibration = {}): number {
  const base = c.posture.preAim
    ? p.reaction.preAimMs
    : lerp(p.reaction.slowMs, p.reaction.fastMs, c.skills.reaction);
  const flash = c.posture.flashBlindMs > 0 ? c.posture.flashBlindMs + p.reaction.flashReactionPenaltyMs : 0;
  const scaled = base * (cal.reactionScale ?? 1);
  return c.posture.seesEnemyAtMs + scaled + flash;
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
): number {
  let chance = p.accuracy.pointBlank;

  // skill: aim scales the whole thing; first-bullet precision helps the opening shot.
  chance *= lerp(0.5, 1.1, shooter.skills.aim);
  if (isFirstShot) {
    chance += lerp(0, 0.1, shooter.skills.firstBulletAccuracy);
    if (shooter.posture.preAim) chance += p.accuracy.preAimFirstShotBonus;
  }

  // range: falloff beyond the weapon's comfortable range (SMGs suffer more than rifles).
  const over = Math.max(0, distanceMeters - weaponComfortRange(shooter.weapon));
  chance -= over * p.accuracy.rangeFalloffPerMeter;

  // moving shooter: big penalty, partially offset by movement skill.
  if (shooter.posture.moving) {
    const movingMult = p.accuracy.movingPenalty + (1 - p.accuracy.movingPenalty) * shooter.skills.movement * 0.5;
    chance *= movingMult;
  }
  // flash-blinded shooter.
  if (shooter.posture.flashBlindMs > 0) chance *= p.accuracy.flashedAccuracy;

  // target behind cover / hard angle.
  chance *= 1 - clamp(target.posture.behindCover, 0, 1);
  // moving target is harder to hit; tracking skill recovers some of it.
  if (target.posture.moving) chance *= lerp(0.7, 1, shooter.skills.tracking);

  chance *= cal.hitChanceScale ?? 1;
  return clamp(chance, p.accuracy.minHitChance, p.accuracy.maxHitChance);
}

/** Probability a landed shot is a headshot, from crosshair placement and situation. */
export function headshotChance(shooter: Combatant, p: CombatParams, cal: CombatCalibration = {}): number {
  let hs = lerp(p.headshot.baseLow, p.headshot.baseHigh, shooter.skills.crosshairPlacement);
  if (shooter.posture.moving) hs *= p.headshot.movingMultiplier;
  if (shooter.posture.flashBlindMs > 0) hs *= p.headshot.flashedMultiplier;
  hs *= cal.headshotScale ?? 1;
  return clamp(hs, 0, 0.95);
}
