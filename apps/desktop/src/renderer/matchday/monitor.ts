// What a player is doing right now (the monitor status line) and what the round situation is
// (alive counts, clutch, spike clock). Everything here is a function of (round, time) so the
// screen can be scrubbed freely.
//
// Pure module: runs under `node --test`.
import {
  ENGINE, activeHop, contactAt, findPlayer, isAlive, logicalAt, roundOver, teamPlayers,
  type PlayerRound, type RoundTimeline, type TeamSlot,
} from './timeline.ts';

export type MonitorState = 'dead' | 'fighting' | 'planting' | 'defusing' | 'moving' | 'holding';

export interface MonitorStatus {
  readonly state: MonitorState;
  /** Engine zone the player occupies (frozen at the place of death for 'dead'). */
  readonly zone: string;
  /** Destination zone while moving. */
  readonly toZone: string | null;
  /** Opponent while fighting; killer when dead. */
  readonly opponentId: string | null;
  /** 0..1 progress of a plant/defuse. */
  readonly progress: number | null;
  readonly moveMode: 'run' | 'walk' | null;
  /** How long ago the player died (dead only). */
  readonly deadForMs: number | null;
}

/**
 * State priority: dead › fighting › planting/defusing › moving › holding.
 * planting/defusing windows are derived as [done − engine duration, done) because the bridge
 * drops the engine's plantStart/defuseStart events.
 */
export function monitorStatusAt(round: RoundTimeline, playerId: string, tMs: number): MonitorStatus {
  const p = findPlayer(round, playerId);
  if (!p) return { state: 'holding', zone: '', toZone: null, opponentId: null, progress: null, moveMode: null, deadForMs: null };
  const { zone } = logicalAt(p, tMs);
  const base = { zone, toZone: null, opponentId: null, progress: null, moveMode: null, deadForMs: null } as const;
  if (!isAlive(p, tMs)) return { ...base, state: 'dead', opponentId: p.killerId, deadForMs: tMs - p.deathMs! };

  const contact = contactAt(round, playerId, tMs);
  if (contact) return { ...base, state: 'fighting', opponentId: contact.opponentId };

  const { plant, defuse } = round;
  if (plant && plant.playerId === playerId && tMs >= plant.startMs && tMs < plant.tMs) {
    return { ...base, state: 'planting', progress: (tMs - plant.startMs) / Math.max(1, plant.tMs - plant.startMs) };
  }
  if (defuse && defuse.playerId === playerId && tMs >= defuse.startMs && tMs < defuse.tMs) {
    return { ...base, state: 'defusing', progress: (tMs - defuse.startMs) / Math.max(1, defuse.tMs - defuse.startMs) };
  }
  const hop = activeHop(p, tMs);
  if (hop) return { ...base, state: 'moving', toZone: hop.toZone, moveMode: hop.mode };
  return { ...base, state: 'holding' };
}

export type SpikePhase = 'none' | 'planting' | 'planted' | 'defusing' | 'defused' | 'detonated';

export interface Situation {
  readonly alive: Record<TeamSlot, number>;
  /** Set while exactly one player of a team is alive against at least one opponent. */
  readonly clutch: { team: TeamSlot; playerId: string; versus: number } | null;
  readonly spike: {
    readonly phase: SpikePhase;
    readonly site: 'A' | 'B' | null;
    /** Time left on the spike once planted (ms), else null. */
    readonly remainingMs: number | null;
    /** 0..1 progress of the plant or defuse in progress. */
    readonly progress: number | null;
  };
  /** Round clock: time left in the round before the plant, spike time after it; in the buy phase, the buy time left. */
  readonly clockMs: number;
  /** The barrier is still up (the round's buy phase). */
  readonly buyPhase: boolean;
  readonly over: boolean;
}

export function situationAt(round: RoundTimeline, tMs: number): Situation {
  const alive = { A: 0, B: 0 };
  const lastAlive: Partial<Record<TeamSlot, PlayerRound>> = {};
  for (const team of ['A', 'B'] as const) {
    for (const p of teamPlayers(round, team)) if (isAlive(p, tMs)) { alive[team] += 1; lastAlive[team] = p; }
  }
  const over = roundOver(round, tMs);
  let clutch: Situation['clutch'] = null;
  if (!over) {
    for (const team of ['A', 'B'] as const) {
      const other: TeamSlot = team === 'A' ? 'B' : 'A';
      if (alive[team] === 1 && alive[other] >= 2 && lastAlive[team]) clutch = { team, playerId: lastAlive[team]!.id, versus: alive[other] };
    }
    if (!clutch && alive.A === 1 && alive.B === 1 && lastAlive.A) clutch = { team: 'A', playerId: lastAlive.A.id, versus: 1 };
  }

  const { plant, defuse } = round;
  let phase: SpikePhase = 'none';
  let remainingMs: number | null = null;
  let progress: number | null = null;
  if (plant) {
    if (tMs >= plant.tMs) {
      phase = 'planted';
      remainingMs = Math.max(0, plant.tMs + ENGINE.spikeTimerMs - Math.min(tMs, round.endMs));
      if (defuse && tMs >= defuse.tMs) phase = 'defused';
      else if (defuse && tMs >= defuse.startMs) { phase = 'defusing'; progress = (tMs - defuse.startMs) / Math.max(1, defuse.tMs - defuse.startMs); }
      else if (round.endReason === 'spikeDetonation' && tMs >= round.endMs) phase = 'detonated';
    } else if (tMs >= plant.startMs) {
      phase = 'planting';
      progress = (tMs - plant.startMs) / Math.max(1, plant.tMs - plant.startMs);
    }
  }
  const elapsed = Math.min(tMs, round.endMs) - round.startMs;
  const buyPhase = tMs < round.startMs;
  const clockMs = buyPhase ? round.startMs - tMs : remainingMs != null ? remainingMs : Math.max(0, ENGINE.roundTimeMs - elapsed);
  return { alive, clutch, spike: { phase, site: plant?.site ?? null, remainingMs, progress }, clockMs, buyPhase, over };
}

/** mm:ss for a round clock (rounded up, like a game HUD). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Kills credited to each player id in this round up to tMs. */
export function killsUpTo(round: RoundTimeline, tMs: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of round.kills) if (k.tMs <= tMs && k.killerId) out.set(k.killerId, (out.get(k.killerId) ?? 0) + 1);
  return out;
}

// ── round timeline marks (scrubber ticks, previous/next event) ───────────────────────────────

export type MarkKind = 'kill' | 'plant' | 'defuse' | 'end';
export interface RoundMark { readonly tMs: number; readonly kind: MarkKind; readonly team: TeamSlot | null }

/** The moments of a round worth jumping to, in time order. */
export function roundMarks(round: RoundTimeline): RoundMark[] {
  const marks: RoundMark[] = round.kills.map((k) => ({ tMs: k.tMs, kind: 'kill' as const, team: k.killerTeam }));
  if (round.plant) marks.push({ tMs: round.plant.tMs, kind: 'plant', team: findPlayer(round, round.plant.playerId)?.team ?? null });
  if (round.defuse) marks.push({ tMs: round.defuse.tMs, kind: 'defuse', team: findPlayer(round, round.defuse.playerId)?.team ?? null });
  if (round.endReason != null) marks.push({ tMs: round.endMs, kind: 'end', team: round.summary?.winner ?? null });
  return marks.sort((a, b) => a.tMs - b.tMs);
}

/** How long before an event a jump lands, so the viewer sees it happen. */
export const JUMP_LEAD_MS = 1500;

/**
 * Where "next event" (+1) / "previous event" (−1) should seek to from `nowMs`, or null when
 * there is nothing further in that direction. Events closer than 300 ms count as one.
 */
export function eventJump(round: RoundTimeline, nowMs: number, dir: 1 | -1): number | null {
  const targets: number[] = [];
  for (const m of roundMarks(round)) {
    const at = Math.max(round.startMs, m.tMs - JUMP_LEAD_MS);
    if (targets.length === 0 || at - targets[targets.length - 1] > 300) targets.push(at);
  }
  if (dir === 1) return targets.find((t) => t > nowMs + 100) ?? null;
  for (let i = targets.length - 1; i >= 0; i--) if (targets[i] < nowMs - 700) return targets[i];
  if (nowMs > round.startMs + 700) return round.startMs;
  return nowMs > round.buyStartMs + 700 ? round.buyStartMs : null;
}

// ── firing (first-person view model) ────────────────────────────────────────────────────────

/** A duel resolves in one engine tick; a short burst is shown leading up to each kill a player is part of. Presentation only. */
export const BURST = { shots: 5, everyMs: 120, kickMs: 100, flashMs: 45 } as const;

/** Recoil (0..1) and muzzle flash for a player at tMs, from the kill events they took part in. */
export function firingAt(kills: ReadonlyArray<{ tMs: number; killerId: string | null; victimId: string }>, playerId: string, tMs: number): { kick: number; flash: boolean } {
  let last = -Infinity;
  for (const k of kills) {
    if (k.killerId !== playerId && k.victimId !== playerId) continue;
    for (let n = 0; n < BURST.shots; n++) {
      const shot = k.tMs - n * BURST.everyMs;
      if (shot <= tMs && shot > last) last = shot;
    }
  }
  const dt = tMs - last;
  return { kick: Number.isFinite(dt) ? Math.exp(-dt / BURST.kickMs) : 0, flash: dt >= 0 && dt < BURST.flashMs };
}
