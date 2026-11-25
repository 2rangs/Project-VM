// PROJECT V — combat-engine public API.
//
// Deterministic, timeline-based 1v1 (and Monte-Carlo) combat resolution from physical
// and informational inputs. Winner and TTK are emergent, never pre-decided
// (DECISION-002); skill ratings cannot override an information deficit (README §29).

export * from "./types.js";
export { resolveDuel } from "./engine.js";
export type { ResolveOptions } from "./engine.js";
export { monteCarloDuel } from "./montecarlo.js";
export type { DuelStats } from "./montecarlo.js";
export { damageForRange, applyDamage } from "./damage.js";
export type { HpState } from "./damage.js";
export { hitChance, headshotChance, keepsMovingAgainst, pelletLandChance, readyDelayMs, stoppedAtMs, movingAt, aimTimeMs, bodyAngularWidthDeg, effectiveAimOffsetDeg, trackingOffsetDeg } from "./skills.js";
export { buildCatalog, requireWeapon } from "./weapons.js";
export type { WeaponCatalog } from "./weapons.js";
export { DEFAULT_PARAMS } from "./params.js";
export type { CombatParams, CombatCalibration } from "./params.js";
export { mulberry32, deriveSeed } from "./rng.js";
export type { Rng } from "./rng.js";
