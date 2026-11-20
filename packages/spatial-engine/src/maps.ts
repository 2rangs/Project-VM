// PROJECT V — map registry: "load map by id" for every map with a spatial dataset.
//
// Node-only (reads datasets/spatial/<id>/ from disk), like loadEngineFromFiles. The engine
// class itself stays filesystem-free.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CoordinateTransform, TacticalMapData } from "./types.js";
import { SpatialEngine } from "./engine.js";
import type { NavData } from "./navigation.js";

export const MAP_IDS = [
  "ascent",
  "abyss",
  "bind",
  "breeze",
  "fracture",
  "haven",
  "icebox",
  "lotus",
  "pearl",
  "split",
  "sunset",
] as const;

export type MapId = (typeof MAP_IDS)[number];
export type SiteLetter = "A" | "B" | "C";

export interface MapInfo {
  readonly id: MapId;
  readonly displayName: string;
  /** valorant-api map uuid. */
  readonly uuid: string;
  /** Spike sites, in order. Haven and Lotus have three. */
  readonly sites: readonly SiteLetter[];
  /**
   * How the graph relations were obtained: Ascent's are hand-authored and calibrated,
   * the others are derived from the map geometry (docs/research/MAPS_DATA.md).
   */
  readonly graphSource: "hand-authored" | "geometry-derived";
}

const info = (id: MapId, displayName: string, uuid: string, sites: readonly SiteLetter[], graphSource: MapInfo["graphSource"] = "geometry-derived"): MapInfo =>
  ({ id, displayName, uuid, sites, graphSource });

export const MAPS: Readonly<Record<MapId, MapInfo>> = {
  ascent: info("ascent", "Ascent", "7eaecc1b-4337-bbf6-6ab9-04b8f06b3319", ["A", "B"], "hand-authored"),
  abyss: info("abyss", "Abyss", "224b0a95-48b9-f703-1bd8-67aca101a61f", ["A", "B"]),
  bind: info("bind", "Bind", "2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba", ["A", "B"]),
  breeze: info("breeze", "Breeze", "2fb9a4fd-47b8-4e7d-a969-74b4046ebd53", ["A", "B"]),
  fracture: info("fracture", "Fracture", "b529448b-4d60-346e-e89e-00a4c527a405", ["A", "B"]),
  haven: info("haven", "Haven", "2bee0dc9-4ffe-519b-1cbd-7fbe763a6047", ["A", "B", "C"]),
  icebox: info("icebox", "Icebox", "e2ad5c54-4114-a870-9641-8ea21279579a", ["A", "B"]),
  lotus: info("lotus", "Lotus", "2fe4ed3a-450a-948b-6d6b-e89a78e680a9", ["A", "B", "C"]),
  pearl: info("pearl", "Pearl", "fd267378-4d1d-484f-ff52-77821ed10dc2", ["A", "B"]),
  split: info("split", "Split", "d960549e-485c-e861-8d71-aa9d1aed12a2", ["A", "B"]),
  sunset: info("sunset", "Sunset", "92584fbe-486a-b1b2-9faa-39b0f486b498", ["A", "B"]),
};

export function isMapId(id: string): id is MapId {
  return (MAP_IDS as readonly string[]).includes(id);
}

/** Maps with an engine-loadable dataset, in registry order. */
export function listMaps(): readonly MapInfo[] {
  return MAP_IDS.map((id) => MAPS[id]);
}

/** packages/spatial-engine/src -> <repo>/datasets/spatial */
export function defaultDatasetsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "datasets", "spatial");
}

export interface LoadedMapData {
  readonly info: MapInfo;
  readonly data: TacticalMapData;
  readonly transform: CoordinateTransform;
  /** The map's navigation roadmap, when <id>.nav.json exists. */
  readonly nav?: NavData;
}

/** Read a map's navgraph + coordinate system from disk. Throws on an unknown id. */
export function loadMapData(id: string, datasetsRoot: string = defaultDatasetsRoot()): LoadedMapData {
  if (!isMapId(id)) throw new Error(`unknown map id: ${id} (available: ${MAP_IDS.join(", ")})`);
  const dir = resolve(datasetsRoot, id);
  const data = JSON.parse(readFileSync(resolve(dir, `${id}.navgraph.json`), "utf8")) as TacticalMapData;
  const cs = JSON.parse(readFileSync(resolve(dir, "coordinate-system.json"), "utf8")) as { transform: CoordinateTransform };
  const navPath = resolve(dir, `${id}.nav.json`);
  const nav = existsSync(navPath) ? (JSON.parse(readFileSync(navPath, "utf8")) as NavData) : undefined;
  return { info: MAPS[id], data, transform: cs.transform, ...(nav ? { nav } : {}) };
}

/** Load a map by id and return its spatial engine. */
export function loadMap(id: string, datasetsRoot?: string): SpatialEngine {
  const { data, transform, nav } = loadMapData(id, datasetsRoot);
  return new SpatialEngine(data, { transform, nav });
}
