// Club finance: income (league stipend, sponsorship, prize money), costs (player and staff wages,
// operations, reinvestment, transfer fees, severance), the monthly ledger, season budgets and the
// board's checks. Formulas in docs/CLUB_OPERATIONS.md §3; constants in constants.ts.
import type { World } from "../model.ts";
import { REGIONS } from "../regions.ts";
import { normal, streamFor } from "../rng.ts";
import { monthKey } from "./calendar.ts";
import { CLUB_MODEL } from "./constants.ts";
import { reputations, roundTo, teamStrength } from "./market.ts";
import { MSG, pushMessage } from "./messages.ts";
import type { ClubState, LedgerKind, TeamFinance } from "./types.ts";

const M = CLUB_MODEL;

export function emptyFinance(): TeamFinance {
  return { balance: 0, fanbase: 0.5, sponsorship: 0, expectedIncome: 0, wageBudget: 0, transferBudget: 0, lastResult: 0.5, ledger: [], monthly: [], season: {}, lastWarning: null };
}

/** Book an amount (+ income / − cost) to a team: balance, season totals, and the ledger for the user's club. */
export function book(club: ClubState, teamId: string, date: string, kind: LedgerKind, amount: number, note?: string): void {
  const f = club.finances[teamId];
  if (!f || amount === 0) return;
  const a = Math.round(amount);
  f.balance += a;
  f.season[kind] = (f.season[kind] ?? 0) + a;
  if (teamId === club.userTeamId) {
    f.ledger.push({ date, kind, amount: a, ...(note ? { note } : {}) });
    if (f.ledger.length > M.maxLedger) f.ledger.splice(0, f.ledger.length - M.maxLedger);
  }
}

/** Annual player wages a team pays (loans split by wage share), and staff wages. */
export function wageBill(w: World, teamId: string): { players: number; staff: number; total: number } {
  const club = w.club!;
  let players = 0;
  let staff = 0;
  const loanOf = new Map(club.loans.map((l) => [l.playerId, l]));
  for (const c of Object.values(club.contracts)) {
    if (c.kind === "staff") { if (c.teamId === teamId) staff += c.salary; continue; }
    const loan = loanOf.get(c.personId);
    if (loan) {
      if (loan.toTeamId === teamId) players += c.salary * loan.wageShare;
      if (loan.fromTeamId === teamId) players += c.salary * (1 - loan.wageShare);
    } else if (c.teamId === teamId) players += c.salary;
  }
  return { players, staff, total: players + staff };
}

/** Operations cost per year: opsFixed + opsIncomeShare · expected income. */
export const operationsCost = (f: TeamFinance): number => M.opsFixed + M.opsIncomeShare * f.expectedIncome;

/** Annual costs the board plans with: wages + operations. */
export function annualCosts(w: World, teamId: string): number {
  return wageBill(w, teamId).total + operationsCost(w.club!.finances[teamId]!);
}

/** Prize money for a regional placement p (1 = first). */
export const prizeFor = (place: number): number => M.prizeTop * Math.pow(M.prizeDecay, Math.max(0, place - 1));

/** Result score r = 1 − (p − 1)/(n − 1). */
export const resultScore = (place: number, n: number): number => (n > 1 ? 1 - (place - 1) / (n - 1) : 0.5);

/** Teams of each region ordered by strength (strongest first); with `noiseSeason`, plus seeded noise. */
export function regionOrder(w: World, noiseSeason?: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of REGIONS) {
    const ids = Object.values(w.teams).filter((t) => t.region === r).map((t) => t.teamId).sort();
    const score = new Map(ids.map((id) => [id, teamStrength(w, id) + (noiseSeason === undefined ? 0 : M.placementNoise * normal(streamFor(w.seed, `placement:${noiseSeason}:${id}`)))]));
    out[r] = ids.sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b));
  }
  return out;
}

/** teamId → { place, n } in its region. */
export function placements(order: Record<string, string[]>): Record<string, { place: number; n: number }> {
  const out: Record<string, { place: number; n: number }> = {};
  for (const ids of Object.values(order)) ids.forEach((id, i) => { out[id] = { place: i + 1, n: ids.length }; });
  return out;
}

/** Sponsorship S for a season. */
export function sponsorshipFor(w: World, teamId: string, f: TeamFinance): number {
  const region = w.teams[teamId]!.region;
  return roundTo(M.sponsorBase * M.regionMarket[region] * (M.sponsorFloor + (1 - M.sponsorFloor) * f.fanbase) * (1 + M.sponsorResultSlope * (f.lastResult - 0.5)), M.feeStep);
}

/**
 * Season budget (season start): sponsorship, expected income (stipend + sponsorship + the prize of
 * the expected placement), wage budget = wageShare · expected income, transfer budget =
 * transferShare · max(0, balance − transferReserveYears · annual costs).
 */
export function setSeasonBudgets(w: World, date: string, notify = true): void {
  const club = w.club!;
  const expected = placements(regionOrder(w));
  for (const id of Object.keys(w.teams).sort()) {
    const f = club.finances[id]!;
    f.sponsorship = sponsorshipFor(w, id, f);
    f.expectedIncome = M.leagueStipend + f.sponsorship + prizeFor(expected[id]?.place ?? 99);
    f.wageBudget = roundTo(M.wageShare * f.expectedIncome, M.wageStep);
    f.transferBudget = roundTo(M.transferShare * Math.max(0, f.balance - M.transferReserveYears * annualCosts(w, id)), M.feeStep);
    f.season = {};
    if (notify && id === club.userTeamId) pushMessage(club, date, MSG.budget(w.season, f.wageBudget, f.transferBudget, f.sponsorship));
  }
}

/** Create every team's finances at the start of a career (fanbase from reputation, a reserve of initialReserveYears). */
export function initFinances(w: World, date: string): void {
  const club = w.club!;
  const rep = reputations(w);
  for (const id of Object.keys(w.teams).sort()) {
    const f = emptyFinance();
    f.fanbase = M.fanBase0 + M.fanRepSlope * (rep[id] ?? 0.5);
    f.lastResult = rep[id] ?? 0.5;
    club.finances[id] = f;
  }
  setSeasonBudgets(w, date, false);
  for (const id of Object.keys(w.teams).sort()) {
    const f = club.finances[id]!;
    f.balance = roundTo(M.initialReserveYears * annualCosts(w, id), M.feeStep);
    f.transferBudget = roundTo(M.transferShare * Math.max(0, f.balance - M.transferReserveYears * annualCosts(w, id)), M.feeStep);
  }
  const uf = club.userTeamId ? club.finances[club.userTeamId] : undefined;
  if (uf) pushMessage(club, date, MSG.budget(w.season, uf.wageBudget, uf.transferBudget, uf.sponsorship));
}

/**
 * The first of each month: a twelfth of every annual flow, then reinvestment of cash above the
 * reserve target, owner support below the debt limit, and the board's checks for the user's club.
 */
export function monthlyFinance(w: World, date: string): void {
  const club = w.club!;
  for (const id of Object.keys(w.teams).sort()) {
    const f = club.finances[id]!;
    const before = f.balance;
    const bill = wageBill(w, id);
    book(club, id, date, "stipend", M.leagueStipend / 12);
    book(club, id, date, "sponsorship", f.sponsorship / 12);
    book(club, id, date, "wages", -bill.players / 12);
    book(club, id, date, "staffWages", -bill.staff / 12);
    book(club, id, date, "operations", -operationsCost(f) / 12);
    const target = M.reserveYears * (bill.total + operationsCost(f));
    if (f.balance > target) book(club, id, date, "reinvestment", -(M.reinvestShare * (f.balance - target)) / 12);
    const limit = -M.debtLimitShare * f.expectedIncome;
    let support = 0;
    if (f.balance < limit) {
      const gap = -f.balance;
      support = gap;
      book(club, id, date, "ownerSupport", gap);
      if (id === club.userTeamId) pushMessage(club, date, MSG.ownerSupport(gap));
    }
    const delta = f.balance - before;
    const income = M.leagueStipend / 12 + f.sponsorship / 12 + support;
    f.monthly.push({ month: monthKey(date), income: Math.round(income), costs: Math.round(income - delta), balance: f.balance });
    if (f.monthly.length > M.maxMonthly) f.monthly.splice(0, f.monthly.length - M.maxMonthly);
    if (id === club.userTeamId && f.lastWarning !== monthKey(date)) {
      if (bill.total > f.wageBudget * (1 + M.wageTolerance)) { pushMessage(club, date, MSG.wageWarning(bill.total, f.wageBudget)); f.lastWarning = monthKey(date); }
      else if (f.balance < 0) { pushMessage(club, date, MSG.negative(f.balance)); f.lastWarning = monthKey(date); }
    }
  }
}

/**
 * Season end: prize money by regional placement (from the season loop's standings when given,
 * else the strength order with placementNoise), fanbase f' = f + fanRate · (r − f).
 * `standings`: teamId → place within its region (1 = first).
 */
export function seasonEndFinance(w: World, date: string, standings?: Record<string, number>): Record<string, { place: number; n: number }> {
  const club = w.club!;
  let places: Record<string, { place: number; n: number }>;
  if (standings && Object.keys(standings).length) {
    const order = regionOrder(w);
    const regionSize = Object.fromEntries(Object.values(order).flatMap((ids) => ids.map((id) => [id, ids.length])));
    places = {};
    for (const id of Object.keys(w.teams)) places[id] = { place: standings[id] ?? regionSize[id]!, n: regionSize[id]! };
  } else {
    places = placements(regionOrder(w, w.season));
  }
  for (const id of Object.keys(w.teams).sort()) {
    const f = club.finances[id]!;
    const { place, n } = places[id]!;
    const prize = prizeFor(place);
    book(club, id, date, "prize", prize, `#${place}`);
    if (id === club.userTeamId) pushMessage(club, date, MSG.prize(place, prize));
    f.lastResult = resultScore(place, n);
    f.fanbase = Math.min(1, Math.max(0, f.fanbase + M.fanRate * (f.lastResult - f.fanbase)));
  }
  return places;
}
