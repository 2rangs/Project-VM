/**
 * Future-round value: how this round's choice affects the next 1–2 rounds' economy and win
 * probability (Handoff §15.5, README §19). Win-prob inputs are PV-2 priors (priors-fixture.ts).
 */
import { NEXT_ROUND_WIN_RATE_BY_BUY, type BuyTier } from "./priors-fixture.js";
import { ECONOMY, clampCredits, lossBonusFor } from "./rules.js";
import { weaponPreservationHasFuture } from "./round-boundaries.js";
import type { MatchScore } from "./types.js";
import type { TeamIdx } from "./shared-mirror.js";

/** Project a team's credits at the START of the next round. */
export function projectNextRoundBank(args: {
  readonly leftoverCredits: number; // credits NOT spent this round
  readonly wonRound: boolean;
  readonly consecutiveLossesBefore: number; // before this round's result
  readonly plantedSpike?: boolean;
}): number {
  let credits = args.leftoverCredits;
  if (args.wonRound) {
    credits += ECONOMY.roundWinReward.value;
  } else {
    const streak = args.consecutiveLossesBefore + 1;
    credits += lossBonusFor(streak);
    if (args.plantedSpike) credits += ECONOMY.spikePlantReward.value;
  }
  return clampCredits(credits);
}

/**
 * Future value, in [-1, 1], of ending this round with a preserved weapon vs not, for the team.
 * Zero when no future round benefits from the preserved weapon (half/OT reset or match point).
 */
export function weaponFutureValue(args: {
  readonly weaponValueCredits: number; // value of the weapon being preserved
  readonly roundNum: number;
  readonly matchScore: MatchScore;
  readonly teamIdx: TeamIdx;
}): number {
  if (!weaponPreservationHasFuture(args.roundNum, args.matchScore, args.teamIdx)) return 0;
  // Normalize to the Operator (4700) as the most valuable weapon; cap at 1.
  return Math.min(1, Math.max(0, args.weaponValueCredits / 4700));
}

/** Prior-based next-round win rate given this round's buy tier (per-team baseline 0.5). */
export function nextRoundWinRate(buy: BuyTier): number {
  return NEXT_ROUND_WIN_RATE_BY_BUY[buy];
}

/** Future win-prob edge (next round rate minus the 0.5 baseline), in [-0.5, 0.5]. */
export function nextRoundWinEdge(buy: BuyTier): number {
  return nextRoundWinRate(buy) - 0.5;
}
