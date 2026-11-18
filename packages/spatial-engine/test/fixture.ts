import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CoordinateTransform, TacticalMapData } from "../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
// packages/spatial-engine/test -> repo root is three levels up.
const repoRoot = resolve(here, "..", "..", "..");
const dataDir = resolve(repoRoot, "datasets/spatial/ascent");

export function loadAscent(): TacticalMapData {
  return JSON.parse(readFileSync(resolve(dataDir, "ascent.navgraph.json"), "utf8")) as TacticalMapData;
}

export function loadTransform(): CoordinateTransform {
  const cs = JSON.parse(readFileSync(resolve(dataDir, "coordinate-system.json"), "utf8")) as {
    transform: CoordinateTransform;
  };
  return cs.transform;
}
