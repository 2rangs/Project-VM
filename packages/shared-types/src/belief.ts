/**
 * Belief State — what a player/team *infers* from observations (Handoff §12.4, README §14.2, §17.3).
 *
 * Beliefs are explicitly uncertain. Enemy positions are probability distributions that
 * decay and spread over the reachable area as time passes since the last sighting
 * (README §17.3: a 10-second-old sighting is not a current position). Nothing here is
 * ground truth; `evidenceType` on every inference is "inferred".
 */
import type { AgentId, PlayerId } from "./ids.js";
import type { Vector3 } from "./vector.js";

/** A single weighted hypothesis about where an enemy is. */
export interface PositionHypothesis {
  readonly position: Vector3;
  readonly weight: number; // unnormalised; consumers normalise per distribution
}

export interface EnemyPositionBelief {
  readonly enemyId: PlayerId;
  readonly agentId: AgentId | null;
  readonly hypotheses: readonly PositionHypothesis[];
  /** Age of the newest supporting observation, in ms. Older → more spread. */
  readonly staleness: number;
}

export type TacticalIntent =
  | "aExecute"
  | "bExecute"
  | "midControl"
  | "rotate"
  | "fake"
  | "retake"
  | "save"
  | "unknown";

export interface TacticalHypothesis {
  readonly intent: TacticalIntent;
  readonly probability: number; // 0..1 across the hypothesis set
  readonly rationale: string;
}

export interface ThreatEstimate {
  readonly zoneId: string;
  readonly threatLevel: number; // 0..1
}

export interface BeliefState {
  readonly playerId: PlayerId;
  readonly timestampMs: number;

  readonly enemyPositionBeliefs: readonly EnemyPositionBelief[];
  readonly tacticalHypotheses: readonly TacticalHypothesis[];
  readonly threatZones: readonly ThreatEstimate[];
  readonly confidence: number; // 0..1 overall confidence in this belief snapshot
}
