import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, type SpatialEngine } from "@project-v/spatial-engine";
import { buildCatalog, type WeaponSpec } from "@project-v/combat-engine";
import type { AbilityCatalog } from "@project-v/ability-engine";
import { SpatialQueryAdapter } from "../../src/view.js";
import type { SpatialQuery } from "../../src/policy-contract.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const spatialDir = resolve(repoRoot, "datasets/spatial/ascent");

export function loadSpatial(): SpatialEngine {
  const nav = JSON.parse(readFileSync(resolve(spatialDir, "ascent.navgraph.json"), "utf8"));
  const cs = JSON.parse(readFileSync(resolve(spatialDir, "coordinate-system.json"), "utf8"));
  return createEngine(nav, cs.transform);
}

export function spatialQuery(engine: SpatialEngine): SpatialQuery {
  return new SpatialQueryAdapter(engine);
}

/** Reuse combat-engine's committed manual-approx weapons fixture (via the file: link). */
export function loadWeapons(): Record<string, WeaponSpec> {
  const p = resolve(here, "..", "..", "node_modules", "@project-v", "combat-engine", "test", "fixtures", "weapons.manual-approx.json");
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return buildCatalog(raw.weapons as WeaponSpec[]);
}

export const NO_ABILITIES: AbilityCatalog = {};

export function loadPv2Scenario(name = "pv2-scenario-01.json"): unknown {
  return JSON.parse(readFileSync(resolve(here, name), "utf8"));
}
