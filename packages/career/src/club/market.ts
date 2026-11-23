// Market formulas: ability index, wages, player value, team strength and reputation, and the
// contracts real players and staff start with. Every constant is in constants.ts.
//
// What a club "knows": the AI and the UI read a player through a scout's estimate
// (`estimateAbility`), never the true CA/PA. A player knows his own level (true CA) when he judges
// his role at a club, and a team's strength is public (results), so strength uses true CA.
import type { AbilityKey, World, WorldPlayer, WorldStaff } from "../model.ts";
import type { Region } from "../regions.ts";
import { estimateAbility, teamScout, UNRATED_ABILITY, type AbilityEstimate } from "../scouting.ts";
import { staffQuality } from "../generate.ts";
import { clamp, streamFor } from "../rng.ts";
import { CLUB_MODEL } from "./constants.ts";
import type { Contract, SquadRole } from "./types.ts";

const M = CLUB_MODEL;

export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/** v(x): a CA/PA on the real players' calibration range, 0..1. */
export function abilityScale(w: Pick<World, "calibration">, x: number): number {
  const { caMin, caMax } = w.calibration;
  return clamp((x - caMin) / Math.max(1e-6, caMax - caMin), 0, 1);
}

/** Potential weight w(t): 1 at or under potentialAgeStart, 0 from potentialAgeEnd. */
export function potentialWeight(age: number): number {
  return clamp((M.potentialAgeEnd - age) / (M.potentialAgeEnd - M.potentialAgeStart), 0, 1);
}

/** Ability index e = v(CA) + w(t) · share · (v(PA) − v(CA)). */
export function abilityIndex(w: Pick<World, "calibration">, ca: number, pa: number, age: number, share: number): number {
  const vc = abilityScale(w, ca);
  const vp = Math.max(vc, abilityScale(w, pa));
  return clamp(vc + potentialWeight(age) * share * (vp - vc), 0, 1);
}

const trueCa = (p: WorldPlayer): number => p.ca ?? UNRATED_ABILITY;
const truePa = (p: WorldPlayer): number => p.pa ?? trueCa(p);

/** Market wage W(e) for a player at a club of `region`: (floor + span · e^exp) · market. */
export function marketWageFromIndex(e: number, region: Region): number {
  return (M.wageFloor + M.wageSpan * Math.pow(clamp(e, 0, 1), M.wageExp)) * M.regionMarket[region];
}

/** Market wage as a club sees it through an ability estimate. */
export function marketWage(w: World, p: WorldPlayer, region: Region, est?: AbilityEstimate): number {
  const ca = est ? est.ca : trueCa(p);
  const pa = est ? est.pa : truePa(p);
  return roundTo(marketWageFromIndex(abilityIndex(w, ca, pa, p.age, M.wagePotentialShare), region), M.wageStep);
}

/** Staff wage = (floor + span · quality^exp) · market. */
export function staffWage(s: WorldStaff, region: Region): number {
  const q = clamp(staffQuality(s), 0, 1);
  return roundTo((M.staffWageFloor[s.role] + M.staffWageSpan[s.role] * Math.pow(q, M.staffWageExp)) * M.regionMarket[region], M.wageStep);
}

/** Contract factor K(yearsLeft). */
export function contractFactor(yearsLeft: number | null): number {
  if (yearsLeft === null) return 1;
  return clamp(M.contractValueFloor + (1 - M.contractValueFloor) * Math.max(0, yearsLeft) / M.contractFullYears, M.contractValueFloor, 1);
}

/** Age factor A(t). */
export const ageValueFactor = (age: number): number => Math.pow(1 - M.valueAgeDecay, Math.max(0, age - M.valueAgePeak));

/**
 * Player value = valueScale · e^valueExp · A(age) · K(yearsLeft), with e from the given CA/PA
 * (an estimate for a club, true values for tests). yearsLeft null = no contract (value of the
 * player, not a fee: a free agent costs no fee).
 */
export function valueFrom(w: Pick<World, "calibration">, ca: number, pa: number, age: number, yearsLeft: number | null): number {
  const e = abilityIndex(w, ca, pa, age, M.valuePotentialShare);
  return M.valueScale * Math.pow(e, M.valueExp) * ageValueFactor(age) * contractFactor(yearsLeft);
}

/** Value of a player as `viewerTeamId`'s scout sees him (rounded to the fee step). */
export function playerValue(w: World, p: WorldPlayer, viewerTeamId: string | null): number {
  const est = estimateAbility(w, teamScout(w, viewerTeamId), p);
  const c = w.club?.contracts[p.playerId];
  const yearsLeft = c ? c.endSeason - w.season : null;
  return roundTo(valueFrom(w, est.ca, est.pa, p.age, yearsLeft), M.feeStep);
}

/** Team strength S: mean true CA of the top five of the roster, on the calibration scale (0..1). */
export function teamStrength(w: World, teamId: string): number {
  const t = w.teams[teamId];
  if (!t) return 0;
  const cas = t.roster.map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p).map(trueCa).sort((a, b) => b - a).slice(0, 5);
  while (cas.length < 5) cas.push(w.calibration.caMin);
  return abilityScale(w, cas.reduce((s, v) => s + v, 0) / 5);
}

/** Reputation: percentile of a team's strength among all teams (0 weakest … 1 strongest). */
export function reputations(w: World): Record<string, number> {
  const ids = Object.keys(w.teams).sort();
  const s = ids.map((id) => ({ id, s: teamStrength(w, id) })).sort((a, b) => a.s - b.s || a.id.localeCompare(b.id));
  const out: Record<string, number> = {};
  s.forEach((x, i) => { out[x.id] = s.length > 1 ? i / (s.length - 1) : 0.5; });
  return out;
}

/** Salary a club offers: market wage · (1 + premium · (reputation − 0.5)). */
export function clubSalary(market: number, reputation: number): number {
  return roundTo(market * (1 + M.teamPayPremium * (reputation - 0.5)), M.wageStep);
}

/** Hidden ambition ∈ [ambitionMin, ambitionMax], fixed per player. */
export function ambitionOf(w: Pick<World, "seed">, playerId: string): number {
  const u = streamFor(w.seed, `ambition:${playerId}`)();
  return M.ambitionMin + (M.ambitionMax - M.ambitionMin) * u;
}

/** Index of a player in a roster ordered by true CA, as if he joined it. */
export function rankIfJoined(w: World, teamId: string, p: WorldPlayer): number {
  const t = w.teams[teamId];
  if (!t) return 99;
  const others = t.roster.filter((id) => id !== p.playerId).map((id) => w.players[id]).filter((x): x is WorldPlayer => !!x);
  return others.filter((o) => trueCa(o) > trueCa(p)).length;
}

/** The role a player expects at a club (1 starter … 0 no club). */
export function expectedRole(w: World, teamId: string | null, p: WorldPlayer, academy = false): number {
  if (!teamId) return 0;
  if (academy) return M.roleAcademy;
  return rankIfJoined(w, teamId, p) < 5 ? 1 : M.roleRotation;
}

export function squadRoleOf(w: World, teamId: string, p: WorldPlayer): SquadRole {
  if (p.status === "academy") return "academy";
  return rankIfJoined(w, teamId, p) < 5 ? "starter" : "rotation";
}

/** Years a real player's starting contract runs: 1 + floor(u·3), +1 when young, capped. */
export function startingYears(w: World, p: WorldPlayer): number {
  const u = streamFor(w.seed, `contract:${p.playerId}`)();
  let y = 1 + Math.floor(u * 3);
  if (p.age <= M.youngContractAge) y += 1;
  return Math.min(M.maxContractYears, y);
}

/** A contract for a player joining `teamId` at market terms (salary through the club's own scout). */
export function marketContract(w: World, p: WorldPlayer, teamId: string, years: number, date: string, rep: number, salary?: number): Contract {
  const team = w.teams[teamId]!;
  const role = squadRoleOf(w, teamId, p);
  const est = estimateAbility(w, teamScout(w, teamId), p);
  const pay = salary ?? (role === "academy" ? M.academyWage : clubSalary(marketWage(w, p, team.region, est), rep));
  const value = valueFrom(w, est.ca, est.pa, p.age, years - 1);
  return {
    personId: p.playerId, kind: "player", teamId, salary: pay,
    startSeason: w.season, endSeason: w.season + Math.max(1, years) - 1,
    buyout: role === "academy" ? null : Math.max(pay, roundTo(M.buyoutValueMult * value, M.feeStep)),
    squadRole: role, signedOn: date,
  };
}

export function staffContract(w: World, s: WorldStaff, teamId: string, years: number, date: string): Contract {
  const team = w.teams[teamId]!;
  return {
    personId: s.staffId, kind: "staff", teamId, salary: staffWage(s, team.region),
    startSeason: w.season, endSeason: w.season + Math.max(1, years) - 1,
    buyout: null, squadRole: "staff", staffRole: s.role, signedOn: date,
  };
}

export type { AbilityKey };
