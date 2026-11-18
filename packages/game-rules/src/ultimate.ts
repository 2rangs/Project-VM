/**
 * Ultimate economy rules (README §21, Handoff §15.2).
 *
 * Provisional (verified: false). Sources: Riot patch notes 1.0
 * https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-0/,
 * Abilities wiki https://wiki.playvalorant.com/en-us/Abilities, economy guide
 * https://mobalytics.gg/blog/valorant/ultimate-economy-guide/.
 *
 * README §21.4 stresses that non-hostile deaths (spike detonation, fall) may charge
 * ultimate points differently from a normal kill — those rules are explicitly marked
 * UNVERIFIED here and must be confirmed per patch.
 */
import { provisional, type RuleValue } from "./rule-value.js";

const PATCH_1_0 =
  "https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-0/";
const WIKI_ABILITIES = "https://wiki.playvalorant.com/en-us/Abilities";

/** How a single ultimate *point* is earned. Agents then need N points (6–8) to cast. */
export interface UltimatePointRules {
  readonly pointForKill: RuleValue<number>;
  readonly pointForDeath: RuleValue<number>;
  readonly pointForSpikePlant: RuleValue<number>;
  readonly pointForSpikeDefuse: RuleValue<number>;
  readonly pointForOrb: RuleValue<number>;
  readonly orbsPerMap: RuleValue<number>;
  /** Whether a non-hostile death (spike/fall) grants the killer's team a point. */
  readonly nonHostileDeathGrantsEnemyPoint: RuleValue<boolean>;
}

export const ULTIMATE_POINT_RULES: UltimatePointRules = {
  pointForKill: provisional(1, PATCH_1_0, { unit: "points", patch: "estimate:>=1.0" }),
  pointForDeath: provisional(1, PATCH_1_0, {
    unit: "points",
    patch: "UNVERIFIED",
    note: "Whether dying grants the victim a point has varied by patch — verify.",
  }),
  pointForSpikePlant: provisional(1, PATCH_1_0, { unit: "points", patch: "estimate:>=1.0" }),
  pointForSpikeDefuse: provisional(1, PATCH_1_0, { unit: "points", patch: "estimate:>=1.0" }),
  pointForOrb: provisional(1, WIKI_ABILITIES, { unit: "points", patch: "estimate:>=1.0" }),
  orbsPerMap: provisional(2, WIKI_ABILITIES, { unit: "orbs", patch: "estimate:>=1.0" }),
  nonHostileDeathGrantsEnemyPoint: provisional(false, WIKI_ABILITIES, {
    patch: "UNVERIFIED",
    note: "README §21.4: spike/fall deaths may not charge enemy ult like a kill does.",
  }),
};

/** Per-agent ultimate point requirement. Provisional sample; expand from valorant-api. */
export interface UltimateCost {
  readonly agentKey: string; // lowercase slug; map to valorant-api UUIDs in datasets/schema
  readonly pointsRequired: RuleValue<number>;
}

export const ULTIMATE_COSTS: readonly UltimateCost[] = [
  { agentKey: "jett", pointsRequired: provisional(7, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
  { agentKey: "sova", pointsRequired: provisional(8, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
  { agentKey: "sage", pointsRequired: provisional(8, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
  { agentKey: "omen", pointsRequired: provisional(7, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
  { agentKey: "killjoy", pointsRequired: provisional(8, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
  { agentKey: "brimstone", pointsRequired: provisional(7, WIKI_ABILITIES, { unit: "points", patch: "UNVERIFIED" }) },
];

const COST_BY_AGENT = new Map(ULTIMATE_COSTS.map((u) => [u.agentKey, u]));

/** Points required for an agent's ultimate, or undefined if not in the sample table. */
export function ultimatePointsRequired(agentKey: string): number | undefined {
  return COST_BY_AGENT.get(agentKey)?.pointsRequired.value;
}

/** Whether an agent has banked enough points to cast its ultimate. */
export function isUltimateReady(agentKey: string, points: number): boolean {
  const required = ultimatePointsRequired(agentKey);
  return required !== undefined && points >= required;
}
