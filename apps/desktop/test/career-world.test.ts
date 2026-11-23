// Desktop career world: built from the copied dataset fixtures, generated people are marked,
// handles never copy a real one, seasons advance, and the save round-trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  advanceSeason, buildDesktopWorld, loadSavedWorld, newProspects, normalizeHandle, serializeWorld, scoutedAbility,
  START_SEASON, type DesktopFixtures,
} from '../src/renderer/career/world.ts';

const json = (f: string) => JSON.parse(readFileSync(new URL(`../src/data/${f}`, import.meta.url), 'utf8'));
const FIX: DesktopFixtures = {
  ratings: json('player_ratings.json'), names: json('player_names.json'), teams: json('team_names.json'),
  rosters: json('rosters.json'), reservedHandles: json('reserved_handles.json'),
};

test('a fresh desktop world has the real players plus a first class of generated prospects and staff', () => {
  const w = buildDesktopWorld(FIX);
  assert.equal(w.season, START_SEASON);
  const real = Object.values(w.players).filter((p) => !p.generated);
  assert.equal(real.length, FIX.ratings.length);
  const pros = newProspects(w);
  assert.ok(pros.length >= 4, `prospects: ${pros.length}`);
  for (const p of pros) {
    assert.equal(p.generated, true);
    assert.equal(p.origin, 'generated');
    assert.ok(p.name && p.handle);
    assert.ok(!FIX.reservedHandles.handles.includes(normalizeHandle(p.handle!)), `${p.handle} copies a real handle`);
    const e = scoutedAbility(w, null, p);
    assert.ok(e.paHi >= e.paLo && e.pa >= e.ca);
  }
  assert.ok(Object.values(w.staff).length > 0 && Object.values(w.staff).every((s) => s.generated));
  assert.equal(serializeWorld(buildDesktopWorld(FIX)), serializeWorld(w), 'same fixtures → same world');
});

test('advancing a season brings a new class and the save reloads it exactly', () => {
  const w1 = advanceSeason(buildDesktopWorld(FIX));
  assert.equal(w1.season, START_SEASON + 1);
  assert.ok(newProspects(w1).length > 0);
  const loaded = loadSavedWorld(serializeWorld(w1));
  assert.deepEqual(loaded, w1);
  assert.equal(loadSavedWorld('not json'), null);
  assert.equal(loadSavedWorld(null), null);
});
