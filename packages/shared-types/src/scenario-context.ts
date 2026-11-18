/**
 * Loaded scenario / team-level decision context (TASK 006 output).
 *
 * PV-2's DecisionContext JSON (datasets/schema/world-state.schema.json) is loaded by the
 * world-state scenario loader into this typed, internal shape: a ground-truth WorldState
 * plus which team is deciding and that team's perceived Observation/Belief. The Action
 * Generator consumes this (never the raw JSON) and derives per-decider DecisionContexts
 * (see action-schema.ts) from it.
 *
 * `coordinateSpace` records the unit mapping: scenario positions are minimapUnits, so the
 * loaded WorldState's positions are minimapUnits too (z left 0). The field makes that
 * explicit rather than silently reinterpreting the project's default world-unit
 * convention (see docs/handoffs/PV-3-core.md phase-2 mapping note).
 */
import type { BeliefState } from "./belief.js";
import type { ObservationState } from "./observation.js";
import type { Side, TeamId } from "./ids.js";
import type { WorldState } from "./world-state.js";

/** Mirrors datasets/schema/provenance.schema.json (PV-2). */
export interface ScenarioProvenance {
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly sourceVersion: string | null;
  readonly gamePatch: string | null;
  readonly retrievedAt: string;
  readonly evidenceType: "observed" | "decoded" | "derived" | "inferred" | "simulated";
  readonly confidence: number | null;
  readonly verified: boolean;
  readonly verificationLevel: number;
  /** TRUE for generated data that is not a real match — must be preserved and surfaced. */
  readonly synthetic: boolean;
  readonly sha256: string | null;
  readonly notes: readonly string[];
}

export type CoordinateSpace = "minimapUnits" | "worldUnits";

export interface TeamDecisionContext {
  readonly contextId: string;
  readonly scenarioRef: string | null;

  readonly world: WorldState;

  readonly decidingTeamId: TeamId;
  readonly decidingSide: Side;

  /** The deciding team's perceived state (from the scenario belief / an ObservationProvider). */
  readonly observation: ObservationState;
  readonly belief: BeliefState;

  /** Enemies the team believes are alive (kill-feed certainty), if known. */
  readonly knownEnemyAliveCount: number | null;

  readonly coordinateSpace: CoordinateSpace;
  readonly provenance: ScenarioProvenance;
}
