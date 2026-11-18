/**
 * Spike timing rules (README §18, Handoff §14.5).
 *
 * Provisional (verified: false). Source: gameplay wiki / community references. These
 * timings drive feasibility of plant/defuse actions (e.g. "not enough time to plant" in
 * README §15.3 / Scenario 04), so they must be verified before any outcome is trusted.
 */
import { provisional, type RuleValue } from "./rule-value.js";

const WIKI_SPIKE = "https://wiki.playvalorant.com/en-us/Spike";

export interface SpikeRules {
  readonly plantDurationMs: RuleValue<number>;
  readonly defuseDurationMs: RuleValue<number>;
  readonly defuseHalfwayMs: RuleValue<number>; // "safe" checkpoint at half defuse
  readonly detonationMs: RuleValue<number>; // post-plant time until detonation
}

export const SPIKE_RULES: SpikeRules = {
  plantDurationMs: provisional(4_000, WIKI_SPIKE, { unit: "ms", patch: "estimate:>=1.0" }),
  defuseDurationMs: provisional(7_000, WIKI_SPIKE, { unit: "ms", patch: "estimate:>=1.0" }),
  defuseHalfwayMs: provisional(3_500, WIKI_SPIKE, {
    unit: "ms",
    patch: "estimate:>=1.0",
    note: "Defuse checkpoint; defuser may release and resume from here.",
  }),
  detonationMs: provisional(45_000, WIKI_SPIKE, {
    unit: "ms",
    patch: "estimate:>=1.0",
    note: "Time from plant to detonation (45s).",
  }),
};

/**
 * Whether a plant can finish before a deadline (ms remaining). Pure feasibility helper
 * for the Action Generator's constraint stage (README §15.3).
 */
export function canPlantWithin(msRemaining: number): boolean {
  return msRemaining >= SPIKE_RULES.plantDurationMs.value;
}

/** Whether a full defuse can complete within the given remaining detonation window. */
export function canDefuseWithin(msUntilDetonation: number): boolean {
  return msUntilDetonation >= SPIKE_RULES.defuseDurationMs.value;
}
