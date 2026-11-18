import type { AbilityCatalog } from "./catalog.js";
import type { AbilityLoadoutEntry, AvailabilityResult, UltimateStatus } from "./types.js";

/**
 * Whether an ability can be used right now, for PV-3's Action Generator Constraint
 * Validation (README §15.3): checks charges, cooldown, and ultimate points. Returns a
 * structured reason so callers can explain exclusions in the Decision Debugger.
 */
export function checkAvailability(
  catalog: AbilityCatalog,
  entry: AbilityLoadoutEntry,
  nowMs: number,
  ult?: UltimateStatus,
): AvailabilityResult {
  const spec = catalog[entry.abilityId];
  if (!spec) return { usable: false, reason: "unknown-ability" };

  if (spec.slot === "Ultimate") {
    const required = spec.ultPoints ?? ult?.required ?? Infinity;
    const points = ult?.points ?? 0;
    if (points < required) return { usable: false, reason: "ult-not-ready" };
    return { usable: true, reason: "ok" };
  }

  if (entry.chargesRemaining <= 0) return { usable: false, reason: "no-charges" };

  if (spec.cooldownMs != null && entry.lastUsedAtMs != null) {
    const elapsed = nowMs - entry.lastUsedAtMs;
    if (elapsed < spec.cooldownMs) {
      return { usable: false, reason: "on-cooldown", cooldownRemainingMs: spec.cooldownMs - elapsed };
    }
  }

  return { usable: true, reason: "ok" };
}
