// PROJECT V — structural MIRROR of PV-3's DecisionPolicy contract
// (@pv/shared-types decision-policy.ts + spatial-query.ts, branch claude/pv-core 9d7ba29).
//
// Mirrored here (not imported) because shared-types lives on another branch. Field names
// match PV-3 so this is a drop-in swap on monorepo integration. Shapes already mirrored in
// perception-engine (ObservationState, SpikeState, PlayerState, Vector2/3, ids) are reused
// from there to avoid duplication.
//
// KNOWN DIVERGENCES (reported to orchestrator → PV-3):
//  - `teammates` uses perception's PlayerState mirror (a SUBSET of PV-3's world-state
//    PlayerState: no credits/inventory/abilities/ultimatePoints). Fine for the scripted
//    policy; the real (richer) PlayerState is a superset, so a policy reading this subset
//    stays compatible.
//  - ZoneId is a plain string here (PV-3 brands it); assignable either way.
//  - BeliefState is produced near-empty (perception-engine computes observation, not belief).

import type {
  AbilityId,
  MapId,
  ObservationState,
  PatchVersion,
  PlayerId,
  PlayerState,
  Side,
  SpikeState,
  TeamId,
  Vector2,
  Vector3,
} from "@project-v/perception-engine";

// ---- SpatialQuery (mirror of spatial-query.ts) ----

export type ZoneId = string;
export type ZoneType = "site" | "main" | "lobby" | "mid" | "link" | "spawn" | "connector" | "position";
export type TravelMode = "run" | "walk";

export interface ZoneMeta {
  readonly id: ZoneId;
  readonly zoneType: ZoneType;
  readonly site: string | null;
  readonly plantable: boolean;
  readonly callout?: string;
}
export interface ZonePath {
  readonly path: readonly ZoneId[];
  readonly timeMs: number;
  readonly distanceMeters: number;
  readonly mode: TravelMode;
}
export interface AudibleZoneResult {
  readonly zoneId: ZoneId;
  readonly strength: number;
}
export interface LineOfSightOptions {
  readonly smokedPairs?: ReadonlyArray<readonly [ZoneId, ZoneId]>;
}
export interface SpatialQuery {
  readonly mapId: string;
  nearestZone(position: Vector2): ZoneId;
  getZoneMeta(zoneId: ZoneId): ZoneMeta | undefined;
  allZones(): readonly ZoneId[];
  zonesByType(type: ZoneType): readonly ZoneId[];
  findPath(from: ZoneId, to: ZoneId, mode?: TravelMode): ZonePath | null;
  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode?: TravelMode): number | null;
  isReachable(from: ZoneId, to: ZoneId): boolean;
  hasLineOfSight(a: ZoneId, b: ZoneId, opts?: LineOfSightOptions): boolean;
  visibleZonesFrom(zoneId: ZoneId): readonly ZoneId[];
  isPlantableZone(zoneId: ZoneId): boolean;
  audibleZones(originZone: ZoneId, threshold?: number): readonly AudibleZoneResult[];
}

// ---- Commands / decision (mirror of decision-policy.ts) ----

export type MoveMode = "walk" | "run";
export type ActionCommandKind = "move" | "hold" | "peek" | "useAbility" | "plant" | "defuse" | "save";

export interface ActionCommand {
  readonly playerId: PlayerId;
  readonly kind: ActionCommandKind;
  readonly targetZone?: ZoneId;
  readonly moveMode?: MoveMode;
  readonly abilityId?: AbilityId;
  readonly executeAtMs?: number;
  readonly sourceActionId?: string;
}

export type TeamStrategy =
  | "default" | "aExecute" | "bExecute" | "midControl" | "fakeAtoB" | "fakeBtoA"
  | "lurkDefault" | "save" | "defaultHold" | "aggroPush" | "stackA" | "stackB" | "retake";

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

export interface RandomSource {
  nextFloat(): number;
  nextInt(minInclusive: number, maxExclusive: number): number;
}

// ---- Belief / economy mirrors (minimal) ----

export interface PositionHypothesis {
  readonly position: Vector3;
  readonly weight: number;
}
export interface EnemyPositionBelief {
  readonly enemyId: PlayerId;
  readonly agentId: string | null;
  readonly hypotheses: readonly PositionHypothesis[];
  readonly staleness: number;
}
export interface TacticalHypothesis {
  readonly intent: string;
  readonly probability: number;
  readonly rationale: string;
}
export interface ThreatEstimate {
  readonly zoneId: string;
  readonly threatLevel: number;
}
export interface BeliefState {
  readonly playerId: PlayerId;
  readonly timestampMs: number;
  readonly enemyPositionBeliefs: readonly EnemyPositionBelief[];
  readonly tacticalHypotheses: readonly TacticalHypothesis[];
  readonly threatZones: readonly ThreatEstimate[];
  readonly confidence: number;
}
export interface TeamEconomyState {
  readonly teamId: TeamId;
  readonly side: Side;
  readonly credits: number;
  readonly lossBonusTier: number;
  readonly consecutiveLosses: number;
}

// ---- PolicyView / policy ----

export interface PolicyView {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly roundNumber: number;
  readonly timeRemainingMs: number;
  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;
  readonly spike: SpikeState;
  /** Own team's players — fully known (they are yours). NO enemy players here. */
  readonly teammates: readonly PlayerState[];
  readonly observation: ObservationState;
  readonly belief: BeliefState;
  readonly economy: TeamEconomyState;
  readonly knownEnemyAliveCount: number | null;
  readonly matchScore: readonly [number, number] | null;
}

export interface DecisionPolicy {
  decide(view: PolicyView, rng: RandomSource): PolicyDecision;
}

export interface PlayerProfile {
  readonly playerId: PlayerId;
  readonly aggression: number;
  readonly discipline: number;
  readonly decisionMaking: number;
  readonly teamwork: number;
}
export const NEUTRAL_PROFILE: Omit<PlayerProfile, "playerId"> = {
  aggression: 0.5,
  discipline: 0.5,
  decisionMaking: 0.5,
  teamwork: 0.5,
};
