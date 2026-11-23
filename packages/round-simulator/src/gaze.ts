// PROJECT V — gaze: where a player looks, and how fast it can look somewhere else.
//
// Facing (SimPlayer.facing) is the player's gaze: perception's field of view and the crosshair the
// combat model measures its aim offset from (combat-engine `aimOffsetDeg`, Fitts aim time). It is
// state, not a per-tick label:
//  - what to look at is decided each tick (simulator `chooseGaze`): an enemy it sees; else the most
//    threatening point of its team's BELIEF it has a line to and no teammate is already watching;
//    else the plan's angle (a holder) or the way ahead (a mover);
//  - it turns toward that at a bounded angular speed from its aim and reaction (turnRateRadPerMs),
//    so it cannot watch two edges at once.
// Report-only: the gaze source is recorded per tick (TrackFrame.players[].gaze).

import type { CombatSkills } from "@pv/combat-engine";

/** Turn rate (deg/s) of the crosshair at mean(aim, reaction) = 0 and = 1. manual-approx: a mouse sweep of a
 *  trained player covers a quarter turn in ~0.1–0.3 s. */
export const TURN_RATE_DEG_PER_S = { slow: 300, fast: 900 } as const;

/** What a player is looking at (recorded in tracks for the desktop). */
export type GazeSource = "enemy" | "threat" | "hold" | "route";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function turnRateRadPerMs(skills: Pick<CombatSkills, "aim" | "reaction">): number {
  const k = clamp01((skills.aim + skills.reaction) / 2);
  const degPerS = TURN_RATE_DEG_PER_S.slow + (TURN_RATE_DEG_PER_S.fast - TURN_RATE_DEG_PER_S.slow) * k;
  return (degPerS * Math.PI) / 180 / 1000;
}

/** Signed smallest angle (rad) from a to b. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Turn a facing toward a desired one by at most `maxRad`. Returns a unit vector. A zero desired
 * direction keeps the current facing.
 */
export function rotateToward(cur: { x: number; y: number }, desired: { x: number; y: number }, maxRad: number): { x: number; y: number } {
  const cm = Math.hypot(cur.x, cur.y), dm = Math.hypot(desired.x, desired.y);
  if (dm === 0) return cm === 0 ? { x: 1, y: 0 } : { x: cur.x / cm, y: cur.y / cm };
  if (cm === 0) return { x: desired.x / dm, y: desired.y / dm };
  const a = Math.atan2(cur.y, cur.x), b = Math.atan2(desired.y, desired.x);
  const d = angleDiff(a, b);
  const t = Math.abs(d) <= maxRad ? b : a + Math.sign(d) * maxRad;
  return { x: Math.cos(t), y: Math.sin(t) };
}

/** Angle (deg) between a facing and the direction from `from` to `to` (horizontal). */
export function offsetDeg(facing: { x: number; y: number }, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return 0;
  const fm = Math.hypot(facing.x, facing.y);
  if (fm === 0) return 180;
  const cos = (facing.x * dx + facing.y * dy) / (fm * Math.hypot(dx, dy));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}
