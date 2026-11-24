/**
 * @pv/shared-types — the shared vocabulary for PROJECT V's simulation core.
 *
 * Nothing here has runtime behaviour beyond tiny constructors/constants; this package
 * is the single source of truth for the state shapes every other package exchanges.
 */
export * from "./vector.js";
export * from "./ids.js";
export * from "./provenance.js";
export * from "./events.js";
export * from "./economy.js";
export * from "./world-state.js";
export * from "./observation.js";
export * from "./belief.js";
export * from "./action-schema.js";
export * from "./spatial-query.js";
export * from "./observation-provider.js";
export * from "./economy-evaluator.js";
export * from "./combat-estimator.js";
export * from "./decision-policy.js";
export * from "./map-tactics.js";
export * from "./mid-plans.js";
export * from "./scenario-context.js";
