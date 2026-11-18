/**
 * Game events (Handoff §17 "Event System", README §8.3 events).
 *
 * Events are the only thing that mutates the world: the simulation applies an event
 * to produce the next WorldState (world-state package), and the ordered event log is
 * the canonical, replayable record of a round. Every event carries a monotonic `seq`
 * and the `tick`/`timeMs` at which it occurred so logs are totally ordered and
 * deterministic (DECISION-010).
 */
import type { AbilityId, EventId, PlayerId, Side, WeaponId } from "./ids.js";
import type { Vector3 } from "./vector.js";

export type DamageCause =
  | "weapon"
  | "ability"
  | "spike" // spike detonation
  | "fall" // falling / out-of-bounds
  | "self";

export interface GameEventBase {
  readonly id: EventId;
  /** Monotonic sequence number within a round; defines total order of the log. */
  readonly seq: number;
  readonly tick: number;
  readonly timeMs: number; // round-relative time in milliseconds
}

export interface RoundStartEvent extends GameEventBase {
  readonly kind: "roundStart";
  readonly roundNumber: number;
}

export interface MovementEvent extends GameEventBase {
  readonly kind: "move";
  readonly playerId: PlayerId;
  readonly from: Vector3;
  readonly to: Vector3;
}

export interface KillEvent extends GameEventBase {
  readonly kind: "kill";
  readonly victim: PlayerId;
  readonly killer: PlayerId | null; // null for non-hostile deaths (spike/fall)
  readonly assists: readonly PlayerId[];
  readonly cause: DamageCause;
  readonly weaponId: WeaponId | null;
}

export interface DamageEvent extends GameEventBase {
  readonly kind: "damage";
  readonly target: PlayerId;
  readonly source: PlayerId | null;
  readonly amount: number; // hit points
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

export interface RoundEndEvent extends GameEventBase {
  readonly kind: "roundEnd";
  readonly winner: Side;
  readonly reason: "elimination" | "spikeDetonation" | "spikeDefused" | "timeExpired";
}

export type GameEvent =
  | RoundStartEvent
  | MovementEvent
  | KillEvent
  | DamageEvent
  | AbilityUseEvent
  | SpikeEvent
  | RoundEndEvent;

export type GameEventKind = GameEvent["kind"];
