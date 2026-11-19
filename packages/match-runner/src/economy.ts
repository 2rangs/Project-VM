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
import { ECONOMY_RULES, ROUND_RULES, weaponPrice } from "@pv/game-rules";
import { advanceTeamEconomy, lossBonusTierFor } from "@pv/economy-engine";

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

export type EconomyCall = "save" | "force" | "full";

/**
 * Buy honoring a coach economy call (timeout order), overriding economy-engine's own pick.
 * Pistol rounds ignore the call (fixed pistol economy). An unaffordable call falls back to the
 * normal `decideBuy`.
 */
export function decideBuyForCall(credits: number, isPistol: boolean, call?: EconomyCall): BuyDecision {
  if (!call || isPistol) return decideBuy(credits, isPistol);
  if (call === "save") return { tier: "eco", weapon: "Classic", weaponKey: "classic", cost: 0 };
  const fullCost = priceOf("vandal") + HEAVY_ARMOR;
  const forceCost = priceOf("spectre") + LIGHT_ARMOR;
  if (call === "full" && credits >= fullCost) return { tier: "full", weapon: "Vandal", weaponKey: "vandal", cost: fullCost };
  if (call === "force" && credits >= forceCost) return { tier: "force", weapon: "Spectre", weaponKey: "spectre", cost: forceCost };
  return decideBuy(credits, isPistol); // cannot honor the call — normal buy
}

/**
 * Apply a round's outcome to one team economy via @pv/economy-engine's canonical
 * `advanceTeamEconomy` (credits = clamp(leftover + win|lossBonus + plant + kills), loss streak
 * updated), and carry ultimate points on top (the engine state does not track ult points).
 * `leftoverCredits` is what remains AFTER this round's buy (defaults to the current credits).
 */
export function applyRoundOutcome(
  eco: TeamEconomy,
  opts: { won: boolean; kills: number; planted: boolean; leftoverCredits?: number },
): TeamEconomy {
  const next = advanceTeamEconomy(
    { teamId: "", side: "attack", credits: eco.credits, consecutiveLosses: eco.consecutiveLosses, lossBonusTier: lossBonusTierFor(eco.consecutiveLosses) },
    { won: opts.won, planted: opts.planted, kills: Math.max(0, opts.kills), leftoverCredits: opts.leftoverCredits ?? eco.credits },
  );
  const ultPoints = eco.ultPoints + Math.max(0, opts.kills) + (opts.planted ? 1 : 0);
  return { credits: next.credits, consecutiveLosses: next.consecutiveLosses, ultPoints };
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
