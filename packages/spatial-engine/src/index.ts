// PROJECT V — spatial-engine public API.
export * from "./types.js";
export { MapCoordinateSystem } from "./coordinate.js";
export { SpatialEngine, positionKey } from "./engine.js";
export type { SpatialEngineOptions } from "./engine.js";
export { ZoneGraph } from "./pathfinding.js";
export type { PathOptions } from "./pathfinding.js";
export { distance2, distance3, pointAlongPolyline, pointInPolygon } from "./geometry.js";
export { createEngine, loadEngineFromFiles } from "./loader.js";
export { MAP_IDS, MAPS, isMapId, listMaps, loadMap, loadMapData, loadMapTactics, defaultDatasetsRoot } from "./maps.js";
export type { MapId, MapInfo, SiteLetter, LoadedMapData } from "./maps.js";
export { Navigator, NavBlockers } from "./navigation.js";
export type { NavVisibility, NavData, NavEdgeKind, NavWaypoint, NavigationRequest, NavigationResult, MovementMode, RoutePreference } from "./navigation.js";
export { deriveMapTactics, siteLetterOf } from "./tactics.js";
export type { MapTactics, SiteTactics, MapTacticsOverrides } from "./tactics.js";
