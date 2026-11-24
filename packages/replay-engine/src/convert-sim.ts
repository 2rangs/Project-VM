/**
 * Convert a simulation-engine event log (PV-core @pv/shared-types GameEvent[])
 * into a Replay, so the SAME viewer plays decoded and simulated rounds
 * (Handoff §24.5: UI reads the replay, never the engine internals).
 *
 * We type the sim events structurally (a loose SimEvent union mirroring
 * packages/shared-types/src/events.ts on origin/claude/pv-core) so this package
 * stays standalone — no cross-branch build dependency. Combat/perception
 * sub-events (shot/hit) are not yet defined on pv-spatial; the mapping leaves
 * hooks (abilityUse→abilitySpawn, damage carried in data) and is forward-safe.
 */
import type {
  PlayerTrack, Replay, ReplayEvent, ReplayPlayer, TrackKeyframe, Vec3, PerceptionTrack,
} from './types.ts';

export interface SimEventBase { seq: number; tick: number; timeMs: number; kind: string }
export interface SimMoveEvent extends SimEventBase { kind: 'move'; playerId: string; from: Vec3; to: Vec3 }
export interface SimKillEvent extends SimEventBase { kind: 'kill'; victim: string; killer: string | null; cause?: string; weaponId?: string | null }
export interface SimAbilityEvent extends SimEventBase { kind: 'abilityUse'; playerId: string; abilityId: string; at: Vec3 | null }
export interface SimSpikeEvent extends SimEventBase { kind: string; playerId: string | null; at: Vec3 | null }
export interface SimRoundStart extends SimEventBase { kind: 'roundStart'; roundNumber: number }
export interface SimRoundEnd extends SimEventBase { kind: 'roundEnd'; winner?: string; reason?: string }
export type SimEvent = SimEventBase & Record<string, unknown>;

export interface ConvertSimMeta {
  mapId: string;
  mapDisplayName?: string | null;
  patch?: string | null;
  seed?: number | null;
  matchId?: string | null;
  coordinateTransform?: Replay['meta']['coordinateTransform'];
  players?: ReplayPlayer[]; // optional roster; else derived from events
  /** OPTIONAL per-team perception/belief time series (PV-4 recordPerception). */
  perception?: readonly PerceptionTrack[];
}

const SPIKE_KINDS: Record<string, 'plant' | 'defuse'> = {
  spikePlanted: 'plant',
  spikeDefused: 'defuse',
};

export function fromSimEventLog(events: readonly SimEvent[], meta: ConvertSimMeta): Replay {
  const trackMap = new Map<string, TrackKeyframe[]>();
  const seenPlayers = new Set<string>();
  // mutable builder (ReplayRound.endMs is readonly in the final shape)
  const rounds: Array<{ roundNum: number; startMs: number; endMs: number | null; buyStartMs?: number }> = [];
  // a buyPhaseStart seen before the next roundStart belongs to that round
  let pendingBuyStart: number | null = null;
  const outEvents: ReplayEvent[] = [];
  let curRound: number | null = null;

  const ensureTrack = (id: string) => {
    seenPlayers.add(id);
    if (!trackMap.has(id)) trackMap.set(id, []);
    return trackMap.get(id)!;
  };

  for (const e of events) {
    switch (e.kind) {
      case 'move': {
        const m = e as unknown as SimMoveEvent;
        const kf = ensureTrack(m.playerId);
        // seed with `from` the first time we see a player so a track has a start
        if (kf.length === 0) kf.push({ tMs: m.timeMs - 1, pos: m.from, facingDeg: null, state: 'alive' });
        kf.push({ tMs: m.timeMs, pos: m.to, facingDeg: null, state: 'alive' });
        break;
      }
      case 'roundStart': {
        const r = e as unknown as SimRoundStart;
        curRound = r.roundNumber;
        if (rounds.length) rounds[rounds.length - 1].endMs = e.timeMs;
        rounds.push({ roundNum: r.roundNumber, startMs: e.timeMs, endMs: null, ...(pendingBuyStart !== null ? { buyStartMs: pendingBuyStart } : {}) });
        pendingBuyStart = null;
        outEvents.push({ tMs: e.timeMs, roundNum: curRound, kind: 'roundStart' });
        break;
      }
      case 'buyPhaseStart': {
        pendingBuyStart = e.timeMs;
        break;
      }
      case 'roundEnd': {
        if (rounds.length) rounds[rounds.length - 1].endMs = e.timeMs;
        outEvents.push({ tMs: e.timeMs, roundNum: curRound, kind: 'roundEnd', data: { reason: (e as SimRoundEnd).reason } });
        break;
      }
      case 'kill': {
        const k = e as unknown as SimKillEvent;
        if (k.victim) seenPlayers.add(k.victim);
        if (k.killer) seenPlayers.add(k.killer);
        outEvents.push({
          tMs: e.timeMs, roundNum: curRound, kind: 'kill',
          actorId: k.killer, victimId: k.victim,
          data: { cause: k.cause, weaponId: k.weaponId ?? null },
        });
        break;
      }
      case 'abilityUse': {
        const a = e as unknown as SimAbilityEvent;
        if (a.playerId) seenPlayers.add(a.playerId);
        outEvents.push({ tMs: e.timeMs, roundNum: curRound, kind: 'abilitySpawn', actorId: a.playerId, pos: a.at, data: { abilityId: a.abilityId } });
        break;
      }
      default: {
        const mapped = SPIKE_KINDS[e.kind];
        if (mapped) {
          const s = e as unknown as SimSpikeEvent;
          if (s.playerId) seenPlayers.add(s.playerId);
          outEvents.push({ tMs: e.timeMs, roundNum: curRound, kind: mapped, actorId: s.playerId, pos: s.at });
        }
        // other kinds (damage, spikePickup, ...) are intentionally not rendered yet
        break;
      }
    }
  }

  const roster: ReplayPlayer[] = meta.players
    ?? [...seenPlayers].map((id) => ({ id, teamIdx: null, agentId: null, displayName: null }));
  const tracks: PlayerTrack[] = [...trackMap.entries()].map(([id, kf]) => ({
    playerId: id, keyframes: kf.sort((a, b) => a.tMs - b.tMs),
  }));

  return {
    schemaVersion: '1',
    meta: {
      mapId: meta.mapId,
      mapDisplayName: meta.mapDisplayName ?? null,
      patch: meta.patch ?? null,
      source: 'simulated',
      seed: meta.seed ?? null,
      matchId: meta.matchId ?? null,
      generatedAt: new Date().toISOString(),
      tickRateHz: null,
      coordinateTransform: meta.coordinateTransform ?? null,
      provenance: { sourceId: 'pv-simulation', evidenceType: 'simulated', synthetic: true },
    },
    players: roster,
    rounds,
    tracks,
    events: outEvents.sort((a, b) => a.tMs - b.tMs),
    perception: meta.perception,
  };
}
