// Unit tests for the live match screen's pure logic (src/renderer/matchday): the map graph,
// the round timeline (zone hops → travel segments, poses, score-at-time), the per-player
// visibility derivation and the monitor state mapping.
//
// Fixture: test/fixtures/matchday/match-sample.json — rounds 2 and 3 of a REAL match-runner
// match (seed 42, NRG vs Team Heretics) as emitted by scripts/run-match.mts (with tracks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeMatch, type RawMatch } from '../../src/shared/match-merge.ts';
import { fromSimEventLog, type Replay } from '../../../../packages/replay-engine/src/index.ts';
import { buildNav, type NavData } from '../../src/renderer/matchday/nav.ts';
import {
  ENGINE, buildHops, buildTimeline, displayPos, engineFacing, facingAt, findPlayer, isAlive, logicalAt, playerIdFor,
  poseAt, scoreAt, teamOfId, teamPlayers, type MatchTimeline, type RoundTimeline,
} from '../../src/renderer/matchday/timeline.ts';
import {
  buildIntel, canHear, canSee, facingAngleTo, playerViewAt, teamIntelAt, watchedZones,
} from '../../src/renderer/matchday/visibility.ts';
import { formatClock, killsUpTo, monitorStatusAt, situationAt } from '../../src/renderer/matchday/monitor.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(path.resolve(here, p), 'utf8'));
const nav = buildNav(readJson('../../src/data/sim/ascent.navgraph.json') as NavData);
const raw = readJson('../fixtures/matchday/match-sample.json') as RawMatch;

function load(): { replay: Replay; tl: MatchTimeline } {
  const { events, summary, perception } = mergeMatch(raw);
  const replay = fromSimEventLog(events, { mapId: 'ascent', perception });
  return { replay, tl: buildTimeline(replay, summary, nav) };
}
const { replay, tl } = load();
const r2 = tl.rounds[0];
const r3 = tl.rounds[1];
const at = (round: RoundTimeline, ms: number) => round.startMs + ms;
const zonePos = (id: string) => nav.zone(id)!.position;

// ── nav ──────────────────────────────────────────────────────────────────────────────────

test('nav: sightlines are symmetric, zone-level, and a zone sees itself', () => {
  assert.equal(nav.hasSight('a-main', 'a-site'), true);
  assert.equal(nav.hasSight('a-site', 'a-main'), true);
  assert.equal(nav.hasSight('a-site', 'a-site'), true);
  assert.equal(nav.hasSight('a-main', 'b-site'), false);
  assert.equal(nav.hasSight('a-lobby', 'a-site'), false, 'no authored sightline → not visible (fails safe)');
});

test('nav: sound attenuates per link and takes the best route', () => {
  assert.equal(nav.audible('a-site', 'a-site'), 1);
  assert.ok(Math.abs(nav.audible('a-main', 'a-site') - 0.8) < 1e-9);
  assert.ok(Math.abs(nav.audible('a-main', 'a-garden') - 0.8 * 0.6) < 1e-9);
  assert.equal(nav.audible('a-main', 'b-site'), 0);
});

test('nav: fastest path and nearest zone', () => {
  assert.deepEqual(nav.path('attacker-spawn', 'a-site'), ['attacker-spawn', 'a-lobby', 'a-main', 'a-site']);
  assert.equal(nav.path('a-site', 'a-site')?.length, 1);
  assert.equal(nav.nearestZone({ x: 6100, y: -6600, z: 480 }).id, 'a-site');
  assert.ok(nav.edge('a-main', 'a-site'));
  assert.equal(nav.edge('a-main', 'b-site'), null);
});

// ── timeline ─────────────────────────────────────────────────────────────────────────────

test('timeline: rounds, rosters and team mapping', () => {
  assert.equal(tl.rounds.length, 2);
  assert.equal(tl.hasTracks, true);
  assert.deepEqual([r2.roundNum, r3.roundNum], [2, 3]);
  assert.equal(r3.players.length, 10);
  assert.equal(teamPlayers(r3, 'A').length, 5);
  assert.deepEqual(teamPlayers(r3, 'A').map((p) => p.id), ['atk1', 'atk2', 'atk3', 'atk4', 'atk5']);
  assert.equal(r3.startMs > r2.endMs, true, 'rounds sit on one match timeline');
});

test('timeline: engine ids map to real teams by side, and swap with the attacker', () => {
  assert.equal(teamOfId('atk3', 'A'), 'A');
  assert.equal(teamOfId('def3', 'A'), 'B');
  assert.equal(teamOfId('atk3', 'B'), 'B');
  assert.equal(playerIdFor('A', 3, 'A'), 'atk3');
  assert.equal(playerIdFor('A', 3, 'B'), 'def3');
});

test('timeline: arrivals become travel segments (run when there was time to wait first)', () => {
  const atk4 = findPlayer(r2, 'atk4')!;
  assert.equal(atk4.spawnZone, 'attacker-spawn');
  assert.deepEqual(atk4.hops.map((h) => h.toZone), ['b-lobby', 'b-main', 'b-site']);
  const [toLobby, toMain] = atk4.hops;
  // spawn → b-lobby takes the whole gap (quantised to engine ticks). The fixture was recorded by
  // the zone-hop engine with the hand-timed edges; the navgraph now carries measured route times,
  // so the reconstructed departure may sit one tick after the round start.
  assert.ok(toLobby.departMs - r2.startMs >= 0 && toLobby.departMs - r2.startMs <= 100, `departs with the round (${toLobby.departMs - r2.startMs} ms)`);
  // held b-lobby for a minute, then ran the 6.6 s edge: departure is arrival − run time
  const edge = nav.edge('b-lobby', 'b-main')!;
  assert.ok(Math.abs((toMain.arriveMs - toMain.departMs) - edge.runTimeMs) < 1);
  assert.ok(toMain.departMs > toLobby.arriveMs + 50000);
});

test('timeline: a gap equal to the walk time is a walk; non-adjacent zones get a short slide', () => {
  const edge = nav.edge('a-lobby', 'a-main')!;
  const hops = buildHops(
    [{ tMs: 1000 + edge.walkTimeMs, pos: zonePos('a-main') }, { tMs: 60000, pos: zonePos('b-site') }],
    zonePos('a-lobby'), 1000, nav,
  );
  assert.equal(hops[0].mode, 'walk');
  assert.equal(hops[0].departMs, 1000);
  assert.equal(hops[1].arriveMs - hops[1].departMs, 1500);
});

test('timeline: a zone hop is never drawn as a straight line between zone centres', () => {
  const atk4 = findPlayer(r3, 'atk4')!;
  const hop = atk4.hops[0]; // attacker-spawn → a-lobby (one keyframe per arrival: sparse)
  assert.equal(hop.sampled, false);
  const mid = (hop.departMs + hop.arriveMs) / 2;
  const pose = poseAt(r3, atk4, mid, nav);
  assert.equal(pose.moving, true);
  assert.equal(pose.zone, 'attacker-spawn', 'the engine keeps the player on the origin zone until arrival');
  assert.equal(pose.toZone, 'a-lobby');
  assert.ok(Math.abs(pose.hopProgress! - 0.5) < 0.01, 'progress is reported for the on-the-way indicator');
  // the drawn position stays on the origin zone for the whole hop, then is on the destination
  for (const u of [0.01, 0.25, 0.5, 0.75, 0.99]) {
    assert.deepEqual(displayPos(atk4, hop.departMs + (hop.arriveMs - hop.departMs) * u), displayPos(atk4, hop.departMs));
  }
  assert.deepEqual(logicalAt(atk4, hop.arriveMs).zone, 'a-lobby');
  const after = displayPos(atk4, hop.arriveMs);
  const off = formationOffset(atk4);
  assert.ok(Math.abs(after.x - off.x - hop.to.x) < 1e-6 && Math.abs(after.y - off.y - hop.to.y) < 1e-6);
  assert.equal(poseAt(r3, atk4, at(r3, 25000), nav).hopProgress, null, 'standing on a-site: not on the way anywhere');
});

test('timeline: travelling players face the next zone; holders face the choke toward the enemy spawn', () => {
  const atk4 = findPlayer(r3, 'atk4')!;
  const hop = atk4.hops[1]; // a-lobby → a-main
  const f = engineFacing(r3, atk4, hop.departMs + 10, nav);
  assert.ok(facingAngleTo(f, hop.from, hop.to) < 1e-6);
  // def1 anchors a-site: an attacker reaches a-site through a-main
  const def1 = findPlayer(r3, 'def1')!;
  const hold = engineFacing(r3, def1, at(r3, 1000), nav);
  assert.ok(facingAngleTo(hold, zonePos('a-site'), zonePos('a-main')) < 1e-6);
});

test('timeline: death freezes a player and ends their liveness', () => {
  const atk4 = findPlayer(r3, 'atk4')!;
  assert.equal(atk4.deathMs, at(r3, 36200));
  assert.equal(atk4.killerId, 'def3');
  assert.equal(isAlive(atk4, at(r3, 36199)), true);
  assert.equal(isAlive(atk4, at(r3, 36200)), false);
  assert.deepEqual(displayPos(atk4, at(r3, 40000)), displayPos(atk4, at(r3, 36200)));
  const kill = r3.kills.find((k) => k.victimId === 'atk4')!;
  assert.equal(kill.zone, 'a-site');
  assert.equal(kill.killerTeam, 'B');
});

test('timeline: plant/defuse windows are derived from the engine durations', () => {
  assert.equal(r3.plant?.playerId, 'atk4');
  assert.equal(r3.plant?.site, 'A');
  assert.equal(r3.plant!.tMs, at(r3, 17900));
  // atk4 reached a-site at 13.8 s, so the 4 s plant starts at 13.9 s
  assert.equal(r3.plant!.startMs, at(r3, 17900) - ENGINE.plantDurationMs);
  assert.equal(r3.defuse?.playerId, 'def3');
  assert.equal(r3.defuse!.tMs - r3.defuse!.startMs, ENGINE.defuseDurationMs);
  assert.deepEqual(r3.defuse!.pos, r3.plant!.pos, 'the defuse happens on the planted spike');
  assert.equal(r3.endReason, 'spikeDefused');
});

test('timeline: the score only counts a round once playback reaches its end (no spoilers)', () => {
  assert.deepEqual(scoreAt(tl, r2.startMs + 1000), { A: 0, B: 0 });
  assert.deepEqual(scoreAt(tl, r2.endMs), raw.rounds[0].score);
  assert.deepEqual(scoreAt(tl, r3.startMs + 5000), raw.rounds[0].score);
  assert.deepEqual(scoreAt(tl, r3.endMs), raw.rounds[1].score);
});

// ── visibility ───────────────────────────────────────────────────────────────────────────

test('visibility: canSee applies the engine rule — alive, range, 110° cone, zone sightline', () => {
  const me = { pos: zonePos('a-main'), zone: 'a-main', alive: true };
  const towardSite = { x: zonePos('a-site').x - me.pos.x, y: zonePos('a-site').y - me.pos.y };
  const enemy = { pos: zonePos('a-site'), zone: 'a-site', alive: true };
  assert.equal(canSee(nav, { ...me, facing: towardSite }, enemy), true);
  assert.equal(canSee(nav, { ...me, facing: { x: -towardSite.x, y: -towardSite.y } }, enemy), false, 'behind the player');
  assert.equal(canSee(nav, { ...me, facing: towardSite }, { ...enemy, alive: false }), false);
  assert.equal(canSee(nav, { ...me, facing: towardSite, alive: false }, enemy), false);
  // a-lobby has no sightline onto a-site even when looking straight at it
  const lobby = { pos: zonePos('a-lobby'), zone: 'a-lobby', alive: true };
  assert.equal(canSee(nav, { ...lobby, facing: { x: enemy.pos.x - lobby.pos.x, y: enemy.pos.y - lobby.pos.y } }, enemy), false);
  // same zone, in front → visible; beyond 45 m → not
  assert.equal(canSee(nav, { ...me, facing: { x: 1, y: 0 } }, { pos: { ...me.pos, x: me.pos.x + 200 }, zone: 'a-main', alive: true }), true);
  assert.equal(canSee(nav, { ...me, facing: { x: 1, y: 0 } }, { pos: { ...me.pos, x: me.pos.x + 4600 }, zone: 'a-main', alive: true }), false);
});

test('visibility: watched zones are the own zone plus sightline zones inside the cone', () => {
  const site = zonePos('a-site');
  const towardMain = { x: zonePos('a-main').x - site.x, y: zonePos('a-main').y - site.y };
  const watched = watchedZones(nav, { pos: site, zone: 'a-site', facing: towardMain, alive: true });
  assert.equal(watched[0], 'a-site');
  assert.ok(watched.includes('a-main'));
  assert.ok(!watched.includes('a-rafters'), 'rafters are behind a holder who watches main');
  assert.deepEqual(watchedZones(nav, { pos: site, zone: 'a-site', facing: towardMain, alive: false }), []);
});

test('visibility: hearing uses loudness × propagated strength against the per-kind floor', () => {
  assert.equal(canHear(nav, 'a-site', { zone: 'a-main', kind: 'footstep' }), true);    // 0.8 × 0.8 = 0.64 ≥ 0.45
  assert.equal(canHear(nav, 'a-garden', { zone: 'a-main', kind: 'footstep' }), false); // 0.8 × 0.48 = 0.38
  assert.equal(canHear(nav, 'a-garden', { zone: 'a-main', kind: 'gunfire' }), true);   // 1.0 × 0.48 ≥ 0.1
  assert.equal(canHear(nav, 'b-site', { zone: 'a-main', kind: 'gunfire' }), false);
});

test('visibility: team intel drops dead enemies and our own footsteps, and dates sightings', () => {
  const intelTrack = buildIntel(replay.perception?.find((p) => p.teamIdx === 0), r3, 'A');
  assert.ok(intelTrack.frames.length > 50);
  // 20 s in: def1 and def2 were both killed around 10.8 s — the kill feed is public, so no ghosts.
  const intel = teamIntelAt(intelTrack, r3, 'A', at(r3, 20000));
  assert.deepEqual(intel.enemies.map((e) => e.enemyId), []);
  // Just before the duels the team has nothing on the enemy yet.
  assert.deepEqual(teamIntelAt(intelTrack, r3, 'A', at(r3, 9000)).enemies, []);
  // Our five are running through a-lobby at 6 s: those footsteps are ours, not intel.
  const early = teamIntelAt(intelTrack, r3, 'A', at(r3, 6000));
  assert.ok(!early.sounds.some((s) => s.kind === 'footstep' && s.zone === 'a-lobby'));
  for (const f of intelTrack.frames) for (const e of f.enemies) assert.ok(e.seenAtMs <= f.tMs && e.seenAtMs >= r3.startMs);
});

test('visibility: a monitor shows a duel opponent, and never more than the team knows', () => {
  const track = buildIntel(replay.perception?.find((p) => p.teamIdx === 0), r3, 'A');
  // atk4 kills def2 at 10.9 s: the lead-in shows def2 on atk4's monitor only.
  const t = at(r3, 10850);
  const intel = teamIntelAt(track, r3, 'A', t);
  assert.deepEqual(playerViewAt(nav, r3, 'atk4', t, intel).enemies, [{ enemyId: 'def2', via: 'duel' }]);
  assert.deepEqual(playerViewAt(nav, r3, 'atk3', t, intel).enemies, []);
  // Sweep both rounds: every enemy on a monitor is either a duel opponent or team-visible.
  for (const round of [r2, r3]) {
    const tr = buildIntel(replay.perception?.find((p) => p.teamIdx === 0), round, 'A');
    for (let ms = round.startMs; ms <= round.endMs; ms += 250) {
      const team = teamIntelAt(tr, round, 'A', ms);
      const visible = new Set(team.enemies.filter((e) => e.visibleNow).map((e) => e.enemyId));
      for (const p of teamPlayers(round, 'A')) {
        const view = playerViewAt(nav, round, p.id, ms, team);
        if (!isAlive(p, ms)) { assert.deepEqual(view, { enemies: [], sounds: [], watched: [] }); continue; }
        for (const e of view.enemies) {
          assert.ok(e.via === 'duel' || visible.has(e.enemyId), `${p.id} sees ${e.enemyId} at ${ms} without team knowledge`);
          assert.equal(teamOfId(e.enemyId, round.attacker), 'B');
        }
        for (const s of view.sounds) assert.ok(team.sounds.includes(s));
      }
    }
  }
});

// ── monitor state ────────────────────────────────────────────────────────────────────────

test('monitor: state follows the round — moving, fighting, planting, holding, dead', () => {
  const s = (ms: number) => monitorStatusAt(r3, 'atk4', at(r3, ms));
  assert.equal(s(5000).state, 'moving');
  assert.equal(s(5000).toZone, 'a-lobby');
  assert.equal(s(10800).state, 'fighting');
  assert.equal(s(10800).opponentId, 'def2');
  assert.equal(s(16000).state, 'planting');
  assert.ok(Math.abs(s(15900).progress! - 0.5) < 0.01);
  assert.equal(s(25000).state, 'holding');
  assert.equal(s(25000).zone, 'a-site');
  assert.equal(s(36100).state, 'fighting', 'squaring up to def3 before the (instant) engine duel');
  const dead = s(37200);
  assert.equal(dead.state, 'dead');
  assert.equal(dead.opponentId, 'def3');
  assert.equal(dead.deadForMs, 1000);
  assert.equal(monitorStatusAt(r3, 'def3', at(r3, 40000)).state, 'defusing');
});

test('monitor: situation — alive counts, spike clock, clutch', () => {
  const start = situationAt(r3, at(r3, 1000));
  assert.deepEqual(start.alive, { A: 5, B: 5 });
  assert.equal(start.spike.phase, 'none');
  assert.equal(start.clockMs, ENGINE.roundTimeMs - 1000);
  assert.equal(situationAt(r3, at(r3, 15900)).spike.phase, 'planting');
  const planted = situationAt(r3, at(r3, 20000));
  assert.equal(planted.spike.phase, 'planted');
  assert.equal(planted.spike.site, 'A');
  assert.equal(planted.clockMs, 17900 + ENGINE.spikeTimerMs - 20000);
  assert.deepEqual(planted.alive, { A: 3, B: 3 });
  // after 36.2 s: A has 1 alive (atk3) against 3
  const late = situationAt(r3, at(r3, 37000));
  assert.deepEqual(late.alive, { A: 1, B: 3 });
  assert.deepEqual(late.clutch, { team: 'A', playerId: 'atk3', versus: 3 });
  assert.equal(late.spike.phase, 'defusing');
  const end = situationAt(r3, r3.endMs);
  assert.equal(end.over, true);
  assert.equal(end.clutch, null);
  assert.equal(end.spike.phase, 'defused');
});

test('monitor: kill tally and clock formatting', () => {
  const tally = killsUpTo(r3, at(r3, 11000));
  assert.equal(tally.get('atk1'), 1);
  assert.equal(tally.get('def2'), 2);
  assert.equal(tally.get('atk4'), 1);
  assert.equal(killsUpTo(r3, at(r3, 10000)).size, 0);
  assert.equal(formatClock(100000), '1:40');
  assert.equal(formatClock(9001), '0:10');
  assert.equal(formatClock(-5), '0:00');
});

// ── 3D world (team cams) ─────────────────────────────────────────────────────────────────
import { BLOCKOUT, EYE_HEIGHT_M, buildBlockout, firstPersonPose, segDist2d, toScene } from '../../src/renderer/matchday/world3d.ts';
import { computeFrame } from '../../src/renderer/matchday/frame.ts';
import { eventJump, firingAt, roundMarks, BURST, JUMP_LEAD_MS } from '../../src/renderer/matchday/monitor.ts';
import { formationOffset } from '../../src/renderer/matchday/timeline.ts';
import { DEFAULT_PREFS, parsePrefs } from '../../src/renderer/matchday/prefs.ts';

test('world3d: game → scene swaps y/z (handedness) and converts to metres', () => {
  assert.deepEqual(toScene({ x: 100, y: -250, z: 400 }), { x: 1, y: 4, z: -2.5 });
});

test('world3d: first-person camera sits at eye height and looks along the heading', () => {
  const pos = { x: 1000, y: 2000, z: 300 };
  const east = firstPersonPose(pos, 0, 3, 0); // heading +game.x, level
  assert.deepEqual(east.position, { x: 10, y: 3 + EYE_HEIGHT_M, z: 20 });
  assert.ok(east.target.x > east.position.x && Math.abs(east.target.z - east.position.z) < 1e-9);
  const north = firstPersonPose(pos, Math.PI / 2, 3, 0); // heading +game.y → +scene.z
  assert.ok(north.target.z > north.position.z && Math.abs(north.target.x - north.position.x) < 1e-9);
  assert.ok(firstPersonPose(pos, 0, 3).target.y < east.position.y, 'default pitch looks slightly down');
});

test('world3d: segment distance', () => {
  const p = (x: number, y: number) => ({ x, y, z: 0 });
  assert.equal(segDist2d(p(0, 0), p(10, 0), p(5, -5), p(5, 5)), 0);
  assert.equal(segDist2d(p(0, 0), p(10, 0), p(0, 3), p(10, 3)), 3);
  assert.equal(segDist2d(p(0, 0), p(10, 0), p(14, 3), p(20, 3)), 5);
});

test('world3d: the blockout never walls off a travel link or an authored sightline', () => {
  const plantZones = (readJson('../../src/data/sim/ascent.navgraph.json') as { plantZones: Array<{ zoneId: string; polygon: Array<{ x: number; y: number }> }> }).plantZones;
  const b = buildBlockout(nav, plantZones);
  assert.equal(b.labels.length, nav.zones.length);
  assert.equal(b.floors.filter((f) => f.kind === 'room').length, nav.zones.length);
  assert.equal(b.floors.filter((f) => f.kind === 'site').length, 2);
  assert.ok(b.walls.length > 200, 'still a walled space, not an open field');
  for (const l of nav.links) {
    const a = nav.zone(l.a)!.position, c = nav.zone(l.b)!.position;
    for (const w of b.walls) assert.ok(segDist2d(w.a, w.b, a, c) >= BLOCKOUT.corridorHalfWidth * 0.9, `wall in the lane ${l.a} → ${l.b}`);
  }
  for (const z of nav.zones) for (const o of nav.sightZones(z.id)) {
    const a = z.position, c = nav.zone(o)!.position;
    for (const w of b.walls) assert.ok(segDist2d(w.a, w.b, a, c) > 0, `wall across the sightline ${z.id} ↔ ${o}`);
  }
  // rooms sit at the navgraph height of their zone
  const site = b.floors.find((f) => f.kind === 'room' && Math.abs(f.pts[0].z - zonePos('a-site').z) < 1e-9);
  assert.ok(site);
});

test('frame: one team\'s picture — own units, gated enemies, public kills', () => {
  const f = computeFrame(replay, tl, nav, 'A', at(r3, 10850))!;
  assert.equal(f.round.roundNum, 3);
  assert.deepEqual(f.units.map((u) => u.id), ['atk1', 'atk2', 'atk3', 'atk4', 'atk5']);
  // atk4 is squaring up to def2: def2 is seen by atk4 (and only by players in a duel with it)
  const def2 = f.seen.find((e) => e.id === 'def2')!;
  assert.ok(def2.seenBy.includes('atk4'));
  assert.ok(!def2.seenBy.includes('atk3'));
  for (const e of [...f.seen, ...f.ghosts]) assert.ok(e.id.startsWith('def'), 'only enemies are in seen/ghosts');
  assert.equal(f.kills.length, 3, 'kills up to this instant are public');
  // the same instant from the other team's side shows THEIR units and nothing of ours unless seen
  const b = computeFrame(replay, tl, nav, 'B', at(r3, 5000))!;
  assert.deepEqual(b.units.map((u) => u.id), ['def1', 'def2', 'def3', 'def4', 'def5']);
  assert.deepEqual(b.seen, []);
});

test('playback: round marks and previous/next event jumps', () => {
  const marks = roundMarks(r3);
  assert.deepEqual(marks.map((m) => m.kind), ['kill', 'kill', 'kill', 'kill', 'plant', 'kill', 'kill', 'defuse', 'end']);
  assert.equal(marks[marks.length - 1].tMs, r3.endMs);
  assert.equal(marks[4].team, 'A', 'our plant');
  // from the round start, "next" lands a lead before the first kill; the 0.2 s burst of kills is one stop
  const first = eventJump(r3, r3.startMs, 1)!;
  assert.equal(first, at(r3, 10700) - JUMP_LEAD_MS);
  const second = eventJump(r3, first, 1)!;
  assert.equal(second, at(r3, 17900) - JUMP_LEAD_MS, 'next stop is the plant, not another kill of the same burst');
  assert.equal(eventJump(r3, second + 5000, -1), second);
  assert.equal(eventJump(r3, r3.endMs, 1), null);
  assert.equal(eventJump(r3, r3.startMs, -1), null);
  assert.equal(eventJump(r3, r3.startMs + 3000, -1), r3.startMs);
});

test('timeline: dense engine samples are drawn exactly as recorded — no zone-centre shortcut', () => {
  // an engine that records every tick: 100 ms samples along a curved path through a-main
  const start = { x: 5000, y: -4000, z: 400 };
  const samples = Array.from({ length: 20 }, (_, i) => ({ tMs: 1000 + (i + 1) * 100, pos: { x: 5000 + (i + 1) * 60, y: -4000 - Math.sin((i + 1) / 4) * 200, z: 400 } }));
  const hops = buildHops(samples, start, 1000, nav);
  assert.equal(hops.length, 20);
  assert.ok(hops.every((h) => h.sampled && h.arriveMs - h.departMs === 100));
  assert.deepEqual(hops[7].from, samples[6].pos);
  assert.deepEqual(hops[7].to, samples[7].pos);
  const p = { id: 'atk1', team: 'A' as const, side: 'attack' as const, slot: 1, spawn: start, spawnZone: 'a-main', hops, continuous: true, deathMs: null, killerId: null };
  // halfway between samples 7 and 8: the linear midpoint of those two samples, with no formation offset
  const mid = displayPos(p, 1000 + 850);
  assert.ok(Math.abs(mid.x - (samples[7].pos.x + samples[8].pos.x) / 2) < 1e-6);
  assert.ok(Math.abs(mid.y - (samples[7].pos.y + samples[8].pos.y) / 2) < 1e-6);
  assert.deepEqual(formationOffset(p), { x: 0, y: 0 });
  // after standing still the engine emits nothing: the next sample is one tick of movement, not a slow slide
  const resumed = buildHops([{ tMs: 40000, pos: { x: 5060, y: -4000, z: 400 } }], start, 1000, nav);
  assert.equal(resumed[0].sampled, true);
  assert.equal(resumed[0].departMs, 39900);
  // the zone-hop engine's sparse arrivals are still reconstructed as before
  assert.equal(findPlayer(r3, 'atk4')!.continuous, false);
  assert.ok(findPlayer(r3, 'atk4')!.hops.every((h) => !h.sampled));
});

test('prefs: stored view preferences are validated field by field', () => {
  assert.deepEqual(parsePrefs(null), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('not json'), DEFAULT_PREFS);
  assert.deepEqual(parsePrefs('{"mode":"cams","tempo":4,"belief":true,"detail":"key"}'), { mode: 'cams', tempo: 4, belief: true, detail: 'key' });
  assert.deepEqual(parsePrefs('{"mode":"3d","tempo":3,"belief":"yes","detail":"nope"}'), DEFAULT_PREFS);
  assert.equal(DEFAULT_PREFS.tempo, 1, 'real time is the default');
  assert.equal(DEFAULT_PREFS.detail, 'extended', 'extended detail is the default');
  assert.equal(parsePrefs('{"mode":"cams","tempo":"auto"}').tempo, 1, 'a stored highlights tempo falls back to real time');
  assert.equal(parsePrefs('{"tempo":0.5}').tempo, 0.5);
  assert.equal(parsePrefs('{"detail":"instant"}').detail, 'instant');
  assert.equal(parsePrefs('{"detail":"full"}').detail, 'full');
});

test('view model: a player fires only around the kills they are part of', () => {
  const kill = at(r3, 10900); // atk4 kills def2
  assert.deepEqual(firingAt(r3.kills, 'atk4', at(r3, 5000)), { kick: 0, flash: false });
  const shot = firingAt(r3.kills, 'atk4', kill);
  assert.equal(shot.kick, 1); assert.equal(shot.flash, true);
  assert.equal(firingAt(r3.kills, 'atk4', kill - BURST.everyMs * 2).flash, true, 'burst before the kill');
  assert.ok(firingAt(r3.kills, 'atk4', kill + 600).kick < 0.01, 'recoil settles');
  assert.equal(firingAt(r3.kills, 'atk3', kill).kick, 0, 'a teammate who is not in the duel does not fire');
  assert.equal(firingAt(r3.kills, 'def2', kill).flash, true, 'the victim was shooting back');
});

test('sight: the sim\'s own per-tick sight and zones win over the approximation; without it the source is "approx"', async () => {
  const { sightAt, zoneOf } = await import('../../src/renderer/matchday/timeline.ts');
  const before = computeFrame(replay, tl, nav, 'A', at(r3, 5000))!;
  assert.equal(before.sightSource, 'approx');
  // attach a sight record to round 3: at 5 s atk1 sees def5 and stands in mid-catwalk per the sim
  const sight: Array<{ tMs: number; zones: Record<string, string>; sees: Record<string, string[]> }> = [{ tMs: 0, zones: { atk1: 'attacker-spawn' }, sees: {} }, { tMs: 5000, zones: { atk1: 'mid-catwalk' }, sees: { atk1: ['def5', 'atk2'] } }];
  const r3s = { ...r3, summary: { ...r3.summary!, sight } };
  const tl2 = { ...tl, rounds: [tl.rounds[0], r3s] };
  assert.equal(sightAt(r3s, at(r3, 4999))?.zones.atk1, 'attacker-spawn');
  assert.equal(zoneOf(r3s, findPlayer(r3s, 'atk1')!, at(r3, 5000)), 'mid-catwalk', 'the sim\'s zone, not the nearest centre');
  const f = computeFrame(replay, tl2, nav, 'A', at(r3, 5000))!;
  assert.equal(f.sightSource, 'engine');
  const atk1 = f.units.find((u) => u.id === 'atk1')!;
  assert.deepEqual(atk1.view.enemies, [{ enemyId: 'def5', via: 'sight' }], 'exactly the enemies the sim says — teammates ignored');
  assert.equal(atk1.pose.zone, 'mid-catwalk');
  assert.deepEqual(f.seen.map((e) => e.id), ['def5']);
});

// ── economy, duels, sim gaze/plan (UI-1…UI-6) ───────────────────────────────────────────────
import { buyReason, dropsOf, playerEco } from '../../src/renderer/matchday/economy.ts';
import { duelCards } from '../../src/renderer/matchday/duels.ts';
import { planOf } from '../../src/renderer/matchday/monitor.ts';
import type { MatchRoundSummary, PlayerBuyInfo } from '../../src/shared/ipc.ts';

const pbuy = (index: number, over: Partial<PlayerBuyInfo> = {}): PlayerBuyInfo => ({
  index, creditsBefore: 3000 + index * 100, creditsAfter: 100, spent: 2900, weapon: 'Vandal', weaponSource: 'bought', armor: 0, armorBought: 'heavy', utility: 300, loadoutValue: 4000, ...over,
});
const ecoRound = (): MatchRoundSummary => ({
  ...(r3.summary as MatchRoundSummary),
  buys: {
    A: { tier: 'full', weapon: 'Vandal', plan: 'max', cost: 13000, loadoutValue: 21000, vctTier: 'full', drops: 1, call: 'full',
      evaluation: [{ plan: 'light', ultHold: false, value: 0.51, winNow: 0.5 }, { plan: 'max', ultHold: false, value: 0.62, winNow: 0.55 }],
      players: [pbuy(0), pbuy(1, { weaponSource: 'dropped', droppedBy: 0, creditsBefore: 900 }), pbuy(2, { weaponSource: 'kept', weapon: 'Phantom' }), pbuy(3), pbuy(4)] },
    B: { tier: 'eco', weapon: 'Classic' },
  },
  economy: {
    A: { credits: 5000, ultPoints: 3, players: [0, 1, 2, 3, 4].map((i) => ({ credits: 700 + i, weapon: i === 2 ? 'Phantom' : null, armor: 0, ultPoints: i })) },
    B: { credits: 1000, ultPoints: 0 },
  },
});

test('economy: a player\'s entering state is shown during the round; the after-state only once it is over', () => {
  const round = ecoRound(), prev = { ...ecoRound(), economy: { ...ecoRound().economy, A: { ...ecoRound().economy.A, players: [0, 1, 2, 3, 4].map((i) => ({ credits: 1, weapon: null, armor: 0, ultPoints: 4 + i })) } } };
  const live = playerEco(round, prev, 'A', 2, false)!;
  assert.equal(live.creditsBefore, 900);
  assert.equal(live.source, 'dropped');
  assert.equal(live.droppedBySlot, 1, 'roster index 0 is slot 1');
  assert.equal(live.ultBefore, 5, 'ult points carried in come from the previous round');
  assert.equal(live.creditsAfter, null, 'the credits after the round do not spoil it');
  assert.equal(live.armor, 50, 'a bought heavy shield counts');
  const done = playerEco(round, prev, 'A', 3, true)!;
  assert.equal(done.creditsAfter, 702); assert.equal(done.keeps, 'Phantom');
  assert.equal(playerEco(round, prev, 'B', 1, false), null, 'no per-player data → null (older engine)');
});

test('economy: the buy reason names the plan, the coach call and the alternative it beat; drops are attributed', () => {
  const buy = ecoRound().buys.A;
  const r = buyReason(buy)!;
  assert.equal(r.plan, 'max'); assert.equal(r.call, 'full'); assert.equal(r.loadoutValue, 21000);
  assert.deepEqual(r.chosen, { plan: 'max', value: 0.62, ultHold: false });
  assert.deepEqual(r.beat, { plan: 'light', value: 0.51, ultHold: false });
  assert.deepEqual(dropsOf(buy), [{ from: 1, to: 2, weapon: 'Vandal' }]);
  assert.equal(buyReason(ecoRound().buys.B), null, 'an engine without plans gives no reason');
});

test('duel cards: our side first, first sight and winner from the viewer\'s point of view', () => {
  const eng = [{ elapsedMs: 10700, attackerId: 'atk4', defenderId: 'def2', attackerZone: 'a-main', defenderZone: 'a-site', distanceMeters: 31.6, firstSight: 'attacker' as const,
    attackerPreAim: true, defenderPreAim: false, attackerMoving: false, defenderMoving: true, angleDelayMs: { attacker: 0, defender: 120 }, crossfire: { attacker: false, defender: true },
    info: { attacker: true, defender: false }, attackerFlashedMs: 0, defenderFlashedMs: 0, winnerSide: 'attack' as const }];
  const mine = duelCards(eng, r3.startMs, 'A', 'A')[0];
  assert.equal(mine.ours.id, 'atk4'); assert.equal(mine.firstSight, 'ours'); assert.equal(mine.winner, 'ours');
  assert.equal(mine.theirs.crossfire, true); assert.equal(mine.theirs.angleDelayMs, 120); assert.equal(mine.distanceM, 32);
  const theirs = duelCards(eng, r3.startMs, 'A', 'B')[0];
  assert.equal(theirs.ours.id, 'def2'); assert.equal(theirs.firstSight, 'theirs'); assert.equal(theirs.winner, 'theirs');
  assert.equal(duelCards(null, 0, 'A', 'A').length, 0);
});

test('plan: our plan revisions are placed on the match clock; nothing for a round without decisions', () => {
  const plan = { opening: 'aExecute', strategy: 'commit A', objective: 'a-site', feint: 'b-site', revisions: [{ atMs: 26600, from: 'aExecute', to: 'commit A', reason: 'clock' }] };
  const r = { ...r3, summary: { ...r3.summary!, decisions: { plans: { A: plan, B: null }, opponentReadBefore: { A: null, B: null }, observed: { plantSite: null, firstContactSite: null, defendersMet: {} } } } } as unknown as RoundTimeline;
  const p = planOf(r, 'A')!;
  assert.equal(p.feint, 'b-site'); assert.equal(p.marks[0].tMs, r3.startMs + 26600);
  assert.equal(planOf(r, 'B'), null);
  assert.equal(planOf(r3, 'A'), null);
});

test('sim gaze: the recorded facing wins over the engine-rule estimate, blind and gaze are reported', () => {
  const sight = [{ tMs: 0, facing: { atk1: { x: 0, y: 1 } }, gaze: { atk1: 'hold' as const } }, { tMs: 6000, facing: { atk1: { x: 1, y: 0 } }, gaze: { atk1: 'enemy' as const }, blind: ['atk1'] }];
  const r = { ...r3, summary: { ...r3.summary!, sight } } as unknown as RoundTimeline;
  const atk1 = findPlayer(r, 'atk1')!;
  assert.deepEqual(facingAt(r, atk1, at(r3, 3000), nav), { x: 0, y: 1 });
  assert.deepEqual(facingAt(r, atk1, at(r3, 6500), nav), { x: 1, y: 0 });
  const f = computeFrame(replay, { ...tl, rounds: [tl.rounds[0], r] }, nav, 'A', at(r3, 6500))!;
  const u = f.units.find((x) => x.id === 'atk1')!;
  assert.equal(u.gaze, 'enemy'); assert.equal(u.blind, true);
  assert.equal(f.units.find((x) => x.id === 'atk2')!.gaze, null, 'no record for that player: no gaze claimed');
  // without a sight record the estimate is used and no gaze is claimed
  const g = computeFrame(replay, tl, nav, 'A', at(r3, 6500))!;
  assert.equal(g.units[0].gaze, null);
});

test('buy phase: each round gets its own buy span before the barrier drops; positions move during it', () => {
  const P = (x: number, y: number) => ({ x, y, z: 0 });
  const round = (n: number, attacker: 'A' | 'B') => ({
    roundNumber: n, phase: 'regulation', attacker, winner: attacker, winnerSide: 'attack', reason: 'elimination', planted: false,
    score: { A: n, B: 0 }, kills: { A: 0, B: 0 },
    economy: { A: { credits: 0, ultPoints: 0 }, B: { credits: 0, ultPoints: 0 } },
    buys: { A: { tier: 'full', weapon: 'Vandal' }, B: { tier: 'full', weapon: 'Vandal' } },
    replayEvents: [
      { seq: 0, tick: -300, timeMs: -30000, kind: 'buyPhaseStart', durationMs: 30000 },
      { seq: 1, tick: -300, timeMs: -30000, kind: 'move', playerId: 'atk1', from: P(0, 0), to: P(0, 0) },
      { seq: 2, tick: -200, timeMs: -20000, kind: 'move', playerId: 'atk1', from: P(0, 0), to: P(300, 0) },
      { seq: 3, tick: 0, timeMs: 0, kind: 'roundStart', roundNumber: 1 },
      { seq: 4, tick: 50, timeMs: 5000, kind: 'move', playerId: 'atk1', from: P(300, 0), to: P(600, 0) },
      { seq: 5, tick: 100, timeMs: 10000, kind: 'roundEnd', winner: 'attack', reason: 'elimination' },
    ],
  });
  const m = mergeMatch({ ...raw, rounds: [round(1, 'A'), round(2, 'A')] as unknown as RawMatch['rounds'] });
  const rp = fromSimEventLog(m.events, { mapId: 'ascent' });
  const t = buildTimeline(rp, m.summary, nav);
  assert.equal(t.rounds.length, 2);
  const [a, b] = t.rounds;
  assert.equal(a.startMs - a.buyStartMs, 30000);
  assert.equal(b.startMs - b.buyStartMs, 30000);
  assert.ok(b.buyStartMs > a.endMs, 'the next round\'s buy phase starts after this round ends');
  assert.equal(t.startMs, a.buyStartMs);
  // the round's player starts at the buy-phase start, moves during the buy phase, and keeps its track
  const p = a.players.find((x) => x.id === 'atk1')!;
  assert.equal(p.spawn.x, 0);
  assert.equal(logicalAt(p, a.buyStartMs + 5000).pos.x < 300, true);
  assert.equal(logicalAt(p, a.startMs).pos.x, 300);
  // round 2's buy-phase keyframes belong to round 2, not to the tail of round 1
  assert.equal(a.players.find((x) => x.id === 'atk1')!.hops.every((h) => h.arriveMs <= a.endMs), true);
  // the HUD clock counts the buy time down, then the round clock
  const sBuy = situationAt(a, a.buyStartMs + 10000);
  assert.equal(sBuy.buyPhase, true);
  assert.equal(formatClock(sBuy.clockMs), '0:20');
  const sLive = situationAt(a, a.startMs + 1000);
  assert.equal(sLive.buyPhase, false);
  assert.equal(formatClock(sLive.clockMs), '1:39');
});
