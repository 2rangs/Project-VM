/**
 * Convert PV-6 replay-parser output (tools/replay-parser normalize.mjs) into a
 * Replay. The normalized bundle has game-world positions by actorGuid, rounds
 * with ms bounds, and provenance — exactly what the Replay format needs.
 *
 * ANONYMITY: tracks are keyed by actorGuid; we mint player_N ids in first-seen
 * order and NEVER copy ProfileName into the Replay.
 */
import type {
  CoordinateTransform, PlayerTrack, Replay, ReplayEvent, ReplayPlayer,
  ReplayRound, TrackKeyframe,
} from './types.ts';

/** Minimal shape of normalize.mjs output we rely on (structurally typed). */
export interface NormalizedParserOutput {
  meta: {
    matchId?: string | null;
    mapName?: string | null;
    mapUrl?: string | null;
    gamePatch?: string | null;
    sourceVrf?: string | null;
    provenance?: Record<string, unknown> & { synthetic?: boolean } | null;
  };
  rounds: Array<{ roundNum: number; startTimeMs: number; endTimeMs: number | null }>;
  positions: Array<{
    roundNum: number;
    actorGuid: number | string;
    matchTimeMs: number | null;
    worldPos: { x: number; y: number; z: number };
    facingDeg: number | null;
    alive: boolean | null;
  }>;
}

export interface ConvertParserOptions {
  coordinateTransform?: CoordinateTransform | null;
  tickRateHz?: number | null;
  /** Override source; defaults to provenance.synthetic ? 'synthetic' : 'real'. */
  source?: 'real' | 'synthetic';
}

export function fromReplayParser(input: NormalizedParserOutput, opts: ConvertParserOptions = {}): Replay {
  const synthetic = !!input.meta.provenance?.synthetic;
  const source = opts.source ?? (synthetic ? 'synthetic' : 'real');

  // actorGuid -> player_N (first-seen order)
  const guidToPlayer = new Map<string, string>();
  const trackMap = new Map<string, TrackKeyframe[]>();
  for (const p of input.positions) {
    if (p.matchTimeMs == null) continue;
    const g = String(p.actorGuid);
    if (!guidToPlayer.has(g)) {
      guidToPlayer.set(g, `player_${guidToPlayer.size + 1}`);
      trackMap.set(g, []);
    }
    const state = p.alive == null ? 'unknown' : (p.alive ? 'alive' : 'dead');
    trackMap.get(g)!.push({ tMs: p.matchTimeMs, pos: p.worldPos, facingDeg: p.facingDeg, state });
  }

  const players: ReplayPlayer[] = [...guidToPlayer.values()].map((id) => ({
    id, teamIdx: null, agentId: null, displayName: null, // teamIdx not linkable per-guid in parser output
  }));
  const tracks: PlayerTrack[] = [...guidToPlayer.entries()].map(([g, id]) => ({
    playerId: id,
    keyframes: (trackMap.get(g) ?? []).sort((a, b) => a.tMs - b.tMs),
  }));

  const rounds: ReplayRound[] = input.rounds.map((r) => ({
    roundNum: r.roundNum, startMs: r.startTimeMs, endMs: r.endTimeMs,
  }));
  const events: ReplayEvent[] = rounds.map((r) => ({ tMs: r.startMs, roundNum: r.roundNum, kind: 'roundStart' as const }));

  return {
    schemaVersion: '1',
    meta: {
      mapId: (input.meta.mapName ?? 'unknown').toLowerCase(),
      mapDisplayName: input.meta.mapName ?? null,
      patch: input.meta.gamePatch ?? null,
      source,
      seed: null,
      matchId: input.meta.matchId ?? null,
      generatedAt: new Date().toISOString(),
      tickRateHz: opts.tickRateHz ?? 128,
      coordinateTransform: opts.coordinateTransform ?? null,
      provenance: input.meta.provenance ?? null,
    },
    players,
    rounds,
    tracks,
    events,
  };
}
