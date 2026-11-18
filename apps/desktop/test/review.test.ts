// Unit tests for post-match review derivations (review.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMvp, economySeries, rosterFor } from '../src/renderer/review.ts';
import { players } from '../src/renderer/data.ts';
import type { MatchSummary } from '../src/shared/ipc.ts';
import type { Replay } from '@pv/replay-engine';

function round(n: number, attacker: 'A' | 'B', over: Partial<MatchSummary['rounds'][number]> = {}): MatchSummary['rounds'][number] {
  return {
    roundNumber: n, phase: n === 1 ? 'pistol' : 'regulation', attacker,
    winner: 'A', winnerSide: 'attack', reason: 'elimination', planted: false,
    score: { A: n, B: 0 }, kills: { A: 5, B: 0 },
    economy: { A: { credits: 1000 * n, ultPoints: n }, B: { credits: 500 * n, ultPoints: 0 } },
    buys: { A: { tier: 'full', weapon: 'Vandal' }, B: { tier: 'eco', weapon: 'Classic' } },
    ...over,
  };
}
const match: MatchSummary = {
  teams: { A: { id: 'a', name: 'Alpha' }, B: { id: 'b', name: 'Bravo' } },
  map: 'ascent', seed: 1, winner: 'A', score: { A: 2, B: 0 }, wentToOvertime: false,
  rounds: [round(1, 'A'), round(2, 'B')],
};

// Replay with kill events only (the shape computeMvp reads).
const replay = {
  meta: { source: 'simulation', mapId: 'ascent' },
  players: [], tracks: [], rounds: [],
  events: [
    // round 1: A attacks → atk* = team A, def* = team B
    { tMs: 1000, roundNum: 1, kind: 'kill', actorId: 'atk1', victimId: 'def1' },
    { tMs: 2000, roundNum: 1, kind: 'kill', actorId: 'atk1', victimId: 'def2' },
    // round 2: B attacks → atk* = team B, def* = team A
    { tMs: 3000, roundNum: 2, kind: 'kill', actorId: 'atk3', victimId: 'def4' },
  ],
} as unknown as Replay;

test('economySeries returns both teams credits per round', () => {
  const s = economySeries(match);
  assert.deepEqual(s, [{ round: 1, a: 1000, b: 500 }, { round: 2, a: 2000, b: 1000 }]);
});

test('rosterFor is deterministic, length 5, distinct, and team-specific', () => {
  const pool = players();
  const r1 = rosterFor('Alpha', pool);
  const r2 = rosterFor('Alpha', pool);
  assert.equal(r1.length, 5);
  assert.deepEqual(r1, r2); // deterministic
  assert.equal(new Set(r1).size, 5); // distinct
  assert.notDeepEqual(rosterFor('Bravo', pool), r1); // different team → different handles
});

test('computeMvp attributes kills/deaths to the right real team via round attacker', () => {
  const { mvp, lines } = computeMvp(match, replay);
  // atk1 scored 2 kills in round 1 (team A) → team A slot 1 has 2 kills, top MVP.
  assert.ok(mvp);
  assert.equal(mvp!.team, 'A');
  assert.equal(mvp!.slot, 1);
  assert.equal(mvp!.kills, 2);
  // round 2 atk3 = team B slot 3 scored 1 kill; def4 = team A slot 4 died.
  const bSlot3 = lines.find((l) => l.team === 'B' && l.slot === 3)!;
  assert.equal(bSlot3.kills, 1);
  const aSlot4 = lines.find((l) => l.team === 'A' && l.slot === 4)!;
  assert.equal(aSlot4.deaths, 1);
  assert.equal(aSlot4.survived, match.rounds.length - 1);
  // every line carries a real handle (not an empty/placeholder)
  assert.ok(lines.every((l) => l.handle && !l.handle.startsWith('P')));
});
