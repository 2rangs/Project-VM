// Desktop ↔ engine contract. Runs scripts/run-match.mts (the tsx reference path of
// src/engine/run-match.ts, the code the app's bundled engine host runs — see
// test/engine-bundle.test.ts for bundle == source) against the LIVE @pv/match-runner and
// checks that its JSON still has the shape the app reads — in particular
// RoundRecord.decisions, which the Review's round-decisions view is built on — and
// that the pre-match options reach the engine.
//
// Needs the workspace install (repo root: pnpm install → node_modules/.bin/tsx).
// Skipped, loudly, when that is missing. Run with: npm run test:engine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import { matchNotes } from '../src/renderer/decisions.ts';
import type { OpponentRead, PlanSummary, RoundDecisions, TendencyEstimate } from '../src/shared/ipc.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const skip = existsSync(tsx) ? false : `workspace not installed (${tsx} missing) — run pnpm install at the repo root`;

function runMatch(cfg: Record<string, unknown>): RawMatch {
  const res = spawnSync(tsx, [path.join(appDir, 'scripts', 'run-match.mts'), JSON.stringify(cfg)], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000,
  });
  assert.equal(res.status, 0, `run-match.mts failed: ${res.stderr?.slice(-400)}`);
  return JSON.parse(res.stdout) as RawMatch;
}

const TEAMS = { teamA: { id: '2', name: 'Alpha' }, teamB: { id: '1001', name: 'Bravo' } };
const isProb = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1;

test('run-match output carries RoundRecord.decisions in the shape the Review reads', { skip }, () => {
  const raw = runMatch({ ...TEAMS, seed: 42, recordPerception: false });
  assert.ok(raw.rounds.length >= 13, 'a full map was played');
  for (const r of raw.rounds) {
    const d: RoundDecisions | null | undefined = r.decisions;
    assert.ok(d, `R${r.roundNumber} has decisions`);
    for (const slot of ['A', 'B'] as const) {
      const plan: PlanSummary | null = d.plans[slot];
      assert.ok(plan, `R${r.roundNumber} ${slot} has a plan`);
      assert.equal(typeof plan.opening, 'string');
      assert.equal(typeof plan.strategy, 'string');
      assert.ok(plan.objective === null || typeof plan.objective === 'string');
      assert.ok(plan.feint === null || typeof plan.feint === 'string');
      assert.ok(Array.isArray(plan.revisions));
      for (const v of plan.revisions) {
        assert.equal(typeof v.atMs, 'number');
        assert.equal(typeof v.from, 'string');
        assert.equal(typeof v.to, 'string');
        assert.equal(typeof v.reason, 'string');
      }
      const read: OpponentRead | null = d.opponentReadBefore[slot];
      assert.ok(read, `R${r.roundNumber} ${slot} has a read (opponent memory is on by default)`);
      const estimates: TendencyEstimate[] = [read.attackSite, read.defenseSite];
      for (const est of estimates) {
        assert.ok(isProb(est.probability.A) && isProb(est.probability.B));
        assert.ok(Math.abs(est.probability.A + est.probability.B - 1) < 1e-9);
        assert.ok(isProb(est.confidence));
        assert.equal(typeof est.samples, 'number');
      }
    }
    assert.ok('plantSite' in d.observed && 'firstContactSite' in d.observed);
    assert.equal(typeof d.observed.defendersMet, 'object');
  }
  // Round 1: nobody has seen anything yet.
  const first = raw.rounds[0].decisions!.opponentReadBefore;
  assert.equal(first.A!.attackSite.confidence, 0);
  assert.equal(first.B!.defenseSite.confidence, 0);
  // …and the whole thing maps to one note per round with no decisions dropped.
  const notes = matchNotes(mergeMatch(raw).summary);
  assert.equal(notes.length, raw.rounds.length);
  assert.ok(notes.some((n) => n.revised), 'at least one round has a mid-round plan revision');
});

test('pre-match options reach the engine: opponentMemory off → null reads; they are echoed back', { skip }, () => {
  const options = { opponentMemory: false, minThrowRates: { teams: { '1001': 0.02 } } };
  const raw = runMatch({ ...TEAMS, seed: 42, recordPerception: false, options });
  assert.deepEqual(raw.options, options);
  for (const r of raw.rounds) {
    assert.equal(r.decisions!.opponentReadBefore.A, null);
    assert.equal(r.decisions!.opponentReadBefore.B, null);
    assert.ok(r.decisions!.plans.A && r.decisions!.plans.B, 'plans are still recorded');
  }
  const notes = matchNotes(mergeMatch(raw).summary);
  assert.ok(notes.every((n) => n.teams.A.read === null && n.teams.B.read === null));
});

test('minThrowRates changes the simulation (same seed, different floor → different match)', { skip }, () => {
  const base = runMatch({ ...TEAMS, seed: 42, recordPerception: false });
  const floored = runMatch({ ...TEAMS, seed: 42, recordPerception: false, options: { minThrowRates: { teams: { '2': 0.5, '1001': 0.5 } } } });
  const sig = (m: RawMatch) => JSON.stringify(m.rounds.map((r) => [r.winner, r.reason, r.kills]));
  assert.notEqual(sig(base), sig(floored), 'a 0.5/s throw floor on both teams must alter round outcomes');
});

test('run-match output carries positions for every player and the navigation trace (no app-side shim)', { skip }, () => {
  const raw = runMatch({ ...TEAMS, seed: 7, recordPerception: false });
  const r = raw.rounds[0];
  const moves = r.replayEvents.filter((e) => e.kind === 'move') as Array<{ playerId: string; timeMs: number; from: { x: number; y: number }; to: { x: number; y: number } }>;
  // every player has a position from the first instant, also those who never leave their spot
  const atStart = new Set(moves.filter((m) => m.timeMs === 0 && m.from.x === m.to.x && m.from.y === m.to.y).map((m) => m.playerId));
  assert.equal(atStart.size, 10, 'a spawn position per player');
  // continuous movement: consecutive samples, never a jump between zone centres
  const longest = moves.reduce((m, e) => Math.max(m, Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y)), 0);
  assert.ok(longest > 0 && longest <= 120, `longest recorded step ${longest.toFixed(0)} uu is one tick of movement`);

  // the navigation trace: planned paths with their waypoints, route and reason
  for (const round of raw.rounds) assert.ok(Array.isArray(round.nav) && round.nav.length > 0, `R${round.roundNumber} has a navigation trace`);
  const all = raw.rounds.flatMap((x) => x.nav ?? []);
  const planned = all.filter((e) => e.kind === 'planned' || e.kind === 'replanned');
  assert.ok(planned.length > 100);
  for (const e of planned.slice(0, 200)) {
    assert.ok(e.waypoints && e.waypoints.length >= 1, 'planned path has waypoints');
    assert.ok(e.from && e.zones && e.zones.length >= 1);
    assert.equal(typeof e.pathLength, 'number');
    assert.equal(typeof e.estimatedTravelMs, 'number');
    assert.ok(['FASTEST', 'SAFEST', 'STEALTH', 'TACTICAL'].includes(e.preference ?? ''));
  }
  assert.ok(planned.some((e) => e.intent), 'the order behind a move is recorded');
  const prefs = new Set(planned.map((e) => e.preference));
  assert.ok(prefs.has('FASTEST') && prefs.size >= 2, `routes are chosen by intent (${[...prefs].join(', ')})`);
  // the summary the live view reads keeps it per round
  const { summary } = mergeMatch(raw);
  assert.equal(summary.rounds[0].nav?.length, raw.rounds[0].nav?.length);
});
