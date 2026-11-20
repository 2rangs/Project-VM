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
  const visibility = JSON.parse(readFileSync(resolve(spatialDir, "ascent.vis.json"), "utf8"));
  return createEngine(nav, cs.transform, roadmap, visibility);
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

type P3 = { x: number; y: number; z: number };
const pairCache = new Map<string, { a: P3; b: P3 }>();

/**
 * Two standing points — one in each zone — that really see each other (measured line of sight),
 * as near the two zones' anchors as possible. Sight is decided by where bodies stand, so a scene
 * that needs "A in zone X sees D in zone Y" must put them on such a pair: the two callouts
 * themselves usually do not see each other.
 */
export function sightPair(engine: SpatialEngine, zoneA: string, zoneB: string): { a: P3; b: P3 } {
  const key = `${zoneA}|${zoneB}`;
  const hit = pairCache.get(key);
  if (hit) return hit;
  const nav = engine.nav!;
  const A = nav.nodePosition(nav.anchorNode(zoneA)!), B = nav.nodePosition(nav.anchorNode(zoneB)!);
  let best: { a: P3; b: P3 } | null = null, bestScore = Infinity;
  for (const i of nav.zoneNodes(zoneA)) for (const j of nav.zoneNodes(zoneB)) {
    if (!nav.nodesVisible(i, j)) continue;
    const p = nav.nodePosition(i), q = nav.nodePosition(j);
    const score = Math.hypot(p.x - A.x, p.y - A.y, p.z - A.z) + Math.hypot(q.x - B.x, q.y - B.y, q.z - B.z);
    if (score < bestScore) { bestScore = score; best = { a: p, b: q }; }
  }
  if (!best) throw new Error(`no line of sight between any standing point of ${zoneA} and ${zoneB}`);
  pairCache.set(key, best);
  return best;
}

/** Where a scene stands a player: on the A Main / A Site sight pair for those two zones, else on the zone's callout. */
export function scenePos(engine: SpatialEngine, zoneId: string): P3 {
  if (zoneId === "a-main") return sightPair(engine, "a-main", "a-site").a;
  if (zoneId === "a-site") return sightPair(engine, "a-main", "a-site").b;
  return engine.getZone(zoneId)!.position;
}

/** A standing point of a zone, as near its anchor as possible, that does NOT see the given point. */
export function hiddenSpot(engine: SpatialEngine, zoneId: string, from: P3): P3 {
  const nav = engine.nav!;
  const eye = nav.locate(from)!;
  const A = nav.nodePosition(nav.anchorNode(zoneId)!);
  let best: P3 | null = null, bestD = Infinity;
  for (const i of nav.zoneNodes(zoneId)) {
    if (nav.nodesVisible(i, eye)) continue;
    const p = nav.nodePosition(i);
    const d = Math.hypot(p.x - A.x, p.y - A.y, p.z - A.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) throw new Error(`every standing point of ${zoneId} sees the given point`);
  return best;
}
