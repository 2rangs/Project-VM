import type { SpatialEngine } from "@pv/spatial-engine";
import type {
  AbilityState,
  HealthBand,
  ObservedEnemy,
  PlayerState,
  SoundObservation,
  WorldState,
} from "./shared-mirror.js";
import { DEFAULT_PARAMS, type PerceptionParams } from "./params.js";
import { canSee, type VisionContext } from "./vision.js";
import { collectSoundSources, hearSounds } from "./hearing.js";

/**
 * Pluggable perception interface PV-3 (world-state package) consumes. This mirrors
 * `@pv/shared-types` `VisibilityOracle` so a `SpatialPerceptionOracle` can be passed
 * straight into PV-3's `observeWorld(world, observerId, { oracle })`.
 */
export interface VisibilityOracle {
  canSee(observer: PlayerState, target: PlayerState, world: WorldState): boolean;
  hearableSounds?(observer: PlayerState, world: WorldState): readonly SoundObservation[];
}

/** Coarse, perceivable band — never the exact HP of an unobserved enemy (mirror of PV-3). */
export function healthBand(health: number): HealthBand {
  if (health <= 0) return "unknown";
  if (health >= 100) return "full";
  if (health >= 50) return "hurt";
  return "low";
}

/** Build the ObservedEnemy a currently-visible target yields (last-seen = now). */
export function observedEnemyFromVisible(target: PlayerState, atMs: number): ObservedEnemy {
  return {
    playerId: target.id,
    agentId: target.agentId,
    lastSeenPosition: target.position,
    lastSeenAtMs: atMs,
    healthBand: healthBand(target.health),
    observedWeaponId: target.weapon?.weaponId ?? null,
    currentlyVisible: true,
  };
}

export interface OracleOptions {
  readonly params?: PerceptionParams;
  /** Classifies an active ability as a vision-blocking smoke. Default: id contains "smoke". */
  readonly isSmoke?: (a: AbilityState) => boolean;
}

export class SpatialPerceptionOracle implements VisibilityOracle {
  private readonly spatial: SpatialEngine;
  private readonly params: PerceptionParams;
  private readonly isSmoke: (a: AbilityState) => boolean;
  private readonly smokeCache = new WeakMap<object, ReadonlyArray<readonly [string, string]>>();

  constructor(spatial: SpatialEngine, opts: OracleOptions = {}) {
    this.spatial = spatial;
    this.params = opts.params ?? DEFAULT_PARAMS;
    this.isSmoke = opts.isSmoke ?? ((a) => a.abilityId.toLowerCase().includes("smoke"));
  }

  /** Zone-id pairs blocked by active smokes (incident smokeable sightlines). Cached per world. */
  private smokedPairs(world: WorldState): ReadonlyArray<readonly [string, string]> {
    const cached = this.smokeCache.get(world);
    if (cached) return cached;
    const pairs: Array<readonly [string, string]> = [];
    for (const ab of world.activeAbilities) {
      if (!this.isSmoke(ab)) continue;
      const zone = this.spatial.nearestZone(ab.origin).id;
      for (const n of this.spatial.visibleZonesFrom(zone)) pairs.push([zone, n]);
    }
    this.smokeCache.set(world, pairs);
    return pairs;
  }

  private visionContext(world: WorldState): VisionContext {
    return { spatial: this.spatial, params: this.params, smokedPairs: this.smokedPairs(world) };
  }

  canSee(observer: PlayerState, target: PlayerState, world: WorldState): boolean {
    return canSee(observer, target, this.visionContext(world));
  }

  hearableSounds(observer: PlayerState, world: WorldState): readonly SoundObservation[] {
    const sources = collectSoundSources(world, this.params);
    return hearSounds(observer.position, sources, this.spatial, this.params, world.timeRemainingMs);
  }
}
