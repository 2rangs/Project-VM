/**
 * Observation State — what a player (or team) has actually perceived (Handoff §12.3).
 *
 * This is the *only* sanctioned channel through which decision code learns about
 * enemies. Crucially, an {@link ObservedEnemy} is a strict subset of a PlayerState:
 * it exposes a last-seen position and coarse status, never the live omniscient
 * position, exact health, inventory or intentions. The type itself is the boundary —
 * there is no field here that leaks ground truth (DECISION-004, README §29).
 */
import type { AbilityId, AgentId, PlayerId, TeamId, WeaponId } from "./ids.js";
import type { Vector3 } from "./vector.js";

/** Coarse, perceivable health bands — never the exact HP of an unobserved enemy. */
export type HealthBand = "full" | "hurt" | "low" | "unknown";

export interface ObservedEnemy {
  readonly playerId: PlayerId;
  readonly agentId: AgentId | null; // may be unknown if only a silhouette/sound
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
  /** Landing off a drop (PROJECT V sound detail): a body arriving, heard within a reach set by the fall. */
  | "landing"
  | "traversal"
  | "other";

export interface SoundObservation {
  readonly kind: SoundKind;
  readonly approxPosition: Vector3; // localisation is approximate by nature
  readonly heardAtMs: number;
  readonly confidence: number; // 0..1
}

/** Information relayed by a teammate (subject to comms quality — Handoff §24.2). */
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
