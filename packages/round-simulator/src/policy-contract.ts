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
   * On a `useAbility` aimed at `targetZone`: the zone the effect screens off — it lands on the
   * side of `targetZone` that faces this zone (a smoke cutting that zone's sight onto it).
   * Absent → it lands on the side facing the thrower.
   */
  readonly aimZone?: ZoneId;
  /**
   * useAbility with a vision blocker (smoke): the zone to HIDE from `targetZone`'s view. The smoke
   * is thrown into `targetZone` and lands where it cuts the most of that zone's view of
   * `screenZone` while keeping off the walkway between the two (a cover smoke on the holders' side
   * of an entry, which the team then walks in beside rather than out of). Optional; without it the
   * landing follows `aimZone` / the thrower as before.
   */
  readonly screenZone?: ZoneId;
  /**
   * How the route to `targetZone` should be chosen (the policy picks the goal and the purpose;
   * the navigation layer finds the path). Default FASTEST.
   */
  readonly routePreference?: "FASTEST" | "SAFEST" | "STEALTH" | "TACTICAL";
  /**
   * Extra cost of passing through a zone (>= 0), from the team's BELIEF — seen / heard /
   * suspected enemies, utility. Never true enemy positions. Used by every preference but FASTEST.
   */
  readonly zoneCosts?: Readonly<Record<string, number>>;
  /**
   * A defender holding with a close-range gun (a shotgun) holds the angle up close: of the spots that
   * see the watched zone, the one nearest to it, so a fight starts within the gun's range. Default false.
   */
  readonly holdClose?: boolean;
}

export type TeamStrategy =
  | "default" | "aExecute" | "bExecute" | "cExecute" | "midControl" | "fakeAtoB" | "fakeBtoA"
  | "lurkDefault" | "save" | "defaultHold" | "aggroPush" | "stackA" | "stackB" | "stackC" | "retake";

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
  /**
   * Where this teammate is going right now (absent when not on a route): the remaining waypoints
   * and how long until it enters the next one. Own-team movement is fully known to the team, and
   * it is what lets utility be TIMED to a teammate's arrival (a flash that is still blinding when
   * the entry comes out of the smoke).
   */
  readonly transit?: TeammateTransit;
  /** How long this teammate stays blinded by a flash (ms; absent / 0 = not blind). Own team only. */
  readonly blindRemainingMs?: number;
}

export interface TeammateTransit {
  /** Remaining waypoints, next first; the last one is where the route ends. */
  readonly path: readonly ZoneId[];
  readonly nextZone: ZoneId;
  /** Time until the teammate enters `nextZone` at its current speed (ms). */
  readonly nextArrivalMs: number;
  /** Standing at the edge of a ground hazard, waiting for it to burn out. */
  readonly waitingAtEdge?: boolean;
}

/** Public parameters of an ability a teammate carries (catalog facts in runtime units; null = not catalogued). */
export interface AbilityFact {
  readonly effectType: string;
  readonly effectTypes: readonly string[];
  readonly durationMs: number | null;
  readonly flashDurationMs: number | null;
  readonly radiusUnits: number | null;
  readonly rangeUnits: number | null;
  readonly windupMs: number | null;
}

/**
 * An active effect the team knows about: its own (always known) or an enemy one a teammate can
 * see (in its zone or line of sight). Zone-level; `own` says whose it is.
 */
export interface VisibleEffect {
  readonly zoneId: ZoneId;
  readonly effectType: string;
  readonly abilityId: string;
  readonly own: boolean;
  readonly remainingMs: number;
}

/** An observed passable hazard (molly / area-denial): its zone and remaining lifetime (ms). */
export interface HazardInfo {
  readonly zoneId: ZoneId;
  readonly remainingMs: number;
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
  /**
   * Passable hazards (molly / area-denial) the team can currently OBSERVE (in a teammate's zone
   * or LoS) — zone + remaining lifetime. A path may cross one (taking damage) or wait it out;
   * this lets the policy choose. Observation-limited (DECISION-004): unseen hazards are absent.
   */
  readonly visibleHazards?: readonly HazardInfo[];
  /**
   * Every active effect the team knows of — its own, and enemy smokes / walls / fire / slow fields
   * a teammate has a sightline onto (also mirrored in `observation.knownMapChanges`). This is the
   * map as utility has changed it: where sight is cut, where the ground is denied.
   */
  readonly visibleEffects?: readonly VisibleEffect[];
  /** Catalog facts of the abilities this team carries, keyed by ability id. */
  readonly abilityFacts?: Readonly<Record<string, AbilityFact>>;
}

export interface DecisionPolicy {
  decide(view: PolicyView, rng: RandomSource): PolicyDecision;
  /**
   * Optional: the round's information trace (who knew what, who called what, when) for replay and
   * debugging. Read once at round end; opaque to the simulator.
   */
  informationTrace?(): unknown;
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
