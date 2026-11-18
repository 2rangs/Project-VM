// @pv/replay-engine — converter unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromReplayParser } from '../src/convert-parser.ts';
import { fromSimEventLog } from '../src/convert-sim.ts';
import { loadReplay, stateAt } from '../src/engine.ts';

test('fromReplayParser: anon ids, tracks by actorGuid, no ProfileName leaks', () => {
  const normalized = {
    meta: { mapName: 'Ascent', gamePatch: null, provenance: { synthetic: false, sourceId: 'valorant-vrf' } },
    rounds: [{ roundNum: 1, startTimeMs: 0, endTimeMs: 20000 }],
    positions: [
      { roundNum: 1, actorGuid: 144, matchTimeMs: 0, worldPos: { x: 1, y: 2, z: 3 }, facingDeg: 90, alive: null },
      { roundNum: 1, actorGuid: 144, matchTimeMs: 1000, worldPos: { x: 4, y: 2, z: 3 }, facingDeg: 95, alive: null },
      { roundNum: 1, actorGuid: 200, matchTimeMs: 0, worldPos: { x: 9, y: 9, z: 0 }, facingDeg: 0, alive: null },
    ],
  };
  const r = fromReplayParser(normalized, { tickRateHz: 128 });
  assert.equal(r.meta.source, 'real');
  assert.equal(r.players.length, 2);
  assert.deepEqual(r.players.map((p) => p.id), ['player_1', 'player_2']);
  // no displayName / ProfileName carried
  assert.ok(r.players.every((p) => !p.displayName));
  const t1 = r.tracks.find((t) => t.playerId === 'player_1')!;
  assert.equal(t1.keyframes.length, 2);
  assert.equal(t1.keyframes[0].state, 'unknown'); // alive=null → unknown, never false
  // round-start event emitted
  assert.equal(r.events.filter((e) => e.kind === 'roundStart').length, 1);
  // loads cleanly
  const loaded = loadReplay(r);
  assert.equal(stateAt(loaded, 500).players.length, 2);
});

test('fromReplayParser: provenance.synthetic → source synthetic', () => {
  const r = fromReplayParser({
    meta: { mapName: 'Ascent', provenance: { synthetic: true } },
    rounds: [], positions: [{ roundNum: 1, actorGuid: 1, matchTimeMs: 0, worldPos: { x: 0, y: 0, z: 0 }, facingDeg: null, alive: null }],
  });
  assert.equal(r.meta.source, 'synthetic');
});

test('fromSimEventLog: move→tracks, kill→event, rounds, source simulated', () => {
  const events = [
    { seq: 0, tick: 0, timeMs: 0, kind: 'roundStart', roundNumber: 1 },
    { seq: 1, tick: 1, timeMs: 1000, kind: 'move', playerId: 'p1', from: { x: 0, y: 0, z: 0 }, to: { x: 10, y: 0, z: 0 } },
    { seq: 2, tick: 2, timeMs: 2000, kind: 'move', playerId: 'p1', from: { x: 10, y: 0, z: 0 }, to: { x: 20, y: 0, z: 0 } },
    { seq: 3, tick: 3, timeMs: 2500, kind: 'kill', victim: 'p2', killer: 'p1', cause: 'weapon', weaponId: 'Vandal' },
    { seq: 4, tick: 4, timeMs: 3000, kind: 'spikePlanted', playerId: 'p1', at: { x: 5, y: 5, z: 0 } },
    { seq: 5, tick: 5, timeMs: 4000, kind: 'roundEnd', winner: 'attack', reason: 'spikeDetonation' },
  ];
  const r = fromSimEventLog(events, { mapId: 'ascent', seed: 7 });
  assert.equal(r.meta.source, 'simulated');
  assert.equal(r.meta.seed, 7);
  assert.equal(r.rounds.length, 1);
  assert.equal(r.rounds[0].endMs, 4000);
  const p1 = r.tracks.find((t) => t.playerId === 'p1')!;
  assert.ok(p1.keyframes.length >= 2);
  assert.equal(r.events.filter((e) => e.kind === 'kill').length, 1);
  assert.equal(r.events.filter((e) => e.kind === 'plant').length, 1);
  // p2 appears as a player (seen via kill) even without a track
  assert.ok(r.players.some((p) => p.id === 'p2'));
  const loaded = loadReplay(r);
  assert.equal(stateAt(loaded, 1500).players.find((p) => p.playerId === 'p1')!.pos.x, 15);
});
