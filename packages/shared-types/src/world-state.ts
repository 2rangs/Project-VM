/**
 * World State — the ground truth of a round (Handoff §12.1/§12.2, README §14.1).
 *
 * This is the *omniscient* state. It is deliberately the thing AI decision code must
 * NOT read directly: DECISION-004 / README §29 forbid giving players perfect
 * information. Access goes through the World→Observation boundary in @pv/world-state,
 * which produces an {@link ../observation ObservationState} per player.
 *
 * Field names are camelCase; all durations/timestamps are milliseconds; positions are
 * VALORANT world coordinate units.
 */
import type {
  AgentId,
  MapId,
  MatchId,
  PatchVersion,
  PlayerId,
  RoundId,
  Side,
  TeamId,
} from "./ids.js";
import type { AbilityInventory, InventoryState, TeamEconomyState, WeaponState } from "./economy.js";
import type { GameEvent } from "./events.js";
import type { Vector2, Vector3 } from "./vector.js";

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
  /** Position once dropped/planted; null while carried. */
  readonly position: Vector3 | null;
  /** Player currently carrying/planting/defusing; null otherwise. */
  readonly holderId: PlayerId | null;
  /**
   * Milliseconds until the spike detonates, measured from now. Only meaningful once
   * phase === "planted". null in every other phase.
   */
  readonly detonationInMs: number | null;
}

/** An ability effect currently active in the world (smoke, wall, flash zone, ...). */
export interface AbilityState {
  readonly instanceId: string;
  readonly ownerId: PlayerId;
  readonly abilityId: string;
  readonly origin: Vector3;
  readonly expiresAtMs: number | null; // round-relative; null = until destroyed/manual
}

/** Non-player, mutable map state (open doors, teleporter cooldowns, ...). */
export interface EnvironmentState {
  readonly openDoors: readonly string[];
  readonly activeInteractables: readonly string[];
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly agentId: AgentId;

  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly facing: Vector2;

  readonly health: number; // 0..100
  readonly armor: number; // remaining armor points (mirrors inventory.armor.points)

  readonly alive: boolean;

  readonly weapon: WeaponState | null; // currently equipped weapon
  readonly inventory: InventoryState;
  readonly abilities: AbilityInventory;

  readonly credits: number;
  readonly ultimatePoints: number;

  /** Coarse FSM label for the player's current micro-behaviour (engine-defined). */
  readonly behaviorState: string;

  /** Optional tactical order currently assigned by the team layer. */
  readonly currentOrderId: string | null;
}

export interface WorldState {
  readonly matchId: MatchId;
  readonly roundId: RoundId;
  readonly roundNumber: number;

  readonly tick: number;
  readonly timeRemainingMs: number; // round time remaining

  readonly mapId: MapId;
  readonly patchVersion: PatchVersion;

  readonly players: readonly PlayerState[];

  readonly spike: SpikeState;
  readonly activeAbilities: readonly AbilityState[];
  readonly environment: EnvironmentState;

  readonly economy: readonly TeamEconomyState[];

  /** Ordered, append-only event log for this round (canonical replay record). */
  readonly events: readonly GameEvent[];
}
