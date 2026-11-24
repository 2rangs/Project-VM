// PROJECT V — how a mover takes an angle it expects to be held (gaze model, SimConfig.gaze).
//
// A peek is not a bonus: each technique only changes inputs the duel already uses —
//  - the peeker's lateral speed across the holder's line (the holder's crosshair has to follow it:
//    combat-engine trackingOffsetDeg),
//  - the peeker's own crosshair offset (a slicer watches exactly the sliver it is opening),
//  - its pace (a walker stops sooner) and
//  - how long it stays exposed (a jiggle strafes out and back: combat-engine exposedUntilMs).
// Techniques:
//  - "walkIn" — it did not expect anyone: it is moving the way it was going, its crosshair where it was.
//  - "swing"  — it expects an enemy and knows where (a fresh call, or a jiggle/sighting just now):
//               a run-speed strafe across the angle with its crosshair on the known spot.
//  - "slice"  — it expects an enemy but does not know where, and clears at a walk: it opens the angle a
//               sliver at a time with its crosshair on the sliver, so it meets the holder on its crosshair.
//  - "jiggle" — it expects an enemy, does not know where, and has the time: strafe out to show itself
//               and see, and back. Long enough for a fast holder to shoot, short for a slow one.
//               What it buys is information: both sides now know the other's spot (re-peek).

import { BODY_HALF_WIDTH } from "./situational.js";

export type PeekKind = "walkIn" | "swing" | "slice" | "jiggle";

/**
 * Exposure of a jiggle: strafe out far enough to clear the body past the edge and see past it
 * (two body half-widths of travel), then back the same way, at strafe speed:
 *     t_exp = 2 · (2 · BODY_HALF_WIDTH) / v.
 * ≈ 207 ms at a rifle's run speed (675 uu/s) — inside a slow holder's reaction, outside a fast one's.
 */
export function jiggleExposureMs(strafeSpeedPerSec: number): number {
  return strafeSpeedPerSec > 0 ? ((2 * (2 * BODY_HALF_WIDTH)) / strafeSpeedPerSec) * 1000 : 0;
}

/**
 * Speed across the line from `observer` to `mover` (uu/s), from the mover's displacement over the
 * last `dtMs`: |v × û| with û the unit vector observer → mover. A walk straight at the holder is 0.
 */
export function lateralSpeed(prev: { x: number; y: number }, now: { x: number; y: number }, observer: { x: number; y: number }, dtMs: number): number {
  if (dtMs <= 0) return 0;
  const vx = (now.x - prev.x) / (dtMs / 1000), vy = (now.y - prev.y) / (dtMs / 1000);
  const ux = now.x - observer.x, uy = now.y - observer.y;
  const um = Math.hypot(ux, uy);
  if (um === 0) return 0;
  return Math.abs(vx * uy - vy * ux) / um;
}

/** Hysteresis for "it was checking that spot": the gaze point is within this angle of the enemy. */
export const CHECKED_SPOT_DEG = 15;

export interface PeekContext {
  /** It knew where the enemy was (a fresh call / sighting, info weight ≥ ½). */
  readonly knows: boolean;
  /** It expected someone there: its gaze was on a believed threat within CHECKED_SPOT_DEG of the enemy. */
  readonly expected: boolean;
  /** It is clearing at a walk (the team's chosen pace). */
  readonly walking: boolean;
  /** Round time left (ms) beyond what its plan needs, the slack a jiggle and re-peek spend. */
  readonly slackMs: number;
  /** Time the jiggle and its re-peek cost (exposure + re-acquire). */
  readonly jiggleCostMs: number;
  /** gameSense ∈ [0,1]: how often it takes the information before committing. */
  readonly gameSense: number;
  /** A uniform draw in [0,1) (seeded per contact). */
  readonly u: number;
}

/**
 * The technique, decided from what the peeker knows (no omniscience: its own belief and gaze):
 *  - knows → swing (pre-aimed);
 *  - expected but unknown → jiggle with probability gameSense when the clock has the slack, else
 *    slice when walking, else swing on the believed spot;
 *  - not expected → walkIn.
 */
export function choosePeek(c: PeekContext): PeekKind {
  if (c.knows) return "swing";
  if (!c.expected) return "walkIn";
  if (c.slackMs >= c.jiggleCostMs && c.u < c.gameSense) return "jiggle";
  return c.walking ? "slice" : "swing";
}
