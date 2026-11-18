import type { RoundResult, TrackFrame } from "./types.js";

/**
 * Neutral replay export (PV-6 adapter seam).
 *
 * PV-6's `packages/replay-engine` is not published yet (claude/pv-replay has only a
 * kinematics schema). This produces a stable, documented intermediate the PV-6 format can
 * map from, and `toPv6ReplayFormat` is a labelled stub to fill once that package lands.
 *
 * Format (ROUND_REPLAY_V0):
 *   { version, mapId, winner, reason, tickMs, frames: TrackFrame[], events: SimEvent[] }
 * Positions are VALORANT world units; convert to minimap with spatial-engine's transform.
 */
export const ROUND_REPLAY_VERSION = "ROUND_REPLAY_V0";

export interface RoundReplay {
  readonly version: string;
  readonly mapId: string;
  readonly winner: string;
  readonly reason: string;
  readonly tickMs: number;
  readonly frames: readonly TrackFrame[];
  readonly events: RoundResult["events"];
}

export function toRoundReplay(result: RoundResult, mapId: string, tickMs: number): RoundReplay {
  if (!result.tracks) {
    throw new Error("toRoundReplay requires config.recordTracks = true");
  }
  return {
    version: ROUND_REPLAY_VERSION,
    mapId,
    winner: result.winner,
    reason: result.reason,
    tickMs,
    frames: result.tracks,
    events: result.events,
  };
}

/** Placeholder for the PV-6 replay-engine format — not yet published. */
export function toPv6ReplayFormat(_result: RoundResult): never {
  throw new Error(
    "PV-6 replay-engine format not available yet (claude/pv-replay has no replay-engine package). Use toRoundReplay() and map it once PV-6 publishes its schema.",
  );
}
