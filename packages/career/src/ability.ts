// The ability model: how an attribute relates to age, potential, playing time and coaching.
// Every constant is named here (design values — there is no data on esports player development;
// docs/GENERATED_PEOPLE.md lists each one and what it does).
import { ABILITY_KEYS, MECHANICAL_KEYS, type AbilityKey } from "./model.ts";
import { clamp } from "./rng.ts";

export const CAREER_MODEL = {
  // --- maturity curve m(t) = clamp((t − T0)/(T1 − T0), 0, 1)^γ -----------------------------------
  /** Age at which development starts (m = 0). */
  maturityStartAge: 14,
  /** Age of full maturity (m = 1): the attribute is at its peak. */
  maturityFullAge: 25,
  /** Curvature of the maturity curve (<1: most of the growth comes early). */
  maturityGamma: 0.8,
  /** Mechanical attributes mature this many years EARLIER, read-the-game attributes this many LATER. */
  mechanicalAgeShift: 1.5,

  // --- decline: loss per season = λ · (t + 1 − D)  for t + 1 > D ------------------------------------
  /** Age after which mechanical attributes decline. */
  mechanicalDeclineAge: 26,
  /** Age after which read-the-game attributes decline. */
  mentalDeclineAge: 30,
  /** Decline slope λ (attribute points per season, per year past the decline age). */
  declinePerYear: 0.006,

  // --- development: closed fraction of the gap to peak = r(t) · P · C · (1 + σ_dev·z) --------------
  /** Maps a starter plays in a season (P = 1 at this many maps). */
  fullSeasonMaps: 40,
  /** Playing-time factor P = P0 + (1 − P0) · min(1, maps / fullSeasonMaps). */
  playTimeFloor: 0.5,
  /** Maps per season by status: starter (top 5 of the roster), bench, academy, free agent. */
  mapsStarter: 40,
  mapsBench: 10,
  mapsAcademy: 20,
  mapsFree: 4,
  /** Coach factor C = C0 + Cslope · coach.development (no coach → development 0.5 → C = 1). */
  coachFactorBase: 0.75,
  coachFactorSlope: 0.5,
  /** Per-season development noise (σ of the multiplicative z term). */
  developmentNoise: 0.25,

  // --- generation ----------------------------------------------------------------------------------
  /** Age distribution of an intake prospect (weights for 16, 17, 18, 19). */
  prospectAgeWeights: [0.2, 0.3, 0.3, 0.2] as readonly number[],
  prospectMinAge: 16,
  /** PA of a prospect: caMin + (caMax − caMin) · u^PA_SKEW (u uniform) — most prospects never reach the elite. */
  paSkew: 1.6,
  /** Share of a role's real attribute spread that is individual (the rest is talent and archetype). */
  individualSpread: 0.6,
  /** Individual noise on how far along the maturity curve an attribute is (σ of a multiplicative term). */
  maturityNoise: 0.1,
  /** Rating uncertainty of a player with no maps: U = U0 · sqrt(K / (K + careerMaps)). */
  unseenUncertainty: 0.1,
  uncertaintyHalfMaps: 10,
  /** Pool size of a prospect: 1 + floor(u · 4) agents (1–4); +1 agent every few seasons of play. */
  prospectPoolMax: 4,

  // --- real players' age estimate --------------------------------------------------------------------
  /** Assumed age at a pro debut (first season in the dataset). */
  debutAge: 19,
  /** Dataset's first season: players already present then may have debuted earlier (0–3 extra years). */
  datasetFirstSeason: 2021,
} as const;

/** Maturity m ∈ [0,1] of attribute `key` at age t. */
export function maturity(t: number, key: AbilityKey): number {
  const m = CAREER_MODEL;
  const shift = (MECHANICAL_KEYS as readonly string[]).includes(key) ? m.mechanicalAgeShift : -m.mechanicalAgeShift;
  const x = clamp((t + shift - m.maturityStartAge) / (m.maturityFullAge - m.maturityStartAge), 0, 1);
  return Math.pow(x, m.maturityGamma);
}

/**
 * Fraction of the remaining gap to peak an attribute closes between age t and t+1 on the average
 * path (P = C = 1, no noise): r(t) = (m(t+1) − m(t)) / (1 − m(t)). Following r from any age
 * reproduces the maturity curve exactly.
 */
export function closingRate(t: number, key: AbilityKey): number {
  const a = maturity(t, key);
  if (a >= 1) return 0;
  return (maturity(t + 1, key) - a) / (1 - a);
}

/** Attribute points lost between age t and t+1 (0 before the decline age). */
export function declineLoss(t: number, key: AbilityKey): number {
  const m = CAREER_MODEL;
  const d = (MECHANICAL_KEYS as readonly string[]).includes(key) ? m.mechanicalDeclineAge : m.mentalDeclineAge;
  return m.declinePerYear * Math.max(0, t + 1 - d);
}

/** Playing-time factor P (1 at a full season). */
export function playTimeFactor(maps: number): number {
  const m = CAREER_MODEL;
  return m.playTimeFloor + (1 - m.playTimeFloor) * Math.min(1, Math.max(0, maps) / m.fullSeasonMaps);
}

/** Coach factor C (1 for a league-average coach, development 0.5). */
export function coachFactor(development: number): number {
  return CAREER_MODEL.coachFactorBase + CAREER_MODEL.coachFactorSlope * clamp(development, 0, 1);
}

/** Rating uncertainty after `maps` career maps for a player who entered with none. */
export function uncertaintyAfter(maps: number, floor: number): number {
  const m = CAREER_MODEL;
  return Math.max(floor, m.unseenUncertainty * Math.sqrt(m.uncertaintyHalfMaps / (m.uncertaintyHalfMaps + Math.max(0, maps))));
}

/**
 * Peak implied by a current value at age t (used for real players, whose potential is not in the
 * data): invert x = floor + m(t)·(peak − floor)  →  peak = floor + (x − floor)/m(t), clamped to the
 * real maximum. At full maturity the peak is the current value.
 */
export function impliedPeak(x: number, t: number, key: AbilityKey, floor: number, ceiling: number): number {
  const m = Math.max(maturity(t, key), 0.05);
  return clamp(floor + (x - floor) / m, x, Math.max(x, ceiling));
}

export const abilityKeys = ABILITY_KEYS;
