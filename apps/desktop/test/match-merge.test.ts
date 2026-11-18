// Unit test for the match-runner → single-timeline merge (match-merge.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import { fromSimEventLog, loadReplay, type SimEvent } from '../../../packages/replay-engine/src/index.ts';

const raw: RawMatch = {
  teams: { A: { id: '1', name: 'NRG' }, B: { id: '2', name: 'Team Heretics' } },
  map: 'ascent', seed: 42, winner: 'B', score: { A: 0, B: 2 }, wentToOvertime: false,
  rounds: [
    {
      roundNumber: 1, phase: 'pistol', attacker: 'A', winner: 'B', winnerSide: 'defense', reason: 'elimination',
      planted: false, score: { A: 0, B: 1 }, kills: { A: 1, B: 2 },
      economy: { A: { credits: 2900, ultPoints: 1 }, B: { credits: 3800, ultPoints: 0 } },
      buys: { A: { tier: 'pistol', weapon: 'Classic' }, B: { tier: 'pistol', weapon: 'Classic' } },
      replayEvents: [
        { seq: 0, tick: 0, timeMs: 0, kind: 'roundStart', roundNumber: 1 },
        { seq: 1, tick: 10, timeMs: 5000, kind: 'kill', victim: 'atk1', killer: 'def1' },
      ],
    },
    {
      roundNumber: 2, phase: 'regulation', attacker: 'A', winner: 'B', winnerSide: 'defense', reason: 'timeExpired',
      planted: true, score: { A: 0, B: 2 }, kills: { A: 0, B: 1 },
      economy: { A: { credits: 1500, ultPoints: 1 }, B: { credits: 6000, ultPoints: 2 } },
      buys: { A: { tier: 'eco', weapon: 'Classic' }, B: { tier: 'full', weapon: 'Vandal' } },
      replayEvents: [
        { seq: 0, tick: 0, timeMs: 0, kind: 'roundStart', roundNumber: 1 },
        { seq: 1, tick: 8, timeMs: 3000, kind: 'spikePlanted', playerId: 'atk2', at: null },
      ],
    },
  ],
};

test('mergeMatch offsets rounds onto one timeline and renumbers roundStart', () => {
  const { events, summary } = mergeMatch(raw);
  // round 2's events are offset past round 1 (max 5000 + 5000 gap = 10000)
  const starts = events.filter((e) => (e as { kind: string }).kind === 'roundStart');
  assert.equal(starts.length, 2);
  assert.equal((starts[0] as unknown as { roundNumber: number }).roundNumber, 1);
  assert.equal((starts[1] as unknown as { roundNumber: number }).roundNumber, 2);
  assert.equal((starts[1] as unknown as { timeMs: number }).timeMs, 10000);
  // summary carries real economy/score, no replayEvents
  assert.equal(summary.score.B, 2);
  assert.equal(summary.winner, 'B');
  assert.equal(summary.rounds[1].economy.B.ultPoints, 2);
  assert.ok(!('replayEvents' in summary.rounds[0]));
});

test('merged events build a loadable multi-round Replay', () => {
  const { events } = mergeMatch(raw);
  const replay = fromSimEventLog(events as SimEvent[], { mapId: 'ascent', mapDisplayName: 'Ascent', seed: 42 });
  const loaded = loadReplay(replay);
  assert.equal(loaded.rounds.length, 2);
  assert.ok(loaded.events.some((e) => e.kind === 'kill'));
  assert.ok(loaded.events.some((e) => e.kind === 'plant'));
});
