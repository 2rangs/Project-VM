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
import { canSee, type SightOccluder, type VisionContext } from "./vision.js";
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
  /**
   * Smokes block sight as a VOLUME (a sphere of the ability's radius at its landing point,
   * vision.ts SightOccluder) instead of by the zone rule. Default false (legacy zone rule).
   */
  readonly smokeVolumes?: boolean;
  /** Smoke radius (uu) when an active smoke carries none (manual-approx; catalog smokes are 3.35–4.1 m). */
  readonly defaultSmokeRadiusUnits?: number;
}

/** Fallback smoke radius (uu, ≈4 m) — only for a smoke whose catalog record has no radius. */
export const DEFAULT_SMOKE_RADIUS_UNITS = 400;

export class SpatialPerceptionOracle implements VisibilityOracle {
  private readonly spatial: SpatialEngine;
  private readonly params: PerceptionParams;
  private readonly isSmoke: (a: AbilityState) => boolean;
  private readonly smokeCache = new WeakMap<object, ReadonlyArray<readonly [string, string]>>();
  private readonly volumeCache = new WeakMap<object, readonly SightOccluder[]>();
  private readonly smokeVolumes: boolean;
  private readonly defaultSmokeRadius: number;

  constructor(spatial: SpatialEngine, opts: OracleOptions = {}) {
    this.spatial = spatial;
    this.params = opts.params ?? DEFAULT_PARAMS;
    this.isSmoke = opts.isSmoke ?? ((a) => a.abilityId.toLowerCase().includes("smoke"));
    this.smokeVolumes = opts.smokeVolumes ?? false;
    this.defaultSmokeRadius = opts.defaultSmokeRadiusUnits ?? DEFAULT_SMOKE_RADIUS_UNITS;
  }

  /** Active smokes as volumes (cached per world). */
  occluders(world: WorldState): readonly SightOccluder[] {
    const cached = this.volumeCache.get(world);
    if (cached) return cached;
    const out: SightOccluder[] = [];
    for (const ab of world.activeAbilities) {
      if (!this.isSmoke(ab)) continue;
      out.push({ center: ab.origin, radius: ab.radiusUnits && ab.radiusUnits > 0 ? ab.radiusUnits : this.defaultSmokeRadius });
    }
    this.volumeCache.set(world, out);
    return out;
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
    if (this.smokeVolumes) return { spatial: this.spatial, params: this.params, smokedPairs: [], occluders: this.occluders(world) };
    return { spatial: this.spatial, params: this.params, smokedPairs: this.smokedPairs(world) };
  }

  canSee(observer: PlayerState, target: PlayerState, world: WorldState): boolean {
    return canSee(observer, target, this.visionContext(world));
  }

  hearableSounds(observer: PlayerState, world: WorldState): readonly SoundObservation[] {
    const sources = collectSoundSources(world, this.params);
    return hearSounds(observer.position, sources, this.spatial, this.params, world.timeRemainingMs, observer.teamId, world.maskers);
  }
}
