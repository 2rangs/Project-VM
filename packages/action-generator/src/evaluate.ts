/**
 * Rule/utility evaluation (README §13.4, §19; DECISION-005 — no ML here).
 *
 * All weights below are PROVISIONAL heuristics (like the game-rules numbers, they are not
 * tuned against data yet). Handoff §20.5/§25: weights must eventually be calibrated by
 * simulation; for now they give explainable, deterministic orderings. They are collected
 * in one place so a later calibration pass can find them.
 */
import type { EnemyPressureFn, ResourceCost } from "./types.js";
import type { SpatialQuery, ZoneId } from "@pv/shared-types";

export const WEIGHTS = {
  /** Penalty applied to utility per unit of estimated risk (0..1). */
  riskPenalty: 0.6,
  /** Penalty for consuming the round clock (fraction of remaining time used). */
  timePenalty: 0.3,
  /** How sharply believed enemy pressure converts to risk. */
  riskSharpness: 1.5,
  /** Extra risk per net player disadvantage. */
  disadvantageRisk: 0.12,
  /** Weight of sightline-adjacent pressure vs. the target zone itself. */
  sightlinePressure: 0.5,
  verified: false,
} as const;

/**
 * Estimated risk of committing to `targetZone`, from believed enemy pressure on the zone
 * and on zones with line of sight to it, plus a man-disadvantage term. 0..1.
 */
export function estimateRisk(
  targetZone: ZoneId,
  spatial: SpatialQuery,
  enemyPressure: EnemyPressureFn,
  aliveSelf: number,
  aliveEnemy: number,
): number {
  let pressure = enemyPressure(targetZone);
  for (const z of spatial.visibleZonesFrom(targetZone)) {
    pressure += WEIGHTS.sightlinePressure * enemyPressure(z);
  }
  let risk = 1 - Math.exp(-WEIGHTS.riskSharpness * pressure);
  if (aliveEnemy > aliveSelf) risk += WEIGHTS.disadvantageRisk * (aliveEnemy - aliveSelf);
  return Math.max(0, Math.min(1, risk));
}

/**
 * Expected utility = base objective value − risk penalty − time penalty. Deterministic.
 */
export function expectedUtility(
  baseValue: number,
  risk: number,
  requiredTimeMs: number,
  timeRemainingMs: number,
): number {
  const timeFrac = Math.min(1, requiredTimeMs / Math.max(1, timeRemainingMs));
  return baseValue - WEIGHTS.riskPenalty * risk - WEIGHTS.timePenalty * timeFrac;
}

export const zeroCost: ResourceCost = { credits: 0, abilities: 0 };
