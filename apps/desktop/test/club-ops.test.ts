// Desktop club operations inside a career: a new career starts the club layer for the manager's
// club (contracts, finances), the search shows scout ranges (never true values), an offer at
// market terms for a free agent completes and the player joins the roster, training plans change
// the shown growth factors, Continue books the monthly ledger, and the career save round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  answerInbox, batchOf, buildDesktopWorld, continueCareer, deserializeCareer, makeOffer, newCareer, quickSeries, recordResult, serializeCareer,
  seriesRequest, setTrainingPlan, trainingWeek, type DesktopFixtures, type World,
} from '../src/renderer/career/world.ts';
import { defaultTerms, financeSummary, offerKindFor, searchRows, trainingRows, wageRows, windowInfo } from '../src/renderer/career/club.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const FIX: DesktopFixtures = {
  ratings: json('player_ratings.json'), names: json('player_names.json'), teams: json('team_names.json'),
  rosters: json('rosters.json'), reservedHandles: json('reserved_handles.json'),
};
const SEED = 2026;
const newGame = () => {
  const w = buildDesktopWorld(FIX, SEED);
  const team = Object.values(w.teams).find((t) => t.name === 'NRG')!;
  return newCareer(w, { seed: SEED, manager: { name: 'T', nationality: 'us' }, userTeamId: team.teamId });
};
let USER = '';
const fresh = (): World => { const c = newGame(); USER = c.userTeamId; return c.world; };

test('a new career starts the club layer for the manager\'s club: contracts, a wage list and budgets', () => {
  const w = fresh();
  assert.equal(w.club!.userTeamId, USER);
  const s = financeSummary(w)!;
  assert.ok(s.balance > 0 && s.wageBudget > 0 && s.transferBudget >= 0);
  const wages = wageRows(w);
  assert.ok(wages.some((r) => r.kind === 'player') && wages.some((r) => r.kind === 'staff'));
  for (const id of w.teams[USER]!.roster) assert.ok(w.club!.contracts[id], `contract for ${id}`);
  assert.equal(windowInfo(w).open, true, 'a career opens in the pre-season window');
});

test('search rows carry the scout ranges, not the true CA', () => {
  const w = fresh();
  const rows = searchRows(w, {});
  assert.ok(rows.length > 10);
  for (const r of rows.slice(0, 20)) {
    assert.ok(r.caLo <= r.ca && r.ca <= r.caHi && r.paLo <= r.paHi);
    assert.ok(!r.player.teamId || r.player.teamId !== USER);
  }
  const free = searchRows(w, { freeOnly: true, ownRegion: false });
  assert.ok(free.every((r) => r.teamName === null && r.value === 0));
  const young = searchRows(w, { maxAge: 20, ownRegion: false });
  assert.ok(young.every((r) => r.age <= 20));
});

test('an offer for a free agent at generous terms completes and the player joins the roster', () => {
  let w = fresh();
  const target = searchRows(w, { freeOnly: true }).find((r) => r.age < 30)!;
  const kind = offerKindFor(w, target.player);
  assert.equal(kind, 'free');
  if (w.teams[USER]!.roster.length >= 8) w.teams[USER]!.roster.pop();
  const terms = defaultTerms(w, target.player, kind);
  const r = makeOffer(w, { playerId: target.playerId, toTeamId: USER, kind, terms: { ...terms, wage: terms.wage * 3 } });
  assert.equal(r.error, null);
  assert.equal(r.offer!.status, 'completed', JSON.stringify(r.offer!.utility));
  w = r.world;
  assert.ok(w.teams[USER]!.roster.includes(target.playerId));
  assert.equal(w.club!.contracts[target.playerId]!.teamId, USER);
});

test('training plans show the growth factors they will apply', () => {
  let w = setTrainingPlan(fresh(), USER, { teamFocus: 'mechanics' });
  w = structuredClone(w);
  for (let i = 0; i < 4; i++) trainingWeek(w, 'x');
  const rows = trainingRows(w);
  assert.ok(rows.length >= 5);
  const f = rows[0]!.factors!;
  assert.ok(f.aim! > 1 && f.trading! < 1, JSON.stringify(f));
});

test('Continue books the month in the career, and the career save (with the club) round-trips', async () => {
  const c = newGame();
  const sim = batchOf(quickSeries);
  while (c.date < '2026-02-10') {
    const r = await continueCareer(c, sim);
    if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? 'reject' : m.options![0]!.id);
    else if (r.stop === 'matchDay') {
      const q = seriesRequest(c, r.fixture!);
      recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: 'user', lineups: { home: q.home.lineup, away: q.away.lineup } });
    }
  }
  const f = c.world.club!.finances[c.userTeamId]!;
  assert.ok(f.ledger.some((e) => e.kind === 'wages'));
  assert.equal(c.world.club!.date, c.date);
  assert.ok(c.inbox.some((m) => m.source === 'club'), 'club messages reach the career inbox');
  const text = serializeCareer(c, 'fixed');
  assert.equal(serializeCareer(deserializeCareer(text), 'fixed'), text);
});
