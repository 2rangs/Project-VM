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
}

export interface SoundLink {
  a: string;
  b: string;
  /** 0 = no loss, 1 = fully attenuated across this link. */
  attenuation: number;
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
