/**
 * Spike timing and blast rules (README §18, Handoff §14.5).
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
  /**
   * Radius of the detonation (m). The same distance is the player's audio range — how far running
   * footsteps carry (see the note on the value): the engine uses it for both.
   */
  readonly blastRadiusM: RuleValue<number>;
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
  // NOT A PUBLISHED NUMBER. The cited wiki page states only the relation — "The maximum radius of
  // the explosion is about the same as the player's audio range" (the circle around the player on
  // the minimap) — and gives no distance (page read 2026-11-19). 50 m is a manual approximation:
  // the single figure found for the audio range is an unofficial community estimate of "roughly
  // 50 meters" for running footsteps, not confirmed against a second source or the live build.
  blastRadiusM: provisional(50, WIKI_SPIKE, {
    unit: "m",
    patch: "UNVERIFIED",
    note:
      "manual-approx. Source states the blast radius is 'about the same as the player's audio range' but no number; " +
      "50 m is an unverified community estimate of the running-footstep audio range. Verify against the live build.",
  }),
};

/** World units per metre (spatial-engine / round-simulator convention: 100 units = 1 m). */
export const WORLD_UNITS_PER_METRE = 100;

/**
 * The spike's blast radius in world units — and, by the rule above, the distance within which a
 * running player's footsteps are heard.
 */
export function spikeBlastRadiusUnits(): number {
  return SPIKE_RULES.blastRadiusM.value * WORLD_UNITS_PER_METRE;
}

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
