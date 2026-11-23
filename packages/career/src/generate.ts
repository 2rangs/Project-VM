// Generators for fictional people ("regens"). Each person is one deterministic function of
// (world seed, person id): the same id under the same seed is always the same person.
//
// Player attributes (docs/GENERATED_PEOPLE.md §2):
//   PA*        = caMin + (caMax − caMin) · u^paSkew                          talent draw
//   peak_k     = μ_role,k + (PA* − CA̅_role) + s · σ_role,k · z_k            archetype × talent × individual
//                then shifted so mean(peak) = PA*, then clamped to the real [min_k, max_k]
//   PA         = mean_k peak_k
//   x_k        = min_k + m_k(age)·(1 + σ_m·z'_k) · (peak_k − min_k)          age curve with noise
//   CA         = mean_k x_k ≤ PA                                             (x_k ≤ peak_k for every k)
import { CAREER_MODEL, maturity } from "./ability.ts";
import { compositeOf, type Calibration } from "./calibration.ts";
import {
  ABILITY_KEYS, RATED_KEYS, ROLES, STAFF_ATTRS, UNRATED_KEYS,
  type AbilityKey, type AttrSlot, type Role, type StaffRole, type WorldPlayer, type WorldStaff,
} from "./model.ts";
import { generateHandle, generatePersonName } from "./names.ts";
import { cultureOf, type Region } from "./regions.ts";
import { clamp, normal, streamFor, weightedIndex, type Rng } from "./rng.ts";

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

const REGION_FALLBACK_COUNTRY: Record<Region, string> = { americas: "us", emea: "de", pacific: "kr", china: "cn" };

function drawCountry(rng: Rng, cal: Calibration, region: Region): string {
  const entries = Object.entries(cal.countries[region]).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return REGION_FALLBACK_COUNTRY[region];
  return entries[weightedIndex(rng, entries.map(([, n]) => n))]![0];
}

function drawAgentPool(rng: Rng, cal: Calibration, role: Role, size: number): string[] {
  const freq = Object.entries(cal.agentFreq[role]).sort(([a], [b]) => a.localeCompare(b));
  const pool: string[] = [];
  const remaining = freq.slice();
  while (pool.length < size && remaining.length > 0) {
    const i = weightedIndex(rng, remaining.map(([, n]) => n));
    pool.push(remaining[i]![0]);
    remaining.splice(i, 1);
  }
  return pool.sort();
}

export interface PlayerGenRequest {
  readonly seed: number;
  readonly id: string;
  readonly region: Region;
  readonly season: number;
  readonly calibration: Calibration;
  /** Normalised handles already taken; the new handle is added to it. */
  readonly reserved: Set<string>;
  /** Override the drawn age (e.g. for tests). */
  readonly age?: number;
  readonly role?: Role;
}

/** Peak profile for a role and a talent draw, clamped to the real per-attribute range. */
export function peakProfile(cal: Calibration, role: Role, paTarget: number, z: Readonly<Record<AbilityKey, number>>): Record<AbilityKey, number> {
  const raw = {} as Record<AbilityKey, number>;
  for (const k of ABILITY_KEYS) {
    raw[k] = cal.roleMean[role][k] + (paTarget - cal.roleCaMean[role]) + CAREER_MODEL.individualSpread * cal.roleSd[role][k] * z[k];
  }
  const mean = ABILITY_KEYS.reduce((s, k) => s + raw[k], 0) / ABILITY_KEYS.length;
  const shift = paTarget - mean;
  const out = {} as Record<AbilityKey, number>;
  for (const k of ABILITY_KEYS) out[k] = r4(clamp(raw[k] + shift, cal.min[k], cal.max[k]));
  return out;
}

export function generatePlayer(req: PlayerGenRequest): WorldPlayer {
  const m = CAREER_MODEL;
  const cal = req.calibration;
  const rng = streamFor(req.seed, `gen-player:${req.id}`);
  const country = drawCountry(rng, cal, req.region);
  const role = req.role ?? ROLES[weightedIndex(rng, ROLES.map((r) => cal.roleShare[r]))]!;
  const age = req.age ?? m.prospectMinAge + weightedIndex(rng, m.prospectAgeWeights);

  // Talent and archetype → peak.
  const paTarget = cal.caMin + (cal.caMax - cal.caMin) * Math.pow(rng(), m.paSkew);
  const z = {} as Record<AbilityKey, number>;
  for (const k of ABILITY_KEYS) z[k] = normal(rng);
  const peak = peakProfile(cal, role, paTarget, z);

  // Age curve → current values.
  const attributes: Record<string, AttrSlot> = {};
  const u0 = m.unseenUncertainty;
  for (const k of ABILITY_KEYS) {
    const mk = clamp(maturity(age, k) * (1 + m.maturityNoise * normal(rng)), 0, 1);
    attributes[k] = { value: r4(cal.min[k] + mk * (peak[k] - cal.min[k])), uncertainty: u0, nMaps: 0 };
  }
  // Tendencies / fixed traits: archetype plus individual spread, inside the real range.
  for (const k of RATED_KEYS) {
    if ((ABILITY_KEYS as readonly string[]).includes(k)) continue;
    const v = clamp(cal.roleMean[role][k] + cal.roleSd[role][k] * normal(rng), cal.min[k], cal.max[k]);
    attributes[k] = { value: r4(v), uncertainty: u0, nMaps: 0 };
  }
  for (const [k, reason] of Object.entries(UNRATED_KEYS)) attributes[k] = { value: null, reason };

  const poolSize = 1 + Math.floor(rng() * m.prospectPoolMax);
  const agentPool = drawAgentPool(rng, cal, role, poolSize);
  const name = generatePersonName(rng, cultureOf(country));
  const handle = generateHandle(rng, req.reserved);

  const ca = compositeOf((k) => (attributes[k] as { value: number }).value)!;
  const pa = compositeOf((k) => peak[k])!;
  return {
    playerId: req.id,
    handle,
    country,
    role,
    attributes,
    hasRatings: true,
    name: name.full,
    region: req.region,
    agentPool,
    origin: "generated",
    generated: true,
    age,
    ageEstimated: false,
    debutSeason: req.season,
    peak,
    ca: r4(ca),
    pa: r4(Math.max(pa, ca)),
    teamId: null,
    status: "free",
    careerMaps: 0,
  };
}

// --- Staff ---------------------------------------------------------------------------------------

export const STAFF_MODEL = {
  /** Staff quality q = lo + (hi − lo) · u^skew; each attribute = clamp(q + spread·z, attrMin, attrMax). */
  qualityLo: 0.2,
  qualityHi: 0.9,
  qualitySkew: 1.2,
  attrSpread: 0.08,
  attrMin: 0.05,
  attrMax: 0.95,
  /** Age of a staff intake hire (uniform integer range) and of the founding staff. */
  intakeAge: [24, 34] as readonly [number, number],
  foundingAge: [28, 52] as readonly [number, number],
  /** Staff keep learning until this age: x += (attrMax − x) · learnRate per season. */
  learnUntilAge: 45,
  learnRate: 0.05,
  /** And lose λ · (t + 1 − D) per season after this age. */
  declineAge: 58,
  declinePerYear: 0.004,
} as const;

export interface StaffGenRequest {
  readonly seed: number;
  readonly id: string;
  readonly region: Region;
  readonly role: StaffRole;
  readonly season: number;
  readonly calibration: Calibration;
  readonly founding?: boolean;
}

/** The single number a staff member is judged by: the mean of their role attributes. */
export function staffQuality(s: Pick<WorldStaff, "attributes" | "role">): number {
  const keys = STAFF_ATTRS[s.role];
  return keys.reduce((sum, k) => sum + (s.attributes[k] ?? 0), 0) / keys.length;
}

export function generateStaff(req: StaffGenRequest): WorldStaff {
  const sm = STAFF_MODEL;
  const rng = streamFor(req.seed, `gen-staff:${req.id}`);
  const country = drawCountry(rng, req.calibration, req.region);
  const [lo, hi] = req.founding ? sm.foundingAge : sm.intakeAge;
  const age = lo + Math.floor(rng() * (hi - lo + 1));
  const q = sm.qualityLo + (sm.qualityHi - sm.qualityLo) * Math.pow(rng(), sm.qualitySkew);
  const attributes: Record<string, number> = {};
  for (const k of STAFF_ATTRS[req.role]) attributes[k] = r4(clamp(q + sm.attrSpread * normal(rng), sm.attrMin, sm.attrMax));
  const name = generatePersonName(rng, cultureOf(country));
  return {
    staffId: req.id,
    name: name.full,
    country,
    region: req.region,
    role: req.role,
    attributes,
    origin: "generated",
    generated: true,
    age,
    debutSeason: req.season,
    teamId: null,
  };
}
