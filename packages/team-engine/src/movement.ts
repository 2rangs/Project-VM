/**
 * Walk or run — a decision, not a fixed rule.
 *
 * Running is fast and loud: every enemy within the footstep radius hears it (perception-engine,
 * the spike's blast radius). Walking and standing are silent, and walking takes about twice as
 * long. So how a player moves is chosen from three things the player actually knows:
 *
 *   intent   — what the move is for in the team's plan
 *                "loud"  : be heard on purpose (a fake's show)            → run
 *                "fast"  : time decides the fight (the go call, a retake, → run
 *                          a chase, a save, an urgent rotation)
 *                "quiet" : arrive unannounced (staging, a lurk, slow play, a cautious rotation)
 *   audible  — is anyone in a position to hear? Outside the radius of every place an enemy is
 *              believed to be, noise costs nothing                        → run
 *   slack    — time the plan can still spend: clock − (what is left to do at the quiet pace).
 *              When walking would not make it, the clock outranks the noise → run
 *
 * otherwise walk. No randomness: the same situation gives the same choice.
 */
import type { MoveMode, Vector3 } from "@pv/shared-types";

export type MoveIntent = "quiet" | "fast" | "loud";

export interface MoveModeInput {
  readonly intent: MoveIntent;
  /** Whether a run here would be heard by an enemy the team believes to be in range. */
  readonly audible: boolean;
  /** Clock left after doing the rest of the plan at walking pace (ms); negative = walking is too slow. */
  readonly slackMs: number;
}

export function chooseMoveMode(input: MoveModeInput): MoveMode {
  if (input.intent !== "quiet") return "run";
  if (!input.audible) return "run";
  return input.slackMs >= 0 ? "walk" : "run";
}

/** Whether `position` is within `radiusUnits` (3D) of any of the `listeners`. */
export function withinEarshot(position: Vector3, listeners: readonly Vector3[], radiusUnits: number): boolean {
  const r2 = radiusUnits * radiusUnits;
  for (const l of listeners) {
    const dx = l.x - position.x, dy = l.y - position.y, dz = l.z - position.z;
    if (dx * dx + dy * dy + dz * dz <= r2) return true;
  }
  return false;
}
