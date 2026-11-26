// Unit tests for the spectator features (src/renderer/matchday): highlight playback plan and the
// live round win-probability estimate. Uses the same real two-round fixture as matchday-logic, plus
// small synthetic rounds for the terminal / skip edges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeMatch, type RawMatch } from '../../src/shared/match-merge.ts';
import { fromSimEventLog, type Replay } from '../../../../packages/replay-engine/src/index.ts';
import { buildNav, type NavData } from '../../src/renderer/matchday/nav.ts';
import { buildTimeline, type MatchTimeline, type PlayerRound, type RoundTimeline, type TeamSlot } from '../../src/renderer/matchday/timeline.ts';
import {
  advanceHighlighted, HIGHLIGHT_LEVELS, isHighlightLevel, mergeWindows, nextWindowStart,
  roundPlayWindows, windowAt, type PlayWindow,
} from '../../src/renderer/matchday/highlights.ts';
import { attackerWinProb, swingMoments, teamWinProb } from '../../src/renderer/matchday/winprob.ts';
import { situationAt } from '../../src/renderer/matchday/monitor.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(path.resolve(here, p), 'utf8'));
const nav = buildNav(readJson('../../src/data/sim/ascent.navgraph.json') as NavData);
const raw = readJson('../fixtures/matchday/match-sample.json') as RawMatch;
function load(): MatchTimeline {
  const { events, summary, perception } = mergeMatch(raw);
  const replay: Replay = fromSimEventLog(events, { mapId: 'ascent', perception });
  return buildTimeline(replay, summary, nav);
}
const tl = load();
const real = tl.rounds[0];

// A minimal synthetic round for the terminal/skip cases: 5 v 5, atk = A, with controllable deaths.
function synthRound(opts: {
  attacker?: TeamSlot; deaths?: Record<string, number>; plant?: number; defuse?: number;
  endMs?: number; endReason?: string | null; winner?: TeamSlot; equip?: { A: number; B: number };
} = {}): RoundTimeline {
  const attacker = opts.attacker ?? 'A';
  const defender: TeamSlot = attacker === 'A' ? 'B' : 'A';
  const mk = (side: 'atk' | 'def', slot: number): PlayerRound => {
    const id = `${side}${slot}`;
    return {
      id, team: side === 'atk' ? attacker : defender, side: side === 'atk' ? 'attack' : 'defense', slot,
      spawn: { x: 0, y: 0, z: 0 }, spawnZone: 'attacker-spawn', hops: [], continuous: false,
      deathMs: opts.deaths?.[id] ?? null, killerId: null,
    };
  };
  const players = [1, 2, 3, 4, 5].flatMap((s) => [mk('atk', s), mk('def', s)]);
  const endMs = opts.endMs ?? 100000;
  const plant = opts.plant != null
    ? { tMs: opts.plant, startMs: opts.plant - 4000, playerId: 'atk1', pos: null, zone: 'a-site', site: 'A' as const }
    : null;
  const defuse = opts.defuse != null
    ? { tMs: opts.defuse, startMs: opts.defuse - 7000, playerId: 'def1', pos: null, zone: 'a-site', site: 'A' as const }
    : null;
  return {
    roundNum: 1, startMs: 0, buyStartMs: -30000, endMs, attacker, players,
    kills: [], plant, defuse, abilities: [],
    endReason: opts.endReason ?? null, hasTracks: false,
    summary: {
      roundNumber: 1, phase: 'regulation', attacker, winner: opts.winner ?? attacker, winnerSide: 'attack',
      reason: opts.endReason ?? 'elimination', planted: plant != null, score: { A: 0, B: 0 }, kills: { A: 0, B: 0 },
      economy: { A: { credits: 0, ultPoints: 0 }, B: { credits: 0, ultPoints: 0 } },
      buys: {
        A: { tier: 'full', weapon: 'vandal', loadoutValue: opts.equip?.A ?? 3900 },
        B: { tier: 'full', weapon: 'vandal', loadoutValue: opts.equip?.B ?? 3900 },
      },
    },
  } as RoundTimeline;
}

// ── highlights: windows ──────────────────────────────────────────────────────────────────

test('highlights: level guard and the four levels exist', () => {
  assert.deepEqual([...HIGHLIGHT_LEVELS], ['instant', 'key', 'extended', 'full']);
  assert.ok(isHighlightLevel('key'));
  assert.ok(!isHighlightLevel('nope'));
});

test('highlights: full is the whole round, instant plays nothing', () => {
  assert.deepEqual(roundPlayWindows(real, 'full'), [{ startMs: real.buyStartMs, endMs: real.endMs }]);
  assert.deepEqual(roundPlayWindows(real, 'instant'), []);
});

test('highlights: key ⊆ extended ⊆ full in coverage, all within the round', () => {
  const span = (ws: PlayWindow[]) => ws.reduce((s, w) => s + (w.endMs - w.startMs), 0);
  const key = roundPlayWindows(real, 'key');
  const ext = roundPlayWindows(real, 'extended');
  for (const ws of [key, ext]) for (const w of ws) {
    assert.ok(w.startMs >= real.buyStartMs && w.endMs <= real.endMs, 'window within the round');
    assert.ok(w.endMs > w.startMs, 'window non-empty');
  }
  assert.ok(span(key) <= span(ext), 'key shows no more than extended');
  assert.ok(span(ext) < (real.endMs - real.buyStartMs), 'extended skips some dead time');
  // windows are sorted and non-overlapping after the merge
  for (let i = 1; i < ext.length; i++) assert.ok(ext[i].startMs > ext[i - 1].endMs);
});

test('highlights: every round always ends on its result', () => {
  for (const level of ['key', 'extended'] as const) {
    const ws = roundPlayWindows(real, level);
    assert.equal(ws[ws.length - 1].endMs, real.endMs, `${level} reaches the round end`);
  }
});

test('highlights: mergeWindows joins near/overlapping spans and clamps', () => {
  const merged = mergeWindows([{ startMs: 0, endMs: 100 }, { startMs: 120, endMs: 200 }, { startMs: 1000, endMs: 1100 }], -50, 5000);
  assert.deepEqual(merged, [{ startMs: 0, endMs: 200 }, { startMs: 1000, endMs: 1100 }]);
  assert.deepEqual(mergeWindows([{ startMs: -100, endMs: 50 }], 0, 40), [{ startMs: 0, endMs: 40 }]);
});

// ── highlights: playhead advance ───────────────────────────────────────────────────────────

test('highlights: advance plays within a window and stops at the end', () => {
  const ws: PlayWindow[] = [{ startMs: 1000, endMs: 2000 }];
  assert.deepEqual(advanceHighlighted(ws, 1000, 100, 5000), { t: 1100, done: false });
  assert.deepEqual(advanceHighlighted(ws, 1950, 100, 5000), { t: 5000, done: true }, 'past the last window → round end');
});

test('highlights: advance skips the gap to the next window', () => {
  const ws: PlayWindow[] = [{ startMs: 1000, endMs: 2000 }, { startMs: 4000, endMs: 4500 }];
  // crossing out of window 1 into the gap jumps to window 2's start
  assert.deepEqual(advanceHighlighted(ws, 1950, 200, 10000), { t: 4000, done: false });
  // starting before the first window jumps forward to it
  assert.deepEqual(advanceHighlighted(ws, 0, 100, 10000), { t: 1000, done: false });
});

test('highlights: an empty plan (instant) finishes immediately', () => {
  assert.deepEqual(advanceHighlighted([], 0, 100, 7000), { t: 7000, done: true });
});

test('highlights: windowAt / nextWindowStart', () => {
  const ws: PlayWindow[] = [{ startMs: 100, endMs: 200 }, { startMs: 400, endMs: 500 }];
  assert.ok(windowAt(ws, 150));
  assert.equal(windowAt(ws, 300), null);
  assert.equal(nextWindowStart(ws, 150), 400);
  assert.equal(nextWindowStart(ws, 450), null);
});

// ── win probability ─────────────────────────────────────────────────────────────────────────

test('winprob: pinned to the engine outcome once the round is over', () => {
  const r = synthRound({ endMs: 40000, endReason: 'elimination', winner: 'A' });
  assert.equal(attackerWinProb(r, 45000), 1);
  assert.equal(teamWinProb(r, 45000, 'B'), 0);
  const rB = synthRound({ endMs: 40000, endReason: 'elimination', winner: 'B' });
  assert.equal(attackerWinProb(rB, 45000), 0);
});

test('winprob: a man advantage favours the side that has it', () => {
  const even = attackerWinProb(synthRound({}), 10000);
  assert.ok(Math.abs(even - 0.5) < 0.12, 'even 5v5 near a coin flip');
  const up = attackerWinProb(synthRound({ deaths: { def1: 5000, def2: 5000 } }), 10000); // 5 atk v 3 def
  const down = attackerWinProb(synthRound({ deaths: { atk1: 5000, atk2: 5000 } }), 10000); // 3 atk v 5 def
  assert.ok(up > even && up > 0.65, 'two-man up strongly favours attackers');
  assert.ok(down < even && down < 0.35, 'two-man down strongly against');
});

test('winprob: a plant swings toward attackers; a near-complete defuse swings back', () => {
  const t = 60000;
  const noPlant = attackerWinProb(synthRound({}), t);
  const planted = attackerWinProb(synthRound({ plant: 55000 }), t);
  assert.ok(planted > noPlant + 0.1, 'post-plant favours attackers');
  // defuse almost done (started at t-6000, completes 1s later): defenders favoured
  const defusing = attackerWinProb(synthRound({ plant: 50000, defuse: t + 1000 }), t);
  assert.ok(defusing < planted, 'an in-progress defuse pulls it back to defenders');
});

test('winprob: equipment advantage tilts an even round', () => {
  const rich = attackerWinProb(synthRound({ equip: { A: 4500, B: 1200 } }), 8000);
  const poor = attackerWinProb(synthRound({ equip: { A: 1200, B: 4500 } }), 8000);
  assert.ok(rich > poor, 'better-equipped side favoured when players are even');
});

test('winprob: all of one side dead is near-terminal', () => {
  const defsDead = synthRound({ deaths: Object.fromEntries([1, 2, 3, 4, 5].map((s) => [`def${s}`, 5000])) });
  assert.ok(attackerWinProb(defsDead, 10000) >= 0.85, 'defenders wiped, pre-plant: attackers heavily favoured');
  const atksDead = synthRound({ deaths: Object.fromEntries([1, 2, 3, 4, 5].map((s) => [`atk${s}`, 5000])) });
  assert.ok(attackerWinProb(atksDead, 10000) <= 0.05, 'attackers wiped, no plant: lost');
  // sanity: the fixture agrees on alive counts
  assert.deepEqual(situationAt(defsDead, 10000).alive, { A: 5, B: 0 });
});

test('winprob: stays within the live bounds mid-round', () => {
  for (const tMs of [0, 10000, 30000, 60000, 90000]) {
    const p = attackerWinProb(real, tMs);
    assert.ok(p >= 0.02 && p <= 0.98, `live prob within bounds at ${tMs}: ${p}`);
  }
});

test('winprob: swing moments are real events ordered by magnitude', () => {
  const swings = swingMoments(real, 'A');
  for (const s of swings) assert.ok(Math.abs(s.delta) >= 0.08);
  for (let i = 1; i < swings.length; i++) assert.ok(Math.abs(swings[i - 1].delta) >= Math.abs(swings[i].delta));
});
