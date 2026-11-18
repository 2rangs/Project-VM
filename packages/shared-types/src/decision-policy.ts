/**
 * DecisionPolicy — the contract PV-4's round-simulator calls to drive agents (Handoff §17
 * Team Engine, README §23–24). PV-3 proposes this shape; PV-4's `round-simulator` was not
 * yet pushed when this was written, so this is the authority until reconciled (reported to
 * the orchestrator).
 *
 * Hard rule (DECISION-004, tested): the policy INPUT is a {@link PolicyView} — the deciding
 * team's *observable* state. It has NO `WorldState` and NO enemy ground truth; enemies are
 * known only through `observation`/`belief`. Own-team players ARE fully known (they are
 * yours). The map (`SpatialQuery`) is a construction dependency of the policy, not part of
 * the per-decision input.
 *
 * The OUTPUT is a set of {@link ActionCommand}s whose kinds mirror the individual Action
 * Schema (README §16.3): move/walk/run, hold, peek, use ability, plant, defuse, save.
 */
import type { AbilityId, MapId, PatchVersion, PlayerId, Side, TeamId } from "./ids.js";
import type { BeliefState } from "./belief.js";
import type { ObservationState } from "./observation.js";
import type { PlayerState, SpikeState } from "./world-state.js";
import type { TeamEconomyState } from "./economy.js";
import type { ZoneId } from "./spatial-query.js";

export type MoveMode = "walk" | "run";

export type ActionCommandKind =
  | "move"
  | "hold"
  | "peek"
  | "useAbility"
  | "plant"
  | "defuse"
  | "save";

export interface ActionCommand {
  readonly playerId: PlayerId;
  readonly kind: ActionCommandKind;
  /** Destination/aim zone for move/peek/plant/defuse/save. */
  readonly targetZone?: ZoneId;
  readonly moveMode?: MoveMode;
  readonly abilityId?: AbilityId;
  /** Coordination offset in ms (teamwork: util before entry, staggered pushes). */
  readonly executeAtMs?: number;
  /** The CandidateAction id this command was chosen from (trace link). */
  readonly sourceActionId?: string;
}

/**
 * The deciding team's observable view — the policy's only per-decision input. No WorldState.
 */
export interface PolicyView {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly roundNumber: number;
  readonly timeRemainingMs: number;
  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;
  readonly spike: SpikeState; // public spike state
  /** Own team's players — fully known (they are yours). */
  readonly teammates: readonly PlayerState[];
  readonly observation: ObservationState;
  readonly belief: BeliefState;
  readonly economy: TeamEconomyState;
  readonly knownEnemyAliveCount: number | null;
  readonly matchScore: readonly [number, number] | null;
}

/** Team strategy the IGL selects (Handoff §16). */
export type TeamStrategy =
  | "default"
  | "aExecute"
  | "bExecute"
  | "midControl"
  | "fakeAtoB"
  | "fakeBtoA"
  | "lurkDefault"
  | "save"
  // defense
  | "defaultHold"
  | "aggroPush"
  | "stackA"
  | "stackB"
  | "retake";

export type PlayerRole = "entry" | "support" | "lurker" | "anchor" | "rotator" | "igl";

export interface RoleAssignment {
  readonly playerId: PlayerId;
  readonly role: PlayerRole;
}

export interface PolicyDecision {
  readonly strategy: TeamStrategy;
  readonly roles: readonly RoleAssignment[];
  readonly commands: readonly ActionCommand[];
}

/**
 * Minimal deterministic randomness source. `@pv/simulation-core`'s RngStream satisfies it
 * structurally, so the policy stays independent of that package while remaining seedable.
 */
export interface RandomSource {
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
}

export interface DecisionPolicy {
  decide(view: PolicyView, rng: RandomSource): PolicyDecision;
}

/** Player tendencies / abilities that bias decisions (README §23.1 subset), each 0..1. */
export interface PlayerProfile {
  readonly playerId: PlayerId;
  readonly aggression: number; // appetite for risky peeks/entries
  readonly discipline: number; // tacticalDiscipline — follows team orders
  readonly decisionMaking: number; // avoids bad fights
  readonly teamwork: number; // timing alignment with the team
}

export const NEUTRAL_PROFILE: Omit<PlayerProfile, "playerId"> = {
  aggression: 0.5,
  discipline: 0.5,
  decisionMaking: 0.5,
  teamwork: 0.5,
};
