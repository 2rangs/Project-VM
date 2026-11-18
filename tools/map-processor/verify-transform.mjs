#!/usr/bin/env node
// Verifies the Ascent coordinate transform: every callout must map into [0,1] minimap space.
// Usage: node tools/map-processor/verify-transform.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const cs = JSON.parse(readFileSync(resolve(root, "datasets/spatial/ascent/coordinate-system.json"), "utf8"));
const src = JSON.parse(readFileSync(resolve(root, "datasets/spatial/ascent/ascent.source.json"), "utf8"));
const t = cs.transform;

function toMinimap(g) {
  return {
    x: g.y * t.xMultiplier + t.xScalarToAdd,
    y: g.x * t.yMultiplier + t.yScalarToAdd,
  };
}
function toGame(m) {
  return {
    y: (m.x - t.xScalarToAdd) / t.xMultiplier,
    x: (m.y - t.yScalarToAdd) / t.yMultiplier,
  };
}

let ok = true;
let maxRoundTripErr = 0;
for (const z of src.zones) {
  const m = toMinimap(z.position);
  const inRange = m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1;
  if (!inRange) ok = false;
  const g2 = toGame(m);
  const err = Math.max(Math.abs(g2.x - z.position.x), Math.abs(g2.y - z.position.y));
  maxRoundTripErr = Math.max(maxRoundTripErr, err);
  const flag = inRange ? "ok " : "OUT";
  console.log(`${flag} ${z.name.padEnd(16)} game=(${z.position.x.toFixed(0)},${z.position.y.toFixed(0)}) -> minimap=(${m.x.toFixed(3)},${m.y.toFixed(3)})`);
}
console.log(`\nmax round-trip error: ${maxRoundTripErr.toExponential(3)} units`);
console.log(ok ? "PASS: all zones within [0,1]" : "FAIL: some zones outside [0,1]");
process.exit(ok ? 0 : 1);
