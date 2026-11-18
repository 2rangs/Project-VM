/**
 * Buy strategy: from a team's money + situation, produce candidate buys (eco / half / force / full)
 * with the resulting loadout tier, each scored by the economy priors (README §19.3, Handoff §16).
 *
 * This is deliberately NOT a single hard threshold — it emits several candidates with their
 * current-round and future-round values so the IGL/decision layer (PV-3) can choose.
 */
import { matchupWinRate, type BuyTier } from "./priors-fixture.js";
import { nextRoundWinEdge } from "./future-value.js";
import type { EconomyOption, MatchScore } from "./types.js";
import { isMapPoint } from "./round-boundaries.js";
import type { TeamIdx } from "./shared-mirror.js";

// Team-total loadout cost bands (credits). Aligned with the PV-2 prior buy thresholds
// (eco <5000, semi 5000–20000, full ≥20000) so the matchup priors apply directly.
export const FULL_TEAM_COST = 20_000;
export const HALF_TEAM_COST = 12_000;
export const ECO_TEAM_COST = 2_500;

export interface BuyContext {
  readonly teamCredits: number; // total credits available to the team this buy phase
  readonly roundNum: number;
  readonly matchScore: MatchScore;
  readonly teamIdx: TeamIdx;
  readonly opponentEstimatedBank?: number; // to guess the opponent's buy tier
  readonly aliveToBuy?: number; // default 5
}

export function tierForSpend(spend: number): BuyTier {
  if (spend >= FULL_TEAM_COST) return "full";
  if (spend >= 5_000) return "semi";
  return "eco";
}

function tierForBank(bank: number): BuyTier {
  // What the opponent can most likely field with this bank.
  if (bank >= FULL_TEAM_COST) return "full";
  if (bank >= HALF_TEAM_COST) return "semi";
  if (bank >= 5_000) return "semi";
  return "eco";
}

function option(
  action: string,
  spend: number,
  ownTier: BuyTier,
  oppTier: BuyTier,
  ctx: BuyContext,
): EconomyOption {
  const winNow = matchupWinRate(ownTier, oppTier);
  const currentRoundValue = (winNow - 0.5) * 2; // [-1,1]
  // Future value: keeping credits (eco/force-light) sets up the next round; spending less than a
  // full buy preserves economy. Zero future weight if this round can end the map.
  const savedVsFull = Math.max(0, FULL_TEAM_COST - spend);
  const economicDelta = savedVsFull; // credits kept vs a full buy (>=0)
  const futureWeight = isMapPoint(ctx.matchScore) ? 0 : 1;
  const futureValue = futureWeight * (nextRoundWinEdge(ownTier) + (savedVsFull / FULL_TEAM_COST) * 0.2);
  return {
    action,
    currentRoundValue: round3(currentRoundValue),
    futureValue: round3(clamp(futureValue, -1, 1)),
    economicDelta,
    ultDelta: 0,
    explanation:
      `${action}: own ${ownTier} vs opp ${oppTier} -> ${(winNow * 100).toFixed(0)}% this round` +
      (futureWeight === 0 ? "; match point, no future weight" : `; keeps ${savedVsFull}cr vs full buy`),
  };
}

/** Candidate buys for the team, most aggressive first. */
export function buyOptions(ctx: BuyContext): EconomyOption[] {
  const oppTier = ctx.opponentEstimatedBank !== undefined ? tierForBank(ctx.opponentEstimatedBank) : "full";
  const credits = ctx.teamCredits;
  const out: EconomyOption[] = [];

  if (credits >= FULL_TEAM_COST) {
    out.push(option("fullBuy", FULL_TEAM_COST, "full", oppTier, ctx));
  } else {
    // Can't comfortably full-buy: a force buy commits most of the bank.
    const forceSpend = Math.min(credits, FULL_TEAM_COST);
    out.push(option("forceBuy", forceSpend, tierForSpend(forceSpend), oppTier, ctx));
  }
  if (credits >= HALF_TEAM_COST) {
    out.push(option("halfBuy", HALF_TEAM_COST, "semi", oppTier, ctx));
  }
  out.push(option("eco", Math.min(credits, ECO_TEAM_COST), "eco", oppTier, ctx));
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
