import { positionKey, type SpatialEngine } from "@pv/spatial-engine";
import {
  PerceptionEngine,
  DEFAULT_PARAMS as PERCEPTION_PARAMS,
  facingAngleTo,
  lineOfSight,
  landingSound,
  EYE_HEIGHT_UNITS,
  type SightOccluder,
  type SightPoint,
  type PlayerState as PPlayerState,
  type WorldState as PWorldState,
} from "@pv/perception-engine";
import {
  resolveDuel,
  readyDelayMs,
  DEFAULT_PARAMS as COMBAT_PARAMS,
  OPEN_POSTURE,
  type Combatant,
  type WeaponSpec,
} from "@pv/combat-engine";
import {
  AbilityEngine,
  type AbilityCatalog,
  type AbilitySpec,
  type GroundPatch,
  type SnapshotEnemy,
  checkAvailability,
  toPerceptionAbilityStates,
  visionBlockerIsSmoke,
  activeGroundPatches,
  deployedEffects,
  visionOccluders,
} from "@pv/ability-engine";
import type {
  CommandTraceEvent,
  EngagementRecord,
  PerceptionSnapshot,
  PerceptionTrack,
  RoundEndReason,
  RoundResult,
  Side,
  SimEvent,
  SimPlayer,
  SimState,
  SimConfig,
  TrackFrame,
  NavTraceEvent,
} from "./types.js";
import { AVERAGE_TRAITS, BODY_OVERLAP_UNITS, DEFAULT_CONFIG, type AbilityCue, type RoundStats, type ShotCue } from "./types.js";
import {
  abilityCastCueConfidence, angleAdvantageDelays, clutchReactionMs, crossfirePenaltyMs, infoWeight as infoFreshness,
  patchExposureMs, slowFieldDelayMs, smokeExitDelayMs, soundCueConfidence,
  DEFAULT_PATCH_RADIUS_UNITS, DEPLOYED_EFFECT_CUE_CONFIDENCE, TRACER_CUE_CONFIDENCE,
} from "./situational.js";
import type { ActionCommand, BeliefState, DecisionPolicy, TeammateTransit } from "./policy-contract.js";
import { buildPolicyView, roundPerceptionParams, SeededRandomSource, SpatialQueryAdapter, toPerceptionSnapshot } from "./view.js";
import { deriveSeed } from "./rng.js";
import { MovementExecutor, type MoverHooks, type NavEvent, type SpotIntent } from "./mover.js";
import { offsetDeg, rotateToward, turnRateRadPerMs, type GazeSource } from "./gaze.js";

export interface RoundSimulatorDeps {
  readonly spatial: SpatialEngine;
  readonly policies: Readonly<Record<Side, DecisionPolicy>>;
  readonly weapons: Readonly<Record<string, WeaponSpec>>;
  readonly abilities: AbilityCatalog;
  readonly config?: Partial<SimConfig>;
}

const RUN_UNITS_PER_SEC = 675;
const WALK_UNITS_PER_SEC = 340;
/** Per side: enemy id → when/where the team last saw them (the info layer of a duel). */
type TeamIntel = Map<Side, Map<string, { atMs: number; zoneId: string; confidence: number }>>;

/** A moving enemy only adds a crossfire angle when it comes from at least this far off the duel's line. */
const CROSSFIRE_MIN_ANGLE_RAD = Math.PI / 6;
/** A teammate swinging on the SAME line is trade pressure, not a second angle: it counts as a fraction of a gun. */
const CROSSFIRE_SAME_LINE_WEIGHT = 0.2;

/** How far from the corner a peeking player is when first contact happens (world units; ≈3 m). */
const PEEK_CORNER_DISTANCE = 300;

/**
 * How near the planted spike a defender must be to defuse it (uu, ≈1.5 m from body centre to the
 * device; manual-approx — VALORANT requires standing over the spike to interact with it).
 */
export const DEFUSE_REACH_UNITS = 150;

const SURPRISE_DELAY_MS = 300; // reaction penalty for the side that did not see first
// Passable hazard (molly / area-denial): a fire patch is a disc on the route (situational.ts
// patchExposureMs). It is priced in TIME only — what it costs is the wait for it to burn out — so
// no HP↔time exchange rate is needed: a mover waits it out, or goes round when the detour is
// shorter than the wait, and walks through it (paying the chord's damage) only when its side's
// clock cannot afford the wait.
// Stacking up: teammates heading into the same next zone cross into it together. A mover that
// reaches the boundary first waits for teammates close behind it (design values, manual-approx).
// Under zone-hopping every teammate given the same order entered on the same tick; with real
// positions they arrive a few tenths of a second apart, and walking in one by one hands a
// holder a series of 1v1s that no team offers on purpose.
/** A teammate this close (ms) to the boundary counts as there. */
const STACK_READY_MS = 900; // (covers a short queue behind the first one there)
/** A teammate within this (ms) of the boundary is worth waiting for. */
const STACK_WINDOW_MS = 1500;
/** Nobody waits at a boundary longer than this (ms). */
const STACK_MAX_WAIT_MS = 2000;
/** Half field of view (radians): a holder is "watching" an edge when it lies inside this cone. */
const HALF_FOV_RAD = (PERCEPTION_PARAMS.vision.halfFovDeg * Math.PI) / 180;

/** What a mover needs to know about the ground ahead (built once per tick). */
interface MoveWorld {
  readonly state: SimState;
  /** The round's event log (a landing is recorded as it happens). */
  readonly events: SimEvent[];
  readonly fire: readonly GroundPatch[];
  readonly slow: readonly GroundPatch[];
  /** Passable ground hazards in force, as discs on the floor (what the route planner prices). */
  readonly hazards: ReadonlyArray<{ center: { x: number; y: number; z: number }; radius: number; costMs: number }>;
  /** `${patch}|${player}` for which a way round has already been looked for (once per patch). */
  readonly rerouteTried: Set<string>;
  /** player → the boundary it is waiting at for teammates, and since when. */
  readonly stackWait: Map<string, { zone: string; sinceMs: number }>;
  /** Report-only stack-up counters (RoundStats.crowd). */
  readonly stackStats: { waits: number; ticks: number; timeouts: number };
  /** `${patch}|${player}` → elapsed ms until which the player is inside that patch (set once). */
  readonly patchExposure: Map<string, number>;
  /** player → elapsed ms until which it is inside fire (the latest of its patch exposures). */
  readonly burnUntil: Map<string, number>;
  /** Each player's last zone hop (where it came from, and on which tick). */
  readonly lastHop: Map<string, { fromZone: string; tick: number }>;
}
// Cast occupation: a caster is weapon-unready for the ability's windup (equip/throw) time, not the
// whole decision tick. DEFAULT applies when the catalog has no windup (manual-approx). If an enemy
// is met during the windup, the caster reacts this much slower (weapon not out), but no longer —
// the window is bounded, so there is no infinitely-helpless caster.
const DEFAULT_CAST_WINDUP_MS = 700;
const CAST_WINDUP_PENALTY_MS = 500;

/** Command-trace sink; a no-op unless config.traceCommands is on (see runRound). */
type Tracer = (e: Omit<CommandTraceEvent, "tick" | "elapsedMs">, dedupeKey?: string) => void;

/** The most common zone among players (deterministic tie-break by zone id); "" if none. */
function modeZone(players: readonly SimPlayer[]): string {
  const counts = new Map<string, number>();
  for (const p of players) counts.set(p.zoneId, (counts.get(p.zoneId) ?? 0) + 1);
  let best = "", bestN = -1;
  for (const [z, n] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (n > bestN) { best = z; bestN = n; }
  }
  return best;
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** A command is active only once its executeAtMs (if any) has been reached — teamwork timing. */
function readyCommand(cmd: ActionCommand | undefined, nowMs: number): ActionCommand | undefined {
  if (!cmd) return undefined;
  if (cmd.executeAtMs != null && nowMs < cmd.executeAtMs) return undefined;
  return cmd;
}

/**
 * Deterministic fixed-tick round loop. Order per tick (Handoff §17, README §28.1):
 * decisions (every N ticks) → movement → abilities → perception → engagement →
 * spike → end-conditions → record. Same initial state + seed ⇒ identical event log.
 */
export class RoundSimulator {
  private readonly spatial: SpatialEngine;
  private readonly policies: Readonly<Record<Side, DecisionPolicy>>;
  private readonly weapons: Readonly<Record<string, WeaponSpec>>;
  private readonly abilitiesCatalog: AbilityCatalog;
  private readonly cfg: SimConfig;
  // Round-scoped posture sets (reset in runRound; always empty when no ground patch exists).
  /** Players currently leaving / crossing a fire patch: on the move, and unable to plant or defuse. */
  private readonly steppingOut = new Set<string>();
  /** Movers standing at the edge of a fire patch, waiting for it to burn out (stationary) → the burn time left. */
  private readonly edgeWaiting = new Map<string, number>();
  private readonly reachCache = new Map<string, boolean>();
  /** The round's movement executor: the only thing that changes a player's position. */
  private mover!: MovementExecutor;
  /** Vision blockers in force this tick (refreshed after abilities advance; see lineOf). */
  private sightBlockers: readonly SightOccluder[] = [];

  /**
   * Is the line between two points clear? The ONE sight rule (perception-engine `lineOfSight`):
   * positional where the map has a sight table, the zone table otherwise. `throughSmoke` = the
   * question is about light that a smoke does not stop (a tracer); everything else is cut by it.
   * No facing here — who LOOKS is decided by the caller (canSee for eyes, facing for a flash).
   */
  private lineOf(a: SightPoint, b: SightPoint, throughSmoke = false): boolean {
    return lineOfSight(this.spatial, a, b, {
      positionalSight: PERCEPTION_PARAMS.vision.positionalSight !== false,
      sameZoneAlwaysVisible: PERCEPTION_PARAMS.vision.sameZoneAlwaysVisible,
      ...(throughSmoke ? {} : { occluders: this.sightBlockers }),
    });
  }

  constructor(deps: RoundSimulatorDeps) {
    this.spatial = deps.spatial;
    this.policies = deps.policies;
    this.weapons = deps.weapons;
    this.abilitiesCatalog = deps.abilities;
    this.cfg = { ...DEFAULT_CONFIG, ...deps.config };
  }

  runRound(initial: SimState): RoundResult {
    const state = initial;
    // perception is smoke/wall aware so deployed abilities actually block line of sight
    // Smokes block sight as volumes at their landing points (vision.ts SightOccluder), inside a zone too.
    const perception = new PerceptionEngine(this.spatial, { isSmoke: visionBlockerIsSmoke, params: roundPerceptionParams(), smokeVolumes: true });
    const abilityEngine = new AbilityEngine(this.spatial);
    const spatialQuery = new SpatialQueryAdapter(this.spatial);
    // Each side's starting zone (mode of its players' tick-0 zones), used as the structural
    // origin for the default hold-facing (a defender watches the choke attackers enter from).
    const originOf: Record<Side, string> = {
      attack: modeZone(state.players.filter((p) => p.side === "attack")),
      defense: modeZone(state.players.filter((p) => p.side === "defense")),
    };
    // Previous-tick belief per side, threaded into buildBelief so unseen enemies age
    // across decisions (real @pv/decision-engine diffusion, not a per-tick reset).
    const prevBelief: Record<Side, BeliefState | null> = { attack: null, defense: null };
    const decisionDtMs = this.cfg.decisionIntervalTicks * this.cfg.tickMs;
    const events: SimEvent[] = [];
    const tracks: TrackFrame[] = [];
    const perceptionSnaps: Record<Side, PerceptionSnapshot[]> = { attack: [], defense: [] };
    const perceptionInterval = this.cfg.perceptionIntervalTicks ?? this.cfg.decisionIntervalTicks;
    // Command→execution trace (policy debugging). `trace` is a no-op unless traceCommands is on;
    // `dedupeKey`, when given, logs that key only once (so recurring per-tick evaluations — a
    // plant rejected every tick, say — appear once, not hundreds of times).
    const commandTrace: CommandTraceEvent[] = [];
    const engagementTrace: EngagementRecord[] = [];
    const tracedKeys = new Set<string>();
    // When each player is weapon-ready again after a cast (elapsedMs); mid-cast = a duel penalty.
    const castBusyUntil = new Map<string, number>();
    const trace = (e: Omit<CommandTraceEvent, "tick" | "elapsedMs">, dedupeKey?: string): void => {
      if (!this.cfg.traceCommands) return;
      if (dedupeKey !== undefined) {
        if (tracedKeys.has(dedupeKey)) return;
        tracedKeys.add(dedupeKey);
      }
      commandTrace.push({ tick: state.tick, elapsedMs: state.elapsedMs, ...e });
    };
    const commands = new Map<string, ActionCommand>();
    const intel: TeamIntel = new Map(); // per side: enemy id → last seen (time, zone)
    const cues: ShotCue[] = []; // every shot cue observed this round (feeds views; traced on request)
    const abilityCues: AbilityCue[] = []; // every ability cue observed this round (same role as `cues`)
    const seenEffects = new Set<string>(); // `${effect}|${side}` — deployed effects a side has already noticed
    const patchExposure = new Map<string, number>();
    const burnUntil = new Map<string, number>();
    const lastHop = new Map<string, { fromZone: string; tick: number }>();
    let eyeInside = new Map<string, SightOccluder>(); // player → the smoke its eye is in (last tick)
    this.landings = [];
    this.shotLog = [];
    const gazeSource = this.gazeOf;
    gazeSource.clear();
    this.lastSight.clear();
    const rerouteTried = new Set<string>();
    const stackWait = new Map<string, { zone: string; sinceMs: number }>();
    const stackStats = { waits: 0, ticks: 0, timeouts: 0 };
    // Report-only round measurements (config.collectStats).
    const collect = this.cfg.collectStats === true;
    let overlapTicks = 0, minPairDistance = Number.POSITIVE_INFINITY;
    const siteArrivals: Array<{ playerId: string; zoneId: string; atMs: number }> = [];
    const attackerRoutes: Record<string, string[]> = {};
    if (collect) for (const p of state.players) if (p.side === "attack") attackerRoutes[p.id] = [p.zoneId];
    this.steppingOut.clear();
    this.edgeWaiting.clear();
    // Navigation: every player takes its own standing spot; from here on only the executor moves them.
    this.mover = new MovementExecutor(this.spatial, { runUnitsPerSec: RUN_UNITS_PER_SEC, walkUnitsPerSec: WALK_UNITS_PER_SEC });
    this.mover.reset(state.players);
    this.spikeRunner = null;
    this.publishZones(state);
    const navEvents: NavTraceEvent[] = [];
    const engaged = new Set<string>(); // pair keys already resolved
    // one persistent RNG stream per side (deterministic, independent)
    const rngOf = {
      attack: new SeededRandomSource(deriveSeed(this.cfg.seed, "policy:attack")),
      defense: new SeededRandomSource(deriveSeed(this.cfg.seed, "policy:defense")),
    } as const;

    const push = (e: SimEvent) => events.push(e);
    push({ kind: "roundStart", tick: 0, elapsedMs: 0 });

    let ended: { winner: Side; reason: RoundEndReason } | null = null;
    const maxTicks = Math.ceil((this.cfg.roundTimeMs + this.cfg.spikeTimerMs + 5000) / this.cfg.tickMs);

    for (let guard = 0; guard < maxTicks && !ended; guard++) {
      const dt = this.cfg.tickMs;

      // 1. decisions (every N ticks): one TEAM decision per side (PV-3 contract).
      if (state.tick % this.cfg.decisionIntervalTicks === 0) {
        const activeAbilities = toPerceptionAbilityStates(abilityEngine);
        for (const side of ["attack", "defense"] as const) {
          const dt = prevBelief[side] ? decisionDtMs : 0;
          const sound = this.cfg.soundDetail ? this.soundWindow(state.elapsedMs, decisionDtMs) : null;
          const view = buildPolicyView(side, state, perception, spatialQuery, prevBelief[side], dt, {
            ...(sound ? { extraSounds: sound.extraSounds, maskers: sound.maskers } : {}),
            activeAbilities, abilityEngine, cues, elapsedMs: state.elapsedMs,
            abilityCues, abilityCatalog: this.abilitiesCatalog, transitOf: (p) => this.transitOf(p), stationaryIds: this.edgeWaiting,
          });
          prevBelief[side] = view.belief;
          // PV-6 fog-of-war / belief heatmap: sample per-team observation+belief (opt-in).
          if (this.cfg.recordPerception && state.tick % perceptionInterval === 0) {
            perceptionSnaps[side].push(toPerceptionSnapshot(view, spatialQuery, state.elapsedMs));
          }
          const decision = this.policies[side].decide(view, rngOf[side]);
          for (const c of decision.commands) {
            commands.set(c.playerId, c);
            trace(
              {
                playerId: c.playerId, phase: "issued", command: c.kind,
                targetZone: c.targetZone, abilityId: c.abilityId,
                result: c.executeAtMs != null && state.elapsedMs < c.executeAtMs ? "deferred" : "active",
              },
              `issued:${c.playerId}:${c.kind}:${c.targetZone ?? c.abilityId ?? ""}:${c.executeAtMs ?? 0}`,
            );
          }
        }
      }

      // 2. movement. Molly / area-denial is a PASSABLE hazard: it adds pathfinding cost (the
      // planner detours when cheaper, else crosses and takes the damage below), not a hard block.
      const fire = activeGroundPatches(abilityEngine, "molly", state.elapsedMs);
      const slow = activeGroundPatches(abilityEngine, "slow", state.elapsedMs);
      const hazards = this.groundHazards(fire, slow);
      const moveWorld: MoveWorld = { state, events, fire, slow, hazards, rerouteTried, stackWait, stackStats, patchExposure, burnUntil, lastHop };
      this.edgeWaiting.clear();
      // Movement blockers (things a body cannot walk through) in force this tick. Vision
      // blockers such as smoke are NOT among them: a smoke is walked through.
      for (const b of state.movementBlockers ?? []) {
        const active = state.elapsedMs >= b.fromMs && state.elapsedMs < b.untilMs;
        if (active && !this.mover.blockers.has(b.id)) {
          if (b.zoneId) this.mover.addZoneBlocker(b.id, b.zoneId);
          else if (b.center) this.mover.addDiscBlocker(b.id, b.center, b.radiusUnits ?? DEFAULT_PATCH_RADIUS_UNITS);
        } else if (!active && this.mover.blockers.has(b.id)) this.mover.removeBlocker(b.id);
      }
      this.mover.releaseDead(state.players);
      const alive = state.players.filter((q) => q.alive);
      // gaze is state: where each player looked at the end of the last tick (turn-rate limited below)
      const facingBefore = new Map(state.players.map((q) => [q.id, { ...q.facing }]));
      this.guardTaken.clear();
      this.beliefNow = prevBelief;
      const sp = state.spike;
      this.spikeWatched = (sp.phase === "planted" || sp.phase === "defusing") && sp.zoneId && sp.position ? { zoneId: sp.zoneId, position: sp.position } : null;
      for (const p of state.players) {
        if (!p.alive) continue;
        const cmd = readyCommand(commands.get(p.id), state.elapsedMs);
        const targetZone = cmd?.kind === "move" ? cmd.targetZone : undefined;
        const hooks = this.moverHooks(moveWorld, trace, targetZone, navEvents, cmd?.kind === "move" ? cmd.sourceActionId : undefined);
        if (cmd?.kind === "move" && cmd.targetZone) {
          this.mover.setGoal(p, {
            zoneId: cmd.targetZone, mode: cmd.moveMode ?? "run",
            ...(cmd.routePreference ? { preference: cmd.routePreference } : {}),
            ...(cmd.zoneCosts ? { zoneCost: (z: string) => cmd.zoneCosts![z] ?? 0 } : {}),
            ...this.spotIntent(p, cmd, state),
            hazards,
          }, hooks);
        } else if (cmd?.kind === "plant" && !this.isMoving(p) && state.spike.carrierId === p.id && this.spatial.isPlantableZone(p.zoneId) && !this.onPlantArea(p)) {
          // Told to plant inside the site but not on its plant area: step onto it first.
          this.mover.setGoal(p, { zoneId: p.zoneId, mode: "run", spot: { kind: "plant" }, hazards }, hooks);
        } else if (cmd?.kind === "defuse" && !this.isMoving(p) && (state.spike.phase === "planted" || state.spike.phase === "defusing") && state.spike.position && state.spike.zoneId && !this.inDefuseReach(p, state.spike.position)) {
          // Told to defuse but not over the spike: walk to it.
          this.mover.setGoal(p, { zoneId: state.spike.zoneId, mode: "run", spot: { kind: "at", position: state.spike.position }, hazards }, hooks);
        } else if (cmd && cmd.kind === "hold" && !this.isMoving(p)) {
          // A holder told what to watch stands where it can see it: if its spot does not, it shifts
          // to one of its zone that does (a few steps; the zone does not change).
          const watch = this.watchIntent(p, cmd.aimZone, p.zoneId, state);
          if (watch && !this.mover.seesFromSpot(p, watch) && this.mover.hasSpotThatSees(p.id, p.zoneId, watch)) {
            this.mover.setGoal(p, { zoneId: p.zoneId, mode: "run", spot: watch, hazards }, hooks);
          }
        }
        this.mover.step(p, dt, alive, hooks);
        // A stationary player aims at its hold zone (aimZone → targetZone → default enemy choke),
        // so perception FOV + combat pre-aim reflect a held angle instead of a stale facing.
        if (!this.isMoving(p)) this.faceStationary(p, cmd, originOf);
      }
      this.publishZones(state);
      // Gaze: choose what to look at (an enemy it sees > the most threatening believed spot it has a
      // line to and no teammate watches > the plan's angle / the way ahead), then turn toward it no
      // faster than its turn rate allows.
      if (this.cfg.gaze) this.updateGaze(state, commands, prevBelief, facingBefore, gazeSource, dt);
      if (collect) {
        let overlap = false;
        for (let i = 0; i < alive.length; i++) {
          const a = alive[i]!;
          if (!a.alive) continue;
          for (let j = i + 1; j < alive.length; j++) {
            const b = alive[j]!;
            if (!b.alive || Math.abs(a.position.z - b.position.z) > 120) continue;
            const d = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
            if (d < minPairDistance) minPairDistance = d;
            if (d < BODY_OVERLAP_UNITS) overlap = true;
          }
        }
        if (overlap) overlapTicks++;
        for (const p of state.players) {
          if (p.side !== "attack" || !p.alive) continue;
          const route = attackerRoutes[p.id];
          if (!route || siteArrivals.some((a) => a.playerId === p.id)) continue;
          if (route[route.length - 1] !== p.zoneId) route.push(p.zoneId);
          if (this.spatial.isPlantableZone(p.zoneId)) siteArrivals.push({ playerId: p.id, zoneId: p.zoneId, atMs: state.elapsedMs });
        }
      }

      // 3. abilities
      this.refreshSightBlockers(abilityEngine);
      for (const p of state.players) {
        if (!p.alive) continue;
        const cmd = readyCommand(commands.get(p.id), state.elapsedMs);
        if (cmd?.kind !== "useAbility" || !cmd.abilityId) continue;
        const abilityId = cmd.abilityId;
        // suppressed players (KAY/O knife, Killjoy ult) cannot cast abilities this tick.
        if (abilityEngine.suppressRemainingMs(p.id, state.elapsedMs) > 0) {
          trace({ playerId: p.id, phase: "ability", abilityId, result: "suppressed" }, `ability:${p.id}:${abilityId}:suppressed`);
          continue;
        }
        const slot = p.abilities.find((a) => a.abilityId === abilityId);
        if (!slot) { trace({ playerId: p.id, phase: "ability", abilityId, result: "noSlot" }, `ability:${p.id}:${abilityId}:noSlot`); continue; }
        const avail = checkAvailability(this.abilitiesCatalog, slot, state.elapsedMs, { points: p.ultimatePoints, required: p.ultimateCost });
        if (!avail.usable) { trace({ playerId: p.id, phase: "ability", abilityId, result: "unavailable" }, `ability:${p.id}:${abilityId}:unavailable`); continue; }
        const catalogSpec = this.abilitiesCatalog[abilityId];
        if (!catalogSpec) { trace({ playerId: p.id, phase: "ability", abilityId, result: "noSpec" }, `ability:${p.id}:${abilityId}:noSpec`); continue; }
        const spec = this.runtimeSpec(catalogSpec);
        // Where the effect lands. A thrown/placed ability (smoke, molly/area-denial, remote
        // recon, wall, slow) deploys at the commanded targetZone's centre when within the
        // catalog range; out of range it is rejected (no charge spent). Movement (dash) is
        // self-displacement, handled below, so it always originates at the caster. Flash/concuss
        // also honour targetZone (pop-flash: blind enemies near the target). Reach: the catalog
        // range when there is one; with no catalogued range the throw reaches only the caster's own
        // zone, a neighbouring zone, or a zone it has an authored sightline onto (withinThrowReach)
        // — never the whole map. ASSUMPTION (manual-approx): no throw arc / flight time.
        const isMovement = spec.effectTypes.includes("movement");
        let origin = p.position;
        let effectZone: string | undefined;
        if (!isMovement && cmd.targetZone) {
          const tz = this.spatial.getZone(cmd.targetZone);
          if (tz) {
            // Where it lands: the floor of the target zone nearest the thrower (landingPoint).
            const landing = this.landingPoint(p, tz.id, cmd.aimZone);
            const inReach = spec.rangeUnits != null ? dist3(p.position, landing) <= spec.rangeUnits : this.withinThrowReach(p.zoneId, tz.id);
            if (!inReach) {
              trace({ playerId: p.id, phase: "ability", abilityId, targetZone: cmd.targetZone, result: "outOfRange" }, `ability:${p.id}:${abilityId}:outOfRange`);
              continue;
            }
            origin = landing;
            effectZone = tz.id;
          }
        }
        // flash/concuss (blind) and suppress (ability-silence) hit enemies in range + LoS of the
        // effect origin (the throw target when one was given, else the caster).
        const isFlash = spec.effectTypes.includes("flash") || spec.effectTypes.includes("concuss");
        const isSuppress = spec.effectTypes.includes("suppress");
        const affectedPlayerIds = isFlash || isSuppress ? this.flashTargets(state, p, spec.radiusUnits ?? 1500, origin, isFlash) : undefined;
        // recon: a frozen snapshot of the enemies the device can see when it lands — it becomes the
        // team's call on them (intel), usable for a pre-aimed swing while it is fresh.
        const snapshotEnemies = spec.effectTypes.includes("recon") ? this.reconTargets(state, p, spec.radiusUnits, origin) : undefined;
        // Every effect sits where it landed: a fire / slow patch is a disc around the landing point
        // (thrown from the neighbouring zone that is the doorway — the entry it denies), a smoke a
        // sphere around it. No zone-centre placement and no doorway special case.
        abilityEngine.use(spec, {
          instanceId: `${p.id}:${abilityId}:${state.tick}`,
          abilityId, ownerId: p.id, teamId: p.teamId,
          origin, startedAtMs: state.elapsedMs,
          ...(effectZone ? { zoneId: effectZone } : {}),
        }, { affectedPlayerIds, snapshotEnemies });
        if (snapshotEnemies && snapshotEnemies.length > 0) {
          let m = intel.get(p.side);
          if (!m) intel.set(p.side, (m = new Map()));
          for (const e of snapshotEnemies) m.set(e.enemyId, { atMs: state.elapsedMs, zoneId: this.spatial.nearestZone(e.position).id, confidence: 1 });
        }
        // The cast is a world event the other team may HEAR (zone-level, loose).
        if (spec.makesSound !== false) this.emitCastCue(state, p, spec, intel, abilityCues);
        slot.chargesRemaining -= 1;
        slot.lastUsedAtMs = state.elapsedMs;
        // Cast occupation: weapon-unready for the ability's windup (equip/throw), catalog or default.
        castBusyUntil.set(p.id, state.elapsedMs + (spec.windupMs ?? DEFAULT_CAST_WINDUP_MS));
        push({ kind: "abilityUsed", tick: state.tick, elapsedMs: state.elapsedMs, actor: p.id, detail: abilityId });
        trace({ playerId: p.id, phase: "ability", abilityId, result: "used" });
        // movement effect (Jett dash, Omen Shrouded Step): instantly displace the caster to the
        // commanded target zone when it is within the ability's range. Cancels any current path.
        if (spec.effectTypes.includes("movement") && cmd.targetZone) {
          const target = this.spatial.getZone(cmd.targetZone);
          const rangeUnits = spec.rangeUnits ?? 1500;
          if (target && dist3(p.position, target.position) <= rangeUnits) {
            // a movement ability sets the caster down on a standing spot of the target zone
            this.mover.placeInZone(p, target.id);
            trace({ playerId: p.id, phase: "ability", abilityId, toZone: target.id, result: "displaced" });
          } else {
            trace({ playerId: p.id, phase: "ability", abilityId, targetZone: cmd.targetZone, result: "outOfRange" }, `ability:${p.id}:${abilityId}:outOfRange`);
          }
        }
      }
      abilityEngine.advance(state.elapsedMs);
      this.refreshSightBlockers(abilityEngine);
      // A deployed smoke / wall / fire is SEEN by whoever has a sightline onto it.
      this.emitDeployedEffectCues(state, abilityEngine, seenEffects, abilityCues);

      // 4. perception snapshot for engagement
      const sight = perception.perceive(this.toPerceptionWorld(state, abilityEngine));
      this.lastSight.clear();
      for (const p of state.players) {
        if (!p.alive || abilityEngine.blindRemainingMs(p.id, state.elapsedMs) > 0) continue;
        const seen = (sight.players.get(p.id)?.visibleEnemies ?? []).filter((e) => e.currentlyVisible).map((e) => e.playerId);
        if (seen.length) this.lastSight.set(p.id, seen);
      }

      // 5. engagement detection (mutual or one-sided visibility → duel)
      // Smoke exits: an eye that was inside a smoke volume last tick and is out of it now.
      const smokeExits = new Map<string, SightOccluder>();
      const insideNow = new Map<string, SightOccluder>();
      if (this.sightBlockers.length > 0 || eyeInside.size > 0) {
        for (const p of state.players) {
          if (!p.alive) continue;
          const eye = { x: p.position.x, y: p.position.y, z: p.position.z + EYE_HEIGHT_UNITS };
          const inside = this.sightBlockers.find((o) => dist3(eye, o.center) <= o.radius);
          if (inside) insideNow.set(p.id, inside);
          else if (eyeInside.has(p.id)) smokeExits.set(p.id, eyeInside.get(p.id)!);
        }
      }
      eyeInside = insideNow;
      this.resolveEngagements(state, sight, abilityEngine, engaged, events, this.cfg.traceCommands ? engagementTrace : null, castBusyUntil, intel, cues, smokeExits);
      this.recordIntel(state, sight, intel, abilityEngine);

      // 5b. molly / area-denial: a fire PATCH (a disc on the route through its zone), not a burning
      // zone. A body is damaged only while it is inside the disc, and how long that is follows from
      // geometry (situational.ts patchExposureMs):
      //  - on it when it lands, standing: it runs out by the nearest edge — r / v;
      //  - on it when it lands, already moving on: the rest of the way to the rim — (r ∓ d) / v;
      //  - walks onto it later and carries on through it: the whole chord — 2r / v;
      //  - walks into the zone later and stops there: it stops short of the fire — nothing.
      // While inside, the player is on the move (no held angle) and cannot plant or defuse.
      // Overlapping patches do not double-dip the per-tick damage.
      // A patch on a DOORWAY (thrown from the neighbouring zone) is different: nobody stands on
      // it, and it is crossed — the whole chord — by whoever passes between the two zones
      // (stepMovement registers that crossing).
      this.steppingOut.clear();
      const fireNow = activeGroundPatches(abilityEngine, "molly", state.elapsedMs);
      for (const h of fireNow) {
        if (h.doorToZoneId !== null) continue;
        const r = h.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS;
        // The patch is a disc around the point it landed on. Who is on it is decided by where each
        // body really is, not by the zone it is in.
        const centre = h.center;
        for (const p of state.players) {
          if (!p.alive || Math.abs(p.position.z - centre.z) > 200) continue;
          const ox = p.position.x - centre.x, oy = p.position.y - centre.y;
          const d = Math.hypot(ox, oy);
          if (d > r) continue;
          const key = `${h.instanceId}|${p.id}`;
          if (patchExposure.has(key)) continue;
          const onRoute = this.mover.isMoving(p);
          const landedOnThem = h.startedAtMs >= state.elapsedMs;
          // already moving when it lands: it leaves by carrying on — the rest of the way to the
          // rim along its heading (r − d when it is past the centre, r + d when still short of it)
          const away = ox * p.facing.x + oy * p.facing.y >= 0;
          const insideMs = landedOnThem
            ? (onRoute ? ((away ? r - d : r + d) / RUN_UNITS_PER_SEC) * 1000 : patchExposureMs(r, RUN_UNITS_PER_SEC, false))
            : onRoute ? patchExposureMs(r, RUN_UNITS_PER_SEC, true) : 0;
          const until = state.elapsedMs + Math.min(insideMs, h.remainingMs);
          patchExposure.set(key, until);
          burnUntil.set(p.id, Math.max(burnUntil.get(p.id) ?? 0, until));
        }
      }
      if (burnUntil.size > 0) {
        for (const p of state.players) {
          if (!p.alive || (burnUntil.get(p.id) ?? 0) <= state.elapsedMs) continue;
          this.steppingOut.add(p.id);
          p.health = Math.max(0, p.health - this.cfg.mollyDamagePerTick);
          if (p.health <= 0) {
            p.alive = false;
            if (state.spike.carrierId === p.id && state.spike.phase === "carried") {
              state.spike.carrierId = null;
              state.spike.zoneId = p.zoneId;
              state.spike.position = { ...p.position };
            }
            push({ kind: "kill", tick: state.tick, elapsedMs: state.elapsedMs, actor: undefined, target: p.id, zoneId: p.zoneId, detail: "molly" });
          }
        }
      }

      // 5c. spike pickup: an attacker standing on a dropped spike picks it up
      if (state.spike.phase === "carried" && !state.spike.carrierId && state.spike.zoneId) {
        const picker = state.players.find((p) => p.alive && p.side === "attack" && p.zoneId === state.spike.zoneId);
        if (picker) {
          state.spike.carrierId = picker.id;
          state.spike.position = null;
          state.spike.zoneId = null;
          push({ kind: "spikePickup", tick: state.tick, elapsedMs: state.elapsedMs, actor: picker.id, zoneId: picker.zoneId });
        }
      }

      // 6. spike progression
      this.stepSpike(state, commands, dt, events, trace);

      // 7. record track frame (opt-in)
      if (this.cfg.recordTracks) {
        const killedNow = new Set(events.filter((e) => e.kind === "kill" && e.tick === state.tick).map((e) => e.target!));
        tracks.push({
          tick: state.tick, elapsedMs: state.elapsedMs,
          players: state.players.map((p) => {
            const base = { id: p.id, side: p.side, x: p.position.x, y: p.position.y, z: p.position.z, alive: p.alive };
            // dead before this tick: no sight. Killed on it: the sight it had when the duel began.
            if (!p.alive && !killedNow.has(p.id)) return base;
            // the sight the engagement step decided on this tick (resolveEngagements' `sees`)
            const blind = abilityEngine.blindRemainingMs(p.id, state.elapsedMs) > 0;
            const sees = blind ? [] : (sight.players.get(p.id)?.visibleEnemies ?? []).filter((e) => e.currentlyVisible).map((e) => e.playerId).sort();
            const fm = Math.hypot(p.facing.x, p.facing.y) || 1;
            const look = this.cfg.gaze ? this.gazeAt.get(p.id) : undefined;
            return { ...base, sees, facing: { x: p.facing.x / fm, y: p.facing.y / fm }, gaze: gazeSource.get(p.id) ?? (this.isMoving(p) ? "route" : "hold"), ...(look ? { look } : {}), ...(blind ? { blind: true as const } : {}) };
          }),
        });
      }

      // 8. end conditions
      ended = this.checkEnd(state);

      // 9. advance clock
      state.tick += 1;
      state.elapsedMs += dt;
      if (state.spike.phase !== "planted" && state.spike.phase !== "defusing" && state.spike.phase !== "defused" && state.spike.phase !== "detonated") {
        state.timeRemainingMs = Math.max(0, state.timeRemainingMs - dt);
      }
    }

    this.spatial.setPositionZones(null);
    if (!ended) ended = { winner: "defense", reason: "timeExpired" };
    push({ kind: "roundEnd", tick: state.tick, elapsedMs: state.elapsedMs, detail: `${ended.winner}:${ended.reason}` });

    return {
      winner: ended.winner,
      reason: ended.reason,
      endedAtTick: state.tick,
      endedAtElapsedMs: state.elapsedMs,
      events,
      survivors: {
        attack: state.players.filter((p) => p.side === "attack" && p.alive).map((p) => p.id),
        defense: state.players.filter((p) => p.side === "defense" && p.alive).map((p) => p.id),
      },
      roster: Object.fromEntries(state.players.map((p) => [p.id, p.side])),
      tracks: this.cfg.recordTracks ? tracks : undefined,
      navTrace: this.cfg.traceCommands || this.cfg.recordTracks ? navEvents : undefined,
      perception: this.cfg.recordPerception
        ? ([
            { teamIdx: 0, side: "attack", intervalTicks: perceptionInterval, snapshots: perceptionSnaps.attack },
            { teamIdx: 1, side: "defense", intervalTicks: perceptionInterval, snapshots: perceptionSnaps.defense },
          ] satisfies PerceptionTrack[])
        : undefined,
      commandTrace: this.cfg.traceCommands ? commandTrace : undefined,
      engagementTrace: this.cfg.traceCommands ? engagementTrace : undefined,
      cueTrace: this.cfg.traceCommands ? cues : undefined,
      abilityCueTrace: this.cfg.traceCommands ? abilityCues : undefined,
      ...(collect
        ? {
            stats: {
              ticks: state.tick, overlapTicks, minPairDistance, siteArrivals, attackerRoutes,
              crowd: {
                ...this.mover.crowd,
                stackWaits: stackStats.waits, stackWaitTicks: stackStats.ticks, stackTimeouts: stackStats.timeouts,
              },
            } satisfies RoundStats,
          }
        : {}),
    };
  }

  // ---- helpers ----

  /** Each player's gaze source this tick (recorded in tracks / engagement trace). */
  private readonly gazeOf = new Map<string, GazeSource>();
  /** The point each player chose to look at this tick (gaze "enemy" / "threat"). */
  private readonly gazeAt = new Map<string, { x: number; y: number; z: number }>();
  // ---- sound detail (cfg.soundDetail) ----
  private readonly perceptionParams = roundPerceptionParams();
  /** Landings off drops this round (each a distance-rule sound with its own reach). */
  private landings: Array<{ playerId: string; teamId: string; position: { x: number; y: number; z: number }; heightUnits: number; elapsedMs: number; radiusUnits: number; levelDb: number }> = [];
  /** Where and when shots were fired this round (the maskers). */
  private shotLog: Array<{ position: { x: number; y: number; z: number }; elapsedMs: number }> = [];

  /** The sounds a decision made now hears: landings since the last decision; gunfire in the masking window. */
  private soundWindow(nowMs: number, sinceMs: number) {
    const m = this.perceptionParams.hearing.masking;
    return {
      extraSounds: this.landings.filter((l) => l.elapsedMs > nowMs - sinceMs && l.elapsedMs <= nowMs)
        .map((l) => ({ kind: "landing" as const, position: l.position, teamId: l.teamId, radiusUnits: l.radiusUnits, levelDb: l.levelDb })),
      maskers: this.shotLog.filter((s) => s.elapsedMs > nowMs - m.windowMs && s.elapsedMs <= nowMs)
        .map((s) => ({ position: s.position, levelDb: m.gunfireDb })),
    };
  }

  /** Enemies each player saw on the last perception tick (not blinded). */
  private readonly lastSight = new Map<string, string[]>();

  /**
   * Choose each player's gaze target and turn toward it (gaze.ts). Sources, in order:
   *  1. "enemy" — the nearest enemy it saw last tick (it tracks what it is fighting);
   *  2. "threat" — for a mover, or a holder without an angle from the plan: the believed enemy spot
   *     (team belief hypotheses, highest weight first, nearer first on ties) it has a clear line to
   *     and that no teammate is already watching (in a teammate's field of view with a line to it) —
   *     teammates split sectors instead of double-checking one;
   *  3. "hold" / "route" — what the plan / the mover set (the held angle, the way ahead).
   * The facing then turns from where it was toward the target by at most turnRate · dt.
   */
  private updateGaze(state: SimState, commands: ReadonlyMap<string, ActionCommand>, belief: Record<Side, BeliefState | null>,
    before: ReadonlyMap<string, { x: number; y: number }>, source: Map<string, GazeSource>, dtMs: number): void {
    const alive = state.players.filter((p) => p.alive);
    const byId = new Map(state.players.map((p) => [p.id, p]));
    const watched = (side: Side, self: SimPlayer, pt: { x: number; y: number; z: number }): boolean =>
      alive.some((q) => q.side === side && q.id !== self.id && facingAngleTo(q.facing, q.position, pt) <= HALF_FOV_RAD && this.lineOf(q, { position: pt }));
    // believed spots a teammate already took this tick (side|x,y): split, don't double-check
    const taken = new Set<string>();
    const spotKey = (side: Side, pt: { x: number; y: number }) => `${side}|${Math.round(pt.x)},${Math.round(pt.y)}`;
    this.gazeAt.clear();
    for (const p of alive) {
      const moving = this.isMoving(p);
      const cmd = readyCommand(commands.get(p.id), state.elapsedMs);
      const planAngle = !moving && !!cmd && (cmd.aimZone !== undefined || ((cmd.kind === "hold" || cmd.kind === "peek") && cmd.targetZone !== undefined));
      let target: { x: number; y: number } | null = null;
      let src: GazeSource = moving ? "route" : "hold";
      const seen = (this.lastSight.get(p.id) ?? []).map((id) => byId.get(id)).filter((e): e is SimPlayer => !!e && e.alive);
      if (seen.length) {
        const e = seen.reduce((m, q) => (dist3(q.position, p.position) < dist3(m.position, p.position) ? q : m));
        target = e.position; src = "enemy";
      } else {
        // Threat points from the team's belief: a last-seen enemy spot is worth the freshness of
        // that sighting, 2^(−age / info half-life) (the duel model's info weight); a believed zone
        // (diffused from sightings and contacts) is worth its threat level at its standing point.
        const b = belief[p.side];
        const cands: Array<{ pos: { x: number; y: number; z: number }; w: number }> = [];
        for (const eb of b?.enemyPositionBeliefs ?? []) {
          const fresh = Math.pow(2, -eb.staleness / this.cfg.infoWindowMs);
          for (const h of eb.hypotheses) cands.push({ pos: h.position, w: h.weight * fresh });
        }
        if (!planAngle) for (const t of b?.threatZones ?? []) if (this.spatial.getZone(t.zoneId)) cands.push({ pos: this.spatial.standPosition(t.zoneId), w: t.threatLevel });
        // A holder keeps the plan's angle unless the team has a FRESH read on an enemy (worth ≥ ½,
        // the same threshold at which a call counts as a pre-aimed swing in the duel model).
        const minW = planAngle ? 0.5 : 0;
        const ranked = cands
          .filter((c) => c.w > minW && dist3(c.pos, p.position) <= PERCEPTION_PARAMS.vision.maxViewDistanceUnits && dist3(c.pos, p.position) > 1)
          .sort((x, y) => y.w - x.w || dist3(x.pos, p.position) - dist3(y.pos, p.position))
          .slice(0, 8);
        for (const c of ranked) {
          if (!this.lineOf(p, { position: c.pos })) continue;
          if (taken.has(spotKey(p.side, c.pos)) || watched(p.side, p, c.pos)) continue;
          taken.add(spotKey(p.side, c.pos));
          target = c.pos; src = "threat"; break;
        }
      }
      if (target) this.gazeAt.set(p.id, { x: target.x, y: target.y, z: (target as { z?: number }).z ?? p.position.z });
      const desired = target ? { x: target.x - p.position.x, y: target.y - p.position.y } : p.facing;
      const prev = before.get(p.id) ?? p.facing;
      p.facing = rotateToward(prev, desired, turnRateRadPerMs(p.skills) * dtMs);
      source.set(p.id, src);
    }
  }

  /**
   * Where a thrown / placed ability aimed at a zone lands: the point of that zone's floor nearest
   * the thrower (the roadmap node of the zone closest to it), i.e. the side of the zone that faces
   * the throw — the doorway a patch denies, the edge of a position a smoke cuts off from the
   * thrower's approach, the entry a flash pops over. When the order names a zone to screen off
   * (`aimZone`), the side facing THAT zone instead (a cover smoke on the zone a teammate steps
   * into, cutting the far zone's sight onto it). A map without a roadmap: the zone's centre.
   * Geometric rule (no throw arc or lineup data); the command carries only zones.
   */
  private landingPoint(p: SimPlayer, zoneId: string, screenZone?: string): { x: number; y: number; z: number } {
    const nav = this.spatial.nav;
    const screen = screenZone && screenZone !== zoneId ? this.spatial.getZone(screenZone) : undefined;
    // the side of the zone that faces the screened zone (aimZone), else the side facing the thrower
    const from = screen ? this.spatial.standPosition(screen.id) : p.position;
    if ((screen || p.zoneId !== zoneId) && nav) {
      const n = nav.locateInZone(from, zoneId, Number.POSITIVE_INFINITY);
      if (n !== null && nav.zoneAt(nav.nodePosition(n)) !== null) {
        const at = nav.nodePosition(n);
        return { x: at.x, y: at.y, z: at.z };
      }
    }
    const z = this.spatial.getZone(zoneId)!;
    return p.zoneId === zoneId ? { ...p.position } : { ...z.position };
  }

  private refreshSightBlockers(abilityEngine: AbilityEngine): void {
    this.sightBlockers = visionOccluders(abilityEngine);
  }

  /** Damage a body takes crossing a fire patch right now (its chord, capped by the burn time left). */
  private crossDamage(h: GroundPatch): number {
    const crossMs = Math.min(h.remainingMs, patchExposureMs(h.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS, RUN_UNITS_PER_SEC, true));
    return Math.ceil(crossMs / this.cfg.tickMs) * this.cfg.mollyDamagePerTick;
  }

  /**
   * Passable ground hazards as the route planner sees them: a disc on the floor whose entry costs
   *  - fire: the wait for it to burn out (its remaining burn time) — so the planner goes round
   *    exactly when the detour is shorter than the wait;
   *  - slow field: the extra time of its chord at the slowed speed.
   * A route that skirts the disc pays nothing. Doorway patches are not priced (see passFireEdge).
   */
  private groundHazards(fire: readonly GroundPatch[], slow: readonly GroundPatch[]): MoveWorld["hazards"] {
    const out: Array<{ center: { x: number; y: number; z: number }; radius: number; costMs: number }> = [];
    for (const h of fire) {
      if (h.doorToZoneId !== null) continue;
      out.push({ center: h.center, radius: h.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS, costMs: h.remainingMs });
    }
    for (const sl of slow) {
      if (sl.doorToZoneId !== null) continue;
      const radius = sl.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS;
      out.push({ center: sl.center, radius, costMs: slowFieldDelayMs(radius, RUN_UNITS_PER_SEC, this.cfg.slowSpeedMultiplier) });
    }
    return out;
  }

  /**
   * How much clock a mover can still spend before its side's objective is out of reach: the
   * attack before the plant has the round timer minus a plant; the defense after it has the spike
   * timer minus a defuse. Nobody else is on a clock.
   */
  private clockBudgetMs(p: SimPlayer, state: SimState): number {
    const s = state.spike;
    if (p.side === "attack" && (s.phase === "carried" || s.phase === "planting")) return state.timeRemainingMs - this.cfg.plantDurationMs;
    if (p.side === "defense" && (s.phase === "planted" || s.phase === "defusing") && s.detonateAtElapsedMs != null) {
      return s.detonateAtElapsedMs - state.elapsedMs - this.cfg.defuseDurationMs;
    }
    return Number.POSITIVE_INFINITY;
  }

  /**
   * A mover has reached the edge of fire on its route. Wait, go round, or cross:
   *  - it WAITS for the fire to burn out (standing at the edge) — that is the stall;
   *  - it GOES ROUND when re-planning from here, with the wait priced in, no longer enters the disc;
   *  - it CROSSES, paying the damage of the chord, only when its side's clock cannot afford the
   *    wait (clockBudgetMs) — and never when that damage would kill it (then it waits anyway).
   * Returns true to step on now. `door` = a patch on the doorway between two zones: there is no
   * way round a door except another route, which the planner does not price per connection, so a
   * doorway patch is waited out or crossed.
   */
  private passFire(p: SimPlayer, patch: GroundPatch, door: boolean, w: MoveWorld, hooks: MoverHooks): boolean {
    const damage = this.crossDamage(patch);
    const lethal = damage >= p.health;
    const speed = p.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC;
    const restMs = (this.mover.remainingLength(p) / speed) * 1000;
    const canAffordWait = patch.remainingMs + restMs <= this.clockBudgetMs(p, w.state);
    if (!lethal && !canAffordWait) {
      // Go through and pay. A doorway patch is crossed on this very step (the whole chord); a
      // patch in the open is registered when the mover is found on it (round loop, step 5b).
      if (door) {
        const until = w.state.elapsedMs + Math.min(patch.remainingMs, patchExposureMs(patch.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS, RUN_UNITS_PER_SEC, true));
        w.patchExposure.set(`${patch.instanceId}|${p.id}`, until);
        w.burnUntil.set(p.id, Math.max(w.burnUntil.get(p.id) ?? 0, until));
      }
      return true;
    }
    if (!door) {
      // Plan again from here with the wait priced in (once per patch): if the route no longer
      // enters the disc, the mover goes round; otherwise it stands at the rim until the fire is out.
      const key = `${patch.instanceId}|${p.id}`;
      if (!w.rerouteTried.has(key)) {
        w.rerouteTried.add(key);
        const centre = patch.center;
        const r = patch.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS;
        const enters = (): boolean => this.mover.remainingWaypoints(p).some((wp) => Math.hypot(wp.position.x - centre.x, wp.position.y - centre.y) <= r && Math.abs(wp.position.z - centre.z) <= 200);
        if (this.mover.replan(p, hooks) === "SUCCESS" && !enters()) return false;
      }
    }
    this.edgeWaiting.set(p.id, patch.remainingMs);
    return false;
  }

  /**
   * Stack up before crossing into the next zone: wait while a teammate in this zone, heading for
   * the same next zone, is close behind — until it is there too, or the wait has lasted long
   * enough. True = cross now.
   */
  private stackedUp(p: SimPlayer, toZone: string, w: MoveWorld): boolean {
    const behind = w.state.players.some((q) => {
      if (!q.alive || q.id === p.id || q.teamId !== p.teamId || q.zoneId !== p.zoneId) return false;
      if (!this.mover.isMoving(q) || this.mover.nextZoneOf(q) !== toZone) return false;
      const ms = this.mover.msToNextZone(q) ?? 0;
      return ms > STACK_READY_MS && ms <= STACK_WINDOW_MS;
    });
    if (!behind) { w.stackWait.delete(p.id); return true; }
    const held = w.stackWait.get(p.id);
    const fresh = !(held && held.zone === toZone);
    const sinceMs = fresh ? w.state.elapsedMs : held!.sinceMs;
    w.stackWait.set(p.id, { zone: toZone, sinceMs });
    const timedOut = w.state.elapsedMs - sinceMs >= STACK_MAX_WAIT_MS;
    if (fresh) w.stackStats.waits++;
    if (timedOut) w.stackStats.timeouts++;
    else w.stackStats.ticks++;
    return timedOut;
  }

  /** Fire on the doorway into `nextZoneId` (the longest-burning, if several): wait or cross. */
  private passFireEdge(p: SimPlayer, nextZoneId: string, w: MoveWorld, hooks: MoverHooks): boolean {
    let patch: GroundPatch | null = null;
    for (const h of w.fire) {
      if (w.patchExposure.has(`${h.instanceId}|${p.id}`)) continue;
      const onDoor = (h.zoneId === nextZoneId && h.doorToZoneId === p.zoneId) || (h.zoneId === p.zoneId && h.doorToZoneId === nextZoneId);
      if (!onDoor) continue;
      if (!patch || h.remainingMs > patch.remainingMs) patch = h;
    }
    return patch ? this.passFire(p, patch, true, w, hooks) : true;
  }

  /**
   * This tick's step would take the mover onto a ground patch in the open (it crosses the disc's
   * rim): fire → wait / go round / cross (passFire); a slow field → its delay is owed, once.
   */
  private passPatchRim(p: SimPlayer, next: { x: number; y: number; z: number }, w: MoveWorld, hooks: MoverHooks): boolean {
    const crossesRim = (h: GroundPatch): boolean => {
      const c = h.center;
      if (Math.abs(next.z - c.z) > 200) return false;
      const r = h.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS;
      return Math.hypot(p.position.x - c.x, p.position.y - c.y) > r && Math.hypot(next.x - c.x, next.y - c.y) <= r;
    };
    for (const h of w.fire) {
      if (h.doorToZoneId !== null || w.patchExposure.has(`${h.instanceId}|${p.id}`) || !crossesRim(h)) continue;
      if (!this.passFire(p, h, false, w, hooks)) return false;
    }
    for (const sl of w.slow) {
      const key = `${sl.instanceId}|${p.id}`;
      if (sl.doorToZoneId !== null || w.patchExposure.has(key) || !crossesRim(sl)) continue;
      w.patchExposure.set(key, w.state.elapsedMs);
      const speed = p.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC;
      p.edgeProgressMs = -slowFieldDelayMs(sl.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS, speed, this.cfg.slowSpeedMultiplier);
    }
    return true;
  }

  /** Two zones are joined by a walkable connection. */
  private adjacent(a: string, b: string): boolean {
    if (a === b) return false;
    const key = `adj:${a}>${b}`;
    let ok = this.reachCache.get(key);
    if (ok === undefined) {
      ok = this.spatial.findPath(a, b, "run", { allowNonTransitWaypoints: true })?.path.length === 2;
      this.reachCache.set(key, ok);
    }
    return ok;
  }

  /**
   * The spec as the round applies it. Two catalog gaps are filled with documented approximations
   * (manual-approx — NOT confirmed game values):
   *  - an area-damage ability with no catalogued duration is an instantaneous burst: it does not
   *    linger, so it lasts one tick (it used to burn forever);
   *  - a ground patch with no catalogued radius gets DEFAULT_PATCH_RADIUS_UNITS.
   */
  private runtimeSpec(spec: AbilitySpec): AbilitySpec {
    if (spec.effectType !== "molly" && spec.effectType !== "slow") return spec;
    const durationMs = spec.effectType === "molly" ? spec.durationMs ?? this.cfg.tickMs : spec.durationMs;
    const radiusUnits = spec.radiusUnits ?? DEFAULT_PATCH_RADIUS_UNITS;
    return durationMs === spec.durationMs && radiusUnits === spec.radiusUnits ? spec : { ...spec, durationMs, radiusUnits };
  }

  /**
   * Reach of a thrown / placed ability that has no catalogued range: the caster's own zone, a zone
   * next to it, or a zone it has an authored sightline onto. A geometric rule taken from the map,
   * standing in for a range the catalog does not give (manual-approx).
   */
  private withinThrowReach(fromZone: string, toZone: string): boolean {
    if (fromZone === toZone) return true;
    const key = `${fromZone}>${toZone}`;
    let ok = this.reachCache.get(key);
    if (ok === undefined) {
      ok = this.spatial.hasLineOfSight(fromZone, toZone) || this.adjacent(fromZone, toZone);
      this.reachCache.set(key, ok);
    }
    return ok;
  }

  /**
   * Enemies a recon effect at `center` reveals when it lands: alive, in the centre's zone or a
   * zone with a sightline onto it, and inside the catalog radius (no radius → its own zone only).
   */
  private reconTargets(state: SimState, caster: SimPlayer, radiusUnits: number | null, center: { x: number; y: number; z: number }): SnapshotEnemy[] {
    const centerZone = this.spatial.nearestZone(center).id;
    const device = { position: center, zoneId: centerZone };
    const out: SnapshotEnemy[] = [];
    for (const e of state.players) {
      if (!e.alive || e.teamId === caster.teamId) continue;
      // inside the radius (no catalogued radius: its own zone only) and in the device's sight
      if (radiusUnits == null ? e.zoneId !== centerZone : dist3(center, e.position) > radiusUnits) continue;
      if (!this.lineOf(device, e)) continue;
      out.push({ enemyId: e.id, teamId: e.teamId, position: { ...e.position } });
    }
    return out;
  }

  /** Where a teammate is going (for its own team's view): remaining waypoints + time to the next one. */
  private transitOf(p: SimPlayer): TeammateTransit | undefined {
    if (!p.alive || p.pathIndex >= p.path.length) return undefined;
    const next = this.spatial.getZone(p.path[p.pathIndex]!);
    if (!next) return undefined;
    // Standing at a fire's edge: it enters the next zone when the fire is out.
    const waitMs = this.edgeWaiting.get(p.id);
    return {
      path: p.path.slice(p.pathIndex),
      nextZone: next.id,
      // time left on the real path to the next zone's boundary (or to the spot, inside the last zone)
      nextArrivalMs: waitMs !== undefined ? waitMs : Math.max(0, this.mover.msToNextZone(p) ?? 0),
      ...(waitMs !== undefined ? { waitingAtEdge: true } : {}),
    };
  }

  /**
   * World event → observation: a cast is HEARD by every enemy the sound reaches over the map's
   * sound graph. The cue names the caster's ZONE (never its position) with a confidence that
   * falls with distance; like a heard shot it updates the hearing team's intel on the caster,
   * never overriding a fresher or firmer call.
   */
  private emitCastCue(state: SimState, caster: SimPlayer, spec: AbilitySpec, intel: TeamIntel, out: AbilityCue[]): void {
    const observerSide: Side = caster.side === "attack" ? "defense" : "attack";
    const observers = state.players.filter((p) => p.alive && p.side === observerSide);
    if (observers.length === 0) return;
    const audible = new Map(this.spatial.audibleZones(caster.zoneId, 0.01).map((z) => [z.zoneId, z.strength]));
    let confidence = 0;
    for (const o of observers) confidence = Math.max(confidence, abilityCastCueConfidence(o.zoneId === caster.zoneId ? 1 : audible.get(o.zoneId) ?? 0));
    if (confidence <= 0) return;
    const zonePosition = { ...(this.spatial.getZone(caster.zoneId)?.position ?? caster.position) };
    out.push({
      tick: state.tick, elapsedMs: state.elapsedMs, casterId: caster.id, abilityId: spec.abilityId, effectType: spec.effectType,
      zoneId: caster.zoneId, zonePosition, observerSide, channel: "sound", confidence,
    });
    let m = intel.get(observerSide);
    if (!m) intel.set(observerSide, (m = new Map()));
    const prev = m.get(caster.id);
    const prevNow = prev && prev.zoneId === caster.zoneId
      ? infoFreshness(state.elapsedMs - prev.atMs, this.cfg.infoWindowMs, AVERAGE_TRAITS.trading, prev.confidence)
      : 0;
    if (confidence > prevNow) m.set(caster.id, { atMs: state.elapsedMs, zoneId: caster.zoneId, confidence });
  }

  /**
   * World state → observation: a deployed smoke / wall / fire / slow field is SEEN by the other
   * team the first time one of its players stands in the effect's zone or has a sightline onto it
   * (the effect is itself visible, so the map's raw sightline is used). The cue names the EFFECT's
   * zone — where utility is being committed — and says nothing of where the caster is.
   */
  private emitDeployedEffectCues(state: SimState, abilityEngine: AbilityEngine, seen: Set<string>, out: AbilityCue[]): void {
    const effects = deployedEffects(abilityEngine, state.elapsedMs);
    if (effects.length === 0) return;
    for (const e of effects) {
      if (!e.worldVisible) continue;
      const owner = state.players.find((p) => p.id === e.ownerId);
      if (!owner) continue;
      const observerSide: Side = owner.side === "attack" ? "defense" : "attack";
      const key = `${e.instanceId}|${observerSide}`;
      if (seen.has(key)) continue;
      // A deployed smoke / wall / fire is a large thing (metres across, a smoke metres tall): any
      // part of it in view gives it away, so it is seen over the zone sightline table, not over
      // a single point-to-point line (which would miss a smoke whose top is in plain view).
      const sighted = state.players.some((p) => p.alive && p.side === observerSide &&
        (p.zoneId === e.zoneId || this.spatial.hasLineOfSight(p.zoneId, e.zoneId)));
      if (!sighted) continue;
      seen.add(key);
      const zonePosition = { ...(this.spatial.getZone(e.zoneId)?.position ?? owner.position) };
      out.push({
        tick: state.tick, elapsedMs: state.elapsedMs, casterId: e.ownerId, abilityId: e.abilityId, effectType: e.effectType,
        zoneId: e.zoneId, zonePosition, observerSide, channel: "sight", confidence: DEPLOYED_EFFECT_CUE_CONFIDENCE,
      });
    }
  }

  /**
   * Enemies of `caster` blinded/suppressed by an effect centred at `center` (the caster, or a
   * thrown target point): alive, within `radiusUnits`, in the centre zone or with LoS to it.
   * `needsSight` (a flash): only someone LOOKING toward where the flash comes from is blinded —
   * for an enemy inside the target zone that is the side it was thrown from (the caster's zone),
   * for one watching the target zone from elsewhere it is the target itself. A flash that pops in
   * the caster's own zone is in the face of everyone there.
   */
  private flashTargets(state: SimState, caster: SimPlayer, radiusUnits: number, center?: { x: number; y: number; z: number }, needsSight = false): string[] {
    const centerPos = center ?? caster.position;
    const centerZone = this.spatial.nearestZone(centerPos).id;
    const casterZonePos = this.spatial.getZone(caster.zoneId)?.position ?? caster.position;
    const out: string[] = [];
    for (const e of state.players) {
      if (!e.alive || e.teamId === caster.teamId) continue;
      if (dist3(centerPos, e.position) > radiusUnits) continue;
      if (!this.lineOf({ position: centerPos, zoneId: centerZone }, e)) continue;
      if (needsSight && e.zoneId !== caster.zoneId) {
        const popFrom = e.zoneId === centerZone ? casterZonePos : centerPos;
        if (facingAngleTo(e.facing, e.position, popFrom) > HALF_FOV_RAD) continue;
      }
      out.push(e.id);
    }
    return out;
  }

  /**
   * What the executor asks the round on a mover's behalf. Movement itself — the path, the
   * position, the zone a position lies in — is the executor's (mover.ts); these hooks keep the
   * round's zone-level rules attached to it:
   *  - canStep: a ground patch in the open — fire is waited out / gone round / crossed at its rim,
   *    a slow field's delay is owed when the mover steps onto it (passPatchRim);
   *  - canEnterZone: fire on a doorway (wait or cross, passFireEdge) and a slow field on the
   *    doorway (its delay is paid before the mover is through);
   *  - onZoneChange: the hop is recorded (smoke-exit timing) and the move is traced;
   *  - onArrive: traced.
   */
  private moverHooks(world: MoveWorld, trace: Tracer, targetZone: string | undefined, navEvents: NavTraceEvent[], intent?: string): MoverHooks {
    const hooks: MoverHooks = {
      canStep: (p, next) => (world.fire.length === 0 && world.slow.length === 0) || this.passPatchRim(p, next, world, hooks),
      canEnterZone: (p, toZone) => {
        if (world.fire.length > 0 && !this.passFireEdge(p, toZone, world, hooks)) return false;
        if (world.slow.length > 0) {
          let r = 0;
          for (const sl of world.slow) {
            const onDoor = (sl.zoneId === toZone && sl.doorToZoneId === p.zoneId) || (sl.zoneId === p.zoneId && sl.doorToZoneId === toZone);
            const key = `${sl.instanceId}|${p.id}`;
            if (!onDoor || world.patchExposure.has(key)) continue;
            world.patchExposure.set(key, world.state.elapsedMs);
            r = Math.max(r, sl.radiusUnits || DEFAULT_PATCH_RADIUS_UNITS);
          }
          if (r > 0) {
            const speed = p.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC;
            p.edgeProgressMs = -slowFieldDelayMs(r, speed, this.cfg.slowSpeedMultiplier);
            return false;
          }
        }
        return this.stackedUp(p, toZone, world);
      },
      onZoneChange: (p, fromZone, toZone) => {
        world.lastHop.set(p.id, { fromZone, tick: world.state.tick });
        trace({ playerId: p.id, phase: "move", fromZone, toZone, targetZone });
      },
      onArrive: (p) => trace({ playerId: p.id, phase: "arrived", toZone: p.zoneId, targetZone }),
      onLanding: (p, h, at) => {
        if (!this.cfg.soundDetail) return;
        const snd = landingSound(h, this.perceptionParams);
        if (!snd) return;
        this.landings.push({ playerId: p.id, teamId: p.teamId, position: at, heightUnits: h, elapsedMs: world.state.elapsedMs, ...snd });
        world.events.push({ kind: "landing", tick: world.state.tick, elapsedMs: world.state.elapsedMs, actor: p.id, zoneId: p.zoneId, detail: `${Math.round(h)}uu r${Math.round(snd.radiusUnits)}` });
      },
      onNavEvent: (e: NavEvent) => {
        navEvents.push({ tick: world.state.tick, elapsedMs: world.state.elapsedMs, ...e, ...(intent ? { intent } : {}) });
        if (e.kind === "blocked" || e.kind === "unreachable") {
          trace({ playerId: e.playerId, phase: "move", targetZone: e.goalZone, result: e.kind, reason: e.reason }, `nav:${e.playerId}:${e.goalZone}:${e.kind}:${world.state.tick}`);
        }
      },
    };
    return hooks;
  }

  /**
   * Tell the map which zone each body is in, so that every zone lookup made from a player's
   * position (perception, the policies) agrees with the simulation's own zone for that player.
   */
  private publishZones(state: SimState): void {
    const hints = new Map<string, string>();
    for (const p of state.players) hints.set(positionKey(p.position.x, p.position.y), p.zoneId);
    if (state.spike.position && state.spike.zoneId) hints.set(positionKey(state.spike.position.x, state.spike.position.y), state.spike.zoneId);
    this.spatial.setPositionZones(hints);
  }

  /**
   * What a mover will do where it stops, read from the state of the round and the order's own
   * fields (never from the policy's labels): the spike carrier heading for a plantable zone stops
   * on its plant area; a defender heading for the zone the spike is planted in stops at the spike;
   * with cfg.coverSpots, a mover told what to watch on arrival (`aimZone`) takes a covered spot
   * that sees it. Everyone else stands near the zone's anchor.
   */
  private spotIntent(p: SimPlayer, cmd: ActionCommand, state: SimState): { spot?: SpotIntent } {
    const s = state.spike, targetZone = cmd.targetZone!;
    if (s.carrierId === p.id && (s.phase === "carried" || s.phase === "planting") && this.spatial.isPlantableZone(targetZone)) return { spot: { kind: "plant" } };
    if (p.side === "defense" && (s.phase === "planted" || s.phase === "defusing") && s.zoneId === targetZone && s.position) {
      // One defender goes to the spike; the others cover it: each takes, of the spots that see the
      // spike, the one the rest of the map sees least — nearest its own way in.
      return { spot: this.spikeRunnerOf(state) === p.id ? { kind: "at", position: s.position } : { kind: "see", point: s.position } };
    }
    if (this.cfg.coverSpots && cmd.aimZone && cmd.aimZone !== targetZone) return { spot: { kind: "hold", watchZone: cmd.aimZone } };
    const watch = this.watchIntent(p, cmd.aimZone, targetZone, state);
    return watch ? { spot: watch } : {};
  }

  /**
   * What a player must be able to SEE from where it stands, from the state of the round:
   *  - a defender before the plant whose order names a zone to watch (the way in to its site):
   *    that zone;
   *  - an attacker after the plant whose order is to watch the spike's zone: the spike itself.
   * Nobody else — a team staging out of sight is not asked to stand in view.
   */
  private watchIntent(p: SimPlayer, aimZone: string | undefined, standZone: string, state: SimState): Extract<SpotIntent, { kind: "see" }> | null {
    if (!aimZone) return null;
    const s = state.spike;
    const planted = s.phase === "planted" || s.phase === "defusing";
    if (p.side === "attack") return planted && s.zoneId === aimZone && s.position ? { kind: "see", point: s.position } : null;
    return !planted && aimZone !== standZone ? { kind: "see", zone: aimZone } : null;
  }

  /**
   * The defender who goes to the planted spike: the living defender nearest to it when the question
   * first comes up after the plant, kept until it dies (then the nearest of those left).
   */
  private spikeRunnerOf(state: SimState): string | null {
    const pos = state.spike.position;
    if (!pos) return null;
    const alive = state.players.filter((q) => q.alive && q.side === "defense");
    if (this.spikeRunner && alive.some((q) => q.id === this.spikeRunner)) return this.spikeRunner;
    let best: string | null = null, bestD = Infinity;
    for (const q of alive) {
      const d = dist3(q.position, pos);
      if (d < bestD || (d === bestD && best !== null && q.id < best)) { bestD = d; best = q.id; }
    }
    return (this.spikeRunner = best);
  }
  private spikeRunner: string | null = null;

  /** The planted spike, while it is down (what a guarding attacker faces). */
  private spikeWatched: { zoneId: string; position: { x: number; y: number; z: number } } | null = null;

  private isMoving(p: SimPlayer): boolean {
    if (this.steppingOut.has(p.id)) return true; // getting out of / crossing a fire patch
    if (this.edgeWaiting.has(p.id)) return false; // standing at a fire's edge, waiting
    return this.mover.isMoving(p);
  }

  /**
   * Orient a stationary player toward the zone it is watching. Priority: the command's explicit
   * `aimZone`; else a hold/peek command's `targetZone`; else the default — the choke an enemy
   * enters this zone from (the neighbour on the shortest path from the enemy's origin). Facing
   * feeds perception's FOV cone and combat pre-aim, so a holder sees the entry it watches.
   */
  private faceStationary(p: SimPlayer, cmd: ActionCommand | undefined, originOf: Record<Side, string>): void {
    const hintZone =
      cmd?.aimZone ??
      (cmd && (cmd.kind === "hold" || cmd.kind === "peek") ? cmd.targetZone : undefined) ??
      this.defaultHoldZone(p, originOf);
    // An attacker guarding the planted spike watches the way the retake comes in — the choke the
    // defenders enter the spike's zone through (the neighbour on the shortest path from their
    // origin), the same rule a pre-plant holder uses for its entry — and keeps the spike in view
    // too when both fit in its field of view (it then looks between them). Looking only at the
    // spike left every retaker arriving from outside the cone: the retaker saw first in 85% of
    // post-plant duels (2026-11-23 measurement, ENGINE_TRUTH.md §4).
    const spike = this.spikeWatched;
    if (spike && p.side === "attack" && cmd?.aimZone === spike.zoneId && this.cfg.gaze) {
      const entry = this.guardEntryFor(p, spike.zoneId);
      const at = entry ? this.peekPoint(p, entry, "defender-spawn") : spike.position;
      const ex = at.x - p.position.x, ey = at.y - p.position.y;
      if (ex !== 0 || ey !== 0) { p.facing = { x: ex, y: ey }; return; }
    }
    if (spike && p.side === "attack" && cmd?.aimZone === spike.zoneId) {
      // (gaze model off) the calibrated rule: watch the retake entry from defender-spawn, and look
      // between it and the spike when both fit in the field of view
      const sx = spike.position.x - p.position.x, sy = spike.position.y - p.position.y;
      const entry = this.retakeEntryOf(spike.zoneId, originOf);
      const ez = entry ? this.spatial.getZone(entry) : undefined;
      if (ez) {
        const ex = ez.position.x - p.position.x, ey = ez.position.y - p.position.y;
        if (ex !== 0 || ey !== 0) {
          const ae = Math.atan2(ey, ex), as = Math.atan2(sy, sx);
          const sep = Math.abs(Math.atan2(Math.sin(as - ae), Math.cos(as - ae)));
          if ((sx !== 0 || sy !== 0) && sep <= 2 * HALF_FOV_RAD) {
            const mid = ae + Math.atan2(Math.sin(as - ae), Math.cos(as - ae)) / 2;
            p.facing = { x: Math.cos(mid), y: Math.sin(mid) };
          } else p.facing = { x: ex, y: ey };
          return;
        }
      }
      if (sx !== 0 || sy !== 0) { p.facing = { x: sx, y: sy }; return; }
    }
    if (!hintZone || hintZone === p.zoneId) return;
    const z = this.spatial.getZone(hintZone);
    if (!z) return;
    // gaze model: crosshair on the peek point of the watched zone, not its centre (peekPoint)
    const at = this.cfg.gaze ? this.peekPoint(p, hintZone, originOf[p.side === "attack" ? "defense" : "attack"]) : z.position;
    const dx = at.x - p.position.x, dy = at.y - p.position.y;
    if (dx === 0 && dy === 0) return;
    p.facing = { x: dx, y: dy };
  }

  /**
   * Which way into the spike's zone a post-plant guard watches. Candidates: the zones joined to the
   * spike's zone (and the zone itself). Each is weighted by how likely the retake comes through it —
   *   w(z) = t_min / t_via(z) + belief threat level of z,
   * t_via(z) = travel time defender-spawn → z → spike zone, t_min the shortest such time (the
   * nearer route is the likelier one) — plus what the team believes (sightings, sounds). A guard
   * takes the heaviest entry it has a clear line to that no teammate has already taken this tick
   * (teammates split the entries rather than all watching one). None in sight: the spike.
   * Looking only at the spike let the retaker see first in 85% of post-plant duels, and with gaze
   * as state the guard was 40°+ off the retaker in 4 duels of 10 when it watched one entry only
   * (2026-11-23, ENGINE_TRUTH.md §4–§8).
   */
  private guardEntryFor(p: SimPlayer, spikeZone: string): string | null {
    const key = `entries>${spikeZone}`;
    let entries = this.guardEntryCache.get(key);
    if (!entries) {
      const from = this.spatial.getZone("defender-spawn") ? "defender-spawn" : null;
      const zones = this.spatial.zones.map((z) => z.id).filter((z) => z === spikeZone || this.adjacent(z, spikeZone));
      const via = zones.map((z) => {
        if (!from) return { zone: z, t: 1 };
        const a = this.spatial.shortestTravelTimeMs(from, z, "run"), b = z === spikeZone ? 0 : this.spatial.shortestTravelTimeMs(z, spikeZone, "run");
        return { zone: z, t: a == null || b == null ? Infinity : a + b + 1 };
      });
      const tmin = Math.min(...via.map((v) => v.t));
      entries = via.map((v) => ({ zone: v.zone, w: Number.isFinite(v.t) ? tmin / v.t : 0 }));
      this.guardEntryCache.set(key, entries);
    }
    const threat = new Map((this.beliefNow.attack?.threatZones ?? []).map((t) => [t.zoneId, t.threatLevel]));
    const ranked = entries.map((e) => ({ zone: e.zone, w: e.w + (threat.get(e.zone) ?? 0) })).sort((a, b) => b.w - a.w || (a.zone < b.zone ? -1 : 1));
    for (const e of ranked) {
      if (this.guardTaken.get(e.zone) && this.guardTaken.get(e.zone) !== p.id) continue;
      if (!this.lineOf(p, { position: this.spatial.standPosition(e.zone), zoneId: e.zone })) continue;
      this.guardTaken.set(e.zone, p.id);
      return e.zone;
    }
    return null;
  }
  private readonly guardEntryCache = new Map<string, Array<{ zone: string; w: number }>>();
  /** entry zone → the guard that took it this tick. */
  private readonly guardTaken = new Map<string, string>();
  /** Each side's latest belief (for gaze and the guards' entries). */
  private beliefNow: Record<Side, BeliefState | null> = { attack: null, defense: null };

  /** The zone the defenders enter `zoneId` through on a retake: the predecessor on defender-spawn → zone. */
  private retakeEntryOf(zoneId: string, originOf: Record<Side, string>): string | undefined {
    const key = `retake>${zoneId}`;
    if (!this.retakeEntry.has(key)) {
      const from = this.spatial.getZone("defender-spawn") ? "defender-spawn" : originOf.defense;
      const r = from && from !== zoneId ? this.spatial.findPath(from, zoneId) : null;
      this.retakeEntry.set(key, r && r.path.length >= 2 ? r.path[r.path.length - 2] : undefined);
    }
    return this.retakeEntry.get(key);
  }
  private readonly retakeEntry = new Map<string, string | undefined>();

  /**
   * Where a holder watching a zone puts its crosshair: the PEEK POINT — of the zone's floor that the
   * holder can see (measured node-to-node sight), the point nearest to where the enemy comes from
   * (its origin zone's standing point): the edge an enemy entering the holder's view crosses first.
   * Without a sight table, or with nothing of the zone in view, the zone's standing point.
   * Crosshair height on it is the player's crosshairPlacement (combat model).
   */
  private peekPoint(p: SimPlayer, zoneId: string, enemyFrom: string | undefined): { x: number; y: number; z: number } {
    const nav = this.spatial.nav;
    const fallback = this.spatial.standPosition(zoneId);
    if (!nav || !nav.hasVisibility) return fallback;
    const at = nav.locateInZone(p.position, p.zoneId);
    if (at === null) return fallback;
    const key = `${at}|${zoneId}|${enemyFrom ?? ""}`;
    let n = this.peekCache.get(key);
    if (n === undefined) {
      const ref = enemyFrom && this.spatial.getZone(enemyFrom) ? this.spatial.standPosition(enemyFrom) : fallback;
      let best = -1, bestD = Infinity;
      for (const c of nav.zoneNodes(zoneId)) {
        if (!nav.nodesVisible(at, c)) continue;
        const q = nav.nodePosition(c);
        const d = Math.hypot(q.x - ref.x, q.y - ref.y, q.z - ref.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      n = best;
      this.peekCache.set(key, n);
    }
    return n >= 0 ? nav.nodePosition(n) : fallback;
  }
  private readonly peekCache = new Map<string, number>();

  /** The zone an enemy would enter this player's zone from: the predecessor on enemy-origin → here. */
  private defaultHoldZone(p: SimPlayer, originOf: Record<Side, string>): string | undefined {
    const enemyOrigin = originOf[p.side === "attack" ? "defense" : "attack"];
    if (!enemyOrigin || enemyOrigin === p.zoneId) return undefined;
    const r = this.spatial.findPath(enemyOrigin, p.zoneId);
    if (!r || r.path.length < 2) return undefined;
    return r.path[r.path.length - 2]; // the choke adjacent to this zone on the enemy's approach
  }

  private resolveEngagements(
    state: SimState,
    sight: ReturnType<PerceptionEngine["perceive"]>,
    abilityEngine: AbilityEngine,
    engaged: Set<string>,
    events: SimEvent[],
    engTrace: EngagementRecord[] | null,
    castBusyUntil: ReadonlyMap<string, number>,
    intel: TeamIntel,
    cues: ShotCue[],
    smokeExits: ReadonlyMap<string, SightOccluder>,
  ): void {
    const alive = state.players.filter((p) => p.alive);
    // A blinded player sees nothing: it has no first sight, holds no angle and is not a second gun.
    const blind = (id: string): boolean => abilityEngine.blindRemainingMs(id, state.elapsedMs) > 0;
    const sees = (viewerId: string, targetId: string): boolean =>
      !blind(viewerId) &&
      (sight.players.get(viewerId)?.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === targetId) ?? false);
    // Smoke is not a wall: a player can walk through it, but has no sight while its eye is inside.
    // A body whose eye was inside a smoke volume last tick and is out of it now has just come OUT
    // OF THE SMOKE (smokeExits, measured after movement each tick); the smoke is the edge it left.
    const exitedSmokeFrom = (p: SimPlayer): SightOccluder | null => smokeExits.get(p.id) ?? null;
    // Holding the smoke's edge: stationary, not blind, and the smoke the pusher comes out of lies
    // inside the holder's field of view. Such a holder sees the pusher appear before the pusher,
    // whose eye is still inside, sees anything.
    const watchesEdge = (holder: SimPlayer, edge: SightOccluder): boolean => {
      if (this.isMoving(holder) || blind(holder.id)) return false;
      return facingAngleTo(holder.facing, holder.position, edge.center) <= HALF_FOV_RAD;
    };
    // Info freshness — exponential decay (half-life model): a call on an enemy that has not left
    // its zone is worth w = 2^(−Δt / halfLife) ∈ (0,1]. Trading stat stretches the half-life
    // (×0.4 … ×1.6): a good trader converts a teammate's call into a refrag for longer.
    const infoWeight = (viewer: SimPlayer, enemy: SimPlayer): number => {
      const seen = intel.get(viewer.side)?.get(enemy.id);
      if (!seen || seen.zoneId !== enemy.zoneId) return 0;
      return infoFreshness(state.elapsedMs - seen.atMs, this.cfg.infoWindowMs, (viewer.traits ?? AVERAGE_TRAITS).trading, seen.confidence);
    };
    // Clutch stat: the last player alive against 2+ plays above/below their level under pressure.
    const lastAliveVsMany = (p: SimPlayer): boolean =>
      !alive.some((c) => c.side === p.side && c.id !== p.id) && alive.filter((c) => c.side !== p.side).length >= 2;
    // Crossfire (양각) = guns on the target from MORE THAN ONE ANGLE. Beyond the duel opponent, an
    // enemy with line of sight onto the target's zone counts when it is either
    //  - set up: stationary (holding a spot — two holders on one callout-sized zone cover two angles), or
    //  - flanking: its bearing to the target differs from the duelist's by ≥ CROSSFIRE_MIN_ANGLE.
    // A stack running through the same choke behind the entry is one angle, not a crossfire: each
    // such teammate only adds trade pressure (CROSSFIRE_SAME_LINE_WEIGHT of a gun).
    // Exposure, not facing: duels resolve at first contact, so "both already look at him" is rare.
    const crossfired = (target: SimPlayer, duelist: SimPlayer): number => {
      if (this.cfg.crossfirePenaltyMs <= 0) return 0;
      const ref = Math.atan2(duelist.position.y - target.position.y, duelist.position.x - target.position.x);
      let guns = 0;
      for (const c of alive) {
        if (!c.alive || c.side !== duelist.side || c.id === duelist.id || blind(c.id)) continue;
        if (!sees(c.id, target.id) && !this.lineOf(c, target)) continue;
        if (!this.isMoving(c)) { guns++; continue; }
        const bearing = Math.atan2(c.position.y - target.position.y, c.position.x - target.position.x);
        const diff = Math.abs(Math.atan2(Math.sin(bearing - ref), Math.cos(bearing - ref)));
        guns += diff >= CROSSFIRE_MIN_ANGLE_RAD ? 1 : CROSSFIRE_SAME_LINE_WEIGHT;
      }
      return guns;
    };
    // A player can be in at most one duel per tick — you can only shoot one target at a
    // time. This lets kills be TRADED over successive ticks instead of one holder winning
    // several simultaneous 1v1s, so numbers advantage actually matters.
    const busy = new Set<string>();
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        if (a.teamId === b.teamId || !a.alive || !b.alive) continue;
        if (busy.has(a.id) || busy.has(b.id)) continue;
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (engaged.has(key)) continue;
        let aSeesB = sees(a.id, b.id);
        let bSeesA = sees(b.id, a.id);
        if (!aSeesB && !bSeesA) continue;
        // Smoke exit: the one who came out of the smoke did not see first if the other was holding
        // that edge. Nothing else is decided here — what "not seeing first" costs is the ordinary
        // surprise delay, discounted by the team's info on the holder (toCombatant), and a blinded
        // holder is not watching anything (so a flash on the holders turns the exit around).
        const aFrom = exitedSmokeFrom(a);
        const bFrom = exitedSmokeFrom(b);
        const aWatched = aFrom !== null && bFrom === null && bSeesA && watchesEdge(b, aFrom);
        const bWatched = bFrom !== null && aFrom === null && aSeesB && watchesEdge(a, bFrom);
        if (aWatched) aSeesB = false;
        if (bWatched) bSeesA = false;
        // Info (called position): the team saw this enemy recently and it has not left that zone →
        // the swing is pre-aimed at the spot, not a blind entry. No info keeps the surprise penalty.
        const aInfoW = aSeesB ? 0 : infoWeight(a, b);
        const bInfoW = bSeesA ? 0 : infoWeight(b, a);
        // A call fresher than one half-life is a pre-aimed swing: it also denies the holder's pre-aim.
        const aInfo = aInfoW >= 0.5;
        const bInfo = bInfoW >= 0.5;
        const aAware = aSeesB || aInfo;
        const bAware = bSeesA || bInfo;
        // Crossfire (양각): a second enemy, from another zone, also has eyes on this player.
        const aCross = crossfired(a, b);
        const bCross = crossfired(b, a);
        engaged.add(key);
        busy.add(a.id);
        busy.add(b.id);
        const seed = deriveSeed(this.cfg.seed, `${state.tick}:${key}`);
        // Angle advantage — the geometry of the corner between them (situational.ts): with one
        // player peeking (PEEK_CORNER_DISTANCE from the corner, strafing at their own speed) and
        // the other holding the rest of the engagement distance away, whoever is farther from the
        // corner sees the other's shoulder first. Nothing is added when both move or both hold.
        let aAngleMs = 0;
        let bAngleMs = 0;
        const aMoving = this.isMoving(a);
        const bMoving = this.isMoving(b);
        if (aMoving !== bMoving) {
          const peeker = aMoving ? a : b;
          const holderDist = Math.max(1, dist3(a.position, b.position) - PEEK_CORNER_DISTANCE);
          const speed = (peeker.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC) * (this.weapons[peeker.weaponId]?.runSpeedMultiplier ?? 1);
          const d = angleAdvantageDelays(PEEK_CORNER_DISTANCE, holderDist, speed);
          aAngleMs = aMoving ? d.peekerMs : d.holderMs;
          bAngleMs = bMoving ? d.peekerMs : d.holderMs;
        }
        // Out of a watched smoke the occluder is at the pusher's own body, not a corner 3 m away:
        // the corner geometry's limit (situational.ts smokeExitDelayMs) replaces the corner terms.
        if (aWatched || bWatched) {
          const pusher = aWatched ? a : b;
          const speed = (pusher.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC) * (this.weapons[pusher.weaponId]?.runSpeedMultiplier ?? 1);
          aAngleMs = aWatched ? smokeExitDelayMs(speed) : 0;
          bAngleMs = bWatched ? smokeExitDelayMs(speed) : 0;
        }
        const ca = this.toCombatant(a, abilityEngine, state, aSeesB, bAware, this.isMoving(b), castBusyUntil, aCross, lastAliveVsMany(a), aInfoW, aAngleMs, b);
        const cb = this.toCombatant(b, abilityEngine, state, bSeesA, aAware, this.isMoving(a), castBusyUntil, bCross, lastAliveVsMany(b), bInfoW, bAngleMs, a);
        const dm = dist3(a.position, b.position) / 100;
        events.push({ kind: "engage", tick: state.tick, elapsedMs: state.elapsedMs, actor: a.id, target: b.id, zoneId: a.zoneId });
        const r = resolveDuel({ a: ca, b: cb, distanceMeters: dm }, seed, { calibration: this.cfg.combatCalibration });
        // Shots are world events with observable consequences for the OTHER team (sound, tracers).
        for (const [shooter, target] of [[a, b], [b, a]] as const) {
          if ((r.outcomes[shooter.id]?.shotsFired ?? 0) > 0) {
            this.emitShotCues(state, shooter, target, alive, intel, cues);
            if (this.cfg.soundDetail) this.shotLog.push({ position: { ...shooter.position }, elapsedMs: state.elapsedMs });
          }
        }
        // Attrition: whoever survives the duel keeps a share (cfg.damageCarryover) of the damage it
        // took into the next fight. At 0 a winner re-fights every duel at full health, so one player
        // can chain 1v1s against a group; the carry-over is the Lanchester attrition that makes
        // numbers count.
        for (const p of [a, b]) {
          const o = r.outcomes[p.id];
          if (o && o.alive) {
            const f = this.cfg.damageCarryover;
            p.health = Math.max(1, p.health - f * Math.max(0, p.health - o.health));
            p.armor = Math.max(0, p.armor - f * Math.max(0, p.armor - o.armor));
          }
        }
        if (r.winner && r.loser) {
          const loser = state.players.find((p) => p.id === r.loser)!;
          loser.alive = false;
          loser.health = 0;
          if (state.spike.carrierId === loser.id && state.spike.phase === "carried") {
            state.spike.carrierId = null;
            state.spike.zoneId = loser.zoneId;
            state.spike.position = { ...loser.position };
          }
          events.push({ kind: "kill", tick: state.tick, elapsedMs: state.elapsedMs, actor: r.winner, target: r.loser, zoneId: loser.zoneId });
        }
        if (engTrace) {
          const atkP = a.side === "attack" ? a : b;
          const defP = a.side === "attack" ? b : a;
          const atkSees = atkP === a ? aSeesB : bSeesA;
          const defSees = defP === a ? aSeesB : bSeesA;
          const winnerSide = r.winner ? (state.players.find((p) => p.id === r.winner)?.side ?? null) : null;
          engTrace.push({
            tick: state.tick, elapsedMs: state.elapsedMs,
            attackerId: atkP.id, defenderId: defP.id, attackerZone: atkP.zoneId, defenderZone: defP.zoneId,
            distanceMeters: dm,
            attackerSawDefender: atkSees, defenderSawAttacker: defSees,
            firstSight: atkSees && !defSees ? "attacker" : defSees && !atkSees ? "defender" : "mutual",
            attackerPreAim: atkSees && !defSees && !this.isMoving(atkP),
            defenderPreAim: defSees && !atkSees && !this.isMoving(defP),
            attackerMoving: this.isMoving(atkP), defenderMoving: this.isMoving(defP),
            angleDelayMs: { attacker: atkP === a ? aAngleMs : bAngleMs, defender: defP === a ? aAngleMs : bAngleMs },
            crossfire: { attacker: (atkP === a ? aCross : bCross) > 0, defender: (defP === a ? aCross : bCross) > 0 },
            info: { attacker: atkP === a ? aInfo : bInfo, defender: defP === a ? aInfo : bInfo },
            aimOffsetDeg: { attacker: offsetDeg(atkP.facing, atkP.position, defP.position), defender: offsetDeg(defP.facing, defP.position, atkP.position) },
            gaze: { attacker: this.gazeOf.get(atkP.id) ?? "route", defender: this.gazeOf.get(defP.id) ?? "route" },
            readyMs: {
              attacker: readyDelayMs(atkP === a ? ca : cb, COMBAT_PARAMS, this.cfg.combatCalibration ?? {}, dm),
              defender: readyDelayMs(defP === a ? ca : cb, COMBAT_PARAMS, this.cfg.combatCalibration ?? {}, dm),
            },
            attackerFlashedMs: abilityEngine.blindRemainingMs(atkP.id, state.elapsedMs),
            defenderFlashedMs: abilityEngine.blindRemainingMs(defP.id, state.elapsedMs),
            ...(aFrom !== null || bFrom !== null
              ? { smokeExit: { attacker: (atkP === a ? aFrom : bFrom) !== null, defender: (defP === a ? aFrom : bFrom) !== null, watched: aWatched || bWatched } }
              : {}),
            winnerSide,
          });
        }
      }
    }
  }

  /**
   * World event → observation. A shot is heard by every enemy the sound reaches (zone-level, loose)
   * and its tracer is SEEN by every enemy with a sightline onto the shot's path — when the weapon's
   * tracers are visible to enemies at all. Tracers are light, so smoke does not hide them; the
   * sightline is the map's zone-to-zone line of sight. Each cue updates the observing team's intel
   * on the shooter (never weaker than what it already holds from a fresher, firmer source).
   */
  private emitShotCues(state: SimState, shooter: SimPlayer, target: SimPlayer, alive: readonly SimPlayer[], intel: TeamIntel, cues: ShotCue[]): void {
    const weapon = this.weapons[shooter.weaponId];
    const observerSide: Side = shooter.side === "attack" ? "defense" : "attack";
    const observers = alive.filter((p) => p.alive && p.side === observerSide && p.id !== target.id);
    if (observers.length === 0) return;
    const audible = new Map(this.spatial.audibleZones(shooter.zoneId, 0.01).map((z) => [z.zoneId, z.strength]));
    let sound = 0;
    let tracer = false;
    for (const o of observers) {
      sound = Math.max(sound, soundCueConfidence(o.zoneId === shooter.zoneId ? 1 : audible.get(o.zoneId) ?? 0, weapon?.fireLoudness ?? 1));
      // a tracer is light along the shot: seen by whoever has a line onto the shooter or the target
      // (a smoke does not hide it — assumption kept from the zone-level rule)
      if (!tracer && (weapon?.tracerVisible ?? true) && (this.lineOf(o, shooter, true) || this.lineOf(o, target, true))) tracer = true;
    }
    const zonePosition = { ...(this.spatial.getZone(shooter.zoneId)?.position ?? shooter.position) };
    const push = (channel: ShotCue["channel"], confidence: number) => {
      cues.push({ tick: state.tick, elapsedMs: state.elapsedMs, shooterId: shooter.id, weaponId: shooter.weaponId, zoneId: shooter.zoneId, zonePosition, observerSide, channel, confidence });
    };
    if (sound > 0) push("sound", sound);
    if (tracer) push("tracer", TRACER_CUE_CONFIDENCE);
    const confidence = Math.max(sound, tracer ? TRACER_CUE_CONFIDENCE : 0);
    if (confidence <= 0) return;
    let m = intel.get(observerSide);
    if (!m) intel.set(observerSide, (m = new Map()));
    const prev = m.get(shooter.id);
    const prevNow = prev && prev.zoneId === shooter.zoneId
      ? infoFreshness(state.elapsedMs - prev.atMs, this.cfg.infoWindowMs, AVERAGE_TRAITS.trading, prev.confidence)
      : 0;
    if (confidence > prevNow) m.set(shooter.id, { atMs: state.elapsedMs, zoneId: shooter.zoneId, confidence });
  }

  /** Remember every enemy each side currently sees (after this tick's duels → usable from the next tick). */
  private recordIntel(state: SimState, sight: ReturnType<PerceptionEngine["perceive"]>, intel: TeamIntel, abilityEngine: AbilityEngine): void {
    for (const p of state.players) {
      if (!p.alive) continue;
      if (abilityEngine.blindRemainingMs(p.id, state.elapsedMs) > 0) continue; // a blinded player calls nothing
      const seen = sight.players.get(p.id)?.visibleEnemies ?? [];
      for (const e of seen) {
        if (!e.currentlyVisible) continue;
        const enemy = state.players.find((q) => q.id === e.playerId);
        if (!enemy?.alive) continue;
        let m = intel.get(p.side);
        if (!m) intel.set(p.side, (m = new Map()));
        m.set(enemy.id, { atMs: state.elapsedMs, zoneId: enemy.zoneId, confidence: 1 });
      }
    }
  }

  private toCombatant(p: SimPlayer, abilityEngine: AbilityEngine, state: SimState, seesEnemy: boolean, enemySeesSelf: boolean, opponentMoving: boolean, castBusyUntil: ReadonlyMap<string, number>, extraGuns = 0, clutchSpot = false, infoWeight = 0, angleMs = 0, opponent?: SimPlayer): Combatant {
    const weapon = this.weapons[p.weaponId];
    if (!weapon) throw new Error(`unknown weapon: ${p.weaponId}`);
    const stationary = !this.isMoving(p);
    // Mid-cast: weapon not out (within the ability windup) → no pre-aim and a reaction penalty.
    const casting = (castBusyUntil.get(p.id) ?? 0) > state.elapsedMs;
    // Caught in a crossfire you cannot hold both angles: no pre-aim, and a late reaction.
    const crossfire = extraGuns > 0;
    const preAim = seesEnemy && !enemySeesSelf && stationary && !casting && !crossfire;
    // Peeker's advantage: a stationary holder reacts late to an enemy peeking into it, even on
    // mutual sight. One who did not see first keeps the full surprise delay. A caster caught mid-
    // windup reacts slower still (weapon-unready), bounded by the windup.
    // Not seeing first costs the surprise delay, discounted by how fresh the team's call is:
    // surprise = SURPRISE_DELAY × (1 − w). No info (w = 0) → the full penalty of a blind entry.
    // A blinded player first sees the enemy when the blind ends — the combat engine adds that wait
    // itself (flashBlindMs + its re-acquisition penalty), so no separate surprise term is stacked on it.
    const blindMs = abilityEngine.blindRemainingMs(p.id, state.elapsedMs);
    const base = blindMs > 0 ? 0 : !seesEnemy ? SURPRISE_DELAY_MS * (1 - infoWeight) : stationary && opponentMoving ? this.cfg.peekerAdvantageMs : 0;
    const traits = p.traits ?? AVERAGE_TRAITS;
    // Crossfire — Hick–Hyman law: choice reaction time grows with the log of the alternatives,
    // RT = b · log2(n + 1), n = extra enemy guns on this player, b = crossfirePenaltyMs (ms per bit).
    // Game sense scales b: reading the second angle shrinks it (×1.5 at 0.2 … ×0.5 at 1.0).
    const crossMs = crossfirePenaltyMs(this.cfg.crossfirePenaltyMs, extraGuns, traits.gameSense);
    // Clutch: composure when last alive vs 2+ — below-average clutch reacts late, above-average early.
    const clutchMs = clutchSpot ? clutchReactionMs(traits.clutch) : 0;
    const seesEnemyAtMs = Math.max(0, base + (casting ? CAST_WINDUP_PENALTY_MS : 0) + crossMs + clutchMs + angleMs);
    return {
      id: p.id, teamId: p.teamId, health: p.health, armor: p.armor, weapon, skills: p.skills,
      posture: {
        ...OPEN_POSTURE,
        preAim,
        moving: this.isMoving(p),
        pace: p.moveMode === "walk" ? "walk" : "run",
        seesEnemyAtMs,
        flashBlindMs: blindMs,
        behindCover: 0,
        // Gaze: how far its crosshair is off the enemy when the fight starts (Fitts aim time in the
        // combat model; crosshair placement adds the height error). Replaces the pre-aim flag for timing.
        ...(opponent && this.cfg.gaze ? { aimOffsetDeg: offsetDeg(p.facing, p.position, opponent.position) } : {}),
      },
    };
  }

  private stepSpike(state: SimState, commands: Map<string, ActionCommand>, dtMs: number, events: SimEvent[], trace: Tracer): void {
    const s = state.spike;
    // Trace plant/defuse command evaluation with the reason it did/didn't take (deduped per
    // distinct reason) — this is the signal PV-3 needs to see why plants aren't happening.
    for (const p of state.players) {
      const c = readyCommand(commands.get(p.id), state.elapsedMs);
      if (c?.kind === "plant") {
        const result = !p.alive ? "dead"
          : s.carrierId !== p.id ? "notCarrier"
          : !this.spatial.isPlantableZone(p.zoneId) ? "notPlantableZone"
          : !this.onPlantArea(p) ? "notOnPlantArea"
          : s.phase === "planting" ? "planting" : "started";
        trace({ playerId: p.id, phase: "plant", fromZone: p.zoneId, result }, `plant:${p.id}:${result}:${p.zoneId}`);
      } else if (c?.kind === "defuse") {
        const result = !p.alive ? "dead"
          : !(s.phase === "planted" || s.phase === "defusing") ? "notPlanted"
          : !s.position || !this.inDefuseReach(p, s.position) ? "notAtSpike"
          : s.phase === "defusing" ? "defusing" : "started";
        trace({ playerId: p.id, phase: "defuse", fromZone: p.zoneId, result }, `defuse:${p.id}:${result}:${p.zoneId}`);
      }
    }
    if (s.phase === "detonated" || s.phase === "defused") return;

    // plant
    if (s.phase === "carried" || s.phase === "planting") {
      const carrier = s.carrierId ? state.players.find((p) => p.id === s.carrierId && p.alive) : null;
      const planting = carrier && !this.steppingOut.has(carrier.id) && !this.mover.isMoving(carrier) && readyCommand(commands.get(carrier.id), state.elapsedMs)?.kind === "plant" && this.onPlantArea(carrier);
      if (planting && carrier) {
        if (s.phase === "carried") { s.phase = "planting"; s.plantProgressMs = 0; events.push({ kind: "plantStart", tick: state.tick, elapsedMs: state.elapsedMs, actor: carrier.id, zoneId: carrier.zoneId }); }
        s.plantProgressMs += dtMs;
        if (s.plantProgressMs >= this.cfg.plantDurationMs) {
          s.phase = "planted";
          s.zoneId = carrier.zoneId;
          s.position = { ...carrier.position };
          s.detonateAtElapsedMs = state.elapsedMs + this.cfg.spikeTimerMs;
          events.push({ kind: "planted", tick: state.tick, elapsedMs: state.elapsedMs, actor: carrier.id, zoneId: carrier.zoneId });
        }
      } else if (s.phase === "planting") {
        s.phase = "carried"; s.plantProgressMs = 0; // interrupted
      }
      return;
    }

    // detonation
    if (s.phase === "planted" || s.phase === "defusing") {
      if (s.detonateAtElapsedMs != null && state.elapsedMs >= s.detonateAtElapsedMs) {
        s.phase = "detonated";
        events.push({ kind: "detonated", tick: state.tick, elapsedMs: state.elapsedMs, zoneId: s.zoneId ?? undefined });
        return;
      }
      // defuse
      const spikeAt = s.position;
      const defuser = spikeAt && state.players.find((p) => p.alive && p.side === "defense" && this.inDefuseReach(p, spikeAt) && !this.steppingOut.has(p.id) && !this.mover.isMoving(p) && readyCommand(commands.get(p.id), state.elapsedMs)?.kind === "defuse");
      if (defuser) {
        if (s.phase === "planted") { s.phase = "defusing"; s.defuseProgressMs = 0; s.defuserId = defuser.id; events.push({ kind: "defuseStart", tick: state.tick, elapsedMs: state.elapsedMs, actor: defuser.id, zoneId: s.zoneId ?? undefined }); }
        if (s.defuserId && !state.players.find((p) => p.id === s.defuserId)?.alive) {
          s.phase = "planted"; s.defuseProgressMs = 0; s.defuserId = null;
          events.push({ kind: "defuseInterrupted", tick: state.tick, elapsedMs: state.elapsedMs });
          return;
        }
        s.defuseProgressMs += dtMs;
        if (s.defuseProgressMs >= this.cfg.defuseDurationMs) {
          s.phase = "defused";
          events.push({ kind: "defused", tick: state.tick, elapsedMs: state.elapsedMs, actor: defuser.id, zoneId: s.zoneId ?? undefined });
        }
      } else if (s.phase === "defusing") {
        // defuser left or died
        const prev = s.defuserId;
        s.phase = "planted"; s.defuseProgressMs = 0; s.defuserId = null;
        if (prev) events.push({ kind: "defuseInterrupted", tick: state.tick, elapsedMs: state.elapsedMs, actor: prev });
      }
    }
  }

  /**
   * On the site's plant area: inside the map's plant polygon (`isPointPlantable`). A plantable zone
   * the map draws no polygon for falls back to the zone (so a map without plant data still plays).
   */
  private onPlantArea(p: SimPlayer): boolean {
    if (!this.spatial.isPlantableZone(p.zoneId)) return this.spatial.isPointPlantable(p.position);
    let drawn = this.polygonZones.get(p.zoneId);
    if (drawn === undefined) {
      const z = this.spatial.getZone(p.zoneId)!;
      drawn = this.spatial.plantZoneAt(z.position) !== null || this.spatial.plantZoneAt(this.spatial.standPosition(z.id)) !== null;
      this.polygonZones.set(p.zoneId, drawn);
    }
    return drawn ? this.spatial.isPointPlantable(p.position) : true;
  }
  private readonly polygonZones = new Map<string, boolean>();

  /** Close enough to the planted spike to defuse it (same floor, within DEFUSE_REACH_UNITS). */
  private inDefuseReach(p: SimPlayer, spike: { x: number; y: number; z: number }): boolean {
    return Math.abs(p.position.z - spike.z) <= 120 && Math.hypot(p.position.x - spike.x, p.position.y - spike.y) <= DEFUSE_REACH_UNITS;
  }

  private checkEnd(state: SimState): { winner: Side; reason: RoundEndReason } | null {
    const s = state.spike;
    if (s.phase === "detonated") return { winner: "attack", reason: "spikeDetonation" };
    if (s.phase === "defused") return { winner: "defense", reason: "spikeDefused" };
    const atkAlive = state.players.some((p) => p.side === "attack" && p.alive);
    const defAlive = state.players.some((p) => p.side === "defense" && p.alive);
    if (!defAlive) return { winner: "attack", reason: "elimination" };
    const planted = s.phase === "planted" || s.phase === "defusing";
    if (!atkAlive && !planted) return { winner: "defense", reason: "elimination" };
    if (state.timeRemainingMs <= 0 && !planted) return { winner: "defense", reason: "timeExpired" };
    return null;
  }

  private toPerceptionWorld(state: SimState, abilityEngine?: AbilityEngine): PWorldState {
    const players: PPlayerState[] = state.players.map((p) => ({
      id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
      position: p.position, velocity: { x: 0, y: 0, z: 0 }, facing: p.facing,
      health: p.health, armor: p.armor, alive: p.alive, weapon: null,
      behaviorState: this.isMoving(p) ? (p.moveMode === "run" ? "running" : "walking") : "still",
      zoneId: p.zoneId,
    }));
    // deployed smokes/walls block LoS; cast this via the smoke-aware oracle (runRound config).
    const activeAbilities = abilityEngine ? toPerceptionAbilityStates(abilityEngine) : [];
    return {
      matchId: state.matchId, roundId: state.roundId, roundNumber: 1, tick: state.tick,
      timeRemainingMs: state.timeRemainingMs, mapId: state.mapId, patchVersion: "synthetic",
      players, spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
      activeAbilities, events: [],
    };
  }
}
