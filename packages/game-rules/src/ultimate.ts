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
import { confirmed, provisional, type RuleValue } from "./rule-value.js";

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

/** Per-agent ultimate point requirement. */
export interface UltimateCost {
  readonly agentKey: string; // lowercase slug; map to valorant-api UUIDs in datasets/schema
  readonly pointsRequired: RuleValue<number>;
}

/**
 * All 30 agents' ultimate point costs, VERIFIED by PV-1 against the official VALORANT wiki
 * (Abilities tables) and the live game build release-13.10 (valorant-api /v1/version),
 * fetched 2026-11-18. Source data: origin/claude/pv-research @ 6759b5c
 * `tools/catalog-builder/data/ability_facts.json` (field `ultPoints`). Slugs are the
 * research slugs; note `kay-o` here (valorant-api/scenarios use `kayo` — reconcile at
 * integration). The Action Generator reads a player's own `ultimateCost` from the loaded
 * loadout, so this table is reference data, not the per-decision source.
 */
const ULT_SOURCE = "https://wiki.playvalorant.com/en-us/Abilities";
const ULT_NOTE =
  "Cross-checked by PV-1 vs official wiki + live build release-13.10 (origin/claude/pv-research ability_facts.json).";
const ult = (agentKey: string, pts: number): UltimateCost => ({
  agentKey,
  pointsRequired: confirmed(pts, ULT_SOURCE, { unit: "points", patch: "release-13.10", note: ULT_NOTE }),
});

export const ULTIMATE_COSTS: readonly UltimateCost[] = [
  ult("astra", 7), ult("breach", 8), ult("brimstone", 8), ult("chamber", 8), ult("clove", 8),
  ult("cypher", 7), ult("deadlock", 7), ult("fade", 8), ult("gekko", 8), ult("harbor", 7),
  ult("hush", 8), ult("iso", 7), ult("jett", 8), ult("kay-o", 8), ult("killjoy", 9),
  ult("miks", 8), ult("neon", 8), ult("omen", 7), ult("phoenix", 7), ult("raze", 8),
  ult("reyna", 7), ult("sage", 7), ult("skye", 8), ult("sova", 8), ult("tejo", 9),
  ult("veto", 7), ult("viper", 9), ult("vyse", 8), ult("waylay", 8), ult("yoru", 8),
  // alias: scenarios/valorant-api use "kayo" for KAY/O.
  ult("kayo", 8),
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
