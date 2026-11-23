// Unit tests for the round-decisions view model (src/renderer/decisions.ts): the
// mapping from the engine's RoundRecord.decisions to what the Review screen renders.
// Fixtures are shaped exactly like real match-runner output (see the samples in
// test/engine-contract.test.ts, which checks the live engine still emits this shape).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptationSummary, confidenceLevel, formatClock, matchNotes, parseCall, roundNote, siteOfZone,
} from '../src/renderer/decisions.ts';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import type { MatchRoundSummary, MatchSummary, OpponentRead, RoundDecisions, TendencyEstimate } from '../src/shared/ipc.ts';

const est = (pA: number, confidence: number, samples: number): TendencyEstimate =>
  ({ probability: { A: pA, B: 1 - pA }, confidence, samples });
const NO_DATA = est(0.5, 0, 0);
const read = (attack: TendencyEstimate, defense: TendencyEstimate): OpponentRead => ({ attackSite: attack, defenseSite: defense });

function round(n: number, attacker: 'A' | 'B', winner: 'A' | 'B', decisions?: RoundDecisions | null): MatchRoundSummary {
  return {
    roundNumber: n, phase: n === 1 ? 'pistol' : 'regulation', attacker, winner,
    winnerSide: winner === attacker ? 'attack' : 'defense', reason: 'elimination', planted: false,
    score: { A: 0, B: 0 }, kills: { A: 0, B: 0 },
    economy: { A: { credits: 800, ultPoints: 0 }, B: { credits: 800, ultPoints: 0 } },
    buys: { A: { tier: 'pistol', weapon: 'Classic' }, B: { tier: 'pistol', weapon: 'Classic' } },
    ...(decisions !== undefined ? { decisions } : {}),
  };
}

// R1: first round of a match. A (attack) holds its opening call; B (defense) rotates.
// Both reads exist but carry no data yet.
const R1: RoundDecisions = {
  plans: {
    A: { opening: 'midControl', strategy: 'midControl', objective: null, feint: null, revisions: [] },
    B: {
      opening: 'defaultHold', strategy: 'stackB', objective: null, feint: null,
      revisions: [{ atMs: 80000, from: 'defaultHold', to: 'stackB', reason: 'enemies reading B — rotate/stack B' }],
    },
  },
  opponentReadBefore: { A: read(NO_DATA, NO_DATA), B: read(NO_DATA, NO_DATA) },
  observed: { plantSite: null, firstContactSite: 'B', defendersMet: { B: 1 } },
};

// R5: A fakes B and goes A, reading the defence as B-heavy (medium confidence). B expects
// the attack on B (medium) but opens in a default hold. The round shows contact on B only.
const R5: RoundDecisions = {
  plans: {
    A: { opening: 'fakeBtoA', strategy: 'fakeBtoA', objective: 'a-site', feint: 'b-site', revisions: [] },
    B: { opening: 'defaultHold', strategy: 'defaultHold', objective: null, feint: null, revisions: [] },
  },
  opponentReadBefore: { A: read(NO_DATA, est(0.21, 0.58, 2.57)), B: read(est(0.33, 0.51, 2.09), NO_DATA) },
  observed: { plantSite: null, firstContactSite: 'B', defendersMet: { B: 2, A: 2 } },
};

test('confidenceLevel: none at 0, low under 0.4, medium under 0.6, high above', () => {
  assert.equal(confidenceLevel(0), 'none');
  assert.equal(confidenceLevel(0.2), 'low');
  assert.equal(confidenceLevel(0.353), 'low'); // one observation, ordinary team
  assert.equal(confidenceLevel(0.4), 'medium');
  assert.equal(confidenceLevel(0.59), 'medium');
  assert.equal(confidenceLevel(0.6), 'high');
  assert.equal(confidenceLevel(Number.NaN), 'none');
});

test('parseCall recognises strategy ids, the slow suffix and site commits; the rest stays raw', () => {
  assert.deepEqual(parseCall('aExecute'), { kind: 'strategy', id: 'aExecute', slow: false });
  assert.deepEqual(parseCall('midControl (slow)'), { kind: 'strategy', id: 'midControl', slow: true });
  assert.deepEqual(parseCall('commit B'), { kind: 'commit', site: 'B' });
  assert.deepEqual(parseCall('some new engine call'), { kind: 'raw', text: 'some new engine call' });
});

test('siteOfZone and formatClock', () => {
  assert.equal(siteOfZone('a-site'), 'A');
  assert.equal(siteOfZone('b-main'), 'B');
  assert.equal(siteOfZone('spawn'), 'spawn');
  assert.equal(siteOfZone(null), null);
  assert.equal(formatClock(83100), '1:23');
  assert.equal(formatClock(100000), '1:40');
  assert.equal(formatClock(9500), '0:09');
  assert.equal(formatClock(-5), '0:00');
});

test('a round with no revisions: opening call is the final call, nothing to list', () => {
  const n = roundNote(round(1, 'A', 'B', R1))!;
  const a = n.teams.A;
  assert.equal(a.side, 'attack');
  assert.equal(a.won, false);
  assert.deepEqual(a.plan!.opening, { kind: 'strategy', id: 'midControl', slow: false });
  assert.deepEqual(a.plan!.final, a.plan!.opening);
  assert.equal(a.plan!.changed, false);
  assert.deepEqual(a.plan!.revisions, []);
  assert.equal(a.plan!.objective, null);
  assert.equal(a.plan!.feint, null);
});

test('a revision keeps its round clock, both calls and the engine reason verbatim', () => {
  const n = roundNote(round(1, 'A', 'B', R1))!;
  const b = n.teams.B;
  assert.equal(b.side, 'defense');
  assert.equal(b.plan!.changed, true);
  assert.deepEqual(b.plan!.final, { kind: 'strategy', id: 'stackB', slow: false });
  assert.deepEqual(b.plan!.revisions, [{
    atMs: 80000, clock: '1:20',
    from: { kind: 'strategy', id: 'defaultHold', slow: false },
    to: { kind: 'strategy', id: 'stackB', slow: false },
    reason: 'enemies reading B — rotate/stack B',
  }]);
  assert.equal(n.revised, true);
  assert.equal(n.feint, false);
});

test('a read with no data yet is level "none": no lean, no stance, no check', () => {
  const n = roundNote(round(1, 'A', 'B', R1))!;
  for (const team of ['A', 'B'] as const) {
    const t = n.teams[team];
    assert.ok(t.read, 'read object present');
    assert.equal(t.read!.attack.level, 'none');
    assert.equal(t.read!.defense.level, 'none');
    assert.equal(t.read!.attack.lean, null);
    assert.deepEqual(t.read!.attack.pct, { A: 50, B: 50 });
    assert.equal(t.stance, null);
    assert.equal(t.check, null);
  }
});

test('the read that matters is the opponent\'s behaviour on the OTHER side', () => {
  const n = roundNote(round(5, 'A', 'A', R5))!;
  assert.equal(n.teams.A.read!.defense.used, true);   // attacking → where they defend
  assert.equal(n.teams.A.read!.attack.used, false);
  assert.equal(n.teams.B.read!.attack.used, true);    // defending → where they attack
  assert.equal(n.teams.B.read!.defense.used, false);
});

test('a null read (opponent memory off) maps to read: null and no judgements', () => {
  const d: RoundDecisions = { ...R5, opponentReadBefore: { A: null, B: null } };
  const n = roundNote(round(5, 'A', 'A', d))!;
  assert.equal(n.teams.A.read, null);
  assert.equal(n.teams.B.read, null);
  assert.equal(n.teams.A.stance, null);
  assert.equal(n.teams.A.check, null);
  // the plan and the observations are still there
  assert.equal(n.teams.A.plan!.objective, 'A');
  assert.deepEqual(n.teams.A.learned, { kind: 'defenders', met: { A: 2, B: 2 } });
});

test('a null read on one team only leaves the other team\'s read intact', () => {
  const d: RoundDecisions = { ...R5, opponentReadBefore: { A: null, B: R5.opponentReadBefore.B } };
  const n = roundNote(round(5, 'A', 'A', d))!;
  assert.equal(n.teams.A.read, null);
  assert.equal(n.teams.B.read!.attack.lean, 'B');
});

test('fake: objective and feint become site letters; attacking away from the stack is "with" the read', () => {
  const n = roundNote(round(5, 'A', 'A', R5))!;
  const a = n.teams.A;
  assert.equal(a.plan!.objective, 'A');
  assert.equal(a.plan!.feint, 'B');
  assert.equal(n.feint, true);
  assert.equal(n.revised, false);
  assert.deepEqual(a.read!.defense.pct, { A: 21, B: 79 });
  assert.equal(a.read!.defense.lean, 'B');
  assert.equal(a.read!.defense.level, 'medium');
  // defence read as B-heavy, opening goes A → with the read
  assert.deepEqual(a.stance, { kind: 'with', site: 'A', predicted: 'B' });
  // 2 defenders met on each site → the round neither confirms nor refutes it
  assert.deepEqual(a.check, { result: 'untested', predicted: 'B' });
});

test('defence: a call that picks no site is neutral; first contact confirms the read as weak evidence', () => {
  const n = roundNote(round(5, 'A', 'A', R5))!;
  const b = n.teams.B;
  assert.deepEqual(b.stance, { kind: 'neutral' });
  assert.deepEqual(b.check, { result: 'hit', predicted: 'B', actual: 'B', evidence: 'contact' });
  assert.deepEqual(b.learned, { kind: 'contact', site: 'B' });
});

test('defence stacking the expected site is "with", the other site "against"; a plant is firm evidence', () => {
  const mk = (opening: string): RoundDecisions => ({
    plans: {
      A: { opening: 'aExecute', strategy: 'aExecute', objective: 'a-site', feint: null, revisions: [] },
      B: { opening, strategy: opening, objective: null, feint: null, revisions: [] },
    },
    opponentReadBefore: { A: read(NO_DATA, NO_DATA), B: read(est(0.3, 0.62, 3.3), NO_DATA) },
    observed: { plantSite: 'A', firstContactSite: 'B', defendersMet: { A: 3 } },
  });
  const withRead = roundNote(round(6, 'A', 'A', mk('stackB')))!.teams.B;
  assert.equal(withRead.read!.attack.level, 'high');
  assert.deepEqual(withRead.stance, { kind: 'with', site: 'B', predicted: 'B' });
  // expected B, they planted A → miss; the plant outranks the first contact
  assert.deepEqual(withRead.check, { result: 'miss', predicted: 'B', actual: 'A', evidence: 'plant' });
  assert.deepEqual(withRead.learned, { kind: 'plant', site: 'A' });
  const against = roundNote(round(6, 'A', 'A', mk('stackA')))!.teams.B;
  assert.deepEqual(against.stance, { kind: 'against', site: 'A', predicted: 'B' });
  // attackers: defenders met only on A → that is what they learned
  assert.deepEqual(roundNote(round(6, 'A', 'A', mk('stackB')))!.teams.A.learned, { kind: 'defenders', met: { A: 3, B: 0 } });
});

test('a low-confidence read is flagged low, still checked, but never credited as driving the call', () => {
  const d: RoundDecisions = {
    plans: {
      A: { opening: 'bExecute', strategy: 'bExecute', objective: 'b-site', feint: null, revisions: [] },
      B: { opening: 'stackB', strategy: 'stackB', objective: null, feint: null, revisions: [] },
    },
    opponentReadBefore: { A: read(NO_DATA, est(0.32, 0.2, 0.5)), B: read(est(0.4, 0.2, 0.5), NO_DATA) },
    observed: { plantSite: 'B', firstContactSite: 'B', defendersMet: { B: 2 } },
  };
  const n = roundNote(round(2, 'A', 'B', d))!;
  assert.equal(n.teams.B.read!.attack.level, 'low');
  assert.equal(n.teams.B.read!.attack.lean, 'B');
  assert.equal(n.teams.B.stance, null);
  assert.deepEqual(n.teams.B.check, { result: 'hit', predicted: 'B', actual: 'B', evidence: 'plant' });
  assert.equal(n.teams.A.stance, null);
  assert.deepEqual(n.teams.A.check, { result: 'hit', predicted: 'B', actual: 'B', evidence: 'defenders' });
});

test('an even split is not a lean, whatever the confidence', () => {
  const d: RoundDecisions = { ...R5, opponentReadBefore: { A: read(NO_DATA, est(0.51, 0.7, 5)), B: R5.opponentReadBefore.B } };
  const a = roundNote(round(5, 'A', 'A', d))!.teams.A;
  assert.equal(a.read!.defense.level, 'high');
  assert.equal(a.read!.defense.lean, null);
  assert.equal(a.stance, null);
  assert.equal(a.check, null);
});

test('slow default: the commit shows as a revision although the call id never changes', () => {
  const d: RoundDecisions = {
    plans: {
      A: {
        opening: 'midControl', strategy: 'midControl', objective: 'b-site', feint: null,
        revisions: [{ atMs: 40000, from: 'midControl (slow)', to: 'commit B', reason: 'clock — commit with the information gathered' }],
      },
      B: null,
    },
    opponentReadBefore: { A: null, B: null },
    observed: { plantSite: null, firstContactSite: null, defendersMet: {} },
  };
  const n = roundNote(round(3, 'A', 'B', d))!;
  assert.equal(n.teams.A.plan!.changed, false);
  assert.deepEqual(n.teams.A.plan!.revisions[0].from, { kind: 'strategy', id: 'midControl', slow: true });
  assert.deepEqual(n.teams.A.plan!.revisions[0].to, { kind: 'commit', site: 'B' });
  assert.equal(n.teams.A.plan!.revisions[0].clock, '0:40');
  assert.equal(n.revised, true);
  // a team with no recorded plan, and a round that showed nothing
  assert.equal(n.teams.B.plan, null);
  assert.deepEqual(n.teams.B.learned, { kind: 'nothing' });
  assert.deepEqual(n.teams.A.learned, { kind: 'nothing' });
  assert.deepEqual(n.observed, { plantSite: null, firstContactSite: null, defendersMet: { A: 0, B: 0 } });
});

test('rounds without decisions (older engine, stub) map to null and are skipped', () => {
  assert.equal(roundNote(round(1, 'A', 'A')), null);
  assert.equal(roundNote(round(1, 'A', 'A', null)), null);
  const match: MatchSummary = {
    teams: { A: { id: 'a', name: 'Alpha' }, B: { id: 'b', name: 'Bravo' } },
    map: 'ascent', seed: 1, winner: 'A', score: { A: 2, B: 0 }, wentToOvertime: false,
    rounds: [round(1, 'A', 'B', R1), round(2, 'A', 'A'), round(5, 'A', 'A', R5)],
  };
  assert.deepEqual(matchNotes(match).map((n) => n.roundNumber), [1, 5]);
});

test('adaptationSummary counts revisions, fakes, read-driven openings and read accuracy per team', () => {
  const match: MatchSummary = {
    teams: { A: { id: 'a', name: 'Alpha' }, B: { id: 'b', name: 'Bravo' } },
    map: 'ascent', seed: 1, winner: 'A', score: { A: 1, B: 1 }, wentToOvertime: false,
    rounds: [round(1, 'A', 'B', R1), round(5, 'A', 'A', R5)],
  };
  const notes = matchNotes(match);
  assert.deepEqual(adaptationSummary(notes, 'A'), {
    rounds: 2, revisedRounds: 0, revisions: 0, feints: 1,
    readRounds: 1, withRead: 1, againstRead: 0, readTested: 0, readHits: 0,
  });
  assert.deepEqual(adaptationSummary(notes, 'B'), {
    rounds: 2, revisedRounds: 1, revisions: 1, feints: 0,
    readRounds: 1, withRead: 0, againstRead: 0, readTested: 1, readHits: 1,
  });
});

test('mergeMatch carries decisions and the pre-match options into the summary the Review reads', () => {
  const raw: RawMatch = {
    teams: { A: { id: 'a', name: 'Alpha' }, B: { id: 'b', name: 'Bravo' } },
    map: 'ascent', seed: 3, winner: 'B', score: { A: 0, B: 2 }, wentToOvertime: false,
    options: { opponentMemory: false, minThrowRates: { teams: { b: 0.01 } } },
    rounds: [
      { ...round(1, 'A', 'B'), replayEvents: [], decisions: R1 },
      { ...round(2, 'A', 'B'), replayEvents: [] }, // an engine that sent none
    ],
  };
  const { summary } = mergeMatch(raw);
  assert.deepEqual(summary.rounds[0].decisions, R1);
  assert.equal('decisions' in summary.rounds[1], false);
  assert.deepEqual(summary.options, { opponentMemory: false, minThrowRates: { teams: { b: 0.01 } } });
  assert.equal(matchNotes(summary).length, 1);
});
