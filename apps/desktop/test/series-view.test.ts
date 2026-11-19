// Pure view logic of the series / veto screens (src/renderer/series/view.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IPC } from '../src/shared/ipc.ts';
import type { MasteryView, SeriesMapView, SeriesView, VetoActionView } from '../src/shared/series.ts';
import { certaintyLevel, mapCards, recommendationReason, stepInfo, theirMasteryEstimate, usesBorrowedGeometry, vetoLogLine } from '../src/renderer/series/view.ts';
import { ko } from '../src/renderer/i18n/ko.ts';
import { en } from '../src/renderer/i18n/en.ts';

const mastery = (value: number, uncertainty = 0.05): MasteryView => ({
  value, uncertainty,
  history: { value, uncertainty, games: 5, wins: null, resultsKnown: false },
  continuity: { value, uncertainty: 0.1, measured: false },
  compFit: { value, uncertainty: 0.15, basis: 'roles', bestComp: null },
});
const POOL = ['Abyss', 'Ascent', 'Haven', 'Lotus', 'Split', 'Summit', 'Sunset'];
const BO3 = (['ban:A', 'ban:B', 'pick:A', 'side:B', 'pick:B', 'side:A', 'ban:A', 'ban:B', 'decider:', 'side:A'] as const).map((s) => {
  const [kind, team] = s.split(':');
  return { kind: kind as 'ban' | 'pick' | 'side' | 'decider', team: (team || null) as 'A' | 'B' | null };
});
function mapView(map: string, ours: number, theirs: number | null, extra: Partial<SeriesMapView> = {}): SeriesMapView {
  return {
    map, mastery: { A: mastery(ours), B: mastery(theirs ?? 0.4) }, winBelief: 0.5, atkRoundWR: null,
    scouting: theirs === null ? null : { estimatedMastery: theirs, verdict: 'average', attack: { shareA: 0.6, rounds: 10 }, defense: { shareA: 0.4, rounds: 2 }, priorMass: { attack: 2.7, defense: 0.9 } },
    ...extra,
  };
}
function view(over: Partial<SeriesView> = {}, veto: Partial<SeriesView['veto']> = {}): SeriesView {
  return {
    phase: 'veto', teams: { A: { id: '1', name: 'Us FC' }, B: { id: '2', name: 'Them FC' } },
    format: { id: 'vct-bo3', games: 3, steps: BO3 }, pool: POOL, reference: 0.43, geometry: 'Ascent',
    score: { A: 0, B: 0 }, winsNeeded: 2,
    maps: [mapView('Abyss', 0.3, 0.5), mapView('Ascent', 0.8, 0.4, { atkRoundWR: 0.472 }), mapView('Haven', 0.6, 0.7), mapView('Lotus', 0.9, 0.2, { atkRoundWR: 0.524 }), mapView('Split', 0.5, 0.5), mapView('Summit', 0.2, 0.2), mapView('Sunset', 0.6, 0.5)],
    veto: { actions: [], maps: [], banned: [], remaining: POOL, pending: { step: 0, kind: 'ban', team: 'A', options: POOL, ai: false, recommendation: { choice: 'Haven', values: {} } }, ...veto },
    games: [], nextGame: null, gameInProgress: false,
    scouting: { enabled: true, analyst: 0.7, gamesReviewed: 2, gamesAvailable: 2, uptake: 0.8, players: [] },
    winner: null,
    ...over,
  };
}
const act = (step: number, kind: VetoActionView['kind'], team: 'A' | 'B' | null, map: string, side?: 'attack' | 'defense'): VetoActionView =>
  ({ step, kind, team, map, ...(side ? { side } : {}), by: team === 'B' ? 'ai' : team === 'A' ? 'human' : 'rule' });

test('series IPC channel names are the stable contract', () => {
  assert.equal(IPC.seriesStart, 'pv:series:start');
  assert.equal(IPC.seriesCmd, 'pv:series:cmd');
  assert.equal(IPC.seriesStop, 'pv:series:stop');
});

test('certainty: a wide error bar is flagged, a tight one is not', () => {
  assert.equal(certaintyLevel(0.03), 'high');
  assert.equal(certaintyLevel(0.06), 'medium');
  assert.equal(certaintyLevel(0.099), 'medium');
  assert.equal(certaintyLevel(0.1), 'low');
  assert.equal(certaintyLevel(0.14), 'low');
});

test('step info: whose turn, which step, counted without the decider', () => {
  const s = stepInfo(view())!;
  assert.deepEqual({ index: s.index, total: s.total, kind: s.kind, ours: s.ours }, { index: 1, total: 9, kind: 'ban', ours: true });
  // The side step after the decider is the 9th choice, though it is format step index 9.
  const last = stepInfo(view({}, { pending: { step: 9, kind: 'side', team: 'A', options: ['attack', 'defense'], map: 'Sunset', ai: false, recommendation: { choice: 'defense', values: {} } } }))!;
  assert.deepEqual({ index: last.index, kind: last.kind, map: last.map }, { index: 9, kind: 'side', map: 'Sunset' });
  const ai = stepInfo(view({}, { pending: { step: 1, kind: 'ban', team: 'B', options: POOL, ai: true, recommendation: { choice: 'Lotus', values: {} } } }))!;
  assert.equal(ai.ours, false);
  assert.equal(stepInfo(view({ phase: 'playing' }, { pending: null })), null);
});

test('map cards: open maps are selectable on our map step; the recommended one is marked', () => {
  const cards = mapCards(view());
  assert.equal(cards.length, 7);
  assert.ok(cards.every((c) => c.status === 'open' && c.selectable));
  assert.deepEqual(cards.filter((c) => c.recommended).map((c) => c.map), ['Haven']);
  // On the AI's step, or a side step, nothing can be chosen from the cards.
  const aiTurn = mapCards(view({}, { pending: { step: 1, kind: 'ban', team: 'B', options: POOL, ai: true, recommendation: { choice: 'Lotus', values: {} } } }));
  assert.ok(aiTurn.every((c) => !c.selectable && !c.recommended));
});

test('map cards: banned, picked (who, order, our side) and the decider', () => {
  const actions = [
    act(0, 'ban', 'A', 'Summit'), act(1, 'ban', 'B', 'Lotus'), act(2, 'pick', 'A', 'Ascent'), act(3, 'side', 'B', 'Ascent', 'defense'),
    act(4, 'pick', 'B', 'Haven'), act(5, 'side', 'A', 'Haven', 'defense'), act(6, 'ban', 'A', 'Abyss'), act(7, 'ban', 'B', 'Split'), act(8, 'decider', null, 'Sunset'),
  ];
  const v = view({}, {
    actions, banned: ['Summit', 'Lotus', 'Abyss', 'Split'], remaining: [],
    maps: [
      { map: 'Ascent', pickedBy: 'A', sideChosenBy: 'B', startingSides: { A: 'attack', B: 'defense' } },
      { map: 'Haven', pickedBy: 'B', sideChosenBy: 'A', startingSides: { A: 'defense', B: 'attack' } },
    ],
    pending: { step: 9, kind: 'side', team: 'A', options: ['attack', 'defense'], map: 'Sunset', ai: false, recommendation: { choice: 'defense', values: {} } },
  });
  const by = Object.fromEntries(mapCards(v).map((c) => [c.map, c]));
  assert.deepEqual([by.Summit!.status, by.Summit!.by], ['banned', 'A']);
  assert.deepEqual([by.Lotus!.status, by.Lotus!.by], ['banned', 'B']);
  assert.deepEqual([by.Ascent!.status, by.Ascent!.by, by.Ascent!.gameNumber, by.Ascent!.ourSide], ['picked', 'A', 1, 'attack']);
  assert.deepEqual([by.Haven!.status, by.Haven!.by, by.Haven!.gameNumber, by.Haven!.ourSide], ['picked', 'B', 2, 'defense']);
  // The decider is nobody's pick, is map 3, and has no side until the last step is made.
  assert.deepEqual([by.Sunset!.status, by.Sunset!.by, by.Sunset!.gameNumber, by.Sunset!.ourSide], ['decider', null, 3, null]);
  assert.ok(mapCards(v).every((c) => !c.selectable));
});

test('recommendation reason: a ban where they are ahead names their edge; otherwise our weakest map', () => {
  const edge = recommendationReason(view())!; // Haven: ours 60, theirs 70
  assert.equal(edge.key, 'ser.rec.ban.edge');
  assert.deepEqual(edge.vars, { map: 'Haven', ours: 60, theirs: 70, gap: 10 });
  const weak = recommendationReason(view({}, { pending: { step: 0, kind: 'ban', team: 'A', options: POOL, ai: false, recommendation: { choice: 'Summit', values: {} } } }))!;
  assert.equal(weak.key, 'ser.rec.ban.weak'); // Summit: ours 20, theirs 20 — not ahead of us
});

test('recommendation reason: without scouting the opponent estimate is unknown, not invented', () => {
  const blind = view();
  blind.maps = blind.maps.map((m) => ({ ...m, scouting: null }));
  assert.equal(theirMasteryEstimate(blind.maps[0]!), null);
  assert.equal(recommendationReason(blind)!.key, 'ser.rec.ban.weak');
  const pick = recommendationReason({ ...blind, veto: { ...blind.veto, pending: { step: 2, kind: 'pick', team: 'A', options: POOL, ai: false, recommendation: { choice: 'Lotus', values: {} } } } })!;
  assert.deepEqual([pick.key, pick.vars.ours], ['ser.rec.pick.best', 90]);
  const scouted = recommendationReason(view({}, { pending: { step: 2, kind: 'pick', team: 'A', options: POOL, ai: false, recommendation: { choice: 'Lotus', values: {} } } }))!;
  assert.deepEqual([scouted.key, scouted.vars.gap], ['ser.rec.pick.edge', 70]);
});

test('recommendation reason: side from the map data, or the stated convention when there is none', () => {
  const side = (map: string, choice: string) => recommendationReason(view({}, { pending: { step: 3, kind: 'side', team: 'A', options: ['attack', 'defense'], map, ai: false, recommendation: { choice, values: {} } } }))!;
  assert.deepEqual([side('Lotus', 'attack').key, side('Lotus', 'attack').vars.pct], ['ser.rec.side.attack', '52.4']);
  assert.deepEqual([side('Ascent', 'defense').key, side('Ascent', 'defense').vars.pct], ['ser.rec.side.defense', '52.8']);
  assert.equal(side('Haven', 'defense').key, 'ser.rec.side.nodata');
  // No advice is worded for the AI's own steps.
  assert.equal(recommendationReason(view({}, { pending: { step: 1, kind: 'ban', team: 'B', options: POOL, ai: true, recommendation: { choice: 'Lotus', values: {} } } })), null);
});

test('veto log lines and every reason key exist in both languages', () => {
  const lines = [act(0, 'ban', 'A', 'Summit'), act(2, 'pick', 'A', 'Ascent'), act(3, 'side', 'B', 'Ascent', 'attack'), act(5, 'side', 'A', 'Haven', 'defense'), act(8, 'decider', null, 'Sunset')].map(vetoLogLine);
  assert.deepEqual(lines.map((l) => l.key), ['ser.log.ban', 'ser.log.pick', 'ser.log.side.attack', 'ser.log.side.defense', 'ser.log.decider']);
  assert.equal(lines[4]!.team, null);
  const keys = [...lines.map((l) => l.key), 'ser.rec.ban.edge', 'ser.rec.ban.weak', 'ser.rec.pick.edge', 'ser.rec.pick.best', 'ser.rec.side.attack', 'ser.rec.side.defense', 'ser.rec.side.nodata', 'ser.geometry.note', 'ser.certainty.low'];
  for (const k of keys) { assert.ok(ko[k], `ko missing ${k}`); assert.ok(en[k], `en missing ${k}`); }
});

test('the geometry note shows whenever the pool has a map other than the simulated one', () => {
  assert.equal(usesBorrowedGeometry(view()), true);
  assert.equal(usesBorrowedGeometry(view({ pool: ['Ascent'] })), false);
});
