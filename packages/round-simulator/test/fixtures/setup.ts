import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, type SpatialEngine } from "@pv/spatial-engine";
import { buildCatalog, type WeaponSpec } from "@pv/combat-engine";
import { buildAbilityCatalog, abilitySpecFromCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { SpatialQueryAdapter } from "../../src/view.js";
import type { SpatialQuery } from "../../src/policy-contract.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..");
const spatialDir = resolve(repoRoot, "datasets/spatial/ascent");

export function loadSpatial(): SpatialEngine {
  const nav = JSON.parse(readFileSync(resolve(spatialDir, "ascent.navgraph.json"), "utf8"));
  const cs = JSON.parse(readFileSync(resolve(spatialDir, "coordinate-system.json"), "utf8"));
  const roadmap = JSON.parse(readFileSync(resolve(spatialDir, "ascent.nav.json"), "utf8"));
  return createEngine(nav, cs.transform, roadmap);
}

export function spatialQuery(engine: SpatialEngine): SpatialQuery {
  return new SpatialQueryAdapter(engine);
}

/**
 * Local copy of the manual-approx weapons fixture (same values as combat-engine's). Loaded
 * by a path RELATIVE TO THIS FILE — no hard-coded "@pv" path fragment — so a later
 * "@pv/*" scope rename needs no change here (F6).
 */
export function loadWeapons(): Record<string, WeaponSpec> {
  const raw = JSON.parse(readFileSync(resolve(here, "weapons.manual-approx.json"), "utf8"));
  return buildCatalog(raw.weapons as WeaponSpec[]);
}

export const NO_ABILITIES: AbilityCatalog = {};

/** Minimal Ascent-meta ability catalog (manual-approx, inline — matches scenario loadout ids). */
export function loadAbilities(): AbilityCatalog {
  return buildAbilityCatalog([
    abilitySpecFromCatalog({ abilityId: "omen:Ability2", slot: "Ability2", name: "Dark Cover", effectTypes: ["smoke"], params: { radiusMeters: 5, durationMs: 15000, blocksVision: true, makesSound: true } }, { cost: 150, charges: 1 }),
    abilitySpecFromCatalog({ abilityId: "breach:Ability2", slot: "Ability2", name: "Flashpoint", effectTypes: ["flash"], params: { radiusMeters: 6, durationMs: 2000, makesSound: true } }, { cost: 250, charges: 2 }),
    abilitySpecFromCatalog({ abilityId: "sova:Ability2", slot: "Ability2", name: "Recon Bolt", effectTypes: ["recon"], params: { radiusMeters: 25, durationMs: 3000, revealDurationMs: 3000, makesSound: true } }, { cost: 400, charges: 1 }),
    abilitySpecFromCatalog({ abilityId: "brimstone:Ability1", slot: "Ability1", name: "Incendiary", effectTypes: ["molly"], params: { radiusMeters: 4, durationMs: 7000, damage: 60, makesSound: true } }, { cost: 250, charges: 1 }),
  ]);
}

export function loadPv2Scenario(name = "pv2-scenario-01.json"): unknown {
  return JSON.parse(readFileSync(resolve(here, name), "utf8"));
}
