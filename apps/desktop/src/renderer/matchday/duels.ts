// Duel cards (UI-2): who saw first, who was pre-aimed, who was in a crossfire, what the angle cost,
// what information each side had — every term read from the engine's own duel record
// (round-simulator EngagementRecord, `RoundSummary.engagement`). Pure.
import type { EngagementInfo } from '../../shared/ipc.ts';
import { teamOfId, type TeamSlot } from './timeline.ts';

export interface DuelCard {
  readonly tMs: number;
  readonly zone: string;
  readonly distanceM: number;
  /** Both fighters, from the viewer's side first. */
  readonly ours: { id: string; preAim: boolean; moving: boolean; crossfire: boolean; info: boolean; angleDelayMs: number | null; flashedMs: number };
  readonly theirs: { id: string; preAim: boolean; moving: boolean; crossfire: boolean; info: boolean; angleDelayMs: number | null; flashedMs: number };
  /** Who had first sight: 'ours' | 'theirs' | 'mutual'. */
  readonly firstSight: 'ours' | 'theirs' | 'mutual';
  /** 'ours' | 'theirs' | null (nobody died). */
  readonly winner: 'ours' | 'theirs' | null;
}

export function duelCards(engagements: readonly EngagementInfo[] | null | undefined, roundStartMs: number, attacker: TeamSlot, viewTeam: TeamSlot): DuelCard[] {
  if (!engagements) return [];
  return engagements.map((e) => {
    const attackerTeam = teamOfId(e.attackerId, attacker);
    const weAreAttacker = attackerTeam === viewTeam;
    const side = (a: boolean) => (a ? 'attacker' : 'defender') as 'attacker' | 'defender';
    const of = (a: boolean) => {
      const k = side(a);
      return {
        id: a ? e.attackerId : e.defenderId,
        preAim: a ? e.attackerPreAim : e.defenderPreAim,
        moving: a ? e.attackerMoving : e.defenderMoving,
        crossfire: !!e.crossfire?.[k], info: !!e.info?.[k],
        angleDelayMs: e.angleDelayMs ? e.angleDelayMs[k] : null,
        flashedMs: a ? e.attackerFlashedMs : e.defenderFlashedMs,
      };
    };
    const ours = of(weAreAttacker), theirs = of(!weAreAttacker);
    const first: DuelCard['firstSight'] = e.firstSight === 'mutual' ? 'mutual' : (e.firstSight === 'attacker') === weAreAttacker ? 'ours' : 'theirs';
    const winner: DuelCard['winner'] = e.winnerSide == null ? null : ((e.winnerSide === 'attack') === weAreAttacker ? 'ours' : 'theirs');
    return { tMs: roundStartMs + e.elapsedMs, zone: weAreAttacker ? e.attackerZone : e.defenderZone, distanceM: Math.round(e.distanceMeters), ours, theirs, firstSight: first, winner };
  }).sort((a, b) => a.tMs - b.tMs);
}
