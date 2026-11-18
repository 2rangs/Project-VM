// PROJECT V — round-simulator local types.
//
// Ties spatial + perception + combat + ability engines into one deterministic round
// loop (Handoff §17, README §28.1). Decision-making is behind the DecisionPolicy
// interface so PV-3's Decision Engine can replace the scripted stand-in later.
//
// Ids mirror @pv/shared-types (string-aliased). DecisionContext mirrors pv-core's
// action-schema DecisionContext: self + observation + public round facts only — NEVER
// the omniscient world (DECISION-004).

import type { CombatSkills, CombatCalibration } from "@pv/combat-engine";
import type { Vector3 } from "@pv/perception-engine";
import type { MoveMode } from "./policy-contract.js";

export type PlayerId = string;
export type TeamId = string;
export type Side = "attack" | "defense";

export interface AbilityLoadoutSlot {
  readonly abilityId: string;
  chargesRemaining: number;
  lastUsedAtMs: number | null;
}

export interface SimPlayer {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly side: Side;
  readonly agentId: string;
  position: Vector3;
  zoneId: string;
  facing: { x: number; y: number };
  health: number;
  armor: number;
  alive: boolean;
  weaponId: string;
  readonly skills: CombatSkills;
  readonly abilities: AbilityLoadoutSlot[];
  ultimatePoints: number;
  ultimateCost: number;
  /** cached path (zone ids) the player is following, and index of the next waypoint. */
  path: string[];
  pathIndex: number;
  /** accumulated traversal time on the current edge (ms). */
  edgeProgressMs: number;
  moveMode: MoveMode;
}

export type SpikePhase = "carried" | "planting" | "planted" | "defusing" | "defused" | "detonated";

export interface SpikeState {
  phase: SpikePhase;
  carrierId: PlayerId | null;
  zoneId: string | null;
  position: Vector3 | null;
  plantProgressMs: number;
  defuseProgressMs: number;
  defuserId: PlayerId | null;
  /** absolute elapsed ms at which the spike detonates once planted. */
  detonateAtElapsedMs: number | null;
}

export interface SimState {
  readonly matchId: string;
  readonly roundId: string;
  readonly mapId: string;
  tick: number;
  elapsedMs: number;
  timeRemainingMs: number;
  readonly players: SimPlayer[];
  spike: SpikeState;
}

// The decision layer (DecisionPolicy / PolicyView / ActionCommand) follows PV-3's contract,
// mirrored in ./policy-contract.ts. The simulator consumes ActionCommand from there.

// ---- Output ----

export type SimEventKind =
  | "roundStart"
  | "move"
  | "abilityUsed"
  | "engage"
  | "kill"
  | "plantStart"
  | "planted"
  | "defuseStart"
  | "defuseInterrupted"
  | "defused"
  | "detonated"
  | "roundEnd";

export interface SimEvent {
  readonly kind: SimEventKind;
  readonly tick: number;
  readonly elapsedMs: number;
  readonly actor?: PlayerId;
  readonly target?: PlayerId;
  readonly zoneId?: string;
  readonly detail?: string;
}

export type RoundEndReason = "elimination" | "spikeDetonation" | "spikeDefused" | "timeExpired";

/** One recorded frame of player positions — the basis for a replay track (PV-6). */
export interface TrackFrame {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly players: ReadonlyArray<{
    readonly id: PlayerId;
    readonly side: Side;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly alive: boolean;
  }>;
}

export interface RoundResult {
  readonly winner: Side;
  readonly reason: RoundEndReason;
  readonly endedAtTick: number;
  readonly endedAtElapsedMs: number;
  readonly events: readonly SimEvent[];
  readonly survivors: Readonly<Record<Side, PlayerId[]>>;
  /** Side of each player this round (for validation export roster). */
  readonly roster: Readonly<Record<PlayerId, Side>>;
  /** Per-tick position frames, present only when config.recordTracks is true. */
  readonly tracks?: readonly TrackFrame[];
}

export interface SimConfig {
  readonly tickMs: number;
  readonly roundTimeMs: number;
  readonly decisionIntervalTicks: number;
  readonly plantDurationMs: number;
  readonly defuseDurationMs: number;
  readonly spikeTimerMs: number;
  readonly seed: number;
  readonly recordTracks: boolean;
  /** Optional combat-engine calibration applied to every duel (PV-2 stats seam). */
  readonly combatCalibration?: CombatCalibration;
}

export const DEFAULT_CONFIG: SimConfig = {
  tickMs: 100,
  roundTimeMs: 100000,
  decisionIntervalTicks: 5,
  plantDurationMs: 4000,
  defuseDurationMs: 7000,
  spikeTimerMs: 45000,
  seed: 1,
  recordTracks: false,
};
