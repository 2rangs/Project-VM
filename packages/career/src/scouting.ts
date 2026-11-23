// What a team's scout sees of a player: CA and PA estimates with error bands. The error is a
// fixed per (scout, player) misjudgement — a scout keeps the same opinion of a player until more
// matches are on record — sized by the scout's judging attributes:
//   σ_CA = σ_CA,min + σ_CA,span · (1 − judgingAbility)   · sqrt(K / (K + careerMaps))
//   σ_PA = σ_PA,min + σ_PA,span · (1 − judgingPotential)
//   estimate = true + σ · z,   z ~ N(0,1) clamped to ±2 (seeded per scout × player),   band = ± σ
// No scout → judging 0 (the widest bands). AI teams sign and pick academy prospects by these
// estimates, so a better scout signs better players.
import { CAREER_MODEL } from "./ability.ts";
import type { World, WorldPlayer, WorldStaff } from "./model.ts";
import { clamp, normal, streamFor } from "./rng.ts";

export const SCOUT_MODEL = {
  caSigmaMin: 0.01,
  caSigmaSpan: 0.08,
  paSigmaMin: 0.02,
  paSigmaSpan: 0.15,
} as const;

export interface AbilityEstimate {
  readonly ca: number;
  readonly caLo: number;
  readonly caHi: number;
  readonly pa: number;
  readonly paLo: number;
  readonly paHi: number;
}

/** League-average ability used for players the dataset could not rate. */
export const UNRATED_ABILITY = 0.6;

export function estimateAbility(world: Pick<World, "seed">, scout: WorldStaff | null | undefined, p: WorldPlayer): AbilityEstimate {
  const s = SCOUT_MODEL;
  const ja = scout?.attributes.judgingAbility ?? 0;
  const jp = scout?.attributes.judgingPotential ?? 0;
  const K = CAREER_MODEL.uncertaintyHalfMaps;
  const sigCa = (s.caSigmaMin + s.caSigmaSpan * (1 - ja)) * Math.sqrt(K / (K + p.careerMaps));
  const sigPa = s.paSigmaMin + s.paSigmaSpan * (1 - jp);
  const rng = streamFor(world.seed, `scout:${scout?.staffId ?? "none"}:${p.playerId}`);
  const zc = normal(rng, 2);
  const zp = normal(rng, 2);
  const trueCa = p.ca ?? UNRATED_ABILITY;
  const truePa = p.pa ?? trueCa;
  const ca = clamp(trueCa + sigCa * zc, 0, 1);
  const pa = clamp(Math.max(ca, truePa + sigPa * zp), 0, 1);
  return {
    ca, caLo: clamp(ca - sigCa, 0, 1), caHi: clamp(ca + sigCa, 0, 1),
    pa, paLo: clamp(Math.max(ca, pa - sigPa), 0, 1), paHi: clamp(pa + sigPa, 0, 1),
  };
}

/** The scout employed by a team (or null). */
export function teamScout(world: World, teamId: string | null | undefined): WorldStaff | null {
  if (!teamId) return null;
  const id = world.teams[teamId]?.staff.scout;
  return id ? world.staff[id] ?? null : null;
}

/** 0..1 ability → the 1–200 CA/PA display scale (FM convention): round(1 + 199·v). */
export function toScale200(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Math.round(1 + 199 * clamp(v, 0, 1));
}
