// PROJECT V — spatial-engine local types.
//
// NOTE: These types are defined locally to keep this package standalone.
// They are candidates to move into `packages/shared-types` once the monorepo
// (owned by PV-3) is assembled. Do not add a cross-package import until then.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ZoneType =
  | "site"
  | "main"
  | "lobby"
  | "mid"
  | "link"
  | "spawn"
  | "connector"
  | "position";

export interface DoorInfo {
  name: string;
  defaultOpen: boolean;
  destructibleSwitch: boolean;
}

export interface Zone {
  id: string;
  name: string;
  callout: string;
  superRegion: string;
  zoneType: ZoneType;
  plantable: boolean;
  position: Vec3;
  /**
   * A walkable standing point for the zone (game uu, z = floor), measured on the map
   * geometry: where a player in this zone is DRAWN, and where every edge route that
   * touches the zone starts/ends. `position` stays the callout and remains the zone's
   * logical centre (nearest-zone lookups, distances).
   */
  anchor?: Vec3;
  /**
   * Whether a shortest path may pass *through* this zone as an intermediate
   * waypoint. Defaults to true. Spawn zones are `transit: false`: a generic
   * (attacker-style) route must not cut through a spawn, so a spawn can only be
   * the start or goal of a path, never a mid-point. See pathfinding options.
   */
  transit?: boolean;
}

/** Raw edge as authored in ascent.source.json (no computed geometry). */
export interface SourceEdge {
  from: string;
  to: string;
  bidirectional?: boolean;
  door?: DoorInfo | null;
  destructible?: unknown;
}

/** Edge after map-processor enrichment (ascent.navgraph.json). */
export interface NavEdge {
  from: string;
  to: string;
  bidirectional: boolean;
  door: DoorInfo | null;
  destructible: unknown;
  distanceUnits: number;
  distanceMeters: number;
  runTimeMs: number;
  walkTimeMs: number;
  provenance: string;
  /** Traversal kind (multi-map datasets); absent = ordinary walkable connection. */
  kind?: EdgeKind;
  note?: string;
  /**
   * Walkable polyline from `from` to `to`, measured on the map geometry. When present the
   * edge's distance/time ARE this route's. A bidirectional edge is walked back along the
   * reversed waypoints unless `routeReverse` is present.
   */
  route?: EdgeRoute;
  /** The way back when it differs from the reversed `route` (a one-way drop on one side). */
  routeReverse?: EdgeRoute;
  /** Set to "straight (...)" when no walkable route was found: the edge is a flagged straight segment. */
  routeStatus?: string;
}

/** [x, y, z] in game uu. */
export type Waypoint = [number, number, number];

export interface EdgeRoute {
  /** Ordered points including both zone anchors. */
  waypoints: Waypoint[];
  lengthMeters: number;
  runTimeMs: number;
  walkTimeMs: number;
  /** Number of one-way drops along the route. */
  drops?: number;
  provenance?: string;
}

/** One direction of an edge, as a mover experiences it. */
export interface EdgeTraversal {
  from: string;
  to: string;
  /** Polyline from the `from` zone's stand point to the `to` zone's (>= 2 points). */
  waypoints: Vec3[];
  /** Polyline length in game units (for a teleporter: the straight segment, not travelled). */
  lengthUnits: number;
  runTimeMs: number;
  walkTimeMs: number;
  kind?: EdgeKind;
  /** True when the polyline is a measured walkable route; false = flagged straight segment. */
  walkable: boolean;
}

export interface PlantZone {
  id: string;
  site: string;
  zoneId: string;
  provenance: string;
  polygon: Vec2[];
}

export interface Sightline {
  a: string;
  b: string;
  type: "direct" | "angle";
  smokeable: boolean;
  note?: string;
  /** Measured fraction of eye-point pairs that see each other (geometry-derived maps). */
  visibility?: number;
  provenance?: string;
}

export interface SoundLink {
  a: string;
  b: string;
  /** 0 = no loss, 1 = fully attenuated across this link. */
  attenuation: number;
  provenance?: string;
}

export interface CoordinateTransform {
  xMultiplier: number;
  yMultiplier: number;
  xScalarToAdd: number;
  yScalarToAdd: number;
}

export interface MovementModel {
  unitsPerMeter: number;
  runSpeedMetersPerSec: number;
  walkSpeedMetersPerSec: number;
}

/** Shape of ascent.navgraph.json (the enriched map the engine consumes). */
export interface TacticalMapData {
  mapId: string;
  mapUuid: string;
  schemaVersion?: string;
  patchVersion?: string;
  movement: MovementModel;
  zones: Zone[];
  plantZones: PlantZone[];
  edges: NavEdge[];
  sightlines: Sightline[];
  soundLinks: SoundLink[];
  /** Site letters in order (multi-map datasets; Ascent's file omits it). */
  sites?: string[];
  /** Map mechanics and whether the graph expresses them (multi-map datasets). */
  mechanics?: MapMechanic[];
  // coordinateTransform may be supplied separately (coordinate-system.json)
  // or embedded; the loader accepts either.
  transform?: CoordinateTransform;
}

export type TravelMode = "run" | "walk";

export interface PathResult {
  /** Ordered zone ids from start to goal (inclusive). */
  path: string[];
  distanceUnits: number;
  distanceMeters: number;
  timeMs: number;
  mode: TravelMode;
}

export interface AudibleZone {
  zoneId: string;
  /** Remaining signal strength in [0,1] when the sound reaches this zone. */
  strength: number;
}

// ---- Multi-map additions (optional fields; Ascent's dataset does not carry them) ----

/** How an edge is traversed. Absent = an ordinary walkable connection. */
export type EdgeKind = "walk" | "drop" | "teleporter" | "zipline" | "rope" | "approx-link";

/** A map mechanic and whether the navgraph can express it. */
export interface MapMechanic {
  kind: string;
  name: string;
  represented: boolean;
  how?: string;
  engineNeeds?: string;
  provenance: string;
}
