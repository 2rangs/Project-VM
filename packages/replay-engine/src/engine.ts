/**
 * Replay engine: load/validate, interpolate, seek. Pure and deterministic —
 * playback speed never changes the computed state, only how often stateAt() is
 * called (DECISION-010: speed and judgement are independent).
 *
 * INTERPOLATION RULES (single source of truth for real + simulated replays):
 *   position : linear between the two bracketing keyframes.
 *   facing   : shortest-arc angular lerp (so 350°→10° turns +20°, not −340°).
 *   state    : step / carry-forward (hold the last keyframe's state).
 *   clamp    : before the first / after the last keyframe, hold the endpoint
 *              value and mark the snapshot `extrapolated`.
 */
import type {
  PlayerSnapshot, PlayerState, Replay, ReplayEvent, ReplaySnapshot,
  PlayerTrack, TrackKeyframe, Vec3,
} from './types.ts';

export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Shortest-arc angular interpolation in degrees; result normalized to [0,360). */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let d = (((b - a) % 360) + 360) % 360; // 0..359
  if (d > 180) d -= 360;                 // shortest arc; exact 180 stays +180
  const r = a + d * t;
  return ((r % 360) + 360) % 360;
}

/** Validate + normalize a plain object into a Replay (sorts keyframes/events). */
export function loadReplay(input: unknown): Replay {
  const r = input as Replay;
  if (!r || typeof r !== 'object') throw new TypeError('replay must be an object');
  if (r.schemaVersion !== '1') throw new TypeError(`unsupported schemaVersion ${String(r.schemaVersion)}`);
  if (!r.meta || typeof r.meta.source !== 'string') throw new TypeError('replay.meta.source missing');
  if (!Array.isArray(r.tracks)) throw new TypeError('replay.tracks must be an array');

  const tracks: PlayerTrack[] = r.tracks.map((tr) => ({
    playerId: tr.playerId,
    keyframes: [...tr.keyframes].sort((a, b) => a.tMs - b.tMs),
  }));
  const events: ReplayEvent[] = [...(r.events ?? [])].sort((a, b) => a.tMs - b.tMs);
  const rounds = [...(r.rounds ?? [])].sort((a, b) => a.startMs - b.startMs);
  return { ...r, tracks, rounds, events };
}

/** [startMs, endMs] spanning all keyframes, events and round bounds. */
export function replayBounds(replay: Replay): { startMs: number; endMs: number } {
  let lo = Infinity, hi = -Infinity;
  for (const tr of replay.tracks) {
    for (const k of tr.keyframes) { if (k.tMs < lo) lo = k.tMs; if (k.tMs > hi) hi = k.tMs; }
  }
  for (const e of replay.events) { if (e.tMs < lo) lo = e.tMs; if (e.tMs > hi) hi = e.tMs; }
  for (const rd of replay.rounds) {
    if (rd.startMs < lo) lo = rd.startMs;
    const end = rd.endMs ?? rd.startMs;
    if (end > hi) hi = end;
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
  return { startMs: lo, endMs: hi };
}

// binary search: index of the last keyframe with tMs <= t (−1 if none)
function floorIndex(keyframes: readonly TrackKeyframe[], t: number): number {
  let lo = 0, hi = keyframes.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].tMs <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function trackStateAt(track: PlayerTrack, tMs: number): PlayerSnapshot | null {
  const kf = track.keyframes;
  if (kf.length === 0) return null;
  const i = floorIndex(kf, tMs);
  // before first keyframe
  if (i < 0) {
    const f = kf[0];
    return { playerId: track.playerId, pos: f.pos, facingDeg: f.facingDeg, state: f.state ?? 'unknown', extrapolated: true };
  }
  // at/after last keyframe
  if (i >= kf.length - 1) {
    const f = kf[kf.length - 1];
    return { playerId: track.playerId, pos: f.pos, facingDeg: f.facingDeg, state: f.state ?? 'unknown', extrapolated: tMs > f.tMs };
  }
  const a = kf[i], b = kf[i + 1];
  const span = b.tMs - a.tMs;
  const u = span > 0 ? (tMs - a.tMs) / span : 0;
  const pos = lerpVec3(a.pos, b.pos, u);
  const facingDeg = a.facingDeg == null || b.facingDeg == null
    ? (a.facingDeg ?? b.facingDeg)
    : lerpAngleDeg(a.facingDeg, b.facingDeg, u);
  const state: PlayerState = a.state ?? 'unknown'; // step: hold the earlier keyframe's state
  return { playerId: track.playerId, pos, facingDeg, state, extrapolated: false };
}

/** Full snapshot of every player at tMs, plus the active round number. */
export function stateAt(replay: Replay, tMs: number): ReplaySnapshot {
  const players: PlayerSnapshot[] = [];
  for (const tr of replay.tracks) {
    const s = trackStateAt(tr, tMs);
    if (s) players.push(s);
  }
  return { tMs, roundNum: roundAt(replay, tMs), players };
}

export function roundAt(replay: Replay, tMs: number): number | null {
  let cur: number | null = null;
  for (const rd of replay.rounds) {
    if (tMs >= rd.startMs && (rd.endMs == null || tMs <= rd.endMs)) cur = rd.roundNum;
  }
  if (cur != null) return cur;
  // fall back to the latest round that has started
  let last: number | null = null;
  for (const rd of replay.rounds) if (tMs >= rd.startMs) last = rd.roundNum;
  return last;
}

/** Events with tMs in [t0, t1]. */
export function eventsInRange(replay: Replay, t0: number, t1: number): ReplayEvent[] {
  return replay.events.filter((e) => e.tMs >= t0 && e.tMs <= t1);
}
