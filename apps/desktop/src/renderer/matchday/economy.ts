// Per-player economy for the round on screen, derived from the round summary the engine sent
// (match-runner `buys[team].players` / `economy[team].players`). Pure: no DOM, no engine imports.
//
// Spoiler rule: what a player ENTERED the round with (credits before the buy, the weapon and where
// it came from, ult points carried in) is shown while the round plays; what they have AFTER the
// round (credits, kept weapon) is only shown once the playhead has reached the round's end.
import type { MatchRoundSummary, PlayerBuyInfo, TeamBuyInfo } from '../../shared/ipc.ts';
import type { TeamSlot } from './timeline.ts';

export interface PlayerEco {
  readonly slot: number;
  readonly creditsBefore: number;
  readonly spent: number;
  readonly weapon: string;
  readonly source: PlayerBuyInfo['weaponSource'];
  /** Roster slot (1..5) of the teammate who paid for the weapon, when dropped. */
  readonly droppedBySlot: number | null;
  readonly armor: number;
  readonly utility: number;
  readonly loadoutValue: number;
  /** Ultimate points carried into the round. */
  readonly ultBefore: number;
  /** After the round (null until the round is over). */
  readonly creditsAfter: number | null;
  readonly keeps: string | null;
}

export function playerEco(
  round: MatchRoundSummary | null, prev: MatchRoundSummary | null, team: TeamSlot, slot: number, over: boolean,
): PlayerEco | null {
  const b = round?.buys[team].players?.[slot - 1];
  if (!round || !b) return null;
  const after = round.economy[team].players?.[slot - 1];
  return {
    slot, creditsBefore: b.creditsBefore, spent: b.spent, weapon: b.weapon, source: b.weaponSource,
    droppedBySlot: b.droppedBy != null ? b.droppedBy + 1 : null,
    armor: b.armor + (b.armorBought === 'light' ? 25 : b.armorBought === 'heavy' ? 50 : 0), utility: b.utility,
    loadoutValue: b.loadoutValue,
    ultBefore: prev?.economy[team].players?.[slot - 1]?.ultPoints ?? 0,
    creditsAfter: over && after ? after.credits : null,
    keeps: over && after ? after.weapon : null,
  };
}

export interface BuyReason {
  readonly plan: string;
  readonly tier: string;
  readonly vctTier: string | null;
  readonly loadoutValue: number | null;
  readonly drops: number;
  readonly call: string | null;
  /** The plan the team chose and the best alternative it beat (objective values), when recorded. */
  readonly chosen: { plan: string; value: number; ultHold: boolean } | null;
  readonly beat: { plan: string; value: number; ultHold: boolean } | null;
}

/** Why a team bought what it did: the plan, the coach call that forced it, and the alternative it beat. */
export function buyReason(buy: TeamBuyInfo | undefined): BuyReason | null {
  if (!buy || buy.plan === undefined) return null;
  const ev = [...(buy.evaluation ?? [])].sort((a, b) => b.value - a.value);
  const chosen = ev.find((e) => e.plan === buy.plan) ?? ev[0] ?? null;
  const beat = ev.find((e) => e !== chosen) ?? null;
  return {
    plan: buy.plan, tier: buy.tier, vctTier: buy.vctTier ?? null, loadoutValue: buy.loadoutValue ?? null, drops: buy.drops ?? 0,
    call: buy.call ?? null,
    chosen: chosen && { plan: chosen.plan, value: chosen.value, ultHold: chosen.ultHold },
    beat: beat && { plan: beat.plan, value: beat.value, ultHold: beat.ultHold },
  };
}

/** Weapons passed between teammates this round: giver slot → receiver slot. */
export function dropsOf(buy: TeamBuyInfo | undefined): Array<{ from: number; to: number; weapon: string }> {
  const out: Array<{ from: number; to: number; weapon: string }> = [];
  for (const p of buy?.players ?? []) if (p.weaponSource === 'dropped' && p.droppedBy != null) out.push({ from: p.droppedBy + 1, to: p.index + 1, weapon: p.weapon });
  return out;
}
