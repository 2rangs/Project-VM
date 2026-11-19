#!/usr/bin/env node
// Builds the Ascent navigation graph from ascent.source.json.
// For each edge, computes euclidean distance between node centers (units + meters)
// and estimated run/walk travel times. Writes datasets/spatial/ascent/ascent.navgraph.json.
//
// NOTE: edge distances are straight-line between callout centers. Real walkable path
// length is >= this (walls, corners), so these are provenance: manual-approx lower bounds.
//
// Usage: node tools/map-processor/build-ascent.mjs
//
// The committed navgraph additionally carries walkable routes (edge.route, zone.anchor) measured
// on the map geometry. After regenerating with this script, re-apply them:
//   python3 -I tools/map-processor/apply_routes.py ascent
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const srcPath = resolve(root, "datasets/spatial/ascent/ascent.source.json");
const outPath = resolve(root, "datasets/spatial/ascent/ascent.navgraph.json");

const src = JSON.parse(readFileSync(srcPath, "utf8"));
const byId = new Map(src.zones.map((z) => [z.id, z]));

const { unitsPerMeter, runSpeedMetersPerSec, walkSpeedMetersPerSec } = src.movement;
const runWalkRatio = runSpeedMetersPerSec / walkSpeedMetersPerSec;

// PV-5 measured edges (origin/claude/pv-mapmesh), applied for medium-confidence edges only.
const measuredPath = resolve(root, "datasets/spatial/ascent/pv5-measured-edges.json");
const measured = new Map();
try {
  const m = JSON.parse(readFileSync(measuredPath, "utf8"));
  for (const e of m.edges) if (e.apply) measured.set(`${e.from}|${e.to}`, e);
} catch {
  /* no measured file: fall back to euclidean for all edges */
}
const measuredKey = (from, to) => (measured.has(`${from}|${to}`) ? `${from}|${to}` : measured.has(`${to}|${from}`) ? `${to}|${from}` : null);

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

let measuredCount = 0;
const edges = src.edges.map((e) => {
  const a = byId.get(e.from), b = byId.get(e.to);
  if (!a) throw new Error(`edge references unknown zone: ${e.from}`);
  if (!b) throw new Error(`edge references unknown zone: ${e.to}`);
  const key = measuredKey(e.from, e.to);
  let distanceMeters, runTimeMs, provenance;
  if (key) {
    const m = measured.get(key);
    distanceMeters = m.distanceMeters;
    runTimeMs = m.runTimeMs;
    provenance = `pv5-measured (${m.confidence})`;
    measuredCount++;
  } else {
    const distanceUnits = dist3(a.position, b.position);
    distanceMeters = distanceUnits / unitsPerMeter;
    runTimeMs = Math.round((distanceMeters / runSpeedMetersPerSec) * 1000);
    provenance = "manual-approx";
  }
  return {
    from: e.from,
    to: e.to,
    bidirectional: e.bidirectional !== false,
    door: e.door ?? null,
    destructible: e.destructible ?? null,
    distanceUnits: Math.round(distanceMeters * unitsPerMeter),
    distanceMeters: Number(distanceMeters.toFixed(2)),
    runTimeMs,
    walkTimeMs: Math.round(runTimeMs * runWalkRatio),
    provenance,
  };
});

const out = {
  ...src,
  generatedBy: "tools/map-processor/build-ascent.mjs",
  generatedNote: `Edge distances/times: PV-5 measured (medium confidence) where available, else straight-line manual-approx. ${measuredCount}/${edges.length} edges measured.`,
  edges,
};

writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`  zones: ${src.zones.length}  edges: ${edges.length}  plantZones: ${src.plantZones.length}`);
console.log(`  measured (PV-5 medium): ${measuredCount}  manual-approx: ${edges.length - measuredCount}`);
const total = edges.reduce((s, e) => s + e.distanceMeters, 0);
console.log(`  total edge length: ${total.toFixed(1)} m`);
