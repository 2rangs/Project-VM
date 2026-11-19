// Round-by-round timeline for the live match screen, built from what the app receives:
// the merged Replay (position tracks + kill/plant/defuse/round events) and the MatchSummary
// (attacker, buys, economy, score per round).
//
// The engine moves players by ZONE HOPS: a player stands on a zone centre and, once the edge's
// travel time has elapsed, appears on the next centre. The replay therefore only has one
// keyframe per arrival. This module turns arrivals back into travel segments (depart → arrive)
// so the map can draw continuous movement, and keeps the engine's "logical" zone separately so
// vision/hearing are still evaluated on the positions the engine actually used.
//
// Pure module: type-only imports, so it runs under `node --test`.
import type { Replay, ReplayEvent } from '@pv/replay-engine';
import type { MatchRoundSummary, MatchSummary } from '../../shared/ipc.ts';
import type { NavModel, Vec2, Vec3 } from './nav.ts';

export type TeamSlot = 'A' | 'B';
export type Side = 'attack' | 'defense';

/** Engine constants mirrored from @pv/round-simulator DEFAULT_CONFIG (not exported to the app). */
export const ENGINE = {
  roundTimeMs: 100000,
  plantDurationMs: 4000,
  defuseDurationMs: 7000,
  spikeTimerMs: 45000,
} as const;

/** How long before the (instant) engine duel the two players are shown squaring up. Presentation only. */
export const CONTACT_LEAD_MS = 1200;
/** How long after winning a duel the winner still counts as "fighting". Presentation only. */
export const CONTACT_TAIL_MS = 500;

export interface Hop {
  readonly departMs: number;
  readonly arriveMs: number;
  readonly fromZone: string;
  readonly toZone: string;
  readonly from: Vec3;
  readonly to: Vec3;
  /** 'walk' when the gap between arrivals matches the edge's walk time, else 'run'. */
  readonly mode: 'run' | 'walk';
}

export interface PlayerRound {
  /** Engine id for this round (atk1..5 / def1..5). Ids are reused by the other team after a side swap. */
  readonly id: string;
  readonly team: TeamSlot;
  readonly side: Side;
  /** 1-based roster slot; stable for a real player across side swaps. */
  readonly slot: number;
  readonly spawn: Vec3;
  readonly spawnZone: string;
  readonly hops: readonly Hop[];
  readonly deathMs: number | null;
  readonly killerId: string | null;
}

export interface KillEvent {
  readonly tMs: number;
  readonly killerId: string | null;
  readonly victimId: string;
  readonly killerTeam: TeamSlot | null;
  readonly victimTeam: TeamSlot;
  /** Where the victim stood (engine position), if tracks are available. */
  readonly pos: Vec3 | null;
  readonly zone: string | null;
}

export interface SpikeAction {
  /** When the action completed (spike planted / defused). */
  readonly tMs: number;
  /** When it began: derived as tMs − engine duration, never before the player reached the zone. */
  readonly startMs: number;
  readonly playerId: string | null;
  readonly pos: Vec3 | null;
  readonly zone: string | null;
  readonly site: 'A' | 'B' | null;
}

export interface RoundTimeline {
  readonly roundNum: number;
  readonly startMs: number;
  /** Time of the roundEnd event (or the last event when the round has none yet). */
  readonly endMs: number;
  readonly attacker: TeamSlot;
  readonly players: readonly PlayerRound[];
  readonly kills: readonly KillEvent[];
  readonly plant: SpikeAction | null;
  readonly defuse: SpikeAction | null;
  readonly endReason: string | null;
  readonly summary: MatchRoundSummary | null;
  /** False when the replay carries no positions for this round (engine did not record tracks). */
  readonly hasTracks: boolean;
}

export interface MatchTimeline {
  readonly rounds: readonly RoundTimeline[];
  readonly startMs: number;
  readonly endMs: number;
  readonly hasTracks: boolean;
}

export function sideOfId(id: string): Side { return id.startsWith('def') ? 'defense' : 'attack'; }
export function slotOfId(id: string): number { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : 1; }
export function teamOfId(id: string, attacker: TeamSlot): TeamSlot {
  const defender: TeamSlot = attacker === 'A' ? 'B' : 'A';
  return sideOfId(id) === 'attack' ? attacker : defender;
}
export function playerIdFor(team: TeamSlot, slot: number, attacker: TeamSlot): string {
  return `${team === attacker ? 'atk' : 'def'}${slot}`;
}

/** VCT side order when the summary is missing: A attacks the first half, B the second, OT alternates. */
function defaultAttacker(roundNum: number): TeamSlot {
  if (roundNum <= 12) return 'A';
  if (roundNum <= 24) return 'B';
  return (roundNum - 25) % 2 === 0 ? 'A' : 'B';
}

const sameSpot = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;

/** Turn a player's arrival keyframes inside one round into travel segments. */
export function buildHops(
  arrivals: ReadonlyArray<{ tMs: number; pos: Vec3 }>, spawn: Vec3, roundStartMs: number, nav: NavModel,
): Hop[] {
  const hops: Hop[] = [];
  let prevPos = spawn; let prevArrive = roundStartMs;
  for (const a of arrivals) {
    if (sameSpot(a.pos, prevPos)) continue;
    const fromZone = nav.nearestZone(prevPos).id;
    const toZone = nav.nearestZone(a.pos).id;
    const edge = nav.edge(fromZone, toZone);
    const gap = a.tMs - prevArrive;
    let departMs = prevArrive; let mode: Hop['mode'] = 'run';
    if (edge) {
      if (Math.abs(gap - edge.walkTimeMs) <= 200) { mode = 'walk'; departMs = prevArrive; }
      else if (gap >= edge.runTimeMs) departMs = a.tMs - edge.runTimeMs;
    } else {
      departMs = Math.max(prevArrive, a.tMs - 1500); // not adjacent in the graph: short slide
    }
    hops.push({ departMs, arriveMs: a.tMs, fromZone, toZone, from: prevPos, to: a.pos, mode });
    prevPos = a.pos; prevArrive = a.tMs;
  }
  return hops;
}

export function buildTimeline(replay: Replay, match: MatchSummary | null, nav: NavModel): MatchTimeline {
  const rounds: RoundTimeline[] = [];
  const sortedRounds = [...replay.rounds].sort((a, b) => a.startMs - b.startMs);
  const events = [...replay.events].sort((a, b) => a.tMs - b.tMs);

  for (let i = 0; i < sortedRounds.length; i++) {
    const rd = sortedRounds[i];
    const nextStart = sortedRounds[i + 1]?.startMs ?? Infinity;
    const inRound = (t: number) => t >= rd.startMs && t < nextStart;
    const evs = events.filter((e) => inRound(e.tMs));
    const endEv = evs.find((e) => e.kind === 'roundEnd');
    const lastEvMs = evs.length > 0 ? evs[evs.length - 1].tMs : rd.startMs;
    const summary = match?.rounds.find((r) => r.roundNumber === rd.roundNum) ?? null;
    const attacker = summary?.attacker ?? defaultAttacker(rd.roundNum);

    // --- players: slice each engine id's keyframes to this round ---
    const players: PlayerRound[] = [];
    let hasTracks = false;
    const deaths = new Map<string, { tMs: number; killerId: string | null }>();
    for (const e of evs) if (e.kind === 'kill' && e.victimId && !deaths.has(e.victimId)) deaths.set(e.victimId, { tMs: e.tMs, killerId: e.actorId ?? null });

    const ids = new Set<string>();
    for (const tr of replay.tracks) ids.add(tr.playerId);
    for (const e of evs) { if (e.actorId) ids.add(e.actorId); if (e.victimId) ids.add(e.victimId); }

    for (const id of [...ids].sort()) {
      const track = replay.tracks.find((tr) => tr.playerId === id);
      // convert-sim seeds the first keyframe 1 ms before the first move, so allow that slack.
      const kfs = (track?.keyframes ?? []).filter((k) => k.tMs >= rd.startMs - 1 && k.tMs < nextStart);
      const death = deaths.get(id) ?? null;
      if (kfs.length === 0 && !evs.some((e) => e.actorId === id || e.victimId === id)) continue;
      if (kfs.length > 0) hasTracks = true;
      const spawn = kfs[0]?.pos ?? { x: 0, y: 0, z: 0 };
      const hops = kfs.length > 0
        ? buildHops(kfs.slice(1).map((k) => ({ tMs: k.tMs, pos: k.pos })), spawn, rd.startMs, nav)
        : [];
      players.push({
        id, team: teamOfId(id, attacker), side: sideOfId(id), slot: slotOfId(id),
        spawn, spawnZone: kfs.length > 0 ? nav.nearestZone(spawn).id : '',
        hops, deathMs: death?.tMs ?? null, killerId: death?.killerId ?? null,
      });
    }

    const partial: RoundTimeline = {
      roundNum: rd.roundNum, startMs: rd.startMs, endMs: endEv?.tMs ?? lastEvMs, attacker, players,
      kills: [], plant: null, defuse: null,
      endReason: ((endEv?.data as { reason?: string } | undefined)?.reason) ?? summary?.reason ?? null,
      summary, hasTracks,
    };

    const kills: KillEvent[] = evs.filter((e) => e.kind === 'kill' && e.victimId).map((e) => {
      const victim = players.find((p) => p.id === e.victimId);
      const pos = victim && hasTracks ? logicalAt(victim, e.tMs).pos : null;
      return {
        tMs: e.tMs, killerId: e.actorId ?? null, victimId: e.victimId!,
        killerTeam: e.actorId ? teamOfId(e.actorId, attacker) : null,
        victimTeam: teamOfId(e.victimId!, attacker),
        pos, zone: pos ? nav.nearestZone(pos).id : null,
      };
    });

    const spikeAction = (e: ReplayEvent | undefined, durationMs: number): SpikeAction | null => {
      if (!e) return null;
      const actor = players.find((p) => p.id === e.actorId);
      const pos = e.pos ?? (actor && hasTracks ? logicalAt(actor, e.tMs).pos : null);
      const zone = pos ? nav.nearestZone(pos).id : null;
      const arrived = actor ? lastArrivalBefore(actor, e.tMs, rd.startMs) : rd.startMs;
      return {
        tMs: e.tMs, startMs: Math.max(arrived, e.tMs - durationMs), playerId: e.actorId ?? null, pos, zone,
        site: zone?.startsWith('a-') ? 'A' : zone?.startsWith('b-') ? 'B' : null,
      };
    };
    const plant = spikeAction(evs.find((e) => e.kind === 'plant'), ENGINE.plantDurationMs);
    const defuse = spikeAction(evs.find((e) => e.kind === 'defuse'), ENGINE.defuseDurationMs);
    // A defuse happens on the planted spike.
    const defuseOnSpike = defuse && plant ? { ...defuse, pos: plant.pos, zone: plant.zone, site: plant.site } : defuse;

    rounds.push({ ...partial, kills, plant, defuse: defuseOnSpike });
  }

  return {
    rounds,
    startMs: rounds[0]?.startMs ?? 0,
    endMs: rounds.length > 0 ? rounds[rounds.length - 1].endMs : 0,
    hasTracks: rounds.some((r) => r.hasTracks),
  };
}

function lastArrivalBefore(p: PlayerRound, tMs: number, roundStartMs: number): number {
  let t = roundStartMs;
  for (const h of p.hops) if (h.arriveMs <= tMs) t = h.arriveMs;
  return t;
}

/** Where the ENGINE has the player at tMs: the zone centre it occupies (hops are instantaneous). */
export function logicalAt(p: PlayerRound, tMs: number): { pos: Vec3; zone: string } {
  const t = p.deathMs != null ? Math.min(tMs, p.deathMs) : tMs;
  let pos = p.spawn; let zone = p.spawnZone;
  for (const h of p.hops) { if (h.arriveMs <= t) { pos = h.to; zone = h.toZone; } else break; }
  return { pos, zone };
}

/** The hop in progress at tMs (departed, not yet arrived), or null when standing. */
export function activeHop(p: PlayerRound, tMs: number): Hop | null {
  const t = p.deathMs != null ? Math.min(tMs, p.deathMs) : tMs;
  for (const h of p.hops) if (t >= h.departMs && t < h.arriveMs) return h;
  return null;
}

export function isAlive(p: PlayerRound, tMs: number): boolean { return p.deathMs == null || tMs < p.deathMs; }

export function roundIndexAt(tl: MatchTimeline, tMs: number): number {
  let idx = 0;
  for (let i = 0; i < tl.rounds.length; i++) if (tMs >= tl.rounds[i].startMs) idx = i;
  return idx;
}

export function findPlayer(round: RoundTimeline, id: string | null | undefined): PlayerRound | undefined {
  return id ? round.players.find((p) => p.id === id) : undefined;
}
export function teamPlayers(round: RoundTimeline, team: TeamSlot): PlayerRound[] {
  return round.players.filter((p) => p.team === team).sort((a, b) => a.slot - b.slot);
}

/** Small constant per-player offset (world units) so players sharing a zone centre do not overlap. */
export function formationOffset(p: Pick<PlayerRound, 'slot' | 'side'>, radius = 150): Vec2 {
  const a = ((p.slot - 1) / 5) * Math.PI * 2 + (p.side === 'attack' ? 0 : Math.PI / 5);
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

const ease = (u: number) => u * u * (3 - 2 * u);

export interface Pose {
  /** Display position: interpolated along the edge while travelling (+ formation offset). */
  readonly pos: Vec3;
  /** Engine position and zone (what vision/hearing/combat used). */
  readonly logicalPos: Vec3;
  readonly zone: string;
  readonly alive: boolean;
  readonly moving: boolean;
  readonly moveMode: 'run' | 'walk' | null;
  /** Zone being travelled to, when moving. */
  readonly toZone: string | null;
  /** Facing as a world-space direction (not normalised); see facingAt for the rules. */
  readonly facing: Vec2;
}

/**
 * Engine-rule facing (no duel override): while travelling, toward the next zone; standing, toward
 * the choke an enemy would enter from — the predecessor of this zone on the enemy spawn → here
 * path (round-simulator `faceStationary` default). The engine can override a holder's aim with a
 * policy `aimZone`/hold target, which is not exported: that is the approximation here.
 */
export function engineFacing(round: RoundTimeline, p: PlayerRound, tMs: number, nav: NavModel): Vec2 {
  const hop = activeHop(p, tMs);
  if (hop) return { x: hop.to.x - hop.from.x, y: hop.to.y - hop.from.y };
  const { pos, zone } = logicalAt(p, tMs);
  const enemySpawn = round.players.find((q) => q.team !== p.team)?.spawnZone;
  const enemyOrigin = p.side === 'attack' ? 'defender-spawn' : 'attacker-spawn';
  const origin = nav.zone(enemyOrigin) ? enemyOrigin : enemySpawn;
  if (origin && origin !== zone) {
    const path = nav.path(origin, zone);
    const choke = path && path.length >= 2 ? nav.zone(path[path.length - 2]) : undefined;
    if (choke) return { x: choke.position.x - pos.x, y: choke.position.y - pos.y };
  }
  // No approach to watch (standing in the enemy's origin): keep the last travel direction.
  let last: Hop | null = null;
  for (const h of p.hops) if (h.arriveMs <= tMs) last = h;
  if (last) return { x: last.to.x - last.from.x, y: last.to.y - last.from.y };
  const next = p.hops[0];
  return next ? { x: next.to.x - next.from.x, y: next.to.y - next.from.y } : { x: 0, y: -1 };
}

/** The duel this player is in at tMs (lead-in before the kill, short tail for the winner), if any. */
export function contactAt(round: RoundTimeline, playerId: string, tMs: number): { kill: KillEvent; opponentId: string; won: boolean } | null {
  for (const k of round.kills) {
    if (!k.killerId) continue;
    if (k.killerId === playerId && tMs >= k.tMs - CONTACT_LEAD_MS && tMs < k.tMs + CONTACT_TAIL_MS) return { kill: k, opponentId: k.victimId, won: true };
    if (k.victimId === playerId && tMs >= k.tMs - CONTACT_LEAD_MS && tMs < k.tMs) return { kill: k, opponentId: k.killerId, won: false };
  }
  return null;
}

/** Display position only (travel interpolation + formation offset). */
export function displayPos(p: PlayerRound, tMs: number): Vec3 {
  const t = p.deathMs != null ? Math.min(tMs, p.deathMs) : tMs;
  const off = formationOffset(p);
  const hop = activeHop(p, t);
  let base: Vec3;
  if (hop) {
    const span = hop.arriveMs - hop.departMs;
    const u = span > 0 ? ease(Math.min(1, Math.max(0, (t - hop.departMs) / span))) : 1;
    base = { x: hop.from.x + (hop.to.x - hop.from.x) * u, y: hop.from.y + (hop.to.y - hop.from.y) * u, z: hop.from.z + (hop.to.z - hop.from.z) * u };
  } else base = logicalAt(p, t).pos;
  return { x: base.x + off.x, y: base.y + off.y, z: base.z };
}

/** Facing for display: the engine rule, turned toward the opponent during a duel. */
export function facingAt(round: RoundTimeline, p: PlayerRound, tMs: number, nav: NavModel): Vec2 {
  const t = p.deathMs != null ? Math.min(tMs, p.deathMs - 1) : tMs;
  const contact = contactAt(round, p.id, t);
  if (contact) {
    const opp = findPlayer(round, contact.opponentId);
    if (opp) {
      const a = displayPos(p, t), b = displayPos(opp, Math.min(t, contact.kill.tMs));
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1) return { x: b.x - a.x, y: b.y - a.y };
    }
  }
  return engineFacing(round, p, t, nav);
}

export function poseAt(round: RoundTimeline, p: PlayerRound, tMs: number, nav: NavModel): Pose {
  const alive = isAlive(p, tMs);
  const t = alive ? tMs : p.deathMs!;
  const hop = alive ? activeHop(p, t) : null;
  const logical = logicalAt(p, t);
  return {
    pos: displayPos(p, t), logicalPos: logical.pos, zone: logical.zone, alive,
    moving: !!hop, moveMode: hop?.mode ?? null, toZone: hop?.toZone ?? null,
    facing: facingAt(round, p, t, nav),
  };
}

/** Heading in radians (atan2 in world x/y), averaged over a short window so turns ease instead of snapping. */
export function smoothFacingRad(round: RoundTimeline, p: PlayerRound, tMs: number, nav: NavModel, windowMs = 420, samples = 7): number {
  let sx = 0, sy = 0;
  for (let i = 0; i < samples; i++) {
    const f = facingAt(round, p, tMs - (windowMs * i) / (samples - 1), nav);
    const m = Math.hypot(f.x, f.y) || 1;
    sx += f.x / m; sy += f.y / m;
  }
  return Math.atan2(sy, sx);
}

/** Match score as the viewer should see it at tMs: the current round only counts once it has ended. */
export function scoreAt(tl: MatchTimeline, tMs: number): Record<TeamSlot, number> {
  const score = { A: 0, B: 0 };
  for (const r of tl.rounds) {
    if (!r.summary) continue;
    if (tMs >= r.endMs && r.endReason != null) { score.A = r.summary.score.A; score.B = r.summary.score.B; }
  }
  return score;
}

/** True once playback has reached the round's end event. */
export function roundOver(round: RoundTimeline, tMs: number): boolean {
  return round.endReason != null && tMs >= round.endMs;
}
