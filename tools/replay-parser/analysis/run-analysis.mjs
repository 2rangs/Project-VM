// PROJECT V — PV-6 replay analysis CLI.
//
//   node run-analysis.mjs <raw.json> <valapi-maps.json> <ascent.navgraph.json> <outDir>
//
// Produces the derived kinematics + map-projection dataset from a decoded
// replay. Aggregates only — no per-frame trajectory, no ProfileName, no raw .vrf.
// ProfileNames are replaced by anonymous player_1..N ids.
//
// Inputs:
//   raw.json           — extract.mjs output (samples + meta.mapHints + players)
//   valapi-maps.json   — https://valorant-api.com/v1/maps response (for transforms + minimap urls)
//   ascent.navgraph.json — PV-4 (origin/claude/pv-spatial) navgraph (READ ONLY: zones + movement)

import fs from 'node:fs';
import path from 'node:path';
import { computeKinematics } from './kinematics.mjs';
import { identifyMap, assignCallouts, projectPoint, straightLineTravel, MAPPROJ_VERSION } from './mapproj.mjs';

const [, , rawPath, mapsPath, navPath, outDir] = process.argv;
if (!rawPath || !mapsPath || !navPath || !outDir) {
  console.error('Usage: node run-analysis.mjs <raw.json> <valapi-maps.json> <ascent.navgraph.json> <outDir>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const maps = JSON.parse(fs.readFileSync(mapsPath, 'utf8')).data;
const nav = JSON.parse(fs.readFileSync(navPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

// --- transforms from valorant-api (skip maps without a transform) ---
const transforms = {};
const minimapUrl = {};
for (const m of maps) {
  if (typeof m.xMultiplier !== 'number') continue;
  // Skip degenerate transforms (practice/tutorial maps like The Range/Skirmish
  // have 0 multipliers → every point collapses to one spot and trivially sits
  // in [0,1], which would pollute the ranking).
  if (!m.xMultiplier || !m.yMultiplier) continue;
  transforms[m.displayName] = {
    xMultiplier: m.xMultiplier, yMultiplier: m.yMultiplier,
    xScalarToAdd: m.xScalarToAdd, yScalarToAdd: m.yScalarToAdd,
  };
  minimapUrl[m.displayName] = m.displayIcon;
}

// --- anonymize players: ProfileName -> player_N ---
const anonMap = {};
let pn = 0;
const players = Object.entries(raw.players).map(([ch, p]) => {
  pn += 1;
  const anonId = `player_${pn}`;
  if (p.ProfileName) anonMap[p.ProfileName] = anonId;
  return { anonId, teamIdx: p.team ?? null, playerId: p.PlayerId !== undefined ? String(p.PlayerId) : `ch${ch}` };
});

// --- points (game-world x,y) ---
const points = raw.samples.map((s) => [s[2], s[3]]);

// --- map identification ---
const ranked = identifyMap(points, transforms);
const mapHints = raw.meta.mapHints || {};
const hintMap = Object.keys(mapHints).sort((a, b) => mapHints[b] - mapHints[a])[0] || null;
const identified = hintMap || (ranked[0] && ranked[0].map);

// --- kinematics ---
const kin = computeKinematics(raw.samples);

// --- callout assignment (only meaningful if Ascent) ---
const zones = nav.zones.map((z) => ({
  id: z.id, name: z.name, callout: z.callout,
  x: z.position?.x, y: z.position?.y, z: z.position?.z,
}));
let callouts = null;
if (identified === 'Ascent') {
  const ca = assignCallouts(points, zones);
  const top = Object.entries(ca.counts).sort((a, b) => b[1] - a[1])
    .map(([id, n]) => ({ zoneId: id, name: zones.find((z) => z.id === id)?.name, samples: n }));
  const dists = ca.perPoint.map((p) => p.distUU).sort((a, b) => a - b);
  callouts = {
    occupiedZones: top,
    nearestZoneDistUU: {
      p50: dists[Math.floor(0.5 * (dists.length - 1))] ?? null,
      p90: dists[Math.floor(0.9 * (dists.length - 1))] ?? null,
      max: dists[dists.length - 1] ?? null,
    },
  };
}

// --- projection bbox for the identified map ---
const t = transforms[identified];
let projection = null;
if (t) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, inside = 0;
  for (const [x, y] of points) {
    const { mx, my } = projectPoint(x, y, t);
    if (mx >= 0 && mx <= 1 && my >= 0 && my <= 1) inside++;
    if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
    if (my < minY) minY = my; if (my > maxY) maxY = my;
  }
  projection = {
    map: identified,
    transform: t,
    minimapBBox: { minX: +minX.toFixed(4), maxX: +maxX.toFixed(4), minY: +minY.toFixed(4), maxY: +maxY.toFixed(4) },
    fractionInUnit: +(inside / points.length).toFixed(4),
    minimapImage: minimapUrl[identified] || null,
  };
}

const out = {
  schema: 'project-v/replay-kinematics@1',
  generatedAt: new Date().toISOString(),
  provenance: {
    sourceId: 'valorant-vrf',
    evidenceType: 'derived',
    verified: true,
    verificationLevel: 3,
    synthetic: false,
    notes: [
      'Aggregated from ONE short replay capture; NOT generalizable. Sample counts are included on every metric.',
      'ProfileNames removed; players are anonymous player_N.',
      'Map identity from decoded parser class-path hint (raw.meta.mapHints), corroborated by transform [0,1] containment.',
      'world->minimap transform values are from valorant-api (same as PV-4 coordinate-system.json).',
      'alive/health not in .vrf; kinematics use position + yaw only.',
    ],
  },
  capture: {
    sampleCount: raw.meta.sampleCount,
    uniqueActors: raw.meta.uniqueGuids.length,
    players,
    mapHints,
  },
  mapIdentification: {
    identified,
    basis: hintMap ? 'decoded parser class-path hint' : 'transform [0,1] containment (weak for small samples)',
    decodedHint: hintMap,
    transformRanking: ranked.slice(0, 5),
    caveat: 'A spatially small sample fits many maps\' [0,1] box, so containment alone is weak; the decoded hint is the primary signal.',
  },
  projection,
  callouts,
  kinematics: kin,
};

const outFile = path.join(outDir, 'ascent-capture-01.kinematics.json');
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.error(`map=${identified} actors=${kin.counts.actors} topSpeed=${kin.speed.topSpeedMps}m/s -> ${outFile}`);

// expose for overlay / doc without recomputation
fs.writeFileSync(path.join(outDir, '_points.json'), JSON.stringify({
  identified, transform: t, minimapImage: minimapUrl[identified] || null,
  points, zones: identified === 'Ascent' ? zones : [],
}));
