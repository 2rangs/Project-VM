/**
 * Action Schema (README §15.2, §15.3; Handoff §13).
 *
 * The Action Generator (a later agent, PV-next) turns a DecisionContext into concrete
 * CandidateActions by matching schemas, generating parameters, and validating
 * constraints. This module only defines the *contract* those pieces share. Two rules
 * from the master prompt are encoded structurally:
 *   - README §29: the generator must build actions from the current map/position/time,
 *     not pick from a fixed list — hence `generate(context)` is a function, not a const
 *     array, and parameters are generated per context.
 *   - README §15.3: a physically impossible action is EXCLUDED, not merely low-scored —
 *     hence {@link FeasibilityResult} distinguishes "infeasible" from a low utility.
 *
 * DecisionContext intentionally exposes only self + observation + belief + public round
 * facts — never omniscient enemy state (DECISION-004).
 */
import type { BeliefState } from "./belief.js";
import type { TeamEconomyState } from "./economy.js";
import type { MapId, PatchVersion, PlayerId, Side, TeamId } from "./ids.js";
import type { ObservationState } from "./observation.js";
import type { SpikePhase } from "./world-state.js";

export type ActionCategory = "strategic" | "tactical" | "individual";

/** Public, non-omniscient facts about the round available to every decision maker. */
export interface PublicRoundContext {
  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;
  readonly roundNumber: number;
  readonly timeRemainingMs: number;
  readonly spikePhase: SpikePhase;
  readonly aliveCountSelfTeam: number;
  readonly aliveCountEnemyTeam: number; // observable from HUD / kill feed
}

/** Everything a single decision maker may legitimately read (DECISION-004). */
export interface DecisionContext {
  readonly selfId: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;

  readonly round: PublicRoundContext;
  readonly economy: TeamEconomyState;

  readonly observation: ObservationState;
  readonly belief: BeliefState;
}

/** A precondition predicate evaluated against a DecisionContext. */
export interface Condition {
  readonly id: string;
  readonly description: string;
  evaluate(context: DecisionContext): boolean;
}

export type ParameterType = "position" | "direction" | "timing" | "target" | "path" | "enum";

export interface ParameterDefinition {
  readonly name: string;
  readonly type: ParameterType;
  readonly description: string;
  readonly required: boolean;
}

/** Why an action is unavailable — distinguishes impossible from merely risky. */
export type InfeasibilityReason =
  | "noPath"
  | "insufficientTime"
  | "missingAbility"
  | "deadActor"
  | "wrongSpikeState"
  | "notEnoughPlayers"
  | "outOfRange"
  | "blocked";

export type FeasibilityResult =
  | { readonly feasible: true }
  | { readonly feasible: false; readonly reasons: readonly InfeasibilityReason[] };

/** A concrete, parameterised action produced by a schema for a given context. */
export interface CandidateAction {
  readonly id: string;
  readonly schemaId: string;
  readonly category: ActionCategory;
  readonly actors: readonly PlayerId[];
  readonly parameters: Readonly<Record<string, unknown>>;

  readonly estimatedDurationMs: number;
  readonly creditCost: number;

  readonly feasibility: FeasibilityResult;
}

/**
 * A reusable action template. `generate` is the heart of situation-aware generation:
 * it inspects the context and emits zero or more concrete candidates.
 */
export interface ActionSchema {
  readonly id: string;
  readonly category: ActionCategory;
  readonly parameters: readonly ParameterDefinition[];
  readonly preconditions: readonly Condition[];

  generate(context: DecisionContext): readonly CandidateAction[];
}
