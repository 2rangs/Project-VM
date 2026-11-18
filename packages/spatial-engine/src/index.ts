// PROJECT V — spatial-engine public API.
export * from "./types.js";
export { MapCoordinateSystem } from "./coordinate.js";
export { SpatialEngine } from "./engine.js";
export type { SpatialEngineOptions } from "./engine.js";
export { ZoneGraph } from "./pathfinding.js";
export { distance2, distance3, pointInPolygon } from "./geometry.js";
export { createEngine, loadEngineFromFiles } from "./loader.js";
