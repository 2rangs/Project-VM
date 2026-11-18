/**
 * @pv/integration-adapters — binds PV-3's dependency-inversion seams to the other
 * branches' real engines via structural mirrors. Everything compiles against mirrors now;
 * at final merge, replace each mirror with the real `@pv/<engine>` import (each adapter's
 * header records the source branch + commit).
 */
export {
  spatialQueryFromEngine,
  MinimapUnitsConverter,
} from "./spatial-adapter.js";
export type { SpatialEngineLike, MapCoordinateSystemLike, SpatialAdapterOptions } from "./spatial-adapter.js";

export { combatEstimatorFromEngine } from "./combat-adapter.js";
export type { CombatAdapterOptions, MonteCarloDuelLike, RequireWeaponLike } from "./combat-adapter.js";

export { economyEvaluatorFromEngine } from "./economy-adapter.js";
export type { EconomyAdapterOptions, EvaluateEconomyLike } from "./economy-adapter.js";

export { availabilityToFeasibility, abilityFeasibility } from "./ability-adapter.js";
export type { AvailabilityResultLike, CheckAvailabilityLike } from "./ability-adapter.js";

export { observationProviderForPlayer, observationForPlayer } from "./observation-adapter.js";
export type { PerceptionResultLike } from "./observation-adapter.js";

export * from "./normalization.js";
