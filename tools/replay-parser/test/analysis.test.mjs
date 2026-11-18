// PROJECT V — PV-6 analysis unit tests (node:test). Deterministic synthetic
// inputs; no real .vrf, no network. Run: node --test test/analysis.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeKinematics } from '../analysis/kinematics.mjs';
import { projectPoint, identifyMap, assignCallouts, straightLineTravel } from '../analysis/mapproj.mjs';

// sample tuple: [sourceTimestamp, guid, x, y, z, yawDeg]
// Use sampleHz=1 so dt = 1s per step → speed(uu/s) == per-step distance(uu).
const samples = [
  [0, 1, 0, 0, 0, 0],      // start
  [1, 1, 675, 0, 0, 90],   // +675uu, +90deg  → 6.75 m/s run, 90 deg/s
  [2, 1, 675, 0, 0, 90],   // 0 → idle
  [3, 1, 675, 0, 0, 90],   // 0 → idle
  // round reset: ts goes backwards → must split (dt<=0), not a 675uu jump
  [0, 1, 1000, 0, 0, 0],
  [1, 1, 1200, 0, 0, 0],   // +200uu → 2.0 m/s walk band
];

// sampleHz=1 → dt=1s/step, so widen maxDtSec past 1s or every step reads as a gap.
const KOPTS = { sampleHz: 1, maxDtSec: 2 };

test('kinematics: speed bands, top speed, yaw rate from known steps', () => {
  const k = computeKinematics(samples, KOPTS);
  assert.equal(k.counts.actors, 1);
  // 4 valid step pairs (the backwards-ts transition is dropped as a reset)
  assert.equal(k.counts.stepPairs, 4);
  assert.equal(k.speed.topSpeedMps, 6.75, 'top speed = 6.75 m/s run');
  assert.equal(k.speed.stateCounts.run, 1);
  assert.equal(k.speed.stateCounts.walkOrCrouch, 1);
  assert.equal(k.speed.stateCounts.idle, 2);
  assert.equal(k.speed.stateCounts.anomalous, 0);
  // yaw: one 90deg turn over 1s = 90 deg/s is the max
  assert.equal(k.yawRate.percentiles.p100, 90);
});

test('kinematics: reset (non-positive dt) splits the stream, no phantom speed', () => {
  const k = computeKinematics(samples, KOPTS);
  // if the backwards-ts step were counted it would be a huge jump; top stays 6.75
  assert.ok(k.speed.topSpeedMps <= 6.75);
});

test('kinematics: empty input is safe', () => {
  const k = computeKinematics([], KOPTS);
  assert.equal(k.counts.stepPairs, 0);
  assert.equal(k.speed.topSpeedMps, null);
});

// Ascent transform from PV-4 datasets/spatial/ascent/coordinate-system.json
const ASCENT = { xMultiplier: 0.00007, yMultiplier: -0.00007, xScalarToAdd: 0.813895, yScalarToAdd: 0.573242 };

test('mapproj: axis-swapped projection matches PV-4 transform', () => {
  const { mx, my } = projectPoint(1382.2, -10417.9, ASCENT);
  assert.ok(Math.abs(mx - 0.08464) < 0.001, `minimapX ${mx}`);
  assert.ok(Math.abs(my - 0.47649) < 0.001, `minimapY ${my}`);
  assert.ok(mx >= 0 && mx <= 1 && my >= 0 && my <= 1);
});

test('mapproj: identifyMap prefers the map that contains the points', () => {
  // a transform that pushes the same points out of [0,1]
  const OFFMAP = { xMultiplier: 0.00007, yMultiplier: -0.00007, xScalarToAdd: 5.0, yScalarToAdd: 5.0 };
  const pts = [[1382.2, -10417.9], [2382.2, -10159]];
  const ranked = identifyMap(pts, { Ascent: ASCENT, Offmap: OFFMAP });
  assert.equal(ranked[0].map, 'Ascent');
  assert.equal(ranked[0].fractionInUnit, 1);
  assert.ok(ranked.find((r) => r.map === 'Offmap').fractionInUnit < 1);
});

test('mapproj: assignCallouts picks the nearest zone', () => {
  const zones = [
    { id: 'defender-spawn', x: 1995.2, y: -9744.9 },
    { id: 'a-site', x: 5000, y: 3000 },
  ];
  const { counts } = assignCallouts([[1900, -9800], [2050, -9700]], zones);
  assert.equal(counts['defender-spawn'], 2);
  assert.equal(counts['a-site'], undefined);
});

test('mapproj: straightLineTravel converts distance to run/walk seconds', () => {
  const a = { x: 0, y: 0 }, b = { x: 675, y: 0 };
  const tr = straightLineTravel(a, b, 100, 6.75, 3.4);
  assert.equal(tr.metres, 6.75);
  assert.equal(tr.runSec, 1.0);   // 6.75 m / 6.75 m/s
  assert.ok(Math.abs(tr.walkSec - 1.99) < 0.01);
});
