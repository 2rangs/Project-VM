// The club-operations lifecycle: start a career's club layer, and what happens each day, each
// month and at the end of a season. All functions are pure (World in, new World out).
//
//   initClub        contracts for every rostered player and employed staff member, finances, budgets
//   clubOnDay       window open/close notices, expired bids; on Mondays the training tick and (in a
//                   window) one AI market round
//   clubOnMonth     the monthly ledger (club/finance.ts) and the board's checks; the contracts-expiring
//                   notice in CLUB_MODEL.expiryNoticeMonth
//   clubSeasonEnd   loans return, prize money and fanbase, contract expiry and renewals, development
//                   with the season's training focus (advanceSeason), then contracts for whoever the
//                   season loop signed, and the new season's budgets
import type { World, WorldPlayer } from "../model.ts";
import { advanceSeason } from "../season.ts";
import { estimateAbility, teamScout } from "../scouting.ts";
import { addDays, dayOfWeek, monthKey, monthOf, seasonEndDate, seasonStartDate, windowStatus } from "./calendar.ts";
import { CLUB_MODEL } from "./constants.ts";
import { book, initFinances, monthlyFinance, seasonEndFinance, setSeasonBudgets, wageBill } from "./finance.ts";
import { clubSalary, marketContract, marketWage, reputations, staffContract, startingYears } from "./market.ts";
import { MSG, pushMessage } from "./messages.ts";
import { emptyTraining, resetTrainingSeason, seasonFocus, trainingWeek } from "./training.ts";
import { aiMarketRound, expireOffers, joinRoster, playerAnswer, preferredYears } from "./transfers.ts";
import type { ClubState, Contract } from "./types.ts";

const M = CLUB_MODEL;
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const label = (p: WorldPlayer): string => p.handle ?? p.playerId;

export interface InitClubOptions {
  /** The club the user manages (null: watch only, every club is AI). */
  readonly userTeamId: string | null;
  /** Starting date (default: the season's first day). */
  readonly date?: string;
}

/** Start the club layer on a world: contracts, finances, budgets. */
export function initClub(world: World, opts: InitClubOptions): World {
  const w = clone(world);
  const date = opts.date ?? seasonStartDate(w.season);
  const club: ClubState = {
    version: 1, date, userTeamId: opts.userTeamId, contracts: {}, finances: {}, offers: [], loans: [], transfers: [],
    shortlist: [], training: emptyTraining(), messages: [], aiBuys: {}, nextId: 1,
  };
  w.club = club;
  const rep = reputations(w);
  for (const t of Object.values(w.teams).sort((a, b) => a.teamId.localeCompare(b.teamId))) {
    for (const id of [...t.roster, ...t.academy]) {
      const p = w.players[id];
      if (!p) continue;
      const years = p.status === "academy" ? Math.max(1, Math.min(3, 22 - p.age)) : startingYears(w, p);
      club.contracts[id] = { ...marketContract(w, p, t.teamId, years, date, rep[t.teamId] ?? 0.5), startSeason: w.season };
    }
    for (const sid of Object.values(t.staff)) {
      const s = sid ? w.staff[sid] : undefined;
      if (s) club.contracts[s.staffId] = staffContract(w, s, t.teamId, 1 + (Number.parseInt(s.staffId.slice(-2), 36) % 3), date);
    }
  }
  initFinances(w, date);
  return w;
}

/**
 * Make contracts match the squads: drop contracts of retired players and of players the season
 * loop released (severance booked), give a market contract to anyone rostered without one (season
 * loop signings, academy promotions), and keep staff contracts in step with the staff posts.
 */
export function reconcileContracts(w: World, date: string): void {
  const club = w.club!;
  const rep = reputations(w);
  const loaned = new Map(club.loans.map((l) => [l.playerId, l]));
  for (const c of Object.values(club.contracts)) {
    if (c.kind === "staff") {
      const s = w.staff[c.personId];
      if (!s || s.teamId !== c.teamId) delete club.contracts[c.personId];
      continue;
    }
    const p = w.players[c.personId];
    if (!p) { delete club.contracts[c.personId]; continue; }
    const loan = loaned.get(c.personId);
    const where = loan ? loan.fromTeamId : c.teamId;
    if (loan ? p.teamId !== loan.toTeamId : p.teamId !== where) {
      if (club.finances[c.teamId]) book(club, c.teamId, date, "severance", -M.severanceShare * c.salary * Math.max(0, c.endSeason - w.season + 1), label(p));
      club.transfers.push({ date, season: w.season, playerId: p.playerId, fromTeamId: c.teamId, toTeamId: null, fee: 0, kind: "release" });
      delete club.contracts[c.personId];
      club.loans = club.loans.filter((l) => l.playerId !== c.personId);
    }
  }
  for (const t of Object.values(w.teams).sort((a, b) => a.teamId.localeCompare(b.teamId))) {
    for (const id of [...t.roster, ...t.academy]) {
      const p = w.players[id];
      if (!p) continue;
      const c = club.contracts[id];
      if (c && !(c.squadRole === "academy" && p.status === "rostered")) continue;
      if (loaned.has(id)) continue;
      const years = p.status === "academy" ? Math.max(1, Math.min(3, 22 - p.age)) : Math.round(preferredYears(p.age));
      club.contracts[id] = marketContract(w, p, t.teamId, years, date, rep[t.teamId] ?? 0.5);
    }
    for (const sid of Object.values(t.staff)) {
      const s = sid ? w.staff[sid] : undefined;
      if (s && !club.contracts[s.staffId]) club.contracts[s.staffId] = staffContract(w, s, t.teamId, 2, date);
    }
  }
}

/** A day passes. `date` is the new current date (YYYY-MM-DD). */
export function clubOnDayMut(w: World, date: string): void {
  const club = w.club;
  if (!club) return;
  const prev = club.date;
  club.date = date;
  const win = windowStatus(date);
  const was = windowStatus(prev);
  if (win.open && (!was.open || was.key !== win.key)) pushMessage(club, date, MSG.windowOpen(win.to));
  if (!win.open && was.open) pushMessage(club, date, MSG.windowClosed());
  expireOffers(w, date);
  if (dayOfWeek(date) === 1) {
    trainingWeek(w, date);
    if (win.open) aiMarketRound(w, date);
  }
}

export function clubOnDay(world: World, date: string): World {
  if (!world.club) return world;
  // Only Mondays (training, AI market) touch players and squads; other days change the club state only.
  const w = dayOfWeek(date) === 1 ? clone(world) : { ...world, club: clone(world.club) };
  clubOnDayMut(w, date);
  return w;
}

/** The first of a month. Books the month once (a second call for the same month does nothing). */
export function clubOnMonthMut(w: World, date: string): void {
  const club = w.club;
  if (!club) return;
  const uf = club.userTeamId ? club.finances[club.userTeamId] : undefined;
  const anyTeam = club.finances[Object.keys(club.finances).sort()[0] ?? ""];
  if (anyTeam?.monthly.some((m) => m.month === monthKey(date))) return;
  monthlyFinance(w, date);
  if (monthOf(date) === M.expiryNoticeMonth && club.userTeamId && uf) {
    const ending = Object.values(club.contracts).filter((c) => c.kind === "player" && c.teamId === club.userTeamId && c.endSeason <= w.season);
    if (ending.length) pushMessage(club, date, MSG.expiring(ending.map((c) => label(w.players[c.personId]!)).filter(Boolean)));
  }
}

export function clubOnMonth(world: World, date: string): World {
  if (!world.club) return world;
  const w = { ...world, club: clone(world.club) }; // the month books money and messages only
  clubOnMonthMut(w, date);
  return w;
}

export interface SeasonEndContext {
  /** teamId → place within its region (1 = first), from the season loop. Absent: strength order + noise. */
  readonly standings?: Record<string, number>;
  /** The date the season ends (default CLUB_MODEL.seasonEnd of the season). */
  readonly date?: string;
}

/**
 * Before the season loop advances: loans return, prize money and fanbase, expiring contracts
 * renewed or let go. Mutates `w`.
 */
export function clubBeforeSeasonEndMut(w: World, ctx: SeasonEndContext = {}): void {
  const club = w.club;
  if (!club) return;
  const date = ctx.date ?? seasonEndDate(w.season);
  club.date = date;
  // Loans return to the parent club.
  for (const l of club.loans.filter((x) => x.endSeason <= w.season)) {
    const p = w.players[l.playerId];
    if (p && w.teams[l.fromTeamId]) joinRoster(w, p, l.fromTeamId);
  }
  club.loans = club.loans.filter((x) => x.endSeason > w.season);
  seasonEndFinance(w, date, ctx.standings);
  // Expiring contracts.
  const rep = reputations(w);
  const left: string[] = [];
  for (const c of Object.values(club.contracts).sort((a, b) => a.personId.localeCompare(b.personId))) {
    if (c.endSeason > w.season) continue;
    if (c.kind === "staff") {
      const s = w.staff[c.personId];
      if (s) Object.assign(c, staffContract(w, s, c.teamId, 2, date), { startSeason: w.season + 1, endSeason: w.season + 2 });
      continue;
    }
    const p = w.players[c.personId];
    if (!p) { delete club.contracts[c.personId]; continue; }
    if (c.squadRole === "academy" || p.status === "academy") { c.endSeason = w.season + 1; continue; }
    if (c.teamId !== club.userTeamId && renewAi(w, p, c, rep[c.teamId] ?? 0.5)) continue;
    if (c.teamId === club.userTeamId) left.push(label(p));
    const t = w.teams[c.teamId];
    if (t) { t.roster = t.roster.filter((id) => id !== p.playerId); t.academy = t.academy.filter((id) => id !== p.playerId); }
    p.teamId = null;
    p.status = "free";
    club.transfers.push({ date, season: w.season, playerId: p.playerId, fromTeamId: c.teamId, toTeamId: null, fee: 0, kind: "expiry" });
    delete club.contracts[c.personId];
  }
  if (left.length) pushMessage(club, date, MSG.expired(left));
}

/** An AI club re-signs an expiring player it rates in its top aiRenewTop, under aiRenewMaxAge, within its wage budget. */
function renewAi(w: World, p: WorldPlayer, c: Contract, rep: number): boolean {
  const club = w.club!;
  const t = w.teams[c.teamId];
  if (!t || p.age >= M.aiRenewMaxAge) return false;
  const scout = teamScout(w, c.teamId);
  const ranked = t.roster.slice().sort((a, b) => estimateAbility(w, scout, w.players[b]!).ca - estimateAbility(w, scout, w.players[a]!).ca || a.localeCompare(b));
  if (ranked.indexOf(p.playerId) < 0 || ranked.indexOf(p.playerId) >= M.aiRenewTop) return false;
  const wage = clubSalary(marketWage(w, p, t.region, estimateAbility(w, scout, p)), rep);
  const terms = { fee: 0, wage, years: Math.round(preferredYears(p.age)) };
  let a = playerAnswer(w, { kind: "renewal", playerId: p.playerId, toTeamId: c.teamId, terms });
  const f = club.finances[c.teamId]!;
  const room = f.wageBudget * (1 + M.wageTolerance) - (wageBill(w, c.teamId).total - c.salary);
  if (a.decision === "counter" && a.counter && a.counter.wage <= room) { terms.wage = a.counter.wage; a = playerAnswer(w, { kind: "renewal", playerId: p.playerId, toTeamId: c.teamId, terms }); }
  if (a.decision !== "accept" || terms.wage > room) return false;
  c.salary = terms.wage;
  c.endSeason = w.season + terms.years;
  c.startSeason = w.season + 1;
  club.transfers.push({ date: club.date, season: w.season, playerId: p.playerId, fromTeamId: c.teamId, toTeamId: c.teamId, fee: 0, kind: "renewal" });
  return true;
}

/** After the season loop advanced: contracts for its signings, training reset, the new budgets. Mutates `w`. */
export function clubAfterSeasonAdvanceMut(w: World): void {
  const club = w.club;
  if (!club) return;
  const date = seasonStartDate(w.season);
  club.date = date;
  resetTrainingSeason(club.training);
  reconcileContracts(w, date);
  for (const k of Object.keys(club.aiBuys)) if (Number(k.slice(0, 4)) < w.season) delete club.aiBuys[k];
  setSeasonBudgets(w, date);
}

/**
 * The whole season end in one call: before → advanceSeason (with the season's training focus) →
 * after. A shell that runs advanceSeason itself calls clubBeforeSeasonEnd, then
 * advanceSeason(world, { focus: seasonFocus(world) }), then clubAfterSeasonAdvance.
 */
export function clubSeasonEnd(world: World, ctx: SeasonEndContext = {}): World {
  if (!world.club) return advanceSeason(world);
  const w = clone(world);
  clubBeforeSeasonEndMut(w, ctx);
  const next = advanceSeason(w, { focus: seasonFocus(w) });
  clubAfterSeasonAdvanceMut(next);
  return next;
}

export function clubBeforeSeasonEnd(world: World, ctx: SeasonEndContext = {}): World {
  const w = clone(world);
  clubBeforeSeasonEndMut(w, ctx);
  return w;
}

export function clubAfterSeasonAdvance(world: World): World {
  const w = clone(world);
  clubAfterSeasonAdvanceMut(w);
  return w;
}

/** Advance the club date by days (the local driver's day step: onDay, and onMonth on the 1st). */
export function nextDay(date: string): string { return addDays(date, 1); }
