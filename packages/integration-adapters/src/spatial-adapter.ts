/**
 * SpatialQuery adapter over PV-4's spatial-engine.
 *
 * MIRROR SOURCE: origin/claude/pv-spatial @ e3ad1c541e4c5834a2cd4e438199a3ad9557a927
 *   packages/spatial-engine/src/{engine.ts,coordinate.ts,types.ts}
 * At merge, replace `SpatialEngineLike` with `import { SpatialEngine } from "@pv/spatial-engine"`.
 *
 * ⚠️ COORDINATE RESULT (phase-5 rehearsal, docs/INTEGRATION_REHEARSAL.md): the default
 * `minimapScale`=1000 assumption is **WRONG**. PV-2 minimapUnits are the **VLR 2D-replay
 * minimap PIXEL frame** (observed x≈170..825 in scenarios, PV-4 vlr range x≈92..973,
 * y≈117..844), NOT normalized×1000. Feeding minimapUnits/1000 into PV-4's valorant-api
 * transform put all attacker-spawn players in `b-main` in the rehearsal. The correct path
 * is PV-6's verified vlr-pixel↔game transform (3001 samples, inclusion 1.0). Therefore this
 * adapter now takes an injectable `minimapToGame` (supply PV-6/PV-4's `fromPv2Scenario`
 * transform at integration); the scale/flip path remains only as a labelled fallback.
 */
import {
  asZoneId,
  type AudibleZoneResult,
  type LineOfSightOptions,
  type SpatialQuery,
  type TravelMode,
  type Vector2,
  type ZoneId,
  type ZoneMeta,
  type ZonePath,
  type ZoneType,
} from "@pv/shared-types";

// ---- structural mirror of spatial-engine ----
interface Vec2Like { readonly x: number; readonly y: number }
interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }
interface ZoneLike {
  readonly id: string;
  readonly zoneType: string;
  readonly site?: string | null;
  readonly plantable: boolean;
  readonly position: Vec3Like;
  readonly callout?: string;
}
interface PathResultLike { readonly path: readonly string[]; readonly timeMs: number; readonly distanceMeters: number }
export interface MapCoordinateSystemLike {
  toGame(minimap: Vec2Like): Vec2Like;
  toMinimap(game: Vec2Like | Vec3Like): Vec2Like;
}
export interface SpatialEngineLike {
  readonly mapId: string;
  readonly coords: MapCoordinateSystemLike;
  readonly zones: readonly ZoneLike[];
  getZone(id: string): ZoneLike | undefined;
  zonesByType(type: string): readonly ZoneLike[];
  nearestZone(position: Vec3Like): ZoneLike;
  findPath(from: string, to: string, mode?: string, opts?: unknown): PathResultLike | null;
  shortestTravelTimeMs(from: string, to: string, mode?: string, opts?: unknown): number | null;
  isReachable(from: string, to: string, opts?: unknown): boolean;
  hasLineOfSight(a: string, b: string, opts?: { smokedPairs?: Array<[string, string]> }): boolean;
  visibleZonesFrom(id: string): readonly string[];
  isPlantableZone(id: string): boolean;
  audibleZones(origin: string, threshold?: number): ReadonlyArray<{ zoneId: string; strength: number }>;
}

export interface SpatialAdapterOptions {
  /**
   * CORRECT path: the verified PV-2 minimapUnits → game-world transform (PV-6's vlr-pixel↔
   * game, 3001 samples). Supply this at integration (e.g. round-simulator's fromPv2Scenario
   * conversion). When set, it overrides the scale/flip fallback.
   */
  readonly minimapToGame?: (mu: Vector2) => Vec2Like;
  /** FALLBACK ONLY (known-wrong for the VLR frame): minimapUnits per 1.0 normalized. */
  readonly minimapScale?: number;
  readonly flipY?: boolean;
}

/** Converts PV-2/PV-3 minimapUnits ↔ PV-4 game-world units, via the engine's transform. */
export class MinimapUnitsConverter {
  private readonly scale: number;
  private readonly flipY: boolean;
  private readonly inject?: (mu: Vector2) => Vec2Like;
  constructor(private readonly coords: MapCoordinateSystemLike, opts: SpatialAdapterOptions = {}) {
    this.scale = opts.minimapScale ?? 1000;
    this.flipY = opts.flipY ?? false;
    this.inject = opts.minimapToGame;
  }
  /** minimapUnits → game-world Vec2 (uu). Uses the injected transform when provided. */
  toGame(mu: Vector2): Vec2Like {
    if (this.inject) return this.inject(mu);
    const norm = { x: mu.x / this.scale, y: (this.flipY ? this.scale - mu.y : mu.y) / this.scale };
    return this.coords.toGame(norm);
  }
  /** game-world (uu) → minimapUnits (~0..scale). */
  fromGame(game: Vec2Like | Vec3Like): Vector2 {
    const norm = this.coords.toMinimap(game);
    const y = this.flipY ? 1 - norm.y : norm.y;
    return { x: norm.x * this.scale, y: y * this.scale };
  }
}

function toMeta(z: ZoneLike): ZoneMeta {
  return {
    id: asZoneId(z.id),
    zoneType: z.zoneType as ZoneType,
    site: z.site ?? null,
    plantable: z.plantable,
    ...(z.callout !== undefined ? { callout: z.callout } : {}),
  };
}

/** Wrap a spatial-engine (structural) as PROJECT V's SpatialQuery. */
export function spatialQueryFromEngine(engine: SpatialEngineLike, opts: SpatialAdapterOptions = {}): SpatialQuery {
  const conv = new MinimapUnitsConverter(engine.coords, opts);
  const toPath = (r: PathResultLike | null, mode: TravelMode): ZonePath | null =>
    r ? { path: r.path.map(asZoneId), timeMs: r.timeMs, distanceMeters: r.distanceMeters, mode } : null;

  return {
    mapId: engine.mapId,
    nearestZone: (position: Vector2): ZoneId => {
      const g = conv.toGame(position);
      return asZoneId(engine.nearestZone({ x: g.x, y: g.y, z: 0 }).id);
    },
    getZoneMeta: (zoneId: ZoneId) => {
      const z = engine.getZone(String(zoneId));
      return z ? toMeta(z) : undefined;
    },
    allZones: () => engine.zones.map((z) => asZoneId(z.id)),
    zonesByType: (type: ZoneType) => engine.zonesByType(type).map((z) => asZoneId(z.id)),
    findPath: (from, to, mode: TravelMode = "run") => toPath(engine.findPath(String(from), String(to), mode), mode),
    shortestTravelTimeMs: (from, to, mode: TravelMode = "run") => engine.shortestTravelTimeMs(String(from), String(to), mode),
    isReachable: (from, to) => engine.isReachable(String(from), String(to)),
    hasLineOfSight: (a, b, los?: LineOfSightOptions) =>
      engine.hasLineOfSight(String(a), String(b), los?.smokedPairs ? { smokedPairs: los.smokedPairs.map(([x, y]) => [String(x), String(y)] as [string, string]) } : undefined),
    visibleZonesFrom: (zoneId) => engine.visibleZonesFrom(String(zoneId)).map(asZoneId),
    isPlantableZone: (zoneId) => engine.isPlantableZone(String(zoneId)),
    audibleZones: (origin, threshold): readonly AudibleZoneResult[] =>
      engine.audibleZones(String(origin), threshold).map((a) => ({ zoneId: asZoneId(a.zoneId), strength: a.strength })),
  };
}
