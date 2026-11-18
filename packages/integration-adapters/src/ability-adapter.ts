/**
 * Ability-availability adapter over PV-4's ability-engine (for Constraint Validation,
 * README §15.3).
 *
 * MIRROR SOURCE: origin/claude/pv-spatial @ e3ad1c541e4c5834a2cd4e438199a3ad9557a927
 *   packages/ability-engine/src/availability.ts (checkAvailability, AvailabilityResult).
 * At merge, import { checkAvailability } from "@pv/ability-engine".
 *
 * Maps ability-engine's AvailabilityResult to a PROJECT V FeasibilityResult so the Action
 * Generator can exclude an unusable ability with a reason instead of merely down-scoring it.
 */
import type { FeasibilityResult, InfeasibilityReason } from "@pv/shared-types";

interface AbilityLoadoutEntryLike {
  readonly abilityId: string;
  readonly charges: number;
  readonly ultimatePoints?: number;
  readonly ultimateCost?: number;
}
export interface AvailabilityResultLike {
  readonly usable: boolean;
  readonly reason?: string;
}
export type CheckAvailabilityLike = (
  catalog: unknown,
  entry: AbilityLoadoutEntryLike,
  ctx?: unknown,
) => AvailabilityResultLike;

/** Map ability-engine availability reasons to PROJECT V infeasibility reasons. */
export function availabilityToFeasibility(result: AvailabilityResultLike): FeasibilityResult {
  if (result.usable) return { feasible: true };
  // All current ability-engine reasons (no-charges, on-cooldown, not-enough-points,
  // unknown-ability) map to "missingAbility" for the generator's constraint stage.
  const reason: InfeasibilityReason = "missingAbility";
  return { feasible: false, reasons: [reason] };
}

/** Convenience: run the check and return a FeasibilityResult directly. */
export function abilityFeasibility(
  check: CheckAvailabilityLike,
  catalog: unknown,
  entry: AbilityLoadoutEntryLike,
  ctx?: unknown,
): FeasibilityResult {
  return availabilityToFeasibility(check(catalog, entry, ctx));
}
