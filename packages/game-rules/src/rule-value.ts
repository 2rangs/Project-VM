/**
 * Sourced, patch-versioned rule values.
 *
 * Handoff §10 / README §19.1 are emphatic: game-rule numbers are NOT constants. They
 * change by patch, and historical matches must be interpreted under the patch they were
 * played on. So every numeric rule in this package is wrapped in a {@link RuleValue}
 * that records where it came from, which patch it is believed to apply to, and — most
 * importantly — whether it has actually been verified against a primary source in this
 * session.
 *
 * This Simulation-Core agent did NOT perform live web verification of these numbers, so
 * every value below ships with `verified: false`. They are reasonable working defaults
 * drawn from community references; the Data agent (PV-2) / a later verification pass
 * must confirm each against the cited Riot source and flip the flag. Treat an unverified
 * value as provisional, never as fact (README §29).
 */

export interface RuleValue<T> {
  readonly value: T;
  /** Unit of the value, e.g. "credits", "ms", "points". Omitted for dimensionless. */
  readonly unit?: string;
  /** Primary/secondary source URL the value is taken from. */
  readonly source: string;
  /** Patch the value is believed to apply to (e.g. "estimate:>=1.11", "UNVERIFIED"). */
  readonly patch: string;
  /** True only once confirmed against a primary source. False = provisional. */
  readonly verified: boolean;
  readonly note?: string;
}

/** Helper to build a provisional (unverified) rule value with a shared source/patch. */
export function provisional<T>(
  value: T,
  source: string,
  opts: { unit?: string; patch?: string; note?: string } = {},
): RuleValue<T> {
  return {
    value,
    source,
    patch: opts.patch ?? "UNVERIFIED",
    verified: false,
    ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
}

/**
 * Build a VERIFIED rule value — a number cross-checked against a primary source. Use only
 * when the value was actually confirmed (e.g. by another agent against the official wiki /
 * live build), and record who/what in `note`.
 */
export function confirmed<T>(
  value: T,
  source: string,
  opts: { unit?: string; patch: string; note?: string },
): RuleValue<T> {
  return {
    value,
    source,
    patch: opts.patch,
    verified: true,
    ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
}

/** Assert that a rule value has been verified; useful in rule-consuming guards/tests. */
export function requireVerified<T>(rv: RuleValue<T>, context: string): T {
  if (!rv.verified) {
    throw new Error(
      `rule value for "${context}" is unverified (source: ${rv.source}, patch: ${rv.patch})`,
    );
  }
  return rv.value;
}
