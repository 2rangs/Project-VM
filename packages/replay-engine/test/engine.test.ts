// @pv/replay-engine — engine unit tests. Run:
//   node --experimental-strip-types --test test/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadReplay, stateAt, trackStateAt, roundAt, eventsInRange,
  replayBounds, lerpAngleDeg, lerpVec3, perceptionAt,
} from '../src/engine.ts';
import { projectToMinimap, inMinimap } from '../src/coordinate.ts';
import type { Replay } from '../src/types.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// canonical synthetic replay shipped with the viewer (single source of truth)
const FIXTURE = path.resolve(DIR, '../../../apps/replay-viewer/public/fixtures/synthetic-replay.json');
const ASCENT = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures', 'ascent-coordinate-system.json'), 'utf8')).transform;

test('lerpAngleDeg takes the shortest arc across the 0/360 wrap', () => {
  assert.equal(lerpAngleDeg(350, 10, 0.5), 0);   // +20°, half lands on 360→0
  assert.equal(lerpAngleDeg(10, 350, 0.5), 0);   // −20°, half lands on 0
  assert.equal(lerpAngleDeg(0, 180, 0.5), 90);
});

test('lerpVec3 interpolates component-wise', () => {
  assert.deepEqual(lerpVec3({ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }, 0.5), { x: 5, y: 10, z: 15 });
});

const mini: Replay = {
  schemaVersion: '1',
  meta: { mapId: 'ascent', patch: null, source: 'synthetic', seed: 1, matchId: null, generatedAt: 'x' },
  players: [{ id: 'player_1', teamIdx: 0 }],
  rounds: [{ roundNum: 1, startMs: 0, endMs: 10000 }, { roundNum: 2, startMs: 20000, endMs: null }],
  tracks: [{ playerId: 'player_1', keyframes: [
    { tMs: 2000, pos: { x: 0, y: 0, z: 0 }, facingDeg: 0, state: 'alive' },
    { tMs: 4000, pos: { x: 100, y: 0, z: 0 }, facingDeg: 90, state: 'alive' },
    { tMs: 6000, pos: { x: 100, y: 0, z: 0 }, facingDeg: 90, state: 'dead' },
  ] }],
  events: [{ tMs: 4000, kind: 'kill', actorId: 'player_1', victimId: 'player_1' }],
};

test('loadReplay validates version and sorts keyframes', () => {
  const unsorted = { ...mini, tracks: [{ playerId: 'player_1', keyframes: [mini.tracks[0].keyframes[2], mini.tracks[0].keyframes[0], mini.tracks[0].keyframes[1]] }] };
  const r = loadReplay(unsorted);
  assert.deepEqual(r.tracks[0].keyframes.map((k) => k.tMs), [2000, 4000, 6000]);
  assert.throws(() => loadReplay({ schemaVersion: '2' }), /schemaVersion/);
});

test('trackStateAt interpolates position + facing and clamps at the ends', () => {
  const tr = mini.tracks[0];
  const mid = trackStateAt(tr, 3000)!;
  assert.deepEqual(mid.pos, { x: 50, y: 0, z: 0 });
  assert.equal(mid.facingDeg, 45);
  assert.equal(mid.state, 'alive');
  assert.equal(mid.extrapolated, false);

  const before = trackStateAt(tr, 0)!;
  assert.equal(before.extrapolated, true);
  assert.deepEqual(before.pos, { x: 0, y: 0, z: 0 });

  const after = trackStateAt(tr, 9999)!;
  assert.equal(after.extrapolated, true);
  assert.equal(after.state, 'dead'); // carry-forward
});

test('stateAt + roundAt report the active round and all players', () => {
  const s = stateAt(mini, 3000);
  assert.equal(s.players.length, 1);
  assert.equal(s.roundNum, 1);
  assert.equal(roundAt(mini, 25000), 2);  // after round 2 start, open-ended
  assert.equal(roundAt(mini, 15000), 2 - 1); // between rounds → latest started = 1
});

test('eventsInRange + replayBounds', () => {
  assert.equal(eventsInRange(mini, 0, 3999).length, 0);
  assert.equal(eventsInRange(mini, 0, 5000).length, 1);
  const b = replayBounds(mini);
  assert.equal(b.startMs, 0);
  assert.equal(b.endMs, 20000);
});

test('projectToMinimap puts Ascent world coords inside [0,1]', () => {
  const p = projectToMinimap({ x: 1995, y: -9744, z: 100 }, ASCENT);
  assert.ok(inMinimap(p), `expected in-bounds, got ${JSON.stringify(p)}`);
});

test('perception: optional per-team belief, sorted + stepped by perceptionAt', () => {
  const withPerception: Replay = {
    ...mini,
    perception: [{
      teamIdx: 0, side: 'attack', intervalTicks: 5,
      snapshots: [
        // intentionally out of order to test loadReplay sort
        { tMs: 4000, observedEnemies: [{ enemyId: 'e1', zone: 'a-site', pos: null, lastSeenMsAgo: 0, currentlyVisible: true }], beliefZones: [{ zone: 'a-site', p: 0.8 }] },
        { tMs: 1000, observedEnemies: [], beliefZones: [{ zone: 'mid', p: 0.5 }, { zone: 'b-site', p: 0.5 }] },
      ],
    }],
  };
  const r = loadReplay(withPerception);
  assert.equal(r.perception![0].snapshots[0].tMs, 1000, 'snapshots sorted ascending');
  // step: before any snapshot → null
  assert.equal(perceptionAt(r, 0, 500), null);
  // at 1500 → the 1000 snapshot (belief over mid/b-site, no visible enemies)
  const s1 = perceptionAt(r, 0, 1500)!;
  assert.equal(s1.tMs, 1000);
  assert.equal(s1.observedEnemies.length, 0);
  // at 5000 → the 4000 snapshot (enemy visible at a-site)
  const s2 = perceptionAt(r, 0, 5000)!;
  assert.equal(s2.tMs, 4000);
  assert.equal(s2.observedEnemies[0].zone, 'a-site');
  assert.equal(s2.beliefZones[0].p, 0.8);
  // team 1 has no track
  assert.equal(perceptionAt(r, 1, 5000), null);
});

test('perception is optional — a replay without it still loads', () => {
  const r = loadReplay(mini);
  assert.equal(r.perception, undefined);
  assert.equal(perceptionAt(r, 0, 1000), null);
});

test('shipped synthetic viewer fixture loads and projects in-bounds', () => {
  const r = loadReplay(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  assert.equal(r.meta.source, 'synthetic');
  assert.equal(r.players.length, 3);
  const s = stateAt(r, 5000);
  const t = r.meta.coordinateTransform!;
  let inBounds = 0;
  for (const p of s.players) if (inMinimap(projectToMinimap(p.pos, t))) inBounds++;
  assert.equal(inBounds, s.players.length, 'all players project inside the minimap');
});
