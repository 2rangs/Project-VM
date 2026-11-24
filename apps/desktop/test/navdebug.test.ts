// Unit tests for the navigation debug model (src/renderer/matchday/navdebug.ts): the drawable
// roadmap and zone connectivity built from the engine's `<map>.nav.json`, and the per-instant
// picture (plan in force, waypoints ahead, walked trace, replans, failures, why) built from a
// round's navigation trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { MatchRoundSummary, NavTraceEvent } from '../src/shared/ipc.ts';
import { buildRoadmap, intentText, navDebugAt, trailOf, waypointsAhead, whyText, type RoadmapData } from '../src/renderer/matchday/navdebug.ts';
import type { Hop, PlayerRound, RoundTimeline } from '../src/renderer/matchday/timeline.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const ascent = JSON.parse(readFileSync(path.resolve(here, '../src/data/sim/ascent.nav.json'), 'utf8')) as RoadmapData;

test('roadmap: the Ascent floor is one connected piece and every zone stands on it', () => {
  const road = buildRoadmap(ascent);
  assert.equal(road.nodes.length, ascent.nodes.length);
  assert.equal(road.segments.length, ascent.edges.length + ascent.drops.length + ascent.links.length);
  assert.equal(road.zones.length, ascent.zones.length);
  assert.equal(road.connectedZones, ascent.zones.length);
  assert.ok(road.segments.some((s) => s.kind === 'drop'), 'one-way drops are kept apart from walkable segments');
  for (const z of road.zones) assert.ok(z.anchor, `${z.id} has a standing point`);
});

test('roadmap: a zone the floor cannot reach is reported unconnected (a drop out is not a way in)', () => {
  const data: RoadmapData = {
    zones: ['a', 'b', 'island', 'ledge'],
    nodes: [[0, 0, 0, 100, 0], [500, 0, 0, 100, 1], [5000, 0, 0, 50, 2], [500, 500, 300, 50, 3]],
    edges: [[0, 1, 80]],
    drops: [[3, 1]],          // from the ledge you can drop down; nothing leads up to it
    links: [],
    anchors: { a: 0, b: 1, island: 2, ledge: 3 },
  };
  const road = buildRoadmap(data);
  const byId = new Map(road.zones.map((z) => [z.id, z.connected]));
  assert.deepEqual([byId.get('a'), byId.get('b'), byId.get('island'), byId.get('ledge')], [true, true, false, false]);
  assert.equal(road.connectedZones, 2);
});

// ── a synthetic round: one attacker walks east, replans once, a second one is refused ──
const P = (x: number, y: number) => ({ x, y, z: 0 });
const hop = (t0: number, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): Hop =>
  ({ departMs: t0, arriveMs: t0 + 100, fromZone: 'a', toZone: 'a', from: a, to: b, mode: 'run', sampled: true });
function player(id: string, slot: number, hops: Hop[], deathMs: number | null = null): PlayerRound {
  return { id, team: 'A', side: 'attack', slot, spawn: P(0, slot * 100), spawnZone: 'a', hops, continuous: true, deathMs, killerId: null };
}
const walker = player('atk1', 1, Array.from({ length: 10 }, (_, i) => hop(1000 + i * 100, P(i * 60, 100), P((i + 1) * 60, 100))));
const stuck = player('atk2', 2, []);
const dead = player('atk3', 3, [], 1500);
const enemy: PlayerRound = { ...player('def1', 1, []), team: 'B', side: 'defense' };
const nav: NavTraceEvent[] = [
  { tick: 0, elapsedMs: 0, kind: 'planned', playerId: 'atk1', goalZone: 'b-site', preference: 'SAFEST', intent: 'attack-save:move', pathLength: 1200, estimatedTravelMs: 1800,
    from: P(0, 100), waypoints: [P(0, 100), P(600, 100), P(600, 700)], zones: ['a', 'b-site'], avoided: [{ zoneId: 'mid', cost: 3.6 }] },
  { tick: 5, elapsedMs: 500, kind: 'replanned', playerId: 'atk1', goalZone: 'b-site', preference: 'SAFEST', intent: 'attack-save:move', pathLength: 1500, estimatedTravelMs: 2200,
    from: P(300, 100), waypoints: [P(300, 100), P(600, 100), P(900, 100), P(900, 700)], zones: ['a', 'b-site'], hazards: [{ x: 600, y: 400, z: 0, radius: 300 }] },
  { tick: 2, elapsedMs: 200, kind: 'unreachable', playerId: 'atk2', goalZone: 'a-nest', preference: 'FASTEST', intent: 'plan:exec-move', reason: 'UNREACHABLE: no walkable connection between start and destination', from: P(0, 200) },
  { tick: 1, elapsedMs: 100, kind: 'planned', playerId: 'def1', goalZone: 'a', preference: 'FASTEST', from: P(0, 100), waypoints: [P(0, 100), P(10, 100)] },
];
const summary = { roundNumber: 1, nav } as unknown as MatchRoundSummary;
const round: RoundTimeline = {
  roundNum: 1, startMs: 1000, buyStartMs: 1000, endMs: 60000, attacker: 'A', players: [walker, stuck, dead, enemy],
  kills: [], plant: null, defuse: null, endReason: null, summary, hasTracks: true,
};
const posAt = (t: number) => (p: PlayerRound) => trailOf(p, t).at(-1)!;

test('trail: the walked trace is the recorded samples up to now, partial last step included', () => {
  assert.deepEqual(trailOf(walker, 1000), [P(0, 100)]);
  const t = trailOf(walker, 1250);
  assert.equal(t.length, 4);
  assert.deepEqual(t.at(-1), P(150, 100));
  assert.equal(trailOf(walker, 99999).length, 11);
  assert.deepEqual(trailOf(dead, 5000), [dead.spawn]);
});

test('waypoints ahead: from the segment the player is on, never the part already walked', () => {
  const wps = [P(0, 0), P(600, 0), P(600, 600)];
  assert.deepEqual(waypointsAhead(wps, P(200, 10)), [P(200, 10), P(600, 0), P(600, 600)]);
  assert.deepEqual(waypointsAhead(wps, P(590, 300)), [P(590, 300), P(600, 600)]);
  assert.deepEqual(waypointsAhead([P(5, 5)], P(0, 0)), [P(5, 5)]);
});

test('the plan in force follows the trace through time: planned, then replanned', () => {
  const early = navDebugAt(round, 'A', 1200, posAt(1200));
  const a1 = early.plans.find((p) => p.playerId === 'atk1')!;
  assert.equal(a1.event?.kind, 'planned');
  assert.deepEqual(a1.destination, P(600, 700));
  assert.equal(a1.replans.length, 0);
  assert.deepEqual(early.counts, { planned: 1, replanned: 0, failed: 1 });
  assert.equal(early.hazards.length, 0);

  const later = navDebugAt(round, 'A', 1600, posAt(1600));
  const b1 = later.plans.find((p) => p.playerId === 'atk1')!;
  assert.equal(b1.event?.kind, 'replanned');
  assert.deepEqual(b1.destination, P(900, 700));
  assert.deepEqual(b1.replans, [P(300, 100)]);
  assert.deepEqual(b1.ahead[0], P(360, 100), 'the path ahead starts where the player is');
  assert.deepEqual(b1.ahead.slice(1), [P(600, 100), P(900, 100), P(900, 700)]);
  assert.equal(b1.trail.length, 7);
  assert.deepEqual(later.hazards, [{ x: 600, y: 400, z: 0, radius: 300 }]);
  assert.deepEqual(later.counts, { planned: 1, replanned: 1, failed: 1 });
});

test('a refused request is a failure with its reason, and the player has no path drawn', () => {
  const f = navDebugAt(round, 'A', 1600, posAt(1600)).plans.find((p) => p.playerId === 'atk2')!;
  assert.equal(f.event, null);
  assert.equal(f.failure?.kind, 'unreachable');
  assert.equal(f.ahead.length, 0);
  assert.equal(f.destination, null);
  assert.equal(f.failures.length, 1);
  assert.match(f.why, /no path \(UNREACHABLE: no walkable connection/);
});

test('only the viewed team is shown; the dead have no plan; before any order there is nothing to explain', () => {
  const f = navDebugAt(round, 'A', 1600, posAt(1600));
  assert.deepEqual(f.plans.map((p) => p.playerId), ['atk1', 'atk2', 'atk3']);
  const d = f.plans.find((p) => p.playerId === 'atk3')!;
  assert.equal(d.event, null);
  assert.equal(d.why, '');
  const b = navDebugAt(round, 'B', 1050, posAt(1050));
  assert.deepEqual(b.plans.map((p) => p.playerId), ['def1']);
  assert.equal(b.plans[0].why, 'no move ordered yet');
  // a round without a trace still gives the walked traces
  const bare = navDebugAt({ ...round, summary: null }, 'A', 1600, posAt(1600));
  assert.equal(bare.plans[0].event, null);
  assert.equal(bare.plans[0].trail.length, 7);
});

test('why: what the order is for, the route preference, what it avoids, and how far', () => {
  assert.equal(whyText(nav[0], (id) => id.toUpperCase()), 'saving → B-SITE · safest route · avoiding MID · 12 m · 1.8 s');
  assert.equal(whyText(nav[1]), 'saving → b-site · safest route · 1 ground patch priced · 15 m · 2.2 s · replanned');
  assert.equal(intentText('throw:chase'), 'chasing the exit kill');
  assert.equal(intentText('plan:exec-move'), 'team plan');
  assert.equal(intentText('plan:lurk-move'), 'lurking');
  assert.equal(intentText(undefined), 'order');
});
