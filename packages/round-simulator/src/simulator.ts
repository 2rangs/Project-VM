import type { SpatialEngine } from "@pv/spatial-engine";
import {
  PerceptionEngine,
  type PlayerState as PPlayerState,
  type WorldState as PWorldState,
} from "@pv/perception-engine";
import {
  resolveDuel,
  OPEN_POSTURE,
  type Combatant,
  type WeaponSpec,
} from "@pv/combat-engine";
import {
  AbilityEngine,
  type AbilityCatalog,
  checkAvailability,
  toPerceptionAbilityStates,
  visionBlockerIsSmoke,
  deniedZoneIds,
  activeAreaDenials,
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
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { ActionCommand, BeliefState, DecisionPolicy } from "./policy-contract.js";
import { buildPolicyView, SeededRandomSource, SpatialQueryAdapter, toPerceptionSnapshot } from "./view.js";
import { deriveSeed } from "./rng.js";

export interface RoundSimulatorDeps {
  readonly spatial: SpatialEngine;
  readonly policies: Readonly<Record<Side, DecisionPolicy>>;
  readonly weapons: Readonly<Record<string, WeaponSpec>>;
  readonly abilities: AbilityCatalog;
  readonly config?: Partial<SimConfig>;
}

const RUN_UNITS_PER_SEC = 675;
const WALK_UNITS_PER_SEC = 340;
const SURPRISE_DELAY_MS = 300; // reaction penalty for the side that did not see first
// Passable-hazard (molly / area-denial) pathfinding cost: how long you'd detour to avoid 1 HP of
// damage, and how long a crosser is assumed exposed in a hazard zone. A fresh molly thus adds a
// multi-second detour cost that shrinks to ~0 as it expires, so the planner routes around a fresh
// molly but walks a dying one.
const HAZARD_MS_PER_HP = 50;
const HAZARD_EXPOSURE_MS = 700;
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
    const perception = new PerceptionEngine(this.spatial, { isSmoke: visionBlockerIsSmoke });
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
          const view = buildPolicyView(side, state, perception, spatialQuery, prevBelief[side], dt, { activeAbilities, abilityEngine });
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
      const denied = deniedZoneIds(abilityEngine); // zones that deal per-tick damage (step 5b)
      const hazardCosts = this.hazardCostMap(abilityEngine, state.elapsedMs);
      for (const p of state.players) {
        if (!p.alive) continue;
        const cmd = readyCommand(commands.get(p.id), state.elapsedMs);
        if (cmd?.kind === "move" && cmd.targetZone) this.ensurePath(p, cmd.targetZone, cmd.moveMode ?? "run", hazardCosts);
        this.stepMovement(p, dt, trace, cmd?.kind === "move" ? cmd.targetZone : undefined);
        // A stationary player aims at its hold zone (aimZone → targetZone → default enemy choke),
        // so perception FOV + combat pre-aim reflect a held angle instead of a stale facing.
        if (!this.isMoving(p)) this.faceStationary(p, cmd, originOf);
      }

      // 3. abilities
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
        const spec = this.abilitiesCatalog[abilityId];
        if (!spec) { trace({ playerId: p.id, phase: "ability", abilityId, result: "noSpec" }, `ability:${p.id}:${abilityId}:noSpec`); continue; }
        // Where the effect lands. A thrown/placed ability (smoke, molly/area-denial, remote
        // recon, wall, slow) deploys at the commanded targetZone's centre when within the
        // catalog range; out of range it is rejected (no charge spent). Movement (dash) is
        // self-displacement, handled below, so it always originates at the caster. Flash/concuss
        // also honour targetZone (pop-flash: blind enemies near the target). ASSUMPTION
        // (manual-approx): caster→target is treated as unobstructed — no throw-arc/LoS check yet.
        const isMovement = spec.effectTypes.includes("movement");
        let origin = p.position;
        if (!isMovement && cmd.targetZone) {
          const tz = this.spatial.getZone(cmd.targetZone);
          if (tz) {
            const rangeUnits = spec.rangeUnits ?? Infinity;
            if (dist3(p.position, tz.position) > rangeUnits) {
              trace({ playerId: p.id, phase: "ability", abilityId, targetZone: cmd.targetZone, result: "outOfRange" }, `ability:${p.id}:${abilityId}:outOfRange`);
              continue;
            }
            origin = { ...tz.position };
          }
        }
        // flash/concuss (blind) and suppress (ability-silence) hit enemies in range + LoS of the
        // effect origin (the throw target when one was given, else the caster).
        const isFlash = spec.effectTypes.includes("flash") || spec.effectTypes.includes("concuss");
        const isSuppress = spec.effectTypes.includes("suppress");
        const affectedPlayerIds = isFlash || isSuppress ? this.flashTargets(state, p, spec.radiusUnits ?? 1500, origin) : undefined;
        abilityEngine.use(spec, {
          instanceId: `${p.id}:${abilityId}:${state.tick}`,
          abilityId, ownerId: p.id, teamId: p.teamId,
          origin, startedAtMs: state.elapsedMs,
        }, { affectedPlayerIds });
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
            p.zoneId = target.id;
            p.position = { ...target.position };
            p.path = [];
            p.pathIndex = 0;
            p.edgeProgressMs = 0;
            trace({ playerId: p.id, phase: "ability", abilityId, toZone: target.id, result: "displaced" });
          } else {
            trace({ playerId: p.id, phase: "ability", abilityId, targetZone: cmd.targetZone, result: "outOfRange" }, `ability:${p.id}:${abilityId}:outOfRange`);
          }
        }
      }
      abilityEngine.advance(state.elapsedMs);

      // 4. perception snapshot for engagement
      const sight = perception.perceive(this.toPerceptionWorld(state, abilityEngine));

      // 5. engagement detection (mutual or one-sided visibility → duel)
      this.resolveEngagements(state, sight, abilityEngine, engaged, events, this.cfg.traceCommands ? engagementTrace : null, castBusyUntil);

      // 5b. molly / area-denial damage to anyone standing in a denied zone. Dedupe zones so two
      // overlapping mollies in the same zone do not double-dip the per-tick damage.
      for (const z of new Set(denied)) {
        for (const p of state.players) {
          if (p.alive && p.zoneId === z) {
            p.health = Math.max(0, p.health - this.cfg.mollyDamagePerTick);
            if (p.health <= 0) {
              p.alive = false;
              push({ kind: "kill", tick: state.tick, elapsedMs: state.elapsedMs, actor: undefined, target: p.id, zoneId: z, detail: "molly" });
            }
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
        tracks.push({
          tick: state.tick, elapsedMs: state.elapsedMs,
          players: state.players.map((p) => ({ id: p.id, side: p.side, x: p.position.x, y: p.position.y, z: p.position.z, alive: p.alive })),
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
      perception: this.cfg.recordPerception
        ? ([
            { teamIdx: 0, side: "attack", intervalTicks: perceptionInterval, snapshots: perceptionSnaps.attack },
            { teamIdx: 1, side: "defense", intervalTicks: perceptionInterval, snapshots: perceptionSnaps.defense },
          ] satisfies PerceptionTrack[])
        : undefined,
      commandTrace: this.cfg.traceCommands ? commandTrace : undefined,
      engagementTrace: this.cfg.traceCommands ? engagementTrace : undefined,
    };
  }

  // ---- helpers ----

  private ensurePath(p: SimPlayer, targetZone: string, mode: "run" | "walk", hazardCosts?: ReadonlyMap<string, number>): void {
    p.moveMode = mode;
    // Keep the cached path while the goal is unchanged; the path is planned with the hazard costs
    // active when it was computed (a hazard appearing mid-route is not re-routed — the crosser
    // takes the damage, which is the intended passable-hazard behaviour).
    if (p.path[p.path.length - 1] === targetZone && p.pathIndex < p.path.length) return;
    const r = this.spatial.findPath(p.zoneId, targetZone, mode, { hazardCosts });
    if (r) {
      p.path = r.path;
      p.pathIndex = p.path[0] === p.zoneId ? 1 : 0;
      p.edgeProgressMs = 0;
    }
  }

  /** Passable-hazard pathfinding costs from active molly/area-denial (shrink as they expire). */
  private hazardCostMap(abilityEngine: AbilityEngine, nowMs: number): ReadonlyMap<string, number> {
    const m = new Map<string, number>();
    for (const h of activeAreaDenials(abilityEngine, nowMs)) {
      const exposureMs = Math.min(h.remainingMs, HAZARD_EXPOSURE_MS);
      const ticks = Math.ceil(exposureMs / this.cfg.tickMs);
      const cost = ticks * this.cfg.mollyDamagePerTick * HAZARD_MS_PER_HP;
      m.set(h.zoneId, Math.max(m.get(h.zoneId) ?? 0, cost)); // overlapping mollies: one hazard, max cost
    }
    return m;
  }

  /**
   * Enemies of `caster` blinded/suppressed by an effect centred at `center` (the caster, or a
   * thrown target point): alive, within `radiusUnits`, in the centre zone or with LoS to it.
   */
  private flashTargets(state: SimState, caster: SimPlayer, radiusUnits: number, center?: { x: number; y: number; z: number }): string[] {
    const centerPos = center ?? caster.position;
    const centerZone = this.spatial.nearestZone(centerPos).id;
    const out: string[] = [];
    for (const e of state.players) {
      if (!e.alive || e.teamId === caster.teamId) continue;
      if (dist3(centerPos, e.position) > radiusUnits) continue;
      if (e.zoneId === centerZone || this.spatial.hasLineOfSight(centerZone, e.zoneId)) out.push(e.id);
    }
    return out;
  }

  /**
   * Discrete zone-hop movement: a player occupies its current zone center until it has
   * spent the edge's traversal time, then hops to the next zone. This keeps players ON
   * real zones (never straight-lining across the map between distant centers), so
   * perception and engagement only use genuine zone sightlines. facing points at the next
   * zone while travelling.
   */
  private stepMovement(p: SimPlayer, dtMs: number, trace?: Tracer, targetZone?: string): void {
    if (p.pathIndex >= p.path.length) return;
    const fromZone = this.spatial.getZone(p.zoneId);
    const nextZone = this.spatial.getZone(p.path[p.pathIndex]);
    if (!nextZone || !fromZone) return;
    p.facing = { x: nextZone.position.x - fromZone.position.x, y: nextZone.position.y - fromZone.position.y };
    const speed = p.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC;
    const edgeMs = (dist3(fromZone.position, nextZone.position) / speed) * 1000;
    p.edgeProgressMs += dtMs;
    if (p.edgeProgressMs >= edgeMs) {
      const fromId = p.zoneId;
      p.zoneId = nextZone.id;
      p.position = { ...nextZone.position };
      p.pathIndex += 1;
      p.edgeProgressMs = 0;
      trace?.({ playerId: p.id, phase: "move", fromZone: fromId, toZone: nextZone.id, targetZone });
      if (p.pathIndex >= p.path.length) {
        trace?.({ playerId: p.id, phase: "arrived", toZone: p.zoneId, targetZone });
      }
    }
  }

  private isMoving(p: SimPlayer): boolean {
    return p.pathIndex < p.path.length;
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
    if (!hintZone || hintZone === p.zoneId) return;
    const z = this.spatial.getZone(hintZone);
    if (!z) return;
    const dx = z.position.x - p.position.x, dy = z.position.y - p.position.y;
    if (dx === 0 && dy === 0) return;
    p.facing = { x: dx, y: dy };
  }

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
  ): void {
    const alive = state.players.filter((p) => p.alive);
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
        const aSeesB = sight.players.get(a.id)?.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === b.id) ?? false;
        const bSeesA = sight.players.get(b.id)?.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === a.id) ?? false;
        if (!aSeesB && !bSeesA) continue;
        engaged.add(key);
        busy.add(a.id);
        busy.add(b.id);
        const seed = deriveSeed(this.cfg.seed, `${state.tick}:${key}`);
        const ca = this.toCombatant(a, abilityEngine, state, aSeesB, bSeesA, this.isMoving(b), castBusyUntil);
        const cb = this.toCombatant(b, abilityEngine, state, bSeesA, aSeesB, this.isMoving(a), castBusyUntil);
        const dm = dist3(a.position, b.position) / 100;
        events.push({ kind: "engage", tick: state.tick, elapsedMs: state.elapsedMs, actor: a.id, target: b.id, zoneId: a.zoneId });
        const r = resolveDuel({ a: ca, b: cb, distanceMeters: dm }, seed, { calibration: this.cfg.combatCalibration });
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
            attackerFlashedMs: abilityEngine.blindRemainingMs(atkP.id, state.elapsedMs),
            defenderFlashedMs: abilityEngine.blindRemainingMs(defP.id, state.elapsedMs),
            winnerSide,
          });
        }
      }
    }
  }

  private toCombatant(p: SimPlayer, abilityEngine: AbilityEngine, state: SimState, seesEnemy: boolean, enemySeesSelf: boolean, opponentMoving: boolean, castBusyUntil: ReadonlyMap<string, number>): Combatant {
    const weapon = this.weapons[p.weaponId];
    if (!weapon) throw new Error(`unknown weapon: ${p.weaponId}`);
    const stationary = !this.isMoving(p);
    // Mid-cast: weapon not out (within the ability windup) → no pre-aim and a reaction penalty.
    const casting = (castBusyUntil.get(p.id) ?? 0) > state.elapsedMs;
    const preAim = seesEnemy && !enemySeesSelf && stationary && !casting;
    // Peeker's advantage: a stationary holder reacts late to an enemy peeking into it, even on
    // mutual sight. One who did not see first keeps the full surprise delay. A caster caught mid-
    // windup reacts slower still (weapon-unready), bounded by the windup.
    const base = !seesEnemy ? SURPRISE_DELAY_MS : stationary && opponentMoving ? this.cfg.peekerAdvantageMs : 0;
    const seesEnemyAtMs = base + (casting ? CAST_WINDUP_PENALTY_MS : 0);
    return {
      id: p.id, teamId: p.teamId, health: p.health, armor: p.armor, weapon, skills: p.skills,
      posture: {
        ...OPEN_POSTURE,
        preAim,
        moving: this.isMoving(p),
        seesEnemyAtMs,
        flashBlindMs: abilityEngine.blindRemainingMs(p.id, state.elapsedMs),
        behindCover: 0,
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
          : s.phase === "planting" ? "planting" : "started";
        trace({ playerId: p.id, phase: "plant", fromZone: p.zoneId, result }, `plant:${p.id}:${result}:${p.zoneId}`);
      } else if (c?.kind === "defuse") {
        const result = !p.alive ? "dead"
          : !(s.phase === "planted" || s.phase === "defusing") ? "notPlanted"
          : p.zoneId !== s.zoneId ? "notOnSpikeZone"
          : s.phase === "defusing" ? "defusing" : "started";
        trace({ playerId: p.id, phase: "defuse", fromZone: p.zoneId, result }, `defuse:${p.id}:${result}:${p.zoneId}`);
      }
    }
    if (s.phase === "detonated" || s.phase === "defused") return;

    // plant
    if (s.phase === "carried" || s.phase === "planting") {
      const carrier = s.carrierId ? state.players.find((p) => p.id === s.carrierId && p.alive) : null;
      const planting = carrier && readyCommand(commands.get(carrier.id), state.elapsedMs)?.kind === "plant" && this.spatial.isPlantableZone(carrier.zoneId);
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
      const defuser = state.players.find((p) => p.alive && p.side === "defense" && p.zoneId === s.zoneId && readyCommand(commands.get(p.id), state.elapsedMs)?.kind === "defuse");
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
