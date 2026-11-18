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
  Side,
  SpikeState,
  TeamId,
  Vector2,
  Vector3,
} from "@pv/perception-engine";
// R2-B: teammate abilities use PV-3's REAL ability-inventory type (charges + ultimate points),
// imported from @pv/shared-types so a shape drift is a typecheck error, not a silent mismatch.
import type { AbilityInventory } from "@pv/shared-types";

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
  /**
   * Direction a holding/stationary player should aim: the zone to watch (a choke/entry). Sets
   * the player's facing (perception FOV + combat pre-aim) while not moving. When absent on a
   * hold/peek, `targetZone` is used; absent entirely, the sim defaults to the enemy entry choke.
   */
  readonly aimZone?: ZoneId;
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

/**
 * Own-team player state the policy reads (PV-3 required fields). Mirrors the subset of
 * @pv/shared-types PlayerState a policy needs; the real (richer) PlayerState is a superset.
 * `abilities` is the REAL @pv/shared-types AbilityInventory (basic/signature/ultimate with
 * charges + banked ultimate points) — R2-B contract alignment.
 */
export interface PolicyTeammate {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly agentId: string;
  readonly position: Vector3;
  readonly facing: Vector2;
  readonly health: number;
  readonly armor: number;
  readonly alive: boolean;
  readonly weapon: { readonly weaponId: string } | null;
  readonly abilities: AbilityInventory;
  readonly credits: number;
  readonly ultimatePoints: number;
  readonly ultimateCost: number;
}

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
  readonly teammates: readonly PolicyTeammate[];
  /** Team-aggregate observation (merged last-seen picture). */
  readonly observation: ObservationState;
  /** Per-player observations keyed by PlayerId (own team), for individual-vision decisions. */
  readonly perPlayerObservation?: Readonly<Record<string, ObservationState>>;
  /** Deciding team's belief — REQUIRED and non-empty when enemies have been observed. */
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
