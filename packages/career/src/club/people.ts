// The people side of the club: agents, bonuses, morale and playing time (docs/CLUB_OPERATIONS.md §9–10).
// Every formula's constants are in constants.ts (DEPTH_MODEL).
//
//   agent           hardness h ∈ [0,1] seeded per player; fee = (min + span·h) · wage · years (buyer pays);
//                   the player needs U ≥ acceptMargin + agentMarginSpan · h
//   effective wage  W_eff = wage + bonusValue · (signing/years + loyalty/years + perWin · E[wins] + perTitle · P(title))
//   morale          weekly m ← m + rate · (T − m); after a series the five who played ± moraleSeries
//   playing time    maps played this season / the club's maps this season
import type { World, WorldPlayer } from "../model.ts";
import { clamp, streamFor } from "../rng.ts";
import { daysBetween } from "./calendar.ts";
import { CLUB_MODEL, DEPTH_MODEL } from "./constants.ts";
import { book } from "./finance.ts";
import { marketWage, teamStrength, roundTo } from "./market.ts";
import type { ClubState, Contract, OfferTerms } from "./types.ts";

const D = DEPTH_MODEL;
const M = CLUB_MODEL;
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const label = (p: WorldPlayer | undefined, id: string): string => p?.handle ?? id;

// --- agents ---------------------------------------------------------------------------------------

export interface Agent { readonly hardness: number; readonly feeShare: number }

export function agentOf(w: Pick<World, "seed">, playerId: string): Agent {
  const h = streamFor(w.seed, `agent:${playerId}`)();
  return { hardness: h, feeShare: D.agentFeeMin + D.agentFeeSpan * h };
}

/** Agent fee for a signing: feeShare · wage · years. */
export const agentFee = (w: Pick<World, "seed">, playerId: string, terms: OfferTerms): number =>
  roundTo(agentOf(w, playerId).feeShare * terms.wage * Math.max(1, terms.years), M.wageStep);

/** The utility a player (his agent) needs to agree. */
export const requiredMargin = (w: Pick<World, "seed">, playerId: string): number => M.acceptMargin + D.agentMarginSpan * agentOf(w, playerId).hardness;

// --- bonuses --------------------------------------------------------------------------------------

/** Expected series wins per season and title chance at a club of strength S. */
export function bonusOdds(S: number): { wins: number; title: number } {
  return { wins: D.seriesPerSeason * sigmoid(D.winSlope * (S - 0.5)), title: sigmoid(D.titleSlope * (S - D.titleCentre)) };
}

/** W_eff: salary plus the bonuses, valued at bonusValue. */
export function effectiveWage(w: World, toTeamId: string, terms: OfferTerms): number {
  const years = Math.max(1, terms.years);
  const odds = bonusOdds(teamStrength(w, toTeamId));
  const bonus = (terms.signingBonus ?? 0) / years + (terms.loyaltyBonus ?? 0) / years + (terms.winBonus ?? 0) * odds.wins + (terms.titleBonus ?? 0) * odds.title;
  return terms.wage + D.bonusValue * bonus;
}

/** Release clause term: + wClause · ambition · clamp((default − clause)/default, −1, 1). */
export function clauseTerm(ambition: number, clause: number | undefined, defaultClause: number): number {
  if (clause === undefined || defaultClause <= 0) return 0;
  return D.wClause * ambition * clamp((defaultClause - clause) / defaultClause, -1, 1);
}

// --- free-agent market timing --------------------------------------------------------------------

/** max(faFloor, 1 − faDecayPerMonth · months unsigned): a free agent's expectations fall with time. */
export function freeAgentTimeFactor(club: ClubState, playerId: string, date: string): number {
  const since = club.freeSince?.[playerId];
  if (!since) return 1;
  const months = Math.max(0, daysBetween(since, date)) / 30;
  return Math.max(D.faFloor, 1 - D.faDecayPerMonth * months);
}

export function markFree(club: ClubState, playerId: string, date: string): void {
  (club.freeSince ??= {})[playerId] = date;
}

// --- morale and playing time ------------------------------------------------------------------------

export const moraleOf = (club: ClubState | undefined, playerId: string): number => club?.morale?.[playerId] ?? 0.5;

/** Share of the club's maps this season the player played (null before the club has played). */
export function playShare(club: ClubState, playerId: string, teamId: string): number | null {
  const team = club.playTime?.teams[teamId] ?? 0;
  if (team <= 0) return null;
  return Math.min(1, (club.playTime?.players[playerId] ?? 0) / team);
}

/** Playing time against what the role promised (0 before the club has played). */
export function playTimeGap(club: ClubState, c: Contract | undefined, playerId: string, teamId: string): number {
  const share = playShare(club, playerId, teamId);
  if (share === null) return 0;
  return share - (D.expectedShare[c?.squadRole ?? "rotation"] ?? 0.3);
}

/** Recent result share r5 (0.5 with no results). */
export function recentShare(club: ClubState, teamId: string): number {
  const r = club.recent?.[teamId] ?? [];
  return r.length ? r.reduce((s, v) => s + v, 0) / r.length : 0.5;
}

function coachMotivation(w: World, teamId: string): number {
  const id = w.teams[teamId]?.staff.headCoach;
  return id ? w.staff[id]?.attributes.motivation ?? 0.5 : 0.5;
}

/** The morale a player drifts toward (T). */
export function moraleTarget(w: World, p: WorldPlayer): number {
  const club = w.club!;
  const teamId = p.teamId;
  if (!teamId) return 0.5;
  const c = club.contracts[p.playerId];
  const market = marketWage(w, p, w.teams[teamId]!.region);
  const pay = c && c.kind === "player" && market > 0 ? clamp(Math.log(c.salary / market), -0.5, 0.5) : 0;
  return clamp(0.5 + D.wResults * (recentShare(club, teamId) - 0.5) + D.wTime * playTimeGap(club, c, p.playerId, teamId) + D.wPay * pay + D.wCoach * (coachMotivation(w, teamId) - 0.5), 0, 1);
}

/** Weekly morale step for the manager's squad (other clubs stay neutral). */
export function moraleWeek(w: World): void {
  const club = w.club!;
  const uid = club.userTeamId;
  if (!uid || !w.teams[uid]) return;
  const morale = (club.morale ??= {});
  for (const id of [...w.teams[uid]!.roster, ...w.teams[uid]!.academy]) {
    const p = w.players[id];
    if (!p) continue;
    const m = moraleOf(club, id);
    morale[id] = Math.round((m + D.moraleRate * (moraleTarget(w, p) - m)) * 10000) / 10000;
  }
}

export interface SeriesResult {
  readonly date: string;
  readonly home: string;
  readonly away: string;
  readonly winner: string;
  readonly maps: number;
  readonly lineups: { readonly home: readonly string[]; readonly away: readonly string[] };
}

/**
 * After a series: playing time for both clubs, recent results, win bonuses for the manager's five,
 * and the morale swing for the five who played (manager's club only).
 */
export function clubSeriesResultMut(w: World, r: SeriesResult): void {
  const club = w.club;
  if (!club) return;
  const pt = (club.playTime ??= { players: {}, teams: {} });
  const recent = (club.recent ??= {});
  for (const side of ["home", "away"] as const) {
    const teamId = r[side];
    pt.teams[teamId] = (pt.teams[teamId] ?? 0) + r.maps;
    for (const id of r.lineups[side]) pt.players[id] = (pt.players[id] ?? 0) + r.maps;
    const list = (recent[teamId] ??= []);
    list.push(r.winner === teamId ? 1 : 0);
    if (list.length > D.recentSeries) list.splice(0, list.length - D.recentSeries);
    if (teamId !== club.userTeamId) continue;
    const won = r.winner === teamId;
    const morale = (club.morale ??= {});
    for (const id of r.lineups[side]) {
      morale[id] = clamp(Math.round((moraleOf(club, id) + (won ? D.moraleSeries : -D.moraleSeries)) * 10000) / 10000, 0, 1);
      const bonus = club.contracts[id]?.bonuses?.perWin ?? 0;
      if (won && bonus > 0) book(club, teamId, r.date, "bonus", -bonus, `${label(w.players[id], id)} win`);
    }
  }
}

/** Season end: title bonuses for the regional winner's players, then playing time resets. */
export function seasonBonusesMut(w: World, date: string, places: Record<string, { place: number }>): void {
  const club = w.club;
  if (!club) return;
  for (const c of Object.values(club.contracts)) {
    if (c.kind !== "player" || !c.bonuses?.perTitle) continue;
    if (places[c.teamId]?.place === 1) book(club, c.teamId, date, "bonus", -c.bonuses.perTitle, `${label(w.players[c.personId], c.personId)} title`);
  }
}

/** Loyalty bonus when a contract runs to its end with the player still at the club. */
export function payLoyalty(w: World, c: Contract, date: string): void {
  const amount = c.bonuses?.loyalty ?? 0;
  if (amount > 0 && w.club) book(w.club, c.teamId, date, "bonus", -amount, `${label(w.players[c.personId], c.personId)} loyalty`);
}

export function resetPlayTime(club: ClubState): void {
  club.playTime = { players: {}, teams: {} };
}
