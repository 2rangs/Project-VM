// IPC contract + stub-runner unit tests. Pins the channel names and the
// sim→replay data path so main and renderer can't drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IPC } from '../src/shared/ipc.ts';
import { StubRunner } from '../src/shared/sim.ts';
// Node (strip-types) can't resolve the Vite/tsconfig '@pv/replay-engine' alias,
// so import the engine source directly in this unit test.
import { fromSimEventLog, loadReplay, stateAt, type SimEvent } from '../../../packages/replay-engine/src/index.ts';
import { ASCENT_TRANSFORM } from '../src/shared/ascent-transform.ts';

test('IPC channel names are the stable contract', () => {
  assert.equal(IPC.simRun, 'pv:sim:run');
  assert.equal(IPC.simProgress, 'pv:sim:progress');
  assert.equal(IPC.traceLoad, 'pv:trace:load');
  assert.equal(IPC.traceList, 'pv:trace:list');
});

test('StubRunner emits a deterministic, convertible event log + streams progress', async () => {
  const progress: number[] = [];
  const a = await new StubRunner().run({ mapId: 'ascent', seed: 7, rounds: 2 }, (p) => progress.push(p.pct));
  const b = await new StubRunner().run({ mapId: 'ascent', seed: 7, rounds: 2 }, () => {});
  assert.deepEqual(a, b, 'same seed → identical log (deterministic)');
  assert.ok(progress.length >= 2 && progress[progress.length - 1] === 1, 'progress reaches 100%');
  assert.ok(a.some((e) => e.kind === 'move'));
  assert.ok(a.some((e) => e.kind === 'kill'));
  assert.ok(a.some((e) => e.kind === 'roundStart'));
});

test('sim event log → Replay via fromSimEventLog loads and plays', async () => {
  const events = await new StubRunner().run({ mapId: 'ascent', seed: 1, rounds: 1 }, () => {});
  const replay = fromSimEventLog(events as SimEvent[], {
    mapId: 'ascent', mapDisplayName: 'Ascent', seed: 1, coordinateTransform: ASCENT_TRANSFORM,
  });
  assert.equal(replay.meta.source, 'simulated');
  assert.equal(replay.meta.seed, 1);
  const loaded = loadReplay(replay);
  assert.equal(loaded.rounds.length, 1);
  assert.ok(loaded.tracks.length >= 3, 'three actors tracked');
  const snap = stateAt(loaded, 5000);
  assert.ok(snap.players.length >= 1);
});
