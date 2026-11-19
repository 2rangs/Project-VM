// Position tracks for the live match screen (app-side bridge, no engine edits).
//
// WHY: @pv/match-runner calls runMatchRound with `{ recordPerception, ...tuning }` and never
// forwards `recordTracks`, so RoundResult.tracks is undefined, toPv6ReplayFormat emits no `move`
// events and the desktop Replay has EMPTY player tracks (the map could only draw observed-enemy
// markers). The round simulator already knows how to record tracks — the flag is just not
// reachable through MatchConfig.
//
// WHAT: installTrackRecording() wraps RoundSimulator.prototype.runRound so every round runs with
// `recordTracks: true`, and remembers the first recorded frame (every player's spawn position).
// Recording is passive: sim events, perception and outcomes are identical with and without it.
// withSpawnMoves() then prepends one zero-length `move` per player at t=0 so a player who never
// leaves their spawn zone still has a position in the replay.
//
// REMOVE WHEN: MatchConfig gains `recordTracks` (forwarded to runMatchRound's config). The shim
// reads a private field (`cfg`); if the engine renames it the wrap becomes a no-op, the replay
// has no tracks again and the UI says so instead of drawing players.
import { RoundSimulator } from '../../../packages/round-simulator/src/index.ts';

interface Frame { players: ReadonlyArray<{ id: string; x: number; y: number; z: number }> }
interface RoundResultLike { tracks?: readonly Frame[] }
type ReplayEvent = Record<string, unknown>;

let lastFirstFrame: Frame | null = null;
let installed = false;

export function installTrackRecording(): void {
  if (installed) return;
  installed = true;
  const proto = RoundSimulator.prototype as unknown as { runRound: (...args: unknown[]) => RoundResultLike };
  const original = proto.runRound;
  proto.runRound = function patchedRunRound(this: { cfg?: Record<string, unknown> }, ...args: unknown[]) {
    if (this.cfg && typeof this.cfg === 'object') this.cfg = { ...this.cfg, recordTracks: true };
    const result = original.apply(this, args);
    lastFirstFrame = result.tracks?.[0] ?? null;
    return result;
  };
}

/** True when the round's replay events carry positions (i.e. the shim or the engine recorded tracks). */
export function hasTracks(events: readonly ReplayEvent[]): boolean {
  return events.some((e) => e.kind === 'move');
}

/**
 * Prepend a zero-length `move` at t=0 for every player in the round just played (from the first
 * recorded frame). Must be called right after the round is played. No-op without tracks.
 */
export function withSpawnMoves(events: readonly ReplayEvent[]): ReplayEvent[] {
  const frame = lastFirstFrame;
  if (!frame) return [...events];
  const spawns: ReplayEvent[] = frame.players.map((p, i) => {
    const at = { x: p.x, y: p.y, z: p.z };
    return { id: `spawn${i}`, seq: -1, tick: 0, timeMs: 0, kind: 'move', playerId: p.id, from: at, to: at };
  });
  return [...spawns, ...events];
}
