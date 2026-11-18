/**
 * Action Generator output model (README §15, §19 required outputs).
 *
 * Extends the shared {@link CandidateAction} with the §19 evaluation fields the Decision
 * Prototype must produce: Feasibility, Required Time, Resource Cost, Estimated Risk,
 * Expected Utility, plus a human-readable rationale for the Decision Debugger.
 */
import type {
  CandidateAction,
  InfeasibilityReason,
  PlayerId,
  SpatialQuery,
  TeamDecisionContext,
  TeamId,
  ZoneId,
} from "@pv/shared-types";

/** Resource consumed by an action. Credits are in-round opportunity; abilities are charges. */
export interface ResourceCost {
  readonly credits: number;
  readonly abilities: number;
}

export interface ActionEvaluation {
  readonly requiredTimeMs: number;
  readonly resourceCost: ResourceCost;
  /** 0 (safe) .. 1 (near-certain loss of the engaging players). */
  readonly estimatedRisk: number;
  /** Higher is better. Rule/utility based (no ML — DECISION-005). Unitless. */
  readonly expectedUtility: number;
  readonly rationale: readonly string[];
}

export interface EvaluatedAction extends CandidateAction {
  readonly evaluation: ActionEvaluation;
}

export interface ExcludedAction {
  readonly candidate: CandidateAction; // feasibility.feasible === false
  readonly reasons: readonly InfeasibilityReason[];
  readonly explanation: string;
}

export interface GenerationResult {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly decidingTeamId: TeamId;
  readonly atMs: number;
  /** Feasible actions, sorted by expectedUtility desc then id asc (deterministic). */
  readonly feasible: readonly EvaluatedAction[];
  readonly excluded: readonly ExcludedAction[];
  /** The team-level selected action (best feasible strategic), or null. */
  readonly selected: EvaluatedAction | null;
  readonly selectionRationale: string;
}

/** Caller-supplied belief pressure: believed enemy probability on a zone (0..~). */
export type EnemyPressureFn = (zone: ZoneId) => number;

export interface GeneratorInput {
  readonly team: TeamDecisionContext;
  readonly spatial: SpatialQuery;
  /** Believed enemy pressure per zone (from @pv/decision-engine). Defaults to 0 everywhere. */
  readonly enemyPressure?: EnemyPressureFn;
  /** Reserved for future stochastic rollouts; evaluation is currently deterministic. */
  readonly seed?: number | string;
}

/** Internal: a player and the zone they currently occupy. */
export interface PlayerAtZone {
  readonly playerId: PlayerId;
  readonly zone: ZoneId;
}
