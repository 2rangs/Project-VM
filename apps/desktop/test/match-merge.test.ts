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

test('perception: side-based round tracks remap to real teams and offset onto the match timeline', () => {
  // Round 1: A attacks. Round 2: B attacks (side swap). Each round has an attack
  // track (teamIdx 0) and a defense track (teamIdx 1), round-relative tMs.
  const withPerc: RawMatch = {
    ...raw,
    rounds: [
      {
        ...raw.rounds[0], attacker: 'A',
        perception: [
          { teamIdx: 0, side: 'attack', snapshots: [{ tMs: 1000, observedEnemies: [], beliefZones: [{ zone: 'a-site', p: 0.5 }] }] },
          { teamIdx: 1, side: 'defense', snapshots: [{ tMs: 1000, observedEnemies: [], beliefZones: [{ zone: 'a-main', p: 0.3 }] }] },
        ],
      },
      {
        ...raw.rounds[1], attacker: 'B',
        perception: [
          { teamIdx: 0, side: 'attack', snapshots: [{ tMs: 2000, observedEnemies: [], beliefZones: [{ zone: 'b-site', p: 0.8 }] }] },
          { teamIdx: 1, side: 'defense', snapshots: [{ tMs: 2000, observedEnemies: [], beliefZones: [{ zone: 'b-main', p: 0.4 }] }] },
        ],
      },
    ],
  };
  const { perception } = mergeMatch(withPerc);
  assert.ok(perception);
  assert.equal(perception!.length, 2);
  const teamA = perception!.find((t) => t.teamIdx === 0)!;
  const teamB = perception!.find((t) => t.teamIdx === 1)!;
  // Team A: attacked R1 (a-site belief), defended R2 (b-main belief). Both land under team A.
  const aZones = teamA.snapshots.map((s) => s.beliefZones[0]?.zone);
  assert.deepEqual(aZones, ['a-site', 'b-main']);
  // Team B: defended R1 (a-main), attacked R2 (b-site).
  const bZones = teamB.snapshots.map((s) => s.beliefZones[0]?.zone);
  assert.deepEqual(bZones, ['a-main', 'b-site']);
  // R2 snapshots are offset past R1 (round-relative 2000 → match-level > round 1's max).
  assert.ok(teamA.snapshots[1].tMs > teamA.snapshots[0].tMs + 2000);
});

test('merged events build a loadable multi-round Replay', () => {
  const { events } = mergeMatch(raw);
  const replay = fromSimEventLog(events as SimEvent[], { mapId: 'ascent', mapDisplayName: 'Ascent', seed: 42 });
  const loaded = loadReplay(replay);
  assert.equal(loaded.rounds.length, 2);
  assert.ok(loaded.events.some((e) => e.kind === 'kill'));
  assert.ok(loaded.events.some((e) => e.kind === 'plant'));
});
