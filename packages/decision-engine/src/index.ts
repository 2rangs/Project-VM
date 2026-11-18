/**
 * @pv/decision-engine — Belief State v0 + per-decider DecisionContext assembly.
 *
 * The belief module (zone probability distributions with time-based diffusion) consumes
 * only ObservationState + SpatialQuery — never WorldState — enforcing DECISION-004 at the
 * type level.
 */
export {
  buildTeamBelief,
  advanceTeamBelief,
  observeTeamBelief,
  spreadFromZone,
  enemyPressureOnZone,
  buildBeliefState,
  buildBelief,
} from "./belief.js";
export type { ZoneBelief, TeamBeliefModel, BuildBeliefOptions } from "./belief.js";
export {
  buildDecisionContext,
  teamBeliefFor,
  decidingTeamPlayers,
  aliveDecidingPlayers,
} from "./context.js";
