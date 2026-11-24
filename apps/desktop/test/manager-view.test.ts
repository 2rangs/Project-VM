// View logic of the in-match manager UI (src/renderer/matchday/manager.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IPC } from '../src/shared/ipc.ts';
import type { SessionState } from '../src/shared/ipc.ts';
import type { DecisionView, ManagerStateView, OpponentReportView } from '../src/shared/manager.ts';
import {
  alertKey, alertLine, decisionRows, moodBar, moodLabel, ourAlerts, pendingChoices, personalityTags, planForEngine,
  reaction, reportHeadlines, siteLean, sparkPath, talkPending,
} from '../src/renderer/matchday/manager.ts';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';

const mind = { players: [], tilt: 0, confidence: 0 };
const manager = (over: Partial<ManagerStateView> = {}): ManagerStateView => ({
  half: 1, timeoutsLeftThisHalf: { A: 1, B: 1 },
  shouts: { A: { tempo: 'normal', risk: 'normal', defense: 'normal' }, B: { tempo: 'normal', risk: 'normal', defense: 'normal' } },
  minds: { A: mind, B: mind }, alerts: [], halfTime: null, strategy: { A: null, B: null }, pendingPlanOptions: { A: [], B: [] },
  ...over,
});
const state = (m: ManagerStateView, round = 9, finished = false): SessionState => ({
  roundNumber: round, score: { A: 2, B: 6 }, attacker: 'A',
  economy: { A: { credits: 8000, ultPoints: 3 }, B: { credits: 20000, ultPoints: 4 } },
  timeoutsRemaining: { A: 2, B: 2 }, timeoutActive: { A: false, B: false }, finished, manager: m,
});

test('the pre-match report channel is part of the IPC contract', () => {
  assert.equal(IPC.prematchReport, 'pv:prematch:report');
});

test('mood labels use the engine tilt threshold; bars are centred on neutral', () => {
  assert.equal(moodLabel({ tilt: 0.5, confidence: 0 }), 'tilted');
  assert.equal(moodLabel({ tilt: 0.25, confidence: 0 }), 'shaky');
  assert.equal(moodLabel({ tilt: 0, confidence: 0.4 }), 'confident');
  assert.equal(moodLabel({ tilt: 0, confidence: 0.1 }), 'steady');
  assert.equal(moodBar(0), 50);
  assert.equal(moodBar(-1), 0);
  assert.equal(moodBar(2), 100);
  assert.deepEqual(personalityTags({ composure: 0.8, drive: 0.3 }), ['composed', 'reserved']);
  assert.deepEqual(personalityTags({ composure: 0.4, drive: 0.8 }), ['fragile', 'driven']);
});

test('auto-pause reads only OUR alerts for the round about to be played', () => {
  const m = manager({ alerts: [
    { kind: 'lossRun', team: 'A', round: 9, streak: 4 },
    { kind: 'lossRun', team: 'B', round: 9, streak: 4 },
    { kind: 'playerTilt', team: 'A', round: 8, player: { index: 1, handle: 'x', tilt: 0.5, key: true } },
  ] });
  const ours = ourAlerts(state(m));
  assert.deepEqual(ours.map((a) => a.kind), ['lossRun']);
  assert.equal(alertKey(ours), '9:lossRun:');
  assert.deepEqual(ourAlerts(state(m, 9, true)), []);
  assert.deepEqual(ourAlerts(null), []);
  assert.deepEqual(alertLine({ kind: 'playerTilt', team: 'A', round: 9, player: { index: 2, handle: 'aspas', tilt: 0.52, key: true } }), { key: 'mgr.alert.keyTilt', vars: { name: 'aspas', pct: 52 } });
  assert.equal(talkPending(manager({ halfTime: { pending: { A: true, B: false }, situation: { A: 'trailing', B: 'leading' } } })), true);
  assert.equal(talkPending(manager()), false);
});

test('talk reactions: lifted, unmoved, rattled', () => {
  assert.equal(reaction(0.08), 'lifted');
  assert.equal(reaction(0.01), 'unmoved');
  assert.equal(reaction(-0.05), 'rattled');
});

test('post-match rows: our decisions only, with the rounds before / after and the tilt', () => {
  const d = (over: Partial<DecisionView>): DecisionView => ({
    round: 9, team: 'A', by: 'human', kind: 'timeout', before: { score: { A: 2, B: 6 }, tilt: 0.3, confidence: 0 },
    roundsBefore: { won: 0, played: 3 }, roundsAfter: { won: 2, played: 3 }, tiltAfter: 0.1, ...over,
  });
  const rows = decisionRows([d({}), d({ team: 'B', by: 'ai' }), d({ kind: 'talk', talk: 'calm', round: 13 }), d({ kind: 'timeout', reason: 'lossRun', roundsAfter: { won: 0, played: 0 } })], 'A');
  assert.equal(rows.length, 3);
  assert.deepEqual([rows[0]!.key, rows[0]!.before, rows[0]!.after, rows[0]!.swing], ['mgr.dec.timeout', '0/3', '2/3', 2]);
  assert.equal(rows[1]!.vars.talk, 'calm');
  assert.equal(rows[2]!.key, 'mgr.dec.timeout.reason');
  assert.equal(rows[2]!.swing, null);
  assert.match(sparkPath([0, 0.5, 1], 100, 10), /^M0\.0,10\.0 L50\.0,5\.0 L100\.0,0\.0$/);
});

test('report headlines lean only on evidence that is there, and flag thin samples', () => {
  const ev = (a: number, rounds: number) => ({ counts: { A: a * rounds, B: (1 - a) * rounds }, rounds, share: { A: a, B: 1 - a } });
  assert.deepEqual(siteLean(ev(0.7, 12)), { site: 'A', share: 0.7, rounds: 12, thin: false });
  assert.equal(siteLean(ev(0.55, 12)).site, null);
  assert.equal(siteLean(ev(0.2, 3)).thin, true);
  const report = {
    sites: { map: { attack: ev(0.5, 2), defense: ev(0.5, 2) }, all: { attack: ev(0.75, 20), defense: ev(0.3, 10) } },
    pistol: { won: { n: 4, rate: 0.5 }, attackSiteA: { n: 2, rate: 0.5 }, forceAfterLoss: { n: 2, rate: 1 } },
    eco: { forceAfterLoss: { n: 10, rate: 0.4 }, fullBuy: { n: 20, rate: 0.7 } },
    players: [{ handle: 'aspas', tag: 'danger' }], gamesReviewed: 2,
  } as unknown as OpponentReportView;
  const lines = reportHeadlines(report);
  assert.deepEqual(lines.map((l) => l.key), ['pre.head.attack', 'pre.head.defense', 'pre.head.pistolForce', 'pre.head.ecoForce', 'pre.head.danger']);
  assert.equal(lines[0]!.vars.site, 'A');
  assert.equal(lines[1]!.vars.site, 'B');
  assert.equal(lines[2]!.thin, true); // two pistol losses is not a habit
  for (const l of lines) { assert.ok(ko[l.key], `ko missing ${l.key}`); assert.ok(en[l.key], `en missing ${l.key}`); }
});

test('plan: only what differs from the IGL is sent; engine-pending options are carried and listed', () => {
  assert.equal(planForEngine({ tempo: 'normal', risk: 'normal', defense: 'normal', useScouting: false }), undefined);
  assert.deepEqual(planForEngine({ tempo: 'fast', attackLean: { site: 'B', strength: 0 }, defenseLean: { site: 'A', strength: 5 } }), { defenseLean: { site: 'A', strength: 5 }, tempo: 'fast' });
  const plan = { pending: { plantPreference: { A: 'safe' as const, B: 'auto' as const }, midControl: 'auto' as const } };
  assert.deepEqual(pendingChoices(plan), ['plantPreference']);
  assert.deepEqual(planForEngine(plan), { pending: plan.pending });
});

test('every manager / pre-match key exists in both languages', () => {
  const keys = Object.keys(ko).filter((k) => k.startsWith('mgr.') || k.startsWith('pre.'));
  assert.ok(keys.length > 40, `only ${keys.length} manager keys`);
  for (const k of keys) assert.ok(en[k], `en missing ${k}`);
});
