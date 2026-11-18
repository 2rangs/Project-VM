/**
 * Match-level economy carryover (README §19, Handoff §16).
 *
 * v0 is TEAM-level (one buy per side per round) and uses @pv/game-rules constants. It is
 * deliberately simple and rule-based (deterministic): round rewards, the loss-bonus ladder,
 * kill/plant rewards, half/OT resets, and a buy heuristic. A richer per-player buy and
 * weapon-preservation model is the economy-engine's job (follow-up); the numbers here are
 * provisional (game-rules values are verified:false).
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
const OT_CREDITS = ROUND_RULES.overtimeCredits.value; // provisional

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

/** Apply a round's outcome to a team economy (returns a new object). */
export function applyRoundOutcome(
  eco: TeamEconomy,
  opts: { won: boolean; kills: number; planted: boolean },
): TeamEconomy {
  const consecutiveLosses = opts.won ? 0 : eco.consecutiveLosses + 1;
  let credits = eco.credits;
  credits += opts.won ? WIN : lossBonusFor(consecutiveLosses);
  credits += opts.kills * KILL;
  if (opts.planted) credits += PLANT;
  // Ultimate points: +1 per kill, +1 for a plant (provisional; README §21).
  const ultPoints = eco.ultPoints + opts.kills + (opts.planted ? 1 : 0);
  return { credits: clampCredits(credits), consecutiveLosses, ultPoints };
}

/** Reset economy at a half (both teams go back to the pistol buy); ult points persist. */
export function halfReset(eco: TeamEconomy): TeamEconomy {
  return { credits: START, consecutiveLosses: 0, ultPoints: eco.ultPoints };
}

/** Economy for an overtime round (fixed credits, no carry). */
export function overtimeReset(eco: TeamEconomy): TeamEconomy {
  return { credits: OT_CREDITS, consecutiveLosses: 0, ultPoints: eco.ultPoints };
}

/** Subtract a buy's cost, floored at 0. */
export function spend(credits: number, cost: number): number {
  return Math.max(0, credits - cost);
}
