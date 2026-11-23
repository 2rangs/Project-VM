// Calibration: everything the generator needs to know about the real population, derived at
// world creation from the real players handed in (the dataset's rated players). Stored in the
// world so a loaded save generates exactly what the original would have.
import { ABILITY_KEYS, RATED_KEYS, ROLES, type RatedKey, type Role } from "./model.ts";
import { REGIONS, regionOf, type Region } from "./regions.ts";

/** The minimal real-player record calibration reads (a game-data Player plus its agent pool). */
export interface RealPlayerInput {
  readonly playerId: string;
  readonly handle: string | null;
  readonly country: string | null;
  readonly role: string | null;
  readonly attributes: unknown;
  readonly hasRatings: boolean;
  readonly agentPool?: readonly string[] | null;
  /** Seasons the player appears in the dataset (for the age estimate). */
  readonly seasons?: readonly number[] | null;
}

export interface Calibration {
  /** Per role, per rated attribute: mean and standard deviation across that role's real players. */
  readonly roleMean: Record<Role, Record<RatedKey, number>>;
  readonly roleSd: Record<Role, Record<RatedKey, number>>;
  /** Per attribute: the lowest and highest value any real player has (generated values stay inside). */
  readonly min: Record<RatedKey, number>;
  readonly max: Record<RatedKey, number>;
  /** Real players' CA (mean of ABILITY_KEYS) per role: mean; and the overall range. */
  readonly roleCaMean: Record<Role, number>;
  readonly caMin: number;
  readonly caMax: number;
  /** Share of real rated players per role. */
  readonly roleShare: Record<Role, number>;
  /** Per region: real players per country (drives generated nationality). */
  readonly countries: Record<Region, Record<string, number>>;
  /** Per role: how many real players of that role have each agent in their pool. */
  readonly agentFreq: Record<Role, Record<string, number>>;
  /** Real players' rating uncertainty: median per attribute (what a full-sample estimate looks like). */
  readonly medianUncertainty: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
export function attrValue(attrs: unknown, key: string): number | null {
  const slot = (attrs as Record<string, { value?: unknown } | undefined> | null)?.[key];
  return num(slot?.value);
}
const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

export function deriveCalibration(real: readonly RealPlayerInput[]): Calibration {
  const rated = real.filter((p) => p.hasRatings && isRole(p.role));
  const roleMean = {} as Record<Role, Record<RatedKey, number>>;
  const roleSd = {} as Record<Role, Record<RatedKey, number>>;
  const min = {} as Record<RatedKey, number>;
  const max = {} as Record<RatedKey, number>;
  for (const k of RATED_KEYS) { min[k] = Infinity; max[k] = -Infinity; }
  const roleCaMean = {} as Record<Role, number>;
  const roleShare = {} as Record<Role, number>;
  const agentFreq = {} as Record<Role, Record<string, number>>;
  let caMin = Infinity;
  let caMax = -Infinity;
  const uncertainties: number[] = [];

  for (const role of ROLES) {
    const group = rated.filter((p) => p.role === role);
    roleShare[role] = group.length / Math.max(1, rated.length);
    roleMean[role] = {} as Record<RatedKey, number>;
    roleSd[role] = {} as Record<RatedKey, number>;
    for (const k of RATED_KEYS) {
      const vals = group.map((p) => attrValue(p.attributes, k)).filter((v): v is number => v !== null);
      const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0.6;
      const sd = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
      roleMean[role][k] = mean;
      roleSd[role][k] = sd;
      for (const v of vals) { min[k] = Math.min(min[k], v); max[k] = Math.max(max[k], v); }
    }
    const cas = group.map((p) => compositeOf((k) => attrValue(p.attributes, k))).filter((v): v is number => v !== null);
    roleCaMean[role] = cas.length ? cas.reduce((s, v) => s + v, 0) / cas.length : 0.6;
    for (const c of cas) { caMin = Math.min(caMin, c); caMax = Math.max(caMax, c); }
    agentFreq[role] = {};
    for (const p of group) for (const a of p.agentPool ?? []) agentFreq[role][a] = (agentFreq[role][a] ?? 0) + 1;
  }
  for (const p of rated) {
    for (const k of ABILITY_KEYS) {
      const u = num((p.attributes as Record<string, { uncertainty?: unknown }>)[k]?.uncertainty);
      if (u !== null) uncertainties.push(u);
    }
  }
  for (const k of RATED_KEYS) if (!Number.isFinite(min[k])) { min[k] = 0.6; max[k] = 0.6; }
  uncertainties.sort((a, b) => a - b);

  const countries = Object.fromEntries(REGIONS.map((r) => [r, {} as Record<string, number>])) as Record<Region, Record<string, number>>;
  for (const p of real) {
    const c = (p.country ?? "").toLowerCase();
    if (!/^[a-z]{2}$/.test(c) || c === "un" || c === "eu") continue;
    const r = regionOf(c);
    countries[r][c] = (countries[r][c] ?? 0) + 1;
  }

  return {
    roleMean, roleSd, min, max, roleCaMean,
    caMin: Number.isFinite(caMin) ? caMin : 0.45,
    caMax: Number.isFinite(caMax) ? caMax : 0.75,
    roleShare, countries, agentFreq,
    medianUncertainty: uncertainties.length ? uncertainties[Math.floor(uncertainties.length / 2)]! : 0.05,
  };
}

/** Equal-weight mean of the ability attributes; null when any is missing. */
export function compositeOf(get: (k: (typeof ABILITY_KEYS)[number]) => number | null | undefined): number | null {
  let s = 0;
  for (const k of ABILITY_KEYS) {
    const v = get(k);
    if (v === null || v === undefined) return null;
    s += v;
  }
  return s / ABILITY_KEYS.length;
}
