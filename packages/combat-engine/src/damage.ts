import type { HitLocation, WeaponSpec } from "./types.js";

/** Damage for a hit at a distance and location, using the matching (or last) band. */
export function damageForRange(weapon: WeaponSpec, distanceMeters: number, location: HitLocation): number {
  const bands = weapon.damageBands;
  let band = bands[bands.length - 1];
  for (const b of bands) {
    if (distanceMeters <= b.maxRangeMeters) {
      band = b;
      break;
    }
  }
  return location === "head" ? band.head : location === "leg" ? band.leg : band.body;
}

export interface HpState {
  readonly health: number;
  readonly armor: number;
}

/**
 * Apply raw damage to armor then health. Model (manual-approx): shield points block
 * damage 1:1 until depleted, overflow carries to health. This reproduces the key game
 * rule that an Operator body shot (150) kills through full heavy shield (100 + 50 = 150).
 */
export function applyDamage(state: HpState, damage: number): HpState {
  const absorbed = Math.min(state.armor, damage);
  const armor = state.armor - absorbed;
  const health = Math.max(0, state.health - (damage - absorbed));
  return { health, armor };
}
