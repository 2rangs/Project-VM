import type { SpatialEngine } from "@pv/spatial-engine";
import type { ObservedEnemy, PlayerId, PlayerState, TeamId, TeamReport, WorldState } from "./shared-mirror.js";
import { DEFAULT_PARAMS, type PerceptionParams } from "./params.js";
import { SpatialPerceptionOracle, observedEnemyFromVisible, type OracleOptions } from "./oracle.js";
import { EnemyMemory } from "./memory.js";
import { CommunicationHub, type PlayerSightingInput } from "./communication.js";
import type { PlayerObservation, TeamObservation } from "./types.js";
import type { Rng } from "./rng.js";

export interface PerceptionResult {
  readonly players: ReadonlyMap<PlayerId, PlayerObservation>;
  readonly teams: ReadonlyMap<TeamId, TeamObservation>;
}

export interface PerceptionEngineOptions extends OracleOptions {
  /** Seeded RNG, required only if params.vision.detectionMissProbability > 0. */
  readonly rng?: Rng;
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Stateful perception layer. Driven once per world tick via {@link perceive}. Holds
 * per-observer memory and per-team communication state across ticks.
 *
 * The ONLY outputs are {@link PlayerObservation} / {@link TeamObservation}; the full
 * {@link WorldState} is never returned or embedded. That boundary is enforced by the
 * return types (they have no `players`/`events`/live-position fields) — omniscient play
 * is unrepresentable, not merely discouraged (DECISION-004, README §29).
 */
export class PerceptionEngine {
  private readonly oracle: SpatialPerceptionOracle;
  private readonly params: PerceptionParams;
  private readonly rng?: Rng;
  private readonly memory = new Map<PlayerId, EnemyMemory>();
  private readonly comms = new Map<TeamId, CommunicationHub>();

  constructor(spatial: SpatialEngine, opts: PerceptionEngineOptions = {}) {
    this.params = opts.params ?? DEFAULT_PARAMS;
    this.rng = opts.rng;
    this.oracle = new SpatialPerceptionOracle(spatial, opts);
    if (this.params.vision.detectionMissProbability > 0 && !this.rng) {
      throw new Error("PerceptionEngine: detectionMissProbability > 0 requires a seeded rng");
    }
  }

  /** The oracle this engine uses, ready to hand to PV-3's `observeWorld(world, id, { oracle })`. */
  get visibilityOracle(): SpatialPerceptionOracle {
    return this.oracle;
  }

  private memoryOf(id: PlayerId): EnemyMemory {
    let m = this.memory.get(id);
    if (!m) {
      m = new EnemyMemory(this.params);
      this.memory.set(id, m);
    }
    return m;
  }

  private commsOf(teamId: TeamId): CommunicationHub {
    let c = this.comms.get(teamId);
    if (!c) {
      c = new CommunicationHub(this.params);
      this.comms.set(teamId, c);
    }
    return c;
  }

  /** Enemies `observer` currently sees this tick (after optional probabilistic miss). */
  private currentlyVisible(observer: PlayerState, world: WorldState, now: number): ObservedEnemy[] {
    const out: ObservedEnemy[] = [];
    const { detectionMissProbability, uncertainBeyondFraction, maxViewDistanceUnits } = this.params.vision;
    const uncertainBeyond = uncertainBeyondFraction * maxViewDistanceUnits;
    for (const target of world.players) {
      if (target.teamId === observer.teamId) continue;
      if (!this.oracle.canSee(observer, target, world)) continue;
      if (detectionMissProbability > 0 && this.rng) {
        const d = dist3(observer.position, target.position);
        if (d > uncertainBeyond && this.rng() < detectionMissProbability) continue; // missed
      }
      out.push(observedEnemyFromVisible(target, now));
    }
    return out;
  }

  /** Run perception for every player and team for the given world tick. */
  perceive(world: WorldState): PerceptionResult {
    const now = world.timeRemainingMs;
    const aliveIds = new Set<PlayerId>(world.players.filter((p) => p.alive).map((p) => p.id));

    // Pass 1: raw sightings + memory-merged pictures + audible events, per alive observer.
    const rawVisible = new Map<PlayerId, ObservedEnemy[]>();
    const merged = new Map<PlayerId, ObservedEnemy[]>();
    const audible = new Map<PlayerId, ReturnType<SpatialPerceptionOracle["hearableSounds"]>>();
    const byTeam = new Map<TeamId, PlayerState[]>();

    for (const observer of world.players) {
      const team = byTeam.get(observer.teamId) ?? [];
      team.push(observer);
      byTeam.set(observer.teamId, team);
      if (!observer.alive) continue;
      const vis = this.currentlyVisible(observer, world, now);
      rawVisible.set(observer.id, vis);
      merged.set(observer.id, this.memoryOf(observer.id).updateAndCollect(vis, now));
      audible.set(observer.id, this.oracle.hearableSounds(observer, world));
    }

    // Pass 2: per-team communication (delayed reports).
    const teamReports = new Map<TeamId, TeamReport[]>();
    for (const [teamId, members] of byTeam) {
      const sightings: PlayerSightingInput[] = members.map((m) => ({
        observerId: m.id,
        alive: m.alive,
        visibleEnemies: rawVisible.get(m.id) ?? [],
      }));
      teamReports.set(teamId, this.commsOf(teamId).step(sightings, now, aliveIds));
    }

    // Pass 3: assemble per-player observations.
    const players = new Map<PlayerId, PlayerObservation>();
    for (const observer of world.players) {
      if (!observer.alive) continue;
      const reports = (teamReports.get(observer.teamId) ?? []).filter((r) => r.fromPlayerId !== observer.id);
      players.set(observer.id, {
        observerId: observer.id,
        teamId: observer.teamId,
        timestampMs: now,
        visibleEnemies: merged.get(observer.id) ?? [],
        audibleEvents: audible.get(observer.id) ?? [],
        teammateReports: reports,
        knownMapChanges: [],
      });
    }

    // Pass 4: team observations.
    const teams = new Map<TeamId, TeamObservation>();
    for (const [teamId, members] of byTeam) {
      const perPlayer: Record<PlayerId, PlayerObservation> = {};
      const pictures: ObservedEnemy[] = [];
      for (const m of members) {
        const obs = players.get(m.id);
        if (obs) {
          perPlayer[m.id] = obs;
          pictures.push(...obs.visibleEnemies);
        }
      }
      teams.set(teamId, {
        teamId,
        timestampMs: now,
        perPlayer,
        sharedReports: teamReports.get(teamId) ?? [],
        teamEnemyPicture: dedupePicture(pictures),
      });
    }

    return { players, teams };
  }

  /** Convenience: run perception and return just one player's observation (or null if dead/absent). */
  observe(world: WorldState, observerId: PlayerId): PlayerObservation | null {
    return this.perceive(world).players.get(observerId) ?? null;
  }
}

/** Keep the freshest entry per enemy: currently-visible wins, else the most recent sighting. */
function dedupePicture(all: readonly ObservedEnemy[]): ObservedEnemy[] {
  const best = new Map<PlayerId, ObservedEnemy>();
  for (const e of all) {
    const prev = best.get(e.playerId);
    if (!prev) {
      best.set(e.playerId, e);
      continue;
    }
    if (e.currentlyVisible && !prev.currentlyVisible) {
      best.set(e.playerId, e);
    } else if (e.currentlyVisible === prev.currentlyVisible && e.lastSeenAtMs < prev.lastSeenAtMs) {
      // smaller remaining-at-sighting == more recent (round clock counts down)
      best.set(e.playerId, e);
    }
  }
  return [...best.values()];
}
