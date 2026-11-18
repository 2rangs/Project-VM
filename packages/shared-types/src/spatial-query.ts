/**
 * SpatialQuery — the dependency-inversion seam onto the Spatial Engine (PV-4).
 *
 * PROJECT V is built by several agents on separate branches that are NOT merged until
 * the end. To use PV-4's `packages/spatial-engine` without importing it, the decision
 * packages depend only on THIS interface. In tests a small Ascent stub implements it
 * (see each package's `test/fixtures`); at final integration a thin adapter wraps the
 * real `SpatialEngine` (whose methods — findPath, shortestTravelTimeMs, isReachable,
 * hasLineOfSight, visibleZonesFrom, isPlantableZone, audibleZones, nearestZone — this
 * interface mirrors).
 *
 * Coordinate frame: positions are **minimapUnits** (`Vector2`), the frame PV-2's
 * DecisionContext scenarios use (origin top-left, x right, y down, ~0..1000). The real
 * adapter converts minimap↔game-world via the engine's CoordinateTransform before
 * delegating; the stub works directly in minimapUnits. Travel times are milliseconds.
 */
import type { Vector2 } from "./vector.js";

/** Zone identifier (e.g. "a-site", "a-main", "mid-courtyard"). Branded to avoid mixups. */
declare const zoneBrand: unique symbol;
export type ZoneId = string & { readonly [zoneBrand]: "ZoneId" };
export const asZoneId = (v: string): ZoneId => v as ZoneId;

/** Zone categories, mirroring the spatial-engine's authored zone types. */
export type ZoneType =
  | "site"
  | "main"
  | "lobby"
  | "mid"
  | "link"
  | "spawn"
  | "connector"
  | "position";

export type TravelMode = "run" | "walk";

export interface ZoneMeta {
  readonly id: ZoneId;
  readonly zoneType: ZoneType;
  /** Site letter for site/plant zones ("A"/"B"/...), else null. */
  readonly site: string | null;
  readonly plantable: boolean;
  readonly callout?: string;
}

export interface ZonePath {
  readonly path: readonly ZoneId[]; // inclusive of start and goal
  readonly timeMs: number;
  readonly distanceMeters: number;
  readonly mode: TravelMode;
}

export interface AudibleZoneResult {
  readonly zoneId: ZoneId;
  readonly strength: number; // 0..1 remaining signal when sound reaches the zone
}

export interface LineOfSightOptions {
  /** Zone pairs currently blocked by smoke; a smokeable sightline through one is cut. */
  readonly smokedPairs?: ReadonlyArray<readonly [ZoneId, ZoneId]>;
}

/**
 * Read-only spatial queries the decision layer needs. All methods are pure w.r.t. the
 * map; none expose or require ground-truth player state.
 */
export interface SpatialQuery {
  readonly mapId: string;

  /** Nearest zone center to a minimapUnits position. */
  nearestZone(position: Vector2): ZoneId;

  getZoneMeta(zoneId: ZoneId): ZoneMeta | undefined;
  allZones(): readonly ZoneId[];
  zonesByType(type: ZoneType): readonly ZoneId[];

  findPath(from: ZoneId, to: ZoneId, mode?: TravelMode): ZonePath | null;
  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode?: TravelMode): number | null;
  isReachable(from: ZoneId, to: ZoneId): boolean;

  hasLineOfSight(a: ZoneId, b: ZoneId, opts?: LineOfSightOptions): boolean;
  visibleZonesFrom(zoneId: ZoneId): readonly ZoneId[];

  isPlantableZone(zoneId: ZoneId): boolean;

  audibleZones(originZone: ZoneId, threshold?: number): readonly AudibleZoneResult[];
}
