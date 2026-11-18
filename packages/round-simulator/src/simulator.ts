import type { SpatialEngine } from "@project-v/spatial-engine";
import {
  PerceptionEngine,
  type PlayerState as PPlayerState,
  type WorldState as PWorldState,
} from "@project-v/perception-engine";
import {
  resolveDuel,
  OPEN_POSTURE,
  type Combatant,
  type WeaponSpec,
} from "@project-v/combat-engine";
import { AbilityEngine, type AbilityCatalog, checkAvailability } from "@project-v/ability-engine";
import type {
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
import type { ActionCommand, DecisionPolicy } from "./policy-contract.js";
import { buildPolicyView, SeededRandomSource } from "./view.js";
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

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
    const perception = new PerceptionEngine(this.spatial);
    const abilityEngine = new AbilityEngine(this.spatial);
    const events: SimEvent[] = [];
    const tracks: TrackFrame[] = [];
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
        for (const side of ["attack", "defense"] as const) {
          const view = buildPolicyView(side, state, perception);
          const decision = this.policies[side].decide(view, rngOf[side]);
          for (const c of decision.commands) commands.set(c.playerId, c);
        }
      }

      // 2. movement
      for (const p of state.players) {
        if (!p.alive) continue;
        const cmd = commands.get(p.id);
        if (cmd?.kind === "move" && cmd.targetZone) this.ensurePath(p, cmd.targetZone, cmd.moveMode ?? "run");
        this.stepMovement(p, dt);
      }

      // 3. abilities
      for (const p of state.players) {
        if (!p.alive) continue;
        const cmd = commands.get(p.id);
        if (cmd?.kind !== "useAbility" || !cmd.abilityId) continue;
        const abilityId = cmd.abilityId;
        const slot = p.abilities.find((a) => a.abilityId === abilityId);
        if (!slot) continue;
        const avail = checkAvailability(this.abilitiesCatalog, slot, state.elapsedMs, { points: p.ultimatePoints, required: p.ultimateCost });
        if (!avail.usable) continue;
        const spec = this.abilitiesCatalog[abilityId];
        if (!spec) continue;
        abilityEngine.use(spec, {
          instanceId: `${p.id}:${abilityId}:${state.tick}`,
          abilityId, ownerId: p.id, teamId: p.teamId,
          origin: p.position, startedAtMs: state.elapsedMs,
        });
        slot.chargesRemaining -= 1;
        slot.lastUsedAtMs = state.elapsedMs;
        push({ kind: "abilityUsed", tick: state.tick, elapsedMs: state.elapsedMs, actor: p.id, detail: abilityId });
      }
      abilityEngine.advance(state.elapsedMs);

      // 4. perception snapshot for engagement
      const sight = perception.perceive(this.toPerceptionWorld(state));

      // 5. engagement detection (mutual or one-sided visibility → duel)
      this.resolveEngagements(state, sight, abilityEngine, engaged, events);

      // 6. spike progression
      this.stepSpike(state, commands, dt, events);

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
      tracks: this.cfg.recordTracks ? tracks : undefined,
    };
  }

  // ---- helpers ----

  private ensurePath(p: SimPlayer, targetZone: string, mode: "run" | "walk"): void {
    p.moveMode = mode;
    if (p.path[p.path.length - 1] === targetZone && p.pathIndex < p.path.length) return;
    const r = this.spatial.findPath(p.zoneId, targetZone, mode);
    if (r) {
      p.path = r.path;
      p.pathIndex = p.path[0] === p.zoneId ? 1 : 0;
      p.edgeProgressMs = 0;
    }
  }

  /**
   * Discrete zone-hop movement: a player occupies its current zone center until it has
   * spent the edge's traversal time, then hops to the next zone. This keeps players ON
   * real zones (never straight-lining across the map between distant centers), so
   * perception and engagement only use genuine zone sightlines. facing points at the next
   * zone while travelling.
   */
  private stepMovement(p: SimPlayer, dtMs: number): void {
    if (p.pathIndex >= p.path.length) return;
    const fromZone = this.spatial.getZone(p.zoneId);
    const nextZone = this.spatial.getZone(p.path[p.pathIndex]);
    if (!nextZone || !fromZone) return;
    p.facing = { x: nextZone.position.x - fromZone.position.x, y: nextZone.position.y - fromZone.position.y };
    const speed = p.moveMode === "run" ? RUN_UNITS_PER_SEC : WALK_UNITS_PER_SEC;
    const edgeMs = (dist3(fromZone.position, nextZone.position) / speed) * 1000;
    p.edgeProgressMs += dtMs;
    if (p.edgeProgressMs >= edgeMs) {
      p.zoneId = nextZone.id;
      p.position = { ...nextZone.position };
      p.pathIndex += 1;
      p.edgeProgressMs = 0;
    }
  }

  private isMoving(p: SimPlayer): boolean {
    return p.pathIndex < p.path.length;
  }

  private resolveEngagements(
    state: SimState,
    sight: ReturnType<PerceptionEngine["perceive"]>,
    abilityEngine: AbilityEngine,
    engaged: Set<string>,
    events: SimEvent[],
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
        const ca = this.toCombatant(a, abilityEngine, state, aSeesB, bSeesA);
        const cb = this.toCombatant(b, abilityEngine, state, bSeesA, aSeesB);
        const dm = dist3(a.position, b.position) / 100;
        events.push({ kind: "engage", tick: state.tick, elapsedMs: state.elapsedMs, actor: a.id, target: b.id, zoneId: a.zoneId });
        const r = resolveDuel({ a: ca, b: cb, distanceMeters: dm }, seed);
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
      }
    }
  }

  private toCombatant(p: SimPlayer, abilityEngine: AbilityEngine, state: SimState, seesEnemy: boolean, enemySeesSelf: boolean): Combatant {
    const weapon = this.weapons[p.weaponId];
    if (!weapon) throw new Error(`unknown weapon: ${p.weaponId}`);
    const preAim = seesEnemy && !enemySeesSelf && !this.isMoving(p);
    return {
      id: p.id, teamId: p.teamId, health: p.health, armor: p.armor, weapon, skills: p.skills,
      posture: {
        ...OPEN_POSTURE,
        preAim,
        moving: this.isMoving(p),
        seesEnemyAtMs: seesEnemy ? 0 : SURPRISE_DELAY_MS,
        flashBlindMs: abilityEngine.blindRemainingMs(p.id, state.elapsedMs),
        behindCover: 0,
      },
    };
  }

  private stepSpike(state: SimState, commands: Map<string, ActionCommand>, dtMs: number, events: SimEvent[]): void {
    const s = state.spike;
    if (s.phase === "detonated" || s.phase === "defused") return;

    // plant
    if (s.phase === "carried" || s.phase === "planting") {
      const carrier = s.carrierId ? state.players.find((p) => p.id === s.carrierId && p.alive) : null;
      const planting = carrier && commands.get(carrier.id)?.kind === "plant" && this.spatial.isPlantableZone(carrier.zoneId);
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
      const defuser = state.players.find((p) => p.alive && p.side === "defense" && p.zoneId === s.zoneId && commands.get(p.id)?.kind === "defuse");
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

  private toPerceptionWorld(state: SimState): PWorldState {
    const players: PPlayerState[] = state.players.map((p) => ({
      id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
      position: p.position, velocity: { x: 0, y: 0, z: 0 }, facing: p.facing,
      health: p.health, armor: p.armor, alive: p.alive, weapon: null,
      behaviorState: this.isMoving(p) ? (p.moveMode === "run" ? "running" : "walking") : "still",
    }));
    return {
      matchId: state.matchId, roundId: state.roundId, roundNumber: 1, tick: state.tick,
      timeRemainingMs: state.timeRemainingMs, mapId: state.mapId, patchVersion: "synthetic",
      players, spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
      activeAbilities: [], events: [],
    };
  }
}
