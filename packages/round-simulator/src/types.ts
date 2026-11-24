import type { PlantPreferences, PlantSpotKind } from "./plant-spot.js";
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

/**
 * Tactical ratings in [0,1] (higher is better; league average 0.6). Mechanical skill (CombatSkills)
 * decides a fair duel; these decide how a player fares in the SITUATIONS around it:
 *  - gameSense: caught in a crossfire (양각) → scales the crossfire reaction penalty.
 *  - trading:   teammate's call on an enemy → how long that info stays usable (refrag window).
 *  - clutch:    last player alive against several → composure (reaction bonus / penalty).
 * See docs/STAT_OUTCOME_MATRIX.md for the full stat → outcome table.
 */
export interface TacticalTraits {
  readonly gameSense: number;
  readonly trading: number;
  readonly clutch: number;
}

export const AVERAGE_TRAITS: TacticalTraits = { gameSense: 0.6, trading: 0.6, clutch: 0.6 };

/** Trait reference point: a 0.6 player gets exactly the base (calibrated) value of each effect. */
export const TRAIT_BASELINE = 0.6;

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
  /** Tactical (non-mechanical) ratings that decide the situational duel cases (default AVERAGE_TRAITS). */
  readonly traits?: TacticalTraits;
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
  /** 1-based round number within the match (surfaced to policies). Default 1. */
  readonly roundNumber?: number;
  /**
   * Things a body cannot walk through for a time (a physical wall). NOT vision blockers: a smoke
   * blocks sight and is walked through. No ability creates one yet — the catalog records walls as
   * vision blockers only — so this is set by scenarios / tests and by future verified rules.
   */
  readonly movementBlockers?: readonly MovementBlocker[];
  /** Each side's economy going into the round (surfaced to its own policy only). */
  readonly economy?: Readonly<Partial<Record<Side, { readonly credits: number; readonly lossBonusTier: number; readonly consecutiveLosses: number }>>>;
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
  | "weaponPickup"
  | "orbPickup"
  | "plantStart"
  | "planted"
  | "defuseStart"
  | "defuseInterrupted"
  | "defused"
  | "detonated"
  | "landing"
  | "traversal"
  | "disengage"
  | "rePeek"
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

/** A movement blocker: a whole zone's floor, or a disc of floor. */
export interface MovementBlocker {
  readonly id: string;
  readonly zoneId?: string;
  readonly center?: Vector3;
  readonly radiusUnits?: number;
  readonly fromMs: number;
  readonly untilMs: number;
}

/** A navigation event of the round: a route planned / re-planned, or a goal found blocked / unreachable. */
export interface NavTraceEvent {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly kind: "planned" | "replanned" | "blocked" | "unreachable";
  readonly playerId: string;
  readonly goalZone: string;
  readonly reason?: string;
  readonly pathLength?: number;
  readonly estimatedTravelMs?: number;
  readonly preference?: string;
  /** The order behind the move (the policy's `sourceActionId`), i.e. what the route is for. */
  readonly intent?: string;
  /** Where the player stood when the path was planned or refused. */
  readonly from?: { readonly x: number; readonly y: number; readonly z: number };
  /** The planned path: the points the player will walk through. */
  readonly waypoints?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>;
  /** The strategic route (zones), current zone first. */
  readonly zones?: readonly string[];
  /** Zones the planner was told to avoid and their cost — from the team's belief, never true positions. */
  readonly avoided?: ReadonlyArray<{ readonly zoneId: string; readonly cost: number }>;
  /** Ground patches (fire, slow) priced into the plan. */
  readonly hazards?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number; readonly radius: number }>;
}

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
    /**
     * Enemies this player SEES on this tick — exactly the sight the engagement step used (the
     * perception engine's line of sight, FOV and range; a blinded player sees nobody). Ids, sorted.
     * Present on every living player's entry and on one killed this very tick (its sight when the
     * duel began); absent on players dead before the tick.
     */
    readonly sees?: readonly PlayerId[];
    /** True while the player is blinded by a flash (it then sees nobody). Absent otherwise. */
    readonly blind?: true;
    /** Gaze (unit vector, horizontal): where the player's crosshair points this tick. Living players. */
    readonly facing?: { readonly x: number; readonly y: number };
    /** What it is looking at: an enemy it sees, a believed threat, its held angle, or the way ahead. */
    readonly gaze?: "enemy" | "threat" | "hold" | "route";
    /** The point it chose to look at (gaze "enemy" / "threat"; gaze model only). */
    readonly look?: { readonly x: number; readonly y: number; readonly z: number };
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
   * Outcome / rejection reason. For "plant": "started" | "planting" | "notPlantableZone" | "notOnPlantArea" |
   * "noCarrier" | "notCarrier" | "dead". For "ability": "used" | "noSlot" | "unavailable" |
   * "noSpec". For "defuse": "started" | "notAtSpike" (beyond DEFUSE_REACH_UNITS) | "dead". For "issued": "deferred"
   * when held by executeAtMs, else "active".
   */
  readonly result?: string;
  /** Why (a navigation failure's reason). */
  readonly reason?: string;
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
  /** Angle-advantage reaction delay each side carried into the duel (ms; the nearer-the-corner side). */
  readonly angleDelayMs?: { readonly attacker: number; readonly defender: number };
  /** The side caught in a crossfire (exposed to a second enemy's sightline), if any. */
  readonly crossfire?: { readonly attacker: boolean; readonly defender: boolean };
  /** The side whose team had a fresh call on the other's position (infoWindowMs). */
  readonly info?: { readonly attacker: boolean; readonly defender: boolean };
  readonly attackerFlashedMs: number;
  readonly defenderFlashedMs: number;
  /** Gaze error (deg) each side's crosshair had off the other at first contact (Fitts aim offset). */
  readonly aimOffsetDeg?: { readonly attacker: number; readonly defender: number };
  /** When each side could first fire (ms after contact; combat-engine readyDelayMs). */
  readonly readyMs?: { readonly attacker: number; readonly defender: number };
  /** Gaze model: the peek in this contact (who peeked, how), whether it ended as a disengage, and the spike phase. */
  readonly peek?: { readonly side: "attack" | "defense"; readonly kind: string; readonly rePeek: boolean };
  readonly disengaged?: boolean;
  readonly spikePhase?: string;
  /** What each side was looking at (gaze source) at first contact. */
  readonly gaze?: { readonly attacker: string; readonly defender: string };
  /**
   * Set when a side came out of a vision blocker into this duel (present only then): it crossed a
   * smoke-cut sightline on the hop that started the duel, so it had no sight until it was out.
   * `watched` = the other side was holding that smoke edge (stationary, facing it, not blind).
   */
  readonly smokeExit?: { readonly attacker: boolean; readonly defender: boolean; readonly watched: boolean };
  /** Winning side of this duel, or null if no one died this duel. */
  readonly winnerSide: Side | null;
}

/**
 * An observable cue a shot gave the OTHER team (world event → observation). Physical facts decide
 * which channels exist — sound propagates over the map's sound graph; a tracer needs a weapon
 * whose tracers enemies can see and a sightline onto the shot's path — and each channel localises
 * the shooter with a different confidence. The cue is evidence, not ground truth: it feeds the
 * observing team's intel/belief and never the combat resolution itself.
 */
export interface ShotCue {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly shooterId: PlayerId;
  readonly weaponId: string;
  /** Zone the shot came from (zone-level localisation) and that zone's centre. */
  readonly zoneId: string;
  readonly zonePosition: Vector3;
  readonly observerSide: Side;
  readonly channel: "sound" | "tracer";
  /** 0..1 — how firmly this cue localises the shooter. */
  readonly confidence: number;
}

/**
 * An observable cue an ability gave the OTHER team (world event → observation), the ability
 * counterpart of {@link ShotCue}. Two channels, decided by physical facts:
 *  - "sound": the cast was heard over the map's sound graph → zone = the CASTER's zone (loose);
 *  - "sight": the deployed effect (smoke / wall / fire / slow field) is seen by someone with a
 *    sightline onto it → zone = the EFFECT's zone. This says where utility is being committed,
 *    not where the caster stands (a smoke is thrown from range).
 * Zone-level evidence only — never the caster's position. It feeds the observing team's
 * observation (and, for a heard cast, its intel on the caster), never the combat resolution.
 */
export interface AbilityCue {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly casterId: PlayerId;
  readonly abilityId: string;
  readonly effectType: string;
  readonly zoneId: string;
  readonly zonePosition: Vector3;
  readonly observerSide: Side;
  readonly channel: "sound" | "sight";
  /** 0..1 — how much this cue is worth as evidence about `zoneId`. */
  readonly confidence: number;
}

/**
 * Report-only measurements of a round (config.collectStats): how the bodies moved and crowded.
 * Nothing in the simulation reads them; the validator turns them into batch metrics
 * (tools/data-validator engine metrics). Collecting them does not change the outcome.
 */
export interface RoundStats {
  /** Ticks simulated. */
  readonly ticks: number;
  /** Ticks on which at least one pair of living bodies on the same floor stood closer than BODY_OVERLAP_UNITS. */
  readonly overlapTicks: number;
  /** Smallest same-floor centre distance between two living bodies this round (uu; Infinity if never measured). */
  readonly minPairDistance: number;
  /** Each attacker's first entry into a plantable (site) zone, in order of arrival. */
  readonly siteArrivals: ReadonlyArray<{ readonly playerId: PlayerId; readonly zoneId: string; readonly atMs: number }>;
  /** Each attacker's zones in the order walked (repeats collapsed) up to its first site entry, its death or the round end. */
  readonly attackerRoutes: Readonly<Record<PlayerId, readonly string[]>>;
  /** Peeks by technique (gaze model; all 0 without it), re-peeks and disengages (jiggles that drew no kill). */
  readonly peeks: { readonly walkIn: number; readonly swing: number; readonly slice: number; readonly jiggle: number; readonly rePeek: number; readonly disengage: number };
  /** Crowd handling: mover-ticks queued / giving way, give-ups (squeezed past), stack-up waits at boundaries. */
  readonly crowd: {
    readonly queueTicks: number;
    readonly queuePushes: number;
    readonly yieldTicks: number;
    readonly yieldPushes: number;
    /** Stack-up episodes (a mover holding at a boundary for a teammate), mover-ticks spent so, and episodes cut by STACK_MAX_WAIT. */
    readonly stackWaits: number;
    readonly stackWaitTicks: number;
    readonly stackTimeouts: number;
  };
}

/**
 * Stop time (ms) of the legacy (gaze-off) duel model: an aggregate calibrated on 160 Ascent matches
 * (STAT_OUTCOME_MATRIX §2.7) that also absorbs what that model does not have (aim time, tracking a
 * swing). The gaze model uses combat-engine's physical stopMs instead.
 */
export const LEGACY_STOP_MS = { run: 700, walk: 350 } as const;

/** Two bodies whose centres are closer than this (uu, ≈ 0.85 body widths) overlap (report-only metric). */
export const BODY_OVERLAP_UNITS = 30;

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
  /** Navigation events (routes planned / re-planned, goals blocked or unreachable); with traceCommands or recordTracks. */
  readonly navTrace?: readonly NavTraceEvent[];
  /** Per-team observation/belief series, present only when config.recordPerception is true. */
  readonly perception?: readonly PerceptionTrack[];
  /** Command→execution trace, present only when config.traceCommands is true. */
  readonly commandTrace?: readonly CommandTraceEvent[];
  /** Every shot cue the teams observed, present only when config.traceCommands is true. */
  readonly cueTrace?: readonly ShotCue[];
  /** Every ability cue the teams observed, present only when config.traceCommands is true. */
  readonly abilityCueTrace?: readonly AbilityCue[];
  /** First-contact posture of every duel, present only when config.traceCommands is true. */
  readonly engagementTrace?: readonly EngagementRecord[];
  /** Report-only movement / crowd measurements, present only when config.collectStats is true. */
  readonly stats?: RoundStats;
  /** Where the spike went down (rounds with a plant only). */
  readonly plant?: PlantRecord;
}

/** Where and how the spike was planted (plant-spot.ts). */
export interface PlantRecord {
  readonly zoneId: string;
  /** Site letter, null when the zone is not a derived site. */
  readonly site: string | null;
  readonly position: Vector3;
  /** When the plant completed (ms into the round). */
  readonly atMs: number;
  /** The candidate spot the spike lies on (within 150 uu), null for an off-list spot. */
  readonly spotId: string | null;
  readonly spotKind: PlantSpotKind | "other";
  /** The spot the carrier set out for, and who chose it. */
  readonly intendedSpotId: string | null;
  readonly by: "auto" | "manager" | null;
}

export interface SimConfig {
  readonly tickMs: number;
  readonly roundTimeMs: number;
  readonly decisionIntervalTicks: number;
  readonly plantDurationMs: number;
  readonly defuseDurationMs: number;
  /**
   * Half-defuse checkpoint (ms; game-rules spike.ts defuseHalfwayMs = 3500): a defuse let go after it
   * resumes from it. 0 / absent = progress always resets (the pre-A3 engine).
   */
  readonly defuseHalfwayMs?: number;
  readonly spikeTimerMs: number;
  /**
   * A mover told what to watch on arrival (the order's `aimZone`) takes a covered spot that sees
   * it, instead of standing near the zone's anchor. Off by default: measured on 160 matches it
   * moves the round-outcome mix away from the real one (NAVIGATION_ENGINE.md §7.3).
   */
  readonly coverSpots: boolean;
  readonly seed: number;
  readonly recordTracks: boolean;
  /** Record per-team observation/belief snapshots (PV-6 fog-of-war). Off by default (cost). */
  readonly recordPerception: boolean;
  /** Record a command→execution trace (policy debugging for PV-3). Off by default. */
  readonly traceCommands: boolean;
  /** Collect report-only movement / crowd measurements (RoundResult.stats). Off by default; passive. */
  readonly collectStats?: boolean;
  /**
   * Gaze model (gaze.ts, docs/ENGINE_TRUTH.md §8): facing is state that turns at a bounded rate
   * toward what the player chooses to watch (an enemy it sees > a believed threat no teammate
   * watches > the plan's angle / the way ahead); holders put the crosshair on the watched zone's
   * peek point; post-plant guards split the spike zone's entries; and the time to the first shot is
   * perception + Fitts aim time over the crosshair's angle off the enemy (combat-engine
   * aimOffsetDeg) instead of the pre-aim flag. OFF by default until the engine is recalibrated with
   * it (measured effect: §8).
   */
  readonly gaze?: boolean;
  /**
   * Sound detail (docs/ENGINE_TRUTH.md §9): a landing off a drop is a sound whose reach grows with
   * the fall (perception-engine landingSound), and gunfire masks quieter cues (footsteps, landings)
   * for listeners it is much louder for (isMasked). OFF by default until measured into calibration.
   */
  readonly soundDetail?: boolean;
  /**
   * Floor items (floor-items.ts): dropped guns can be picked up mid-round, and ultimate orbs at
   * `orbs` (from the map's objects data) are taken once per round. OFF (undefined) by default.
   */
  readonly floorItems?: { readonly orbs?: readonly { readonly id: string; readonly position: Vector3 }[] };
  /**
   * The attacking team's plant preference per site letter (plant-spot.ts PlantChoice: auto, a spot
   * kind, or a spot id). Absent / "auto": the carrier chooses by game sense and situation.
   */
  readonly plantPreference?: PlantPreferences;
  /** Sampling interval for recordPerception, in ticks. Defaults to decisionIntervalTicks. */
  readonly perceptionIntervalTicks?: number;
  /** HP lost per tick while a body is inside a molly / area-denial patch (manual-approx). */
  readonly mollyDamagePerTick: number;
  /**
   * Movement-speed multiplier inside a slow field (manual-approx: the catalog carries no slow
   * magnitude). Crossing the field costs the extra time of its chord at this speed.
   */
  readonly slowSpeedMultiplier: number;
  /**
   * Peeker's advantage (ms): how stale a stationary holder's picture of a MOVING enemy is — the
   * peeker is already further out than the holder sees, so the holder reacts this much later even on
   * mutual sight. It follows from latency, not from a team's choice, so it is not a match option.
   * NOTE: 210 is a calibrated aggregate (opening-duel rate, README §31), not a measured latency.
   * The opposing effect, the angle advantage, is derived from geometry (situational.ts).
   */
  readonly peekerAdvantageMs: number;
  /**
   * Crossfire (양각) — Hick–Hyman law slope b (ms per bit): a player exposed to n extra enemy guns
   * (enemies with line of sight onto its zone, beyond the one it is duelling) reacts
   * b · log2(n + 1) later and loses any pre-aim edge. This is what makes numbers count.
   */
  readonly crossfirePenaltyMs: number;
  /**
   * Info half-life (ms): a teammate's call on an enemy still in the same zone is worth
   * w = 2^(−Δt / halfLife); the surprise delay of not seeing first is scaled by (1 − w), and a call
   * fresher than one half-life also denies the holder's pre-aim. No info → full surprise penalty.
   */
  readonly infoWindowMs: number;
  /**
   * Attrition: share of the damage a duel's survivor took that carries into its next fight
   * (0 = every duel at full health, 1 = all of it). Below 1 stands in for what the sim does not
   * model between fights (cover, heals, disengaging).
   * Default 0.4 (fitted on real rosters; ENGINE_TRUTH.md §4).
   */
  readonly damageCarryover: number;
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
  coverSpots: false,
  seed: 1,
  recordTracks: false,
  recordPerception: false,
  traceCommands: false,
  mollyDamagePerTick: 6, // ~60 HP/s inside a fire patch (manual-approx)
  slowSpeedMultiplier: 0.5, // manual-approx (no catalog value)
  crossfirePenaltyMs: 60, // Hick–Hyman slope (ms/bit); calibrated on 160 Ascent matches (8/8 judged)
  infoWindowMs: 2000,
  // VALORANT has no health regeneration, so the physical value is 1; the missing 0.6 stands for what
  // the sim does not model between fights (cover, falling back, stall utility the default
  // abilities-off game has none of). Fitted on real rosters, seeds 1–160 (8/8 judged, attack 0.501),
  // confirmed on 161–320 and 321–480 — docs/ENGINE_TRUTH.md §4.
  damageCarryover: 0.4,
  peekerAdvantageMs: 180,
};
