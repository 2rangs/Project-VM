/**
 * Purchasable utility (ability charges) per agent — the "kit" a full buy pays for on top of the
 * weapon and shield.
 *
 * Kit cost = Σ over the agent's non-ultimate abilities of (credit cost × max charges), from the
 * official wiki Abilities tables as captured in `tools/catalog-builder/data/ability_facts.json`
 * (PV-1 research, fetched 2026-11-18, live build release-13.10). A free signature charge has cost 0
 * there and adds nothing. Astra's star cost is missing from that table (0 here), so her kit is
 * under-priced — flagged, not guessed.
 */
import { confirmed, type RuleValue } from "./rule-value.js";

const KIT_SOURCE = "https://wiki.playvalorant.com/en-us/Abilities";
const KIT_NOTE = "Σ cost × charges of the buyable abilities (ability_facts.json, release-13.10).";

export interface UtilityKitCost {
  readonly agentKey: string;
  readonly fullKit: RuleValue<number>;
}

const kit = (agentKey: string, credits: number): UtilityKitCost => ({
  agentKey,
  fullKit: confirmed(credits, KIT_SOURCE, { unit: "credits", patch: "release-13.10", note: KIT_NOTE }),
});

export const UTILITY_KIT_COSTS: readonly UtilityKitCost[] = [
  kit("astra", 0), kit("breach", 700), kit("brimstone", 750), kit("chamber", 1000), kit("clove", 750),
  kit("cypher", 600), kit("deadlock", 700), kit("fade", 700), kit("gekko", 550), kit("harbor", 500),
  kit("hush", 450), kit("iso", 500), kit("jett", 550), kit("kay-o", 700), kit("killjoy", 600),
  kit("miks", 900), kit("neon", 500), kit("omen", 750), kit("phoenix", 850), kit("raze", 700),
  kit("reyna", 1300), kit("sage", 700), kit("skye", 950), kit("sova", 700), kit("tejo", 900),
  kit("veto", 600), kit("viper", 500), kit("vyse", 500), kit("waylay", 600), kit("yoru", 750),
  // alias: scenarios/valorant-api use "kayo" for KAY/O.
  kit("kayo", 700),
];

const KIT_BY_AGENT = new Map(UTILITY_KIT_COSTS.map((k) => [k.agentKey, k]));

/** Credits for an agent's full buyable kit, or undefined for an agent not in the table. */
export function utilityKitCost(agentKey: string): number | undefined {
  return KIT_BY_AGENT.get(agentKey)?.fullKit.value;
}
