// PROJECT V — local MIRROR of the subset of @pv/shared-types (PV-3, branch claude/pv-core)
// that perception-engine consumes and produces.
//
// WHY THIS EXISTS: shared-types lives on another branch (claude/pv-core) and is not a
// dependency available in this branch's tree. These declarations mirror PV-3's shapes
// *field-for-field* (read from packages/shared-types/src on 2026-11-18) so this package
// is standalone and testable now. On monorepo integration, delete this file and
// `import type { ... } from "@pv/shared-types"` instead — the names and structures match,
// so it is a drop-in swap.
//
// Branded ids in shared-types erase to `string`; we alias them to `string` here. A real
// branded id is assignable to `string`, and we only ever pass ids through (never mint
// new ones from raw strings), so this stays forward-compatible.

export type PlayerId = string;
export type TeamId = string;
export type AgentId = string;
export type WeaponId = string;
export type AbilityId = string;
export type MatchId = string;
export type RoundId = string;
export type MapId = string;
export type PatchVersion = string;
export type Side = "attack" | "defense";

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}
export interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---- Observation (shared-types/observation.ts) ----

export type HealthBand = "full" | "hurt" | "low" | "unknown";

export interface ObservedEnemy {
  readonly playerId: PlayerId;
  readonly agentId: AgentId | null;
  /** Where the enemy was when last seen — NOT their current position. */
  readonly lastSeenPosition: Vector3;
  readonly lastSeenAtMs: number;
  readonly healthBand: HealthBand;
  readonly observedWeaponId: WeaponId | null;
  /** True only while currently in line of sight this tick. */
  readonly currentlyVisible: boolean;
}

export type SoundKind =
  | "footstep"
  | "gunfire"
  | "reload"
  | "abilityCast"
  | "spikePlant"
  | "spikeDefuse"
  | "other";

export interface SoundObservation {
  readonly kind: SoundKind;
  readonly approxPosition: Vector3; // zone-level localisation, not exact source
  readonly heardAtMs: number;
  readonly confidence: number; // 0..1
}

export interface TeamReport {
  readonly fromPlayerId: PlayerId;
  readonly aboutEnemy: PlayerId | null;
  readonly approxPosition: Vector3 | null;
  readonly reportedAtMs: number;
}

export interface MapObservation {
  readonly abilityId: AbilityId | null;
  readonly approxPosition: Vector3;
  readonly observedAtMs: number;
  readonly note: string;
}

export interface ObservationState {
  readonly observerId: PlayerId;
  readonly teamId: TeamId;
  readonly timestampMs: number;
  readonly visibleEnemies: readonly ObservedEnemy[];
  readonly audibleEvents: readonly SoundObservation[];
  readonly teammateReports: readonly TeamReport[];
  readonly knownMapChanges: readonly MapObservation[];
}

// ---- World (shared-types/world-state.ts, economy.ts, events.ts) — INPUT only ----

export interface WeaponState {
  readonly weaponId: WeaponId;
  readonly magazine: number;
  readonly reserve: number;
}

export interface AbilityState {
  readonly instanceId: string;
  readonly ownerId: PlayerId;
  readonly abilityId: string;
  readonly origin: Vector3;
  readonly expiresAtMs: number | null;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly agentId: AgentId;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly facing: Vector2;
  readonly health: number;
  readonly armor: number;
  readonly alive: boolean;
  readonly weapon: WeaponState | null;
  readonly behaviorState: string;
  // NOTE: the real PlayerState has more fields (inventory, abilities, credits, ...).
  // perception-engine deliberately reads only the perceivable ones above.
}

export type SpikePhase =
  | "carried"
  | "dropped"
  | "planting"
  | "planted"
  | "defusing"
  | "defused"
  | "detonated";

export interface SpikeState {
  readonly phase: SpikePhase;
  readonly position: Vector3 | null;
  readonly holderId: PlayerId | null;
  readonly detonationInMs: number | null;
}

// Events (subset used for hearing). Mirrors shared-types/events.ts discriminated union.
export interface GameEventBase {
  readonly id: string;
  readonly seq: number;
  readonly tick: number;
  readonly timeMs: number;
}
export type DamageCause = "weapon" | "ability" | "spike" | "fall" | "self";
export interface KillEvent extends GameEventBase {
  readonly kind: "kill";
  readonly victim: PlayerId;
  readonly killer: PlayerId | null;
  readonly assists: readonly PlayerId[];
  readonly cause: DamageCause;
  readonly weaponId: WeaponId | null;
}
export interface DamageEvent extends GameEventBase {
  readonly kind: "damage";
  readonly target: PlayerId;
  readonly source: PlayerId | null;
  readonly amount: number;
  readonly cause: DamageCause;
}
export interface AbilityUseEvent extends GameEventBase {
  readonly kind: "abilityUse";
  readonly playerId: PlayerId;
  readonly abilityId: AbilityId;
  readonly at: Vector3 | null;
}
export type SpikeEventKind =
  | "spikePickup"
  | "spikeDrop"
  | "spikePlantStart"
  | "spikePlanted"
  | "spikeDefuseStart"
  | "spikeDefused"
  | "spikeDetonated";
export interface SpikeEvent extends GameEventBase {
  readonly kind: SpikeEventKind;
  readonly playerId: PlayerId | null;
  readonly at: Vector3 | null;
}
export interface OtherEvent extends GameEventBase {
  readonly kind: "roundStart" | "move" | "roundEnd";
}
export type GameEvent = KillEvent | DamageEvent | AbilityUseEvent | SpikeEvent | OtherEvent;

export interface WorldState {
  readonly matchId: MatchId;
  readonly roundId: RoundId;
  readonly roundNumber: number;
  readonly tick: number;
  readonly timeRemainingMs: number;
  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;
  readonly players: readonly PlayerState[];
  readonly spike: SpikeState;
  readonly activeAbilities: readonly AbilityState[];
  readonly events: readonly GameEvent[];
  // NOTE: real WorldState also has `environment` and `economy`; perception ignores them.
}
