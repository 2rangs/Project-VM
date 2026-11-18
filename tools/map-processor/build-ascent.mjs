#!/usr/bin/env node
// Builds the Ascent navigation graph from ascent.source.json.
// For each edge, computes euclidean distance between node centers (units + meters)
// and estimated run/walk travel times. Writes datasets/spatial/ascent/ascent.navgraph.json.
//
// NOTE: edge distances are straight-line between callout centers. Real walkable path
// length is >= this (walls, corners), so these are provenance: manual-approx lower bounds.
//
// Usage: node tools/map-processor/build-ascent.mjs
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

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const edges = src.edges.map((e) => {
  const a = byId.get(e.from), b = byId.get(e.to);
  if (!a) throw new Error(`edge references unknown zone: ${e.from}`);
  if (!b) throw new Error(`edge references unknown zone: ${e.to}`);
  const distanceUnits = dist3(a.position, b.position);
  const distanceMeters = distanceUnits / unitsPerMeter;
  const runTimeMs = Math.round((distanceMeters / runSpeedMetersPerSec) * 1000);
  const walkTimeMs = Math.round((distanceMeters / walkSpeedMetersPerSec) * 1000);
  return {
    from: e.from,
    to: e.to,
    bidirectional: e.bidirectional !== false,
    door: e.door ?? null,
    destructible: e.destructible ?? null,
    distanceUnits: Math.round(distanceUnits),
    distanceMeters: Number(distanceMeters.toFixed(2)),
    runTimeMs,
    walkTimeMs,
    provenance: "manual-approx",
  };
});

const out = {
  ...src,
  generatedBy: "tools/map-processor/build-ascent.mjs",
  generatedNote: "Edge distances/times computed from node centers; straight-line approximation.",
  edges,
};

writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`  zones: ${src.zones.length}  edges: ${edges.length}  plantZones: ${src.plantZones.length}`);
const total = edges.reduce((s, e) => s + e.distanceMeters, 0);
console.log(`  total edge length: ${total.toFixed(1)} m (straight-line)`);
