/**
 * Ultimate economy: track both teams' ult charge, value point-denial and ult timing
 * (Handoff §15.2, README §21). Point requirements come from the canonical PV-1 catalog (rules.ts);
 * point-earning rules mirror @pv/game-rules (provisional).
 */
import { ULT_POINT_RULES, ultPointsRequired } from "./rules.js";
import type { AgentId, PlayerId } from "./shared-mirror.js";

export type UltEventKind =
  | "kill"
  | "death"
  | "spike_plant"
  | "spike_defuse"
  | "orb"
  | "spike_death"
  | "environment_death";

export interface UltState {
  readonly playerId: PlayerId;
  readonly agentKey: AgentId;
  readonly points: number;
  readonly required: number; // undefined-safe: falls back to 7 if agent unknown
  readonly ready: boolean;
  readonly pointsToReady: number;
}

/** Build an ult state, resolving the agent's required points from the canonical catalog. */
export function makeUltState(playerId: PlayerId, agentKey: AgentId, points: number): UltState {
  const required = ultPointsRequired(agentKey) ?? 7;
  const clamped = Math.max(0, Math.min(points, required));
  return {
    playerId,
    agentKey,
    points: clamped,
    required,
    ready: clamped >= required,
    pointsToReady: Math.max(0, required - clamped),
  };
}

/** Points a single event grants to the actor (positive) per the (provisional) earning rules. */
export function pointsForEvent(kind: UltEventKind): number {
  switch (kind) {
    case "kill":
      return ULT_POINT_RULES.pointForKill.value;
    case "death":
      return ULT_POINT_RULES.pointForDeath.value;
    case "spike_plant":
      return ULT_POINT_RULES.pointForSpikePlant.value;
    case "spike_defuse":
      return ULT_POINT_RULES.pointForSpikeDefuse.value;
    case "orb":
      return ULT_POINT_RULES.pointForOrb.value;
    // README §21.4: non-hostile deaths may not charge the enemy the way a kill does.
    case "spike_death":
    case "environment_death":
      return ULT_POINT_RULES.nonHostileDeathGrantsEnemyPoint.value ? 1 : 0;
    default:
      return 0;
  }
}

/** Apply an event to a player's ult state (points capped at required). */
export function applyUltEvent(state: UltState, kind: UltEventKind): UltState {
  const gained = pointsForEvent(kind);
  if (gained === 0) return state;
  return makeUltState(state.playerId, state.agentKey, state.points + gained);
}

/**
 * Value of DENYING an enemy one ult point by not dying to them, in [0, 1].
 * Highest when the enemy is exactly one point from a ready ultimate; zero once they are already
 * ready (the point is wasted) or far away. `ultImpact` scales by how game-swinging that ult is.
 */
export function ultDenialValue(enemy: UltState, ultImpact = 0.6): number {
  if (enemy.ready) return 0; // already charged — denying a point changes nothing
  if (enemy.pointsToReady === 1) return ultImpact; // one kill from their ult: denial is worth most
  if (enemy.pointsToReady === 2) return ultImpact * 0.35;
  return ultImpact * 0.1; // far from ult: small
}

/** Is the enemy's ult a present threat this round? */
export const ultReadyThreat = (enemy: UltState): boolean => enemy.ready;
