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

/** Which inventory slot an ability occupies (maps to @pv/shared-types AbilityInventory). */
export type AbilitySlotKind = "basic" | "signature" | "ultimate";

export interface AbilityLoadoutSlot {
  readonly abilityId: string;
  /** Inventory slot; absent is treated as "basic". The "ultimate" slot is the player's ult. */
  readonly slot?: AbilitySlotKind;
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
  | "spikePickup"
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

// ---- Perception/belief time series (PV-6 fog-of-war + Belief heatmap, recordPerception) ----
// Structural mirror of @pv/replay-engine's PerceptionTrack/PerceptionSnapshot (claude/pv-replay
// f9f7a09). Kept local so the round-simulator has no build dependency on PV-6's package; the
// shapes match field-for-field, so toPv6ReplayFormat's output is a drop-in for its `perception`.
// This is OBSERVATION/BELIEF, never ground truth (DECISION-004) — one track per team.

/** An enemy as a team currently sees or last saw them (never ground truth). */
export interface PerceptionObservedEnemy {
  readonly enemyId: string | null;
  readonly zone: string;
  readonly pos?: { readonly x: number; readonly y: number; readonly z: number } | null;
  readonly lastSeenMsAgo: number;
  readonly currentlyVisible: boolean;
}

/** Probability mass this team assigns to an enemy being in a zone (0..1; need not sum to 1). */
export interface ZoneBelief {
  readonly zone: string;
  readonly p: number;
}

/** A sound contact localized to a zone. */
export interface SoundCue {
  readonly zone: string;
  readonly kind?: string | null;
  readonly tMsAgo?: number;
}

/** One team's belief at one sampled instant. tMs is round-relative (the match merger offsets it). */
export interface PerceptionSnapshot {
  readonly tMs: number;
  readonly roundNum?: number | null;
  readonly observedEnemies: readonly PerceptionObservedEnemy[];
  readonly beliefZones: readonly ZoneBelief[];
  readonly sounds?: readonly SoundCue[];
}

/**
 * A whole team's perception time series. `teamIdx` here is SIDE-BASED for a single round
 * (0 = attack, 1 = defense) with `side` set; the match-level merger remaps to the real team
 * index using `side` + that round's attacker.
 */
export interface PerceptionTrack {
  readonly teamIdx: number;
  readonly side?: Side | null;
  readonly intervalTicks?: number | null;
  readonly snapshots: readonly PerceptionSnapshot[];
}

// ---- Command execution trace (policy-debugging aid for PV-3, config.traceCommands) ----

export type CommandTracePhase =
  | "issued" // a policy command was received for this player
  | "move" // a zone-hop was executed
  | "arrived" // the player reached the end of its move path
  | "plant" // a plant command was evaluated (see `result` for why it did/didn't start)
  | "ability" // a useAbility command was evaluated
  | "defuse"; // a defuse command was evaluated

/** One step in the command→execution trace. `result` carries the outcome / rejection reason. */
export interface CommandTraceEvent {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly playerId: PlayerId;
  readonly phase: CommandTracePhase;
  /** The ActionCommand kind involved (for "issued"). */
  readonly command?: SimEventKind | string;
  readonly targetZone?: string;
  readonly fromZone?: string;
  readonly toZone?: string;
  readonly abilityId?: string;
  /**
   * Outcome / rejection reason. For "plant": "started" | "planting" | "notPlantableZone" |
   * "noCarrier" | "notCarrier" | "dead". For "ability": "used" | "noSlot" | "unavailable" |
   * "noSpec". For "defuse": "started" | "notOnSpikeZone" | "dead". For "issued": "deferred"
   * when held by executeAtMs, else "active".
   */
  readonly result?: string;
}

/**
 * One duel's first-contact state — the posture inputs that decide an opening duel. Captured
 * for every engagement when config.traceCommands is on, so a policy's opening-duel win rate can
 * be explained (who saw first, pre-aim/holding vs moving, flashed, distance, zones).
 */
export interface EngagementRecord {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly attackerId: PlayerId;
  readonly defenderId: PlayerId;
  readonly attackerZone: string;
  readonly defenderZone: string;
  readonly distanceMeters: number;
  readonly attackerSawDefender: boolean;
  readonly defenderSawAttacker: boolean;
  /** Who had first sight (the reaction-time edge): "attacker" | "defender" | "mutual". */
  readonly firstSight: "attacker" | "defender" | "mutual";
  /** preAim = sees the enemy, is not seen back, and is not moving (a held angle). */
  readonly attackerPreAim: boolean;
  readonly defenderPreAim: boolean;
  readonly attackerMoving: boolean;
  readonly defenderMoving: boolean;
  readonly attackerFlashedMs: number;
  readonly defenderFlashedMs: number;
  /** Winning side of this duel, or null if no one died this duel. */
  readonly winnerSide: Side | null;
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
  /** Per-team observation/belief series, present only when config.recordPerception is true. */
  readonly perception?: readonly PerceptionTrack[];
  /** Command→execution trace, present only when config.traceCommands is true. */
  readonly commandTrace?: readonly CommandTraceEvent[];
  /** First-contact posture of every duel, present only when config.traceCommands is true. */
  readonly engagementTrace?: readonly EngagementRecord[];
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
  /** Record per-team observation/belief snapshots (PV-6 fog-of-war). Off by default (cost). */
  readonly recordPerception: boolean;
  /** Record a command→execution trace (policy debugging for PV-3). Off by default. */
  readonly traceCommands: boolean;
  /** Sampling interval for recordPerception, in ticks. Defaults to decisionIntervalTicks. */
  readonly perceptionIntervalTicks?: number;
  /** HP lost per tick while standing in a molly / area-denial zone. */
  readonly mollyDamagePerTick: number;
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
  recordPerception: false,
  traceCommands: false,
  mollyDamagePerTick: 6, // ~60 HP/s standing in fire (manual-approx)
};
