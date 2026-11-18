/**
 * Economy rules (README §19, Handoff §16).
 *
 * All values are provisional (verified: false) — see rule-value.ts. Sources:
 *   - Credits (wiki): https://wiki.playvalorant.com/en-us/Credits
 *   - Patch 1.11 (loss-bonus rework): https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/
 *   - Economy guide: https://mobalytics.gg/blog/valorant/ultimate-economy-guide/
 */
import { provisional, type RuleValue } from "./rule-value.js";

const WIKI_CREDITS = "https://wiki.playvalorant.com/en-us/Credits";
const PATCH_1_11 =
  "https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/";
const ECON_GUIDE = "https://mobalytics.gg/blog/valorant/ultimate-economy-guide/";

export interface EconomyRules {
  readonly startingCredits: RuleValue<number>; // pistol round / match start
  readonly maxCredits: RuleValue<number>;
  readonly roundWinReward: RuleValue<number>;
  /**
   * Loss-bonus ladder indexed by consecutive losses (index 0 = first loss). The last
   * entry is the cap for 3+ consecutive losses.
   */
  readonly lossBonusLadder: RuleValue<readonly number[]>;
  readonly spikePlantReward: RuleValue<number>; // team award when planting
  readonly killReward: RuleValue<number>; // default per-kill award
}

export const ECONOMY_RULES: EconomyRules = {
  startingCredits: provisional(800, WIKI_CREDITS, {
    unit: "credits",
    patch: "estimate:>=1.0",
    note: "Pistol-round starting credits.",
  }),
  maxCredits: provisional(9000, WIKI_CREDITS, { unit: "credits", patch: "estimate:>=1.0" }),
  roundWinReward: provisional(3000, WIKI_CREDITS, { unit: "credits", patch: "estimate:>=1.0" }),
  lossBonusLadder: provisional([1900, 2400, 2900], PATCH_1_11, {
    unit: "credits",
    patch: "estimate:>=1.11",
    note: "1st/2nd/3rd+ consecutive loss. Reworked in 1.11; confirm current patch.",
  }),
  spikePlantReward: provisional(300, ECON_GUIDE, {
    unit: "credits",
    patch: "UNVERIFIED",
    note: "Team award for planting even on a lost round; verify amount/recipients.",
  }),
  killReward: provisional(200, ECON_GUIDE, {
    unit: "credits",
    patch: "estimate:>=1.0",
    note: "Default weapon kill. Some abilities/objectives differ.",
  }),
};

/** Armor purchase options. */
export interface ArmorPurchase {
  readonly id: "light" | "heavy" | "regen";
  readonly cost: RuleValue<number>;
  readonly points: RuleValue<number>;
}

export const ARMOR_PURCHASES: readonly ArmorPurchase[] = [
  {
    id: "light",
    cost: provisional(400, WIKI_CREDITS, { unit: "credits", patch: "estimate:>=1.0" }),
    points: provisional(25, WIKI_CREDITS, { unit: "points", patch: "estimate:>=1.0" }),
  },
  {
    id: "heavy",
    cost: provisional(1000, WIKI_CREDITS, { unit: "credits", patch: "estimate:>=1.0" }),
    points: provisional(50, WIKI_CREDITS, { unit: "points", patch: "estimate:>=1.0" }),
  },
  {
    id: "regen",
    cost: provisional(650, WIKI_CREDITS, {
      unit: "credits",
      patch: "UNVERIFIED",
      note: "Regen shield; availability/cost is patch-dependent.",
    }),
    points: provisional(25, WIKI_CREDITS, { unit: "points", patch: "UNVERIFIED" }),
  },
];

/**
 * Loss-bonus credits for a given streak length (1 = first loss). Clamps to the ladder
 * cap for longer streaks. Pure, so it is directly unit-testable.
 */
export function lossBonusFor(consecutiveLosses: number): number {
  const ladder = ECONOMY_RULES.lossBonusLadder.value;
  if (consecutiveLosses <= 0) return 0;
  const idx = Math.min(consecutiveLosses, ladder.length) - 1;
  return ladder[idx]!;
}

/** Whether `credits` can afford a total cost; trivially pure for testing/affordability. */
export function canAfford(credits: number, totalCost: number): boolean {
  return credits >= totalCost;
}

/** Clamp a credit total to the legal [0, maxCredits] range. */
export function clampCredits(credits: number): number {
  const max = ECONOMY_RULES.maxCredits.value;
  if (credits < 0) return 0;
  return credits > max ? max : credits;
}
