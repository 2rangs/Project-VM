// Career scouting in the desktop: the fog on player views, assignments, reports, the own-player
// panel and academy actions, and their ko/en strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { batchOf, buildDesktopWorld, continueCareer, answerInbox, newCareer, quickSeries, type CareerState, type DesktopFixtures } from '../src/renderer/career/world.ts';
import {
  academyAction, academyActions, assign, devSeries, fogged, knowledgePct, ownPanel, playerView, range20, range200, rangeText, reportRows, scoutRows,
} from '../src/renderer/career/scouting.ts';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const FIX: DesktopFixtures = {
  ratings: json('player_ratings.json'), names: json('player_names.json'), teams: json('team_names.json'),
  rosters: json('rosters.json'), reservedHandles: json('reserved_handles.json'),
};
function career(seed = 77): CareerState {
  const w = buildDesktopWorld(FIX, seed);
  const team = Object.values(w.teams).find((t) => t.name === 'T1')!;
  return newCareer(w, { seed, manager: { name: 'Tester', nationality: 'kr' }, userTeamId: team.teamId });
}

test('a career world is fogged: other players are ranges, our own almost exact', () => {
  const c = career();
  const w = c.world;
  assert.ok(fogged(w));
  const other = Object.values(w.players).find((p) => p.teamId && p.teamId !== c.userTeamId && p.hasRatings)!;
  const v = playerView(w, other, c.date);
  const aim = range20(v.attributes.aim!);
  assert.ok(aim.hi > aim.lo, `aim is a range ${rangeText(aim)}`);
  assert.match(rangeText(range200(v.ca)), /^\d+–\d+$/);
  assert.ok(knowledgePct(w, other, c.date) < 100);
  const mine = w.players[w.teams[c.userTeamId]!.roster[0]!]!;
  assert.equal(knowledgePct(w, mine, c.date), 100);
  const own = playerView(w, mine, c.date);
  assert.ok(own.ca.hi - own.ca.lo < 0.08);
  const panel = ownPanel(w, mine);
  assert.ok(panel.morale >= 0 && panel.morale <= 100);
  assert.ok(['low', 'mid', 'high'].includes(panel.traits.professionalism));
});

test('assignments, Monday reports and the academy actions', async () => {
  const c = career();
  const rows = scoutRows(c.world);
  assert.ok(rows.length >= 1 && rows[0]!.assignment?.kind === 'region', 'scouts start on our region');
  c.world = assign(c.world, rows[0]!.scout.staffId, 'youth', c.world.teams[c.userTeamId]!.region, c.date);
  assert.equal(scoutRows(c.world)[0]!.assignment?.kind, 'youth');
  for (let i = 0; i < 6 && reportRows(c.world).length === 0; i++) {
    const r = await continueCareer(c, batchOf(quickSeries));
    if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.options![0]!.id);
  }
  assert.ok(reportRows(c.world).length > 0, 'reports after a Monday');
  const free = Object.values(c.world.players).find((p) => p.status === 'free' && p.age <= 21 && p.hasRatings)!;
  if (c.world.teams[c.userTeamId]!.academy.length < 3) {
    assert.ok(academyActions(c.world, free).includes('invite'));
    const r = academyAction(c.world, 'invite', free.playerId, c.date);
    assert.equal(r.error, null);
    assert.equal(r.world.players[free.playerId]!.status, 'academy');
    assert.ok(academyActions(r.world, r.world.players[free.playerId]!).includes('promote'));
  }
  assert.deepEqual(devSeries(c.world.players[c.world.teams[c.userTeamId]!.roster[0]!]!), [], 'no season ended yet');
});

test('every scouting / development string exists in ko and en', () => {
  const keys = Object.keys(en).filter((k) => /^(scout|dev)\.|^inbox\.scouting\.(weekly|youthIntake)|^col\.(knowledge|rec|morale|lastChange)/.test(k));
  assert.ok(keys.length > 60);
  for (const k of keys) assert.ok(ko[k] && ko[k].length > 0, `ko ${k}`);
});
