/**
 * SpatialQuery adapter over PV-4's spatial-engine.
 *
 * MIRROR SOURCE: origin/claude/pv-spatial @ e3ad1c541e4c5834a2cd4e438199a3ad9557a927
 *   packages/spatial-engine/src/{engine.ts,coordinate.ts,types.ts}
 * At merge, replace `SpatialEngineLike` with `import { SpatialEngine } from "@pv/spatial-engine"`.
 *
 * ⚠️ COORDINATE NORMALIZATION RISK (see docs/INTEGRATION_PLAN.md §Normalization):
 * PV-3/PV-2 positions are **minimapUnits ~0..1000** (scenario frame). PV-4's
 * MapCoordinateSystem maps game-world uu ↔ **normalized minimap [0,1]** (axis-swapped:
 * minimapX uses gameY). This adapter assumes minimapUnits = normalized × `minimapScale`
 * (default 1000) with the same orientation. That assumption MUST be verified against PV-2's
 * actual scenario frame at integration; `minimapScale`/`flipY` are exposed to correct it.
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
  /** minimapUnits per 1.0 of normalized minimap space. Default 1000. */
  readonly minimapScale?: number;
  /** Flip the minimap Y axis if PV-2's frame is inverted relative to PV-4's. */
  readonly flipY?: boolean;
}

/** Converts PV-2/PV-3 minimapUnits ↔ PV-4 game-world units, via the engine's transform. */
export class MinimapUnitsConverter {
  private readonly scale: number;
  private readonly flipY: boolean;
  constructor(private readonly coords: MapCoordinateSystemLike, opts: SpatialAdapterOptions = {}) {
    this.scale = opts.minimapScale ?? 1000;
    this.flipY = opts.flipY ?? false;
  }
  /** minimapUnits (~0..scale) → game-world Vec2 (uu). */
  toGame(mu: Vector2): Vec2Like {
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
