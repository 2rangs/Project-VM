import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, type SpatialEngine } from "@project-v/spatial-engine";
import { buildAbilityCatalog, requireAbility, type AbilityCatalog } from "../../src/catalog.js";
import type { AbilitySpec, Vec3 } from "../../src/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const spatialDir = resolve(repoRoot, "datasets/spatial/ascent");

export function loadSpatial(): SpatialEngine {
  const nav = JSON.parse(readFileSync(resolve(spatialDir, "ascent.navgraph.json"), "utf8"));
  const cs = JSON.parse(readFileSync(resolve(spatialDir, "coordinate-system.json"), "utf8"));
  return createEngine(nav, cs.transform);
}

export function loadAbilities(): AbilityCatalog {
  const raw = JSON.parse(readFileSync(resolve(here, "abilities.manual-approx.json"), "utf8"));
  return buildAbilityCatalog(raw.abilities as AbilitySpec[]);
}

export const ABILITIES = loadAbilities();
export const ability = (id: string): AbilitySpec => requireAbility(ABILITIES, id);

export function zonePos(spatial: SpatialEngine, zoneId: string): Vec3 {
  const z = spatial.getZone(zoneId);
  if (!z) throw new Error(`no zone ${zoneId}`);
  return { ...z.position };
}
