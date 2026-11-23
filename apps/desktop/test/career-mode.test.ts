// Desktop career mode: a career on the desktop world, the manager's series mapped into the
// fixture (home/away as scheduled), every inbox message renders in both languages, and the save
// round-trips mid-season.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answerInbox, batchOf, buildDesktopWorld, continueCareer, deserializeCareer, groupStandings, newCareer, quickSeries,
  recordResult, serializeCareer, seriesRequest, type CareerState, type DesktopFixtures, type Fixture,
} from '../src/renderer/career/world.ts';
import { inboxText, opponentOf, optionLabel, outcomeFromSeries, seriesSetup } from '../src/renderer/career/view.ts';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';
import type { SeriesView } from '../src/shared/series.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const FIX: DesktopFixtures = {
  ratings: json('player_ratings.json'), names: json('player_names.json'), teams: json('team_names.json'),
  rosters: json('rosters.json'), reservedHandles: json('reserved_handles.json'),
};
const tOf = (d: Record<string, string>) => (key: string, vars?: Record<string, string | number>) => {
  let s = d[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
};
const sim = batchOf(quickSeries);

function career(seed = 77): CareerState {
  const w = buildDesktopWorld(FIX, seed);
  const team = Object.values(w.teams).find((t) => t.name === 'T1')!;
  return newCareer(w, { seed, manager: { name: 'Tester', nationality: 'kr' }, userTeamId: team.teamId });
}

async function toMatchDay(c: CareerState): Promise<Fixture> {
  for (let i = 0; i < 20; i++) {
    const r = await continueCareer(c, sim);
    if (r.stop === 'matchDay') return r.fixture!;
    if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.options![0]!.id);
  }
  throw new Error('no match day');
}

/** A finished series view where our team (series A) won 2–1. */
function fakeView(c: CareerState, f: Fixture): SeriesView {
  const opp = opponentOf(c, f)!;
  return {
    phase: 'finished', winner: 'A', score: { A: 2, B: 1 },
    teams: { A: { id: c.userTeamId, name: 'us' }, B: { id: opp, name: 'them' } },
    games: [
      { gameNumber: 1, map: 'Ascent', pickedBy: 'A', startingSides: { A: 'attack', B: 'defense' }, winner: 'A', score: { A: 13, B: 7 }, overtime: false },
      { gameNumber: 2, map: 'Lotus', pickedBy: 'B', startingSides: { A: 'defense', B: 'attack' }, winner: 'B', score: { A: 11, B: 13 }, overtime: false },
      { gameNumber: 3, map: 'Haven', pickedBy: 'decider', startingSides: { A: 'attack', B: 'defense' }, winner: 'A', score: { A: 14, B: 12 }, overtime: true },
    ],
  } as unknown as SeriesView;
}

test('the manager\'s series is recorded home/away as scheduled, with the career\'s fives', async () => {
  const c = career();
  const f = await toMatchDay(c);
  const setup = seriesSetup(c, f);
  assert.equal(setup.teamA.id, c.userTeamId);
  assert.equal(setup.rosters.A.length, 5);
  assert.deepEqual(setup.rosters.A.map((p) => p.playerId), seriesRequest(c, f).home.teamId === c.userTeamId ? seriesRequest(c, f).home.lineup : seriesRequest(c, f).away.lineup);
  const out = outcomeFromSeries(c, f, fakeView(c, f));
  const userHome = f.home === c.userTeamId;
  assert.equal(out.winner, c.userTeamId);
  assert.deepEqual(out.mapsWon, userHome ? [2, 1] : [1, 2]);
  assert.deepEqual(out.maps[0]!.score, userHome ? [13, 7] : [7, 13]);
  recordResult(c, f.id, out);
  const g = c.season.stages[0]!.groups.alpha.includes(c.userTeamId) ? 'alpha' : 'omega';
  const row = groupStandings(c.season, 'stage1', g).find((r) => r.teamId === c.userTeamId)!;
  assert.equal(row.wins, 1);
  assert.equal(row.mapsWon, 2);
  assert.equal(row.roundsWon, 38);
  for (const id of setup.rosters.A.map((p) => p.playerId)) assert.equal(c.stats[id]!.maps, 3);
});

test('every inbox message of a season renders in Korean and English (no raw keys or {vars})', async () => {
  const c = career(78);
  for (let i = 0; i < 200; i++) {
    const r = await continueCareer(c, sim);
    if (r.stop === 'seasonEnd') break;
    if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.options![0]!.id);
    if (r.stop === 'matchDay') {
      const req = seriesRequest(c, r.fixture!);
      recordResult(c, req.fixtureId, { ...quickSeries(req, c), source: 'user', lineups: { home: req.home.lineup, away: req.away.lineup } });
    }
  }
  await continueCareer(c, sim); // season transition mail
  const keys = new Set(c.inbox.map((m) => m.key));
  for (const k of ['welcome', 'board.objective', 'league.schedule', 'squad.overview', 'competition.champion', 'competition.drawn', 'season.review', 'squad.changes', 'staff.formReport']) {
    assert.ok(keys.has(k), `season produced no ${k}`);
  }
  for (const [lang, d] of [['ko', ko], ['en', en]] as const) {
    const t = tOf(d);
    for (const m of c.inbox) {
      const tx = inboxText(t, lang, m);
      assert.notEqual(tx.title, m.key, `${lang}: no title for ${m.key}`);
      assert.ok(!/\{\w+\}/.test(tx.title + tx.body), `${lang}: unfilled placeholder in ${m.key}: ${tx.title} ${tx.body}`);
      for (const o of m.options ?? []) assert.notEqual(optionLabel(t, lang, m, o.id), o.id, `${lang}: no label for ${m.key}/${o.id}`);
    }
  }
});

test('a desktop career save round-trips mid-season', async () => {
  const c = career(79);
  await toMatchDay(c);
  const text = serializeCareer(c, 'fixed');
  assert.equal(serializeCareer(deserializeCareer(text), 'fixed'), text);
});
