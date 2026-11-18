/**
 * @pv/world-state — construct, update, serialize World State, and gate it into
 * Observations.
 *
 * The World→Observation boundary (observeWorld) is the enforcement point for
 * DECISION-004: decision code should import from here and consume ObservationState,
 * never read enemy fields off a raw WorldState.
 */
export { createWorldState, createPlayerState, getPlayer, deepFreeze } from "./create.js";
export type { CreateWorldInput, CreatePlayerInput } from "./create.js";
export {
  updatePlayer,
  patchPlayer,
  setSpike,
  appendEvents,
  advanceTick,
  killPlayer,
} from "./update.js";
export {
  serializeWorld,
  deserializeWorld,
  WORLD_STATE_SCHEMA_VERSION,
} from "./serialize.js";
export type { SerializedWorld } from "./serialize.js";
export { observeWorld, healthBand, BLIND_ORACLE } from "./observation.js";
export type { VisibilityOracle, ObserveOptions } from "./observation.js";
export {
  loadDecisionContext,
  validateDecisionContext,
  ScenarioValidationError,
  SCENARIO_ENUMS,
} from "./scenario.js";
export type { LoadOptions } from "./scenario.js";
