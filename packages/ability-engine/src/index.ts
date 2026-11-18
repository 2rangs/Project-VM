// PROJECT V — ability-engine public API.
//
// Deploys abilities as live effect objects and bridges them into spatial (LoS/path),
// perception (smoke/reveal) and combat (flash). Reveals are frozen snapshots (no
// omniscient leak). Includes availability checks for PV-3's Constraint Validation.

export * from "./types.js";
export { AbilityEngine } from "./engine.js";
export type { SnapshotEnemy, UseOptions } from "./engine.js";
export { buildAbilityCatalog, requireAbility } from "./catalog.js";
export type { AbilityCatalog } from "./catalog.js";
export { abilitySpecFromCatalog, primaryEffect, metersToUnits, UNITS_PER_METER } from "./catalog-adapter.js";
export { checkAvailability } from "./availability.js";
export {
  visionBlockerIsSmoke,
  toPerceptionAbilityStates,
  deniedZoneIds,
  revealedEnemies,
  combatFlashBlindMs,
} from "./adapters.js";
