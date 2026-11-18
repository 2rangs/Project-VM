import type { RoundResult, TrackFrame } from "./types.js";
import { toSimGameEvents, type SimGameEvent } from "./export.js";

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

/** Metadata for PV-6's fromSimEventLog (mirror of replay-engine ConvertSimMeta). */
export interface Pv6SimMeta {
  readonly mapId: string;
  readonly mapDisplayName?: string | null;
  readonly patch?: string | null;
  readonly seed?: number | null;
  readonly matchId?: string | null;
  readonly coordinateTransform?: unknown;
}

export interface Pv6SimEventLog {
  readonly events: readonly SimGameEvent[];
  readonly meta: Pv6SimMeta;
}

/**
 * Bridge to PV-6's replay-engine (claude/pv-replay `packages/replay-engine`). PV-6's
 * `fromSimEventLog(events, meta)` ingests pv-core GameEvent[]; this produces exactly that
 * (including move events from the per-tick tracks), so integration is:
 *
 *   import { fromSimEventLog } from "@pv/replay-engine";
 *   const log = toPv6ReplayFormat(result, { mapId, seed, coordinateTransform });
 *   const replay = fromSimEventLog(log.events, log.meta);
 *
 * We return the bridge input rather than the Replay object to avoid a cross-branch build
 * dependency on PV-6's package (verified against PV-6's converter in test/replay.test.ts).
 */
export function toPv6ReplayFormat(result: RoundResult, meta: Pv6SimMeta): Pv6SimEventLog {
  return { events: toSimGameEvents(result, { includeMoves: true }), meta };
}
