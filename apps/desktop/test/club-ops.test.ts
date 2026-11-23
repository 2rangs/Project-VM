// Desktop club operations: a fresh desktop world starts with contracts and finances for the
// default club, the search shows scout ranges (never true values), an offer at market terms for a
// free agent completes and he joins the roster, training plans change the shown growth factors,
// the local driver books the monthly ledger, and the save (with the club state) round-trips and fits
// in localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDesktopWorld, loadSavedWorld, makeOffer, serializeWorld, setTrainingPlan, trainingWeek, type DesktopFixtures } from '../src/renderer/career/world.ts';
import {
  advanceClubDays, defaultTerms, DEFAULT_USER_TEAM, financeSummary, offerKindFor, searchRows, trainingRows, wageRows, windowInfo, withClub,
} from '../src/renderer/career/club.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const FIX: DesktopFixtures = {
  ratings: json('player_ratings.json'), names: json('player_names.json'), teams: json('team_names.json'),
  rosters: json('rosters.json'), reservedHandles: json('reserved_handles.json'),
};
const fresh = () => withClub(buildDesktopWorld(FIX));

test('a fresh desktop career manages the default club with contracts, a wage list and budgets', () => {
  const w = fresh();
  assert.equal(w.club!.userTeamId, DEFAULT_USER_TEAM);
  const s = financeSummary(w)!;
  assert.ok(s.balance > 0 && s.wageBudget > 0 && s.transferBudget >= 0);
  const wages = wageRows(w);
  assert.ok(wages.some((r) => r.kind === 'player') && wages.some((r) => r.kind === 'staff'));
  for (const id of w.teams[DEFAULT_USER_TEAM]!.roster) assert.ok(w.club!.contracts[id], `contract for ${id}`);
  assert.equal(windowInfo(w).open, true, 'a career opens in the pre-season window');
});

test('search rows carry the scout ranges, not the true CA', () => {
  const w = fresh();
  const rows = searchRows(w, {});
  assert.ok(rows.length > 10);
  for (const r of rows.slice(0, 20)) {
    assert.ok(r.caLo <= r.ca && r.ca <= r.caHi && r.paLo <= r.paHi);
    assert.ok(!r.player.teamId || r.player.teamId !== DEFAULT_USER_TEAM);
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
  if (w.teams[DEFAULT_USER_TEAM]!.roster.length >= 8) w.teams[DEFAULT_USER_TEAM]!.roster.pop();
  const terms = defaultTerms(w, target.player, kind);
  const r = makeOffer(w, { playerId: target.playerId, toTeamId: DEFAULT_USER_TEAM, kind, terms: { ...terms, wage: terms.wage * 3 } });
  assert.equal(r.error, null);
  assert.equal(r.offer!.status, 'completed', JSON.stringify(r.offer!.utility));
  w = r.world;
  assert.ok(w.teams[DEFAULT_USER_TEAM]!.roster.includes(target.playerId));
  assert.equal(w.club!.contracts[target.playerId]!.teamId, DEFAULT_USER_TEAM);
});

test('training plans show the growth factors they will apply', () => {
  let w = setTrainingPlan(fresh(), DEFAULT_USER_TEAM, { teamFocus: 'mechanics' });
  w = structuredClone(w);
  for (let i = 0; i < 4; i++) trainingWeek(w, 'x');
  const rows = trainingRows(w);
  assert.ok(rows.length >= 5);
  const f = rows[0]!.factors!;
  assert.ok(f.aim! > 1 && f.trading! < 1, JSON.stringify(f));
});

test('the local driver books a month and the save round-trips under the localStorage limit', () => {
  const w = advanceClubDays(fresh(), 40);
  const f = w.club!.finances[DEFAULT_USER_TEAM]!;
  assert.ok(f.ledger.some((e) => e.kind === 'wages'));
  assert.ok(w.club!.date > '2026-02-10');
  const text = serializeWorld(w);
  assert.deepEqual(loadSavedWorld(text), w);
  assert.ok(text.length < 4_500_000, `save is ${text.length} chars`);
});
