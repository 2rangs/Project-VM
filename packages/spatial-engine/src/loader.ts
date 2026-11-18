import { readFileSync } from "node:fs";
import type { CoordinateTransform, TacticalMapData } from "./types.js";
import { SpatialEngine } from "./engine.js";

/** Build an engine from already-parsed JSON objects. */
export function createEngine(data: TacticalMapData, transform?: CoordinateTransform): SpatialEngine {
  return new SpatialEngine(data, { transform });
}

/**
 * Convenience loader: reads an ascent.navgraph.json and (optionally) a
 * coordinate-system.json from disk. Node-only. The core engine itself has no
 * filesystem dependency so it can run in a browser/worker with pre-loaded data.
 */
export function loadEngineFromFiles(navgraphPath: string, coordinateSystemPath?: string): SpatialEngine {
  const data = JSON.parse(readFileSync(navgraphPath, "utf8")) as TacticalMapData;
  let transform: CoordinateTransform | undefined;
  if (coordinateSystemPath) {
    const cs = JSON.parse(readFileSync(coordinateSystemPath, "utf8")) as { transform: CoordinateTransform };
    transform = cs.transform;
  }
  return new SpatialEngine(data, { transform });
}
