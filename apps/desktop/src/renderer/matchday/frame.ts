// One instant of the match as ONE team knows it — the single data object both view modes draw
// from (the tactical map, the six monitors and the HUD panels). Nothing in a Frame comes from
// the other team's ground truth except where that team's own perception or the public kill
// feed grants it: `seen` enemies are gated by playerViewAt / team intel, ghosts are remembered
// sightings, and kill markers are public.
//
// Pure module: runs under `node --test`.
import type { Replay } from '@pv/replay-engine';
import type { NavModel, Vec3 } from './nav.ts';
import {
  displayPos, findPlayer, formationOffset, isAlive, poseAt, roundIndexAt, smoothFacingRad, teamPlayers,
  type KillEvent, type MatchTimeline, type PlayerRound, type Pose, type RoundTimeline, type TeamSlot,
} from './timeline.ts';
import {
  buildIntel, playerViewAt, teamIntelAt, PERCEPTION, type IntelSound, type IntelTrack, type PlayerView, type TeamIntel,
} from './visibility.ts';
import { killsUpTo, monitorStatusAt, situationAt, type MonitorStatus, type Situation } from './monitor.ts';

export interface FrameUnit {
  readonly id: string;
  readonly slot: number;
  readonly pose: Pose;
  /** Smoothed heading (radians, world x/y). */
  readonly facingRad: number;
  readonly status: MonitorStatus;
  readonly view: PlayerView;
  readonly kills: number;
}

export interface FrameEnemy {
  readonly id: string;
  readonly slot: number;
  readonly pos: Vec3;
  /** Own players who see this enemy right now. Empty for a ghost. */
  readonly seenBy: readonly string[];
  /** Milliseconds since the team last saw this enemy (0 while visible). */
  readonly ageMs: number;
  readonly zone: string;
}

export interface Frame {
  readonly tMs: number;
  readonly round: RoundTimeline;
  readonly team: TeamSlot;
  readonly units: readonly FrameUnit[];
  /** Enemies visible to at least one of our players now. */
  readonly seen: readonly FrameEnemy[];
  /** Remembered sightings of living enemies that nobody sees right now. */
  readonly ghosts: readonly FrameEnemy[];
  readonly sounds: readonly IntelSound[];
  readonly belief: ReadonlyArray<{ zone: string; p: number }>;
  readonly situation: Situation;
  /** Kills so far this round (public information). */
  readonly kills: readonly KillEvent[];
  /** Last known zone + staleness per living enemy slot, for the opponent roster. */
  readonly lastKnown: ReadonlyMap<string, { zone: string; ageMs: number; visible: boolean }>;
}

const intelCache = new WeakMap<RoundTimeline, Partial<Record<TeamSlot, IntelTrack>>>();
function intelFor(replay: Replay, round: RoundTimeline, team: TeamSlot): IntelTrack {
  let byTeam = intelCache.get(round);
  if (!byTeam) { byTeam = {}; intelCache.set(round, byTeam); }
  let track = byTeam[team];
  if (!track) {
    track = buildIntel(replay.perception?.find((p) => p.teamIdx === (team === 'A' ? 0 : 1)), round, team);
    byTeam[team] = track;
  }
  return track;
}

export function computeFrame(replay: Replay, tl: MatchTimeline, nav: NavModel, team: TeamSlot, tMs: number): Frame | null {
  if (tl.rounds.length === 0) return null;
  const round = tl.rounds[roundIndexAt(tl, tMs)];
  const t = Math.min(Math.max(tMs, round.startMs), round.endMs);
  const intel: TeamIntel = teamIntelAt(intelFor(replay, round, team), round, team, t);
  const tally = killsUpTo(round, t);

  const units: FrameUnit[] = teamPlayers(round, team).map((p: PlayerRound) => ({
    id: p.id, slot: p.slot,
    pose: poseAt(round, p, t, nav),
    facingRad: smoothFacingRad(round, p, isAlive(p, t) ? t : p.deathMs! - 1, nav),
    status: monitorStatusAt(round, p.id, t),
    view: playerViewAt(nav, round, p.id, t, intel),
    kills: tally.get(p.id) ?? 0,
  }));

  const seenBy = new Map<string, string[]>();
  for (const u of units) for (const e of u.view.enemies) seenBy.set(e.enemyId, [...(seenBy.get(e.enemyId) ?? []), u.id]);

  const seen: FrameEnemy[] = [];
  const ghosts: FrameEnemy[] = [];
  const lastKnown = new Map<string, { zone: string; ageMs: number; visible: boolean }>();
  for (const [id, by] of seenBy) {
    const p = findPlayer(round, id);
    if (!p || !isAlive(p, t)) continue;
    const pose = poseAt(round, p, t, nav);
    seen.push({ id, slot: p.slot, pos: displayPos(p, t), seenBy: by, ageMs: 0, zone: pose.toZone ?? pose.zone });
    lastKnown.set(id, { zone: pose.zone, ageMs: 0, visible: true });
  }
  for (const e of intel.enemies) {
    if (seenBy.has(e.enemyId)) continue;
    const p = findPlayer(round, e.enemyId);
    if (!p || !e.pos) continue;
    const ageMs = Math.max(0, t - e.seenAtMs);
    lastKnown.set(e.enemyId, { zone: e.zone, ageMs, visible: false });
    if (ageMs > PERCEPTION.memoryMs) continue;
    const off = formationOffset(p);
    ghosts.push({ id: e.enemyId, slot: p.slot, pos: { x: e.pos.x + off.x, y: e.pos.y + off.y, z: e.pos.z }, seenBy: [], ageMs, zone: e.zone });
  }

  return {
    tMs: t, round, team, units, seen, ghosts,
    sounds: intel.sounds, belief: intel.belief,
    situation: situationAt(round, t),
    kills: round.kills.filter((k) => k.tMs <= t),
    lastKnown,
  };
}

/**
 * Playback tempo for "highlights" pacing: real time around anything worth watching (a kill, the
 * plant, the defuse, the end of the round), fast through the quiet stretches in between.
 */
export function autoTempoAt(round: RoundTimeline, tMs: number): number {
  const marks: number[] = [round.endMs];
  for (const k of round.kills) marks.push(k.tMs);
  if (round.plant) marks.push(round.plant.startMs, round.plant.tMs);
  if (round.defuse) marks.push(round.defuse.startMs, round.defuse.tMs);
  let near = Infinity;
  for (const m of marks) {
    const d = m - tMs; // > 0: the moment is ahead
    const dist = d >= 0 ? d / 3500 : -d / 1500; // slow down 3.5 s before, stay slow 1.5 s after
    if (dist < near) near = dist;
  }
  if (near <= 1) return 1;
  if (near <= 2) return 1 + (near - 1) * 5; // ramp 1× → 6×
  return 6;
}
