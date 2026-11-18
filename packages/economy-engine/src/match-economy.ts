/**
 * Match-loop economy: advance team economy state BETWEEN rounds from a round's outcome.
 *
 * This is the glue a Match Runner (PV-3) calls after each round to get the next round's starting
 * credits and loss streak for both teams, plus how much weapon value survivors carry over. It reuses
 * the per-team projection in future-value.ts (leftover + win/loss/plant, clamped) and adds the two
 * pieces that a full match loop also needs: per-kill rewards and the updated TeamEconomyState
 * (credits + consecutiveLosses + lossBonusTier) for each team.
 *
 * All functions are pure and deterministic. Credit numbers mirror rules.ts (WIKI_CREDITS-sourced).
 */
import { ECONOMY, clampCredits, lossBonusFor, weaponPrice } from "./rules.js";
import { isPreResetRound } from "./round-boundaries.js";
import type { TeamEconomyState, TeamIdx } from "./shared-mirror.js";

/** Minimal round result a Match Runner feeds back to the economy after a round resolves. */
export interface RoundEconomyOutcome {
  readonly roundNum: number;
  /** Which team won the round (0 or 1). */
  readonly winnerTeamIdx: TeamIdx;
  /** Team that planted the spike this round (gets the plant award even on a lost round), or null. */
  readonly plantingTeamIdx?: TeamIdx | null;
  /** Kills credited to [team0, team1] this round (for per-kill rewards). */
  readonly kills: readonly [number, number];
  /** Credits each team did NOT spend in this round's buy phase (carried into the award). */
  readonly leftoverCredits: readonly [number, number];
}

/** Itemized credit award for one team for one round (sums to `total`). */
export interface CreditAward {
  readonly win: number;
  readonly lossBonus: number;
  readonly plant: number;
  readonly kills: number;
  readonly total: number;
}

/** Compute one team's credit award for a round. `consecutiveLossesBefore` is the streak ENTERING it. */
export function creditAward(args: {
  readonly won: boolean;
  readonly consecutiveLossesBefore: number;
  readonly planted: boolean;
  readonly kills: number;
}): CreditAward {
  const win = args.won ? ECONOMY.roundWinReward.value : 0;
  // The loss bonus uses the streak INCLUDING this loss (1st loss -> ladder[0]); winners reset to 0.
  const lossBonus = args.won ? 0 : lossBonusFor(args.consecutiveLossesBefore + 1);
  // The plant award is paid to the planting team even if they lost the round.
  const plant = args.planted ? ECONOMY.spikePlantReward.value : 0;
  const kills = Math.max(0, args.kills) * ECONOMY.killReward.value;
  return { win, lossBonus, plant, kills, total: win + lossBonus + plant + kills };
}

/** Tier (0 = none, else 1..ladderLen) shown in TeamEconomyState.lossBonusTier for a loss streak. */
export function lossBonusTierFor(consecutiveLosses: number): number {
  if (consecutiveLosses <= 0) return 0;
  return Math.min(consecutiveLosses, ECONOMY.lossBonusLadder.value.length);
}

/**
 * Advance ONE team's economy state across a round boundary. Returns a new TeamEconomyState whose
 * `credits` = clamp(leftoverCredits + award.total), with the loss streak and tier updated.
 */
export function advanceTeamEconomy(
  prev: TeamEconomyState,
  args: { readonly won: boolean; readonly planted: boolean; readonly kills: number; readonly leftoverCredits: number },
): TeamEconomyState {
  const award = creditAward({
    won: args.won,
    consecutiveLossesBefore: prev.consecutiveLosses,
    planted: args.planted,
    kills: args.kills,
  });
  const consecutiveLosses = args.won ? 0 : prev.consecutiveLosses + 1;
  return {
    ...prev,
    credits: clampCredits(args.leftoverCredits + award.total),
    consecutiveLosses,
    lossBonusTier: lossBonusTierFor(consecutiveLosses),
  };
}

/** Advance BOTH teams from one round outcome — the between-rounds call for a match loop. */
export function advanceMatchEconomy(
  prev: readonly [TeamEconomyState, TeamEconomyState],
  outcome: RoundEconomyOutcome,
): [TeamEconomyState, TeamEconomyState] {
  const step = (idx: TeamIdx): TeamEconomyState =>
    advanceTeamEconomy(prev[idx], {
      won: outcome.winnerTeamIdx === idx,
      planted: outcome.plantingTeamIdx === idx,
      kills: outcome.kills[idx] ?? 0,
      leftoverCredits: outcome.leftoverCredits[idx] ?? 0,
    });
  return [step(0), step(1)];
}

/**
 * Credit value of weapons that SURVIVING players carry into the next round (equipment retention).
 * Returns 0 at a half/OT reset round, where loadouts reset and nothing carries (isPreResetRound).
 * A Match Runner uses this to reduce the team's effective rebuy cost next round.
 */
export function retainedWeaponValue(survivorWeaponKeys: readonly string[], roundNum: number): number {
  if (isPreResetRound(roundNum)) return 0;
  return survivorWeaponKeys.reduce((sum, key) => sum + (weaponPrice(key) ?? 0), 0);
}
