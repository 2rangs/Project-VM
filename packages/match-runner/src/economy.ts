/**
 * Match-level economy carryover (README §19, Handoff §16).
 *
 * v0 is TEAM-level (one buy per side per round) and uses @pv/game-rules constants. The
 * between-round transition here is numerically IDENTICAL to @pv/economy-engine's canonical
 * `advanceTeamEconomy` (credits = clamp(leftover + win/lossBonus/plant/kills); loss-streak
 * handling), and economy-engine's rule values equal game-rules'. We keep this self-contained
 * because economy-engine currently exports a `dist/` build (not source) and is not yet built in
 * the monorepo, so depending on it would make the runnable draft fragile. SWAP TARGET: once
 * economy-engine is source-consumable (`exports: "./src/index.ts"`), replace the body of
 * `applyRoundOutcome` with a call to `advanceTeamEconomy`/`advanceMatchEconomy` (PV-2 owns it).
 *
 * A richer per-player buy and weapon-preservation model is the economy-engine's job (follow-up).
 * All values are provisional (game-rules values are verified:false).
 */
import {
  ECONOMY_RULES,
  ROUND_RULES,
  lossBonusFor,
  clampCredits,
  weaponPrice,
} from "@pv/game-rules";

export interface TeamEconomy {
  credits: number;
  consecutiveLosses: number;
  ultPoints: number;
}

export type BuyTier = "pistol" | "full" | "force" | "eco";

export interface BuyDecision {
  readonly tier: BuyTier;
  /** Capitalised weapon name for round-simulator's makeSyntheticRound. */
  readonly weapon: string;
  readonly weaponKey: string;
  readonly cost: number;
}

const START = ECONOMY_RULES.startingCredits.value; // 800
const WIN = ECONOMY_RULES.roundWinReward.value; // 3000
const KILL = ECONOMY_RULES.killReward.value; // 200
const PLANT = ECONOMY_RULES.spikePlantReward.value; // 300
const OT_CREDITS = ROUND_RULES.overtimeCredits.value; // provisional 5000

const priceOf = (key: string) => weaponPrice(key)?.price.value ?? 0;
const HEAVY_ARMOR = 1000;
const LIGHT_ARMOR = 400;

export function newTeamEconomy(): TeamEconomy {
  return { credits: START, consecutiveLosses: 0, ultPoints: 0 };
}

/** Rule-based team buy from current credits. */
export function decideBuy(credits: number, isPistol: boolean): BuyDecision {
  if (isPistol) {
    if (credits >= priceOf("ghost") + LIGHT_ARMOR) {
      return { tier: "pistol", weapon: "Ghost", weaponKey: "ghost", cost: priceOf("ghost") + LIGHT_ARMOR };
    }
    return { tier: "pistol", weapon: "Classic", weaponKey: "classic", cost: 0 };
  }
  const fullCost = priceOf("vandal") + HEAVY_ARMOR;
  const forceCost = priceOf("spectre") + LIGHT_ARMOR;
  if (credits >= fullCost) return { tier: "full", weapon: "Vandal", weaponKey: "vandal", cost: fullCost };
  if (credits >= forceCost) return { tier: "force", weapon: "Spectre", weaponKey: "spectre", cost: forceCost };
  return { tier: "eco", weapon: "Classic", weaponKey: "classic", cost: 0 }; // save
}

/**
 * Apply a round's outcome to one team economy (mirror of economy-engine's `advanceTeamEconomy`):
 * credits = clamp(leftover + win|lossBonus + plant + kills), loss streak updated, ult points
 * carried. `leftoverCredits` is what remains AFTER this round's buy (defaults to current credits).
 */
export function applyRoundOutcome(
  eco: TeamEconomy,
  opts: { won: boolean; kills: number; planted: boolean; leftoverCredits?: number },
): TeamEconomy {
  const leftover = opts.leftoverCredits ?? eco.credits;
  const consecutiveLosses = opts.won ? 0 : eco.consecutiveLosses + 1;
  // Loss bonus uses the streak INCLUDING this loss (1st loss → ladder[0]); winners reset.
  const award = (opts.won ? WIN : lossBonusFor(consecutiveLosses)) + Math.max(0, opts.kills) * KILL + (opts.planted ? PLANT : 0);
  const ultPoints = eco.ultPoints + Math.max(0, opts.kills) + (opts.planted ? 1 : 0);
  return { credits: clampCredits(leftover + award), consecutiveLosses, ultPoints };
}

/** Reset economy at a half (both teams go back to the pistol buy); ult points persist. */
export function halfReset(eco: TeamEconomy): TeamEconomy {
  return { credits: START, consecutiveLosses: 0, ultPoints: eco.ultPoints };
}

/** Economy for an overtime round (fixed credits, no carry); ult points persist. */
export function overtimeReset(eco: TeamEconomy): TeamEconomy {
  return { credits: OT_CREDITS, consecutiveLosses: 0, ultPoints: eco.ultPoints };
}

/** Subtract a buy's cost, floored at 0. */
export function spend(credits: number, cost: number): number {
  return Math.max(0, credits - cost);
}
