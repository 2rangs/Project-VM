/**
 * ObservationProvider — the dependency-inversion seam onto the Perception Engine (PV-4).
 *
 * PV-4 is building `packages/perception-engine`, which turns ground-truth WorldState +
 * an observing team into an ObservationState (what that team can actually see/hear),
 * enforcing DECISION-004. Until that package exists and is integrated, the decision
 * layer depends only on this interface; tests use a stub (and the scenario loader can
 * build an ObservationState directly from a DecisionContext's `belief` block).
 *
 * The contract is deliberately one-directional: an ObservationProvider MAY read the
 * omniscient world, but it only ever RETURNS an ObservationState — the perceived subset.
 * Decision code holds the provider's output, never the world it read.
 */
import type { TeamId } from "./ids.js";
import type { ObservationState } from "./observation.js";

export interface ObservationProvider {
  /**
   * The observation available to `teamId` as of `atMs` (round-relative ms). Implementers
   * must not leak unperceived enemy ground truth into the result.
   */
  observe(teamId: TeamId, atMs: number): ObservationState;
}
