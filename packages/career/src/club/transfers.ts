// Transfers, loans, free agency and renewals: offers, the selling club's and the player's answers
// (both from stated utilities), counter-offers, completion, releases, and the AI market that
// moves players between AI clubs. docs/CLUB_OPERATIONS.md §4.
//
//   Selling club:  asking = V_seller · (1 + starterPremium·[starter] + shortPremium·[would drop below five])
//                  fee ≥ buyout → must accept;  fee ≥ asking → accept;
//                  fee ≥ counterShare · asking → counter at asking;  else reject.
//   Player:        U = wWage·ln(wage/ref) + wAmbition·ambition·(S_to − S_from) + wRole·(R_to − R_from) + wLength·L
//                  U ≥ 0 → accept;  else counter with the wage that makes U = acceptMargin when that is
//                  within maxCounterRaise × the offer;  else reject.
import type { World, WorldPlayer } from "../model.ts";
import { SEASON_MODEL } from "../season.ts";
import { estimateAbility, teamScout } from "../scouting.ts";
import { addDays, windowStatus } from "./calendar.ts";
import { CLUB_MODEL } from "./constants.ts";
import { book, wageBill } from "./finance.ts";
import {
  ambitionOf, clubSalary, expectedRole, marketWage, playerValue, reputations, roundTo, squadRoleOf, teamStrength, valueFrom,
} from "./market.ts";
import { MSG, pushMessage } from "./messages.ts";
import {
  agentFee, clauseTerm, effectiveWage, freeAgentTimeFactor, markFree, moraleOf, playTimeGap, requiredMargin,
} from "./people.ts";
import { abilityScale } from "./market.ts";
import { DEPTH_MODEL } from "./constants.ts";
import type { ClubState, Contract, OfferKind, OfferTerms, PlayerUtility, Text, TransferOffer } from "./types.ts";
import { estimateForTeam } from "../knowledge.ts";

const M = CLUB_MODEL;
const T = (ko: string, en: string): Text => ({ ko, en });
const clone = <V>(v: V): V => JSON.parse(JSON.stringify(v)) as V;
const label = (p: WorldPlayer): string => p.handle ?? p.playerId;

// --- squad moves ----------------------------------------------------------------------------------

const byTrueCa = (w: World) => (a: string, b: string): number => (w.players[b]?.ca ?? 0.6) - (w.players[a]?.ca ?? 0.6) || a.localeCompare(b);

/** Take a player off his club's roster/academy. */
export function detach(w: World, p: WorldPlayer): void {
  const t = p.teamId ? w.teams[p.teamId] : undefined;
  if (t) {
    t.roster = t.roster.filter((id) => id !== p.playerId);
    t.academy = t.academy.filter((id) => id !== p.playerId);
  }
  p.teamId = null;
  p.status = "free";
}

/** Put a player on a club's main roster (re-sorted strongest first, as the season loop does). */
export function joinRoster(w: World, p: WorldPlayer, teamId: string): void {
  detach(w, p);
  const t = w.teams[teamId]!;
  p.teamId = teamId;
  p.status = "rostered";
  t.roster = [...t.roster, p.playerId].sort(byTrueCa(w));
}

// --- the two answers ------------------------------------------------------------------------------

export interface ClubAnswer { decision: "accept" | "counter" | "reject"; asking: number; counter?: OfferTerms; reason: Text }

/** The selling club's asking price for a player (its own scout's value). */
export function askingPrice(w: World, p: WorldPlayer): number {
  const seller = p.teamId!;
  const t = w.teams[seller]!;
  const value = playerValue(w, p, seller);
  const idx = t.roster.indexOf(p.playerId);
  const starter = idx >= 0 && idx < SEASON_MODEL.starters ? 1 : 0;
  const short = t.roster.length - (idx >= 0 ? 1 : 0) < SEASON_MODEL.starters ? 1 : 0;
  return roundTo(value * (1 + M.starterPremium * starter + M.shortPremium * short), M.feeStep);
}

export function clubAnswer(w: World, offer: Pick<TransferOffer, "kind" | "playerId" | "terms">): ClubAnswer {
  const p = w.players[offer.playerId]!;
  const seller = p.teamId!;
  const contract = w.club!.contracts[p.playerId];
  if (offer.kind === "loan") {
    const t = w.teams[seller]!;
    const idx = t.roster.indexOf(p.playerId);
    const starter = idx >= 0 && idx < SEASON_MODEL.starters;
    const share = offer.terms.wageShare ?? 0;
    if (starter) return { decision: "reject", asking: 0, reason: T("주전 선수는 임대하지 않습니다.", "We do not loan out a starter.") };
    if (share < M.loanMinWageShare) {
      return { decision: "counter", asking: 0, counter: { ...offer.terms, wageShare: M.loanMinWageShare }, reason: T(`연봉의 ${Math.round(M.loanMinWageShare * 100)}% 이상을 부담해야 합니다.`, `You must pay at least ${Math.round(M.loanMinWageShare * 100)}% of the wage.`) };
    }
    return { decision: "accept", asking: 0, reason: T("출전 시간이 필요한 선수라 임대에 동의합니다.", "He needs games; the loan is agreed.") };
  }
  const asking = askingPrice(w, p);
  // Sell-on: the seller counts a share of the next fee, at sellOnExpectation of its value of the player.
  const sellOn = Math.min(DEPTH_MODEL.maxSellOn, Math.max(0, offer.terms.sellOn ?? 0));
  const fee = offer.terms.fee + sellOn * DEPTH_MODEL.sellOnExpectation * playerValue(w, p, seller);
  if (contract?.buyout != null && offer.terms.fee >= contract.buyout) return { decision: "accept", asking, reason: T("바이아웃 금액을 충족해 거절할 수 없습니다.", "The bid meets the release clause.") };
  if (fee >= asking) return { decision: "accept", asking, reason: T("제시액이 구단의 평가액 이상입니다.", "The bid meets the club's valuation.") };
  if (fee >= M.counterShare * asking) return { decision: "counter", asking, counter: { ...offer.terms, fee: Math.max(offer.terms.fee, roundTo(asking - (fee - offer.terms.fee), M.feeStep)) }, reason: T(`구단은 ${asking.toLocaleString()}달러를 원합니다.`, `The club wants $${asking.toLocaleString()}.`) };
  return { decision: "reject", asking, reason: T("제시액이 구단 평가액에 한참 못 미칩니다.", "The bid is far below the club's valuation.") };
}

/** Preferred contract length L*(age) = clamp(1 + (age − 20)/4, 1, 3). */
export const preferredYears = (age: number): number => Math.min(3, Math.max(1, 1 + (age - 20) / 4));

/**
 * The player's utility of an offer (see the header), with the depth terms (DEPTH_MODEL):
 *   the wage term reads W_eff (salary + valued bonuses); a free agent's reference falls with time unsigned;
 *   release clause: + wClause · ambition · (default − asked)/default;
 *   renewal: + wMorale · 2(m − 0.5) + wPlayTime · (share − expected) + wAmbition · ambition · (S_club − v(CA)) · renewAmbitionShare.
 * The player (his agent) agrees at U ≥ margin = acceptMargin + agentMarginSpan · hardness.
 */
export function playerUtility(w: World, p: WorldPlayer, kind: OfferKind, toTeamId: string, terms: OfferTerms): PlayerUtility {
  const club = w.club!;
  const toRegion = w.teams[toTeamId]!.region;
  const market = marketWage(w, p, toRegion);
  const contract = club.contracts[p.playerId];
  const current = contract?.kind === "player" ? contract.salary : 0;
  const fromTeam = kind === "renewal" ? toTeamId : p.teamId;
  const ref = kind === "free" || !contract
    ? M.freeAgentRefShare * market * freeAgentTimeFactor(club, p.playerId, club.date)
    : Math.max(current, M.refMarketShare * market);
  const ambition = ambitionOf(w, p.playerId);
  const sFrom = fromTeam ? teamStrength(w, fromTeam) : 0;
  const sTo = teamStrength(w, toTeamId);
  const rFrom = expectedRole(w, fromTeam, p, p.status === "academy");
  const rTo = expectedRole(w, toTeamId, p);
  const margin = requiredMargin(w, p.playerId);
  if (kind === "loan") {
    const role = M.wRole * (rTo - rFrom);
    const amb = M.wAmbition * ambition * (sTo - sFrom) * 0.5;
    return { total: role + amb, wage: 0, ambition: amb, role, length: 0, ref, margin: 0 };
  }
  const effWage = effectiveWage(w, toTeamId, terms);
  const wage = M.wWage * Math.log(Math.max(1, effWage) / Math.max(1, ref));
  const length = M.wLength * -Math.abs(terms.years - preferredYears(p.age)) / 3;
  const est = estimateForTeam(w, toTeamId, p);
  const defaultClause = M.buyoutValueMult * valueFrom(w, est.ca, est.pa, p.age, terms.years - 1);
  const clause = clauseTerm(ambition, terms.releaseClause, defaultClause);
  if (kind === "renewal") {
    const morale = DEPTH_MODEL.wMorale * 2 * (moraleOf(club, p.playerId) - 0.5);
    const playTime = DEPTH_MODEL.wPlayTime * playTimeGap(club, contract, p.playerId, toTeamId);
    const amb = M.wAmbition * ambition * (sTo - abilityScale(w, p.ca ?? 0.6)) * DEPTH_MODEL.renewAmbitionShare;
    return { total: wage + amb + length + clause + morale + playTime, wage, ambition: amb, role: 0, length, ref, morale, playTime, clause, margin, effWage };
  }
  const amb = M.wAmbition * ambition * (sTo - sFrom);
  const role = M.wRole * (rTo - rFrom);
  return { total: wage + amb + role + length + clause, wage, ambition: amb, role, length, ref, clause, margin, effWage };
}

export interface PlayerAnswer { decision: "accept" | "counter" | "reject"; utility: PlayerUtility; counter?: OfferTerms; reason: Text }

export function playerAnswer(w: World, offer: Pick<TransferOffer, "kind" | "playerId" | "toTeamId" | "terms">): PlayerAnswer {
  const p = w.players[offer.playerId]!;
  const u = playerUtility(w, p, offer.kind, offer.toTeamId, offer.terms);
  const margin = offer.kind === "loan" ? 0 : u.margin ?? M.acceptMargin;
  // A renewal the player does not want whatever the money (unhappy, benched, or too good for the club).
  if (offer.kind === "renewal" && (u.morale ?? 0) + (u.playTime ?? 0) + u.ambition < -DEPTH_MODEL.refuseBelow) {
    return { decision: "reject", utility: u, reason: T("선수가 재계약을 원하지 않습니다 (사기·출전 시간·야망).", "The player does not want to stay (morale, playing time, ambition).") };
  }
  if (u.total >= margin) return { decision: "accept", utility: u, reason: T("선수가 조건에 동의했습니다.", "The player agreed to the terms.") };
  if (offer.kind === "loan") return { decision: "reject", utility: u, reason: T("선수가 더 많은 출전을 보장받지 못한다고 봅니다.", "The player does not see more playing time there.") };
  // The salary that brings U to the margin, with the bonuses held as offered.
  const eff = u.effWage ?? offer.terms.wage;
  const effNeeded = eff * Math.exp((margin - u.total) / M.wWage);
  const needed = Math.ceil((offer.terms.wage + effNeeded - eff) / M.wageStep) * M.wageStep;
  if (needed <= offer.terms.wage * M.maxCounterRaise) {
    return { decision: "counter", utility: u, counter: { ...offer.terms, wage: needed }, reason: T(`선수(에이전트)는 연봉 ${needed.toLocaleString()}달러를 원합니다.`, `The player's agent wants $${needed.toLocaleString()} a year.`) };
  }
  return { decision: "reject", utility: u, reason: T("선수가 이 이적에 관심이 없습니다.", "The player is not interested in this move.") };
}

// --- offers ---------------------------------------------------------------------------------------

export interface OfferRequest {
  readonly playerId: string;
  readonly toTeamId: string;
  readonly kind: OfferKind;
  readonly terms: OfferTerms;
}

export type OfferError = "windowClosed" | "squadFull" | "overBudget" | "ownPlayer" | "notContracted" | "pendingExists" | "releasedHere" | "unknown";

/** Why an offer cannot be made (null: it can). */
export function offerBlocker(w: World, req: OfferRequest, date: string): OfferError | null {
  const club = w.club!;
  const p = w.players[req.playerId];
  const to = w.teams[req.toTeamId];
  if (!p || !to) return "unknown";
  if (req.kind === "renewal") return p.teamId === req.toTeamId && club.contracts[p.playerId] ? null : "notContracted";
  if (p.teamId === req.toTeamId) return "ownPlayer";
  if ((req.kind === "transfer" || req.kind === "loan") && !windowStatus(date).open) return "windowClosed";
  if (req.kind === "free" && p.teamId) return "notContracted";
  if ((req.kind === "transfer" || req.kind === "loan") && !p.teamId) return "unknown";
  // A club cannot re-sign a player it released this season (no release-and-re-sign to reset a contract).
  if (club.transfers.some((r) => r.playerId === req.playerId && r.fromTeamId === req.toTeamId && r.kind === "release" && r.season === w.season)) return "releasedHere";
  if (to.roster.length >= SEASON_MODEL.maxRoster) return "squadFull";
  if (req.terms.fee > club.finances[req.toTeamId]!.transferBudget) return "overBudget";
  if (club.offers.some((o) => o.playerId === req.playerId && o.toTeamId === req.toTeamId && (o.status === "pending" || o.status === "countered"))) return "pendingExists";
  return null;
}

function newOffer(club: ClubState, req: OfferRequest, from: string | null, date: string): TransferOffer {
  return { id: `of-${club.nextId++}`, kind: req.kind, playerId: req.playerId, fromTeamId: from, toTeamId: req.toTeamId, terms: { ...req.terms }, status: "pending", stage: "club", created: date, updated: date };
}

function trimOffers(club: ClubState): void {
  const open = club.offers.filter((o) => o.status === "pending" || o.status === "countered");
  const closed = club.offers.filter((o) => !(o.status === "pending" || o.status === "countered"));
  club.offers = [...closed.slice(-M.maxOfferHistory), ...open];
}

/** Run the player stage of an offer (club already agreed). */
function playerStage(w: World, o: TransferOffer, date: string): void {
  const a = playerAnswer(w, o);
  o.utility = a.utility;
  o.reason = a.reason;
  o.updated = date;
  if (a.decision === "accept") { complete(w, o, date); return; }
  if (a.decision === "counter") { o.status = "countered"; o.stage = "buyer"; o.counter = a.counter; o.counterFrom = "player"; return; }
  o.status = "rejected"; o.stage = "done";
}

/** Run an offer from where it stands: the club stage (or straight to the player). */
function advance(w: World, o: TransferOffer, date: string): void {
  const club = w.club!;
  if (o.kind === "free" || o.kind === "renewal" || !o.fromTeamId) { o.stage = "player"; playerStage(w, o, date); return; }
  if (o.fromTeamId === club.userTeamId && o.toTeamId !== club.userTeamId) {
    // A bid for one of the user's players waits for the user.
    o.stage = "club"; o.status = "pending"; o.expires = addDays(date, M.offerExpiryDays);
    const p = w.players[o.playerId]!;
    pushMessage(club, date, { ...MSG.incoming(label(p), w.teams[o.toTeamId]!.name, o.terms.fee), offerId: o.id, playerId: p.playerId });
    return;
  }
  const a = clubAnswer(w, o);
  o.reason = a.reason;
  o.updated = date;
  if (a.decision === "accept") { o.stage = "player"; playerStage(w, o, date); return; }
  if (a.decision === "counter") { o.status = "countered"; o.stage = "buyer"; o.counter = a.counter; o.counterFrom = "club"; return; }
  o.status = "rejected"; o.stage = "done";
}

/** Complete an agreed offer: fees, the new contract (or loan), the squad move, records, messages. */
function complete(w: World, o: TransferOffer, date: string): void {
  const club = w.club!;
  const p = w.players[o.playerId]!;
  const from = o.kind === "renewal" ? null : p.teamId;
  o.status = "completed"; o.stage = "done"; o.updated = date;
  if (o.kind === "renewal") {
    const c = club.contracts[p.playerId]!;
    c.salary = o.terms.wage;
    c.endSeason = w.season + Math.max(1, o.terms.years) - 1;
    c.signedOn = date;
    if (o.terms.releaseClause !== undefined) c.buyout = o.terms.releaseClause;
    applyBonusTerms(c, o.terms);
    payOnSigning(w, o, date);
    club.transfers.push({ date, season: w.season, playerId: p.playerId, fromTeamId: o.toTeamId, toTeamId: o.toTeamId, fee: 0, kind: "renewal" });
    return;
  }
  if (o.kind === "loan") {
    club.loans.push({ playerId: p.playerId, fromTeamId: from!, toTeamId: o.toTeamId, wageShare: o.terms.wageShare ?? M.loanMinWageShare, endSeason: w.season });
    joinRoster(w, p, o.toTeamId);
    club.transfers.push({ date, season: w.season, playerId: p.playerId, fromTeamId: from, toTeamId: o.toTeamId, fee: 0, kind: "loan" });
    return;
  }
  if (o.terms.fee > 0 && from) {
    book(club, o.toTeamId, date, "transferOut", -o.terms.fee, label(p));
    // An earlier sell-on clause takes its share of the fee from the seller.
    const prior = club.contracts[p.playerId]?.sellOn;
    const cut = prior && club.finances[prior.teamId] ? roundTo(prior.pct * o.terms.fee, M.feeStep) : 0;
    book(club, from, date, "transferIn", o.terms.fee - cut, label(p));
    if (cut > 0) book(club, prior!.teamId, date, "sellOn", cut, label(p));
    club.finances[o.toTeamId]!.transferBudget = Math.max(0, club.finances[o.toTeamId]!.transferBudget - o.terms.fee);
    club.finances[from]!.transferBudget += roundTo(M.transferShare * o.terms.fee, M.feeStep);
  }
  club.loans = club.loans.filter((l) => l.playerId !== p.playerId);
  joinRoster(w, p, o.toTeamId);
  const est = estimateForTeam(w, o.toTeamId, p);
  const value = valueFrom(w, est.ca, est.pa, p.age, o.terms.years - 1);
  const c: Contract = {
    personId: p.playerId, kind: "player", teamId: o.toTeamId, salary: o.terms.wage,
    startSeason: w.season, endSeason: w.season + Math.max(1, o.terms.years) - 1,
    buyout: o.terms.releaseClause ?? Math.max(o.terms.wage, roundTo(M.buyoutValueMult * value, M.feeStep)),
    squadRole: squadRoleOf(w, o.toTeamId, p), signedOn: date,
  };
  applyBonusTerms(c, o.terms);
  if (o.kind === "transfer" && from && (o.terms.sellOn ?? 0) > 0) c.sellOn = { teamId: from, pct: Math.min(DEPTH_MODEL.maxSellOn, o.terms.sellOn!) };
  club.contracts[p.playerId] = c;
  if (club.freeSince) club.freeSince[p.playerId] = "";
  payOnSigning(w, o, date);
  club.transfers.push({ date, season: w.season, playerId: p.playerId, fromTeamId: from, toTeamId: o.toTeamId, fee: o.terms.fee, kind: o.kind });
  if (o.toTeamId === club.userTeamId) pushMessage(club, date, MSG.signed(label(p), o.terms.fee, o.terms.wage, o.terms.years));
  if (from && from === club.userTeamId) pushMessage(club, date, MSG.sold(label(p), w.teams[o.toTeamId]!.name, o.terms.fee));
  // Other open offers for this player are void.
  for (const x of club.offers) if (x !== o && x.playerId === p.playerId && (x.status === "pending" || x.status === "countered")) { x.status = "withdrawn"; x.stage = "done"; x.updated = date; }
}

function applyBonusTerms(c: Contract, t: OfferTerms): void {
  const b = { ...(t.loyaltyBonus ? { loyalty: t.loyaltyBonus } : {}), ...(t.winBonus ? { perWin: t.winBonus } : {}), ...(t.titleBonus ? { perTitle: t.titleBonus } : {}) };
  c.bonuses = Object.keys(b).length ? b : undefined;
}

/** Agent fee and signing-on bonus, paid by the signing club. */
function payOnSigning(w: World, o: TransferOffer, date: string): void {
  const club = w.club!;
  const p = w.players[o.playerId];
  const fee = agentFee(w, o.playerId, o.terms);
  if (fee > 0) book(club, o.toTeamId, date, "agentFee", -fee, p?.handle ?? o.playerId);
  if ((o.terms.signingBonus ?? 0) > 0) book(club, o.toTeamId, date, "bonus", -o.terms.signingBonus!, `${p?.handle ?? o.playerId} signing`);
}

/** Make an offer (mutating `w`): validates, then runs the selling club's and the player's answers. */
export function submitOfferMut(w: World, req: OfferRequest, date: string): TransferOffer | OfferError {
  const club = w.club!;
  const block = offerBlocker(w, req, date);
  if (block) return block;
  const p = w.players[req.playerId]!;
  const o = newOffer(club, req, req.kind === "free" ? null : p.teamId, date);
  club.offers.push(o);
  advance(w, o, date);
  trimOffers(club);
  return o;
}

/** Make an offer. Returns the new world and the offer (or why it could not be made). */
export function makeOffer(world: World, req: OfferRequest, date = world.club!.date): { world: World; offer: TransferOffer | null; error: OfferError | null } {
  const w = clone(world);
  const r = submitOfferMut(w, req, date);
  return typeof r === "string" ? { world, offer: null, error: r } : { world: w, offer: r, error: null };
}

/** The buyer answers a counter-offer: accept its terms (re-run the stage that countered) or walk away. */
export function answerCounterMut(w: World, offerId: string, accept: boolean, date: string): TransferOffer | null {
  const o = w.club!.offers.find((x) => x.id === offerId);
  if (!o || o.status !== "countered" || !o.counter) return null;
  if (!accept) { o.status = "withdrawn"; o.stage = "done"; o.updated = date; return o; }
  if (o.counter.fee > w.club!.finances[o.toTeamId]!.transferBudget && o.counter.fee > o.terms.fee) {
    o.reason = T("이적 예산이 부족합니다.", "Not enough transfer budget."); return o;
  }
  const from = o.counterFrom;
  o.terms = { ...o.counter };
  delete o.counter;
  o.status = "pending";
  if ((o.kind === "transfer" || o.kind === "loan") && !windowStatus(date).open) { o.status = "expired"; o.stage = "done"; return o; }
  if (from === "player") { o.stage = "player"; playerStage(w, o, date); } else advance(w, o, date);
  return o;
}

export function answerCounter(world: World, offerId: string, accept: boolean, date = world.club!.date): World {
  const w = clone(world);
  answerCounterMut(w, offerId, accept, date);
  return w;
}

/** The user answers a bid for one of his players: accept (the player then decides) or reject. */
export function answerIncomingMut(w: World, offerId: string, accept: boolean, date: string): TransferOffer | null {
  const club = w.club!;
  const o = club.offers.find((x) => x.id === offerId);
  if (!o || o.status !== "pending" || o.fromTeamId !== club.userTeamId) return null;
  o.updated = date;
  if (!accept) { o.status = "rejected"; o.stage = "done"; o.reason = T("제안을 거절했습니다.", "You rejected the bid."); return o; }
  o.stage = "player";
  playerStage(w, o, date);
  return o;
}

export function answerIncoming(world: World, offerId: string, accept: boolean, date = world.club!.date): World {
  const w = clone(world);
  answerIncomingMut(w, offerId, accept, date);
  return w;
}

/** Release a player: severance = severanceShare · remaining salary; he becomes a free agent. */
export function releasePlayerMut(w: World, playerId: string, date: string): boolean {
  const club = w.club!;
  const p = w.players[playerId];
  if (!p || !p.teamId) return false;
  const c = club.contracts[playerId];
  const teamId = p.teamId;
  const loan = club.loans.find((l) => l.playerId === playerId);
  if (loan) {
    // Ending a loan early sends the player back.
    club.loans = club.loans.filter((l) => l !== loan);
    joinRoster(w, p, loan.fromTeamId);
    return true;
  }
  if (c) {
    const remaining = c.salary * Math.max(0, c.endSeason - w.season + 1);
    book(club, teamId, date, "severance", -M.severanceShare * remaining, label(p));
    delete club.contracts[playerId];
  }
  detach(w, p);
  markFree(club, playerId, date);
  club.transfers.push({ date, season: w.season, playerId, fromTeamId: teamId, toTeamId: null, fee: 0, kind: "release" });
  return true;
}

export function releasePlayer(world: World, playerId: string, date = world.club!.date): World {
  const w = clone(world);
  releasePlayerMut(w, playerId, date);
  return w;
}

/** Suggested terms for an offer as the buyer's scout sees the player (fee = asking-like value, wage = market). */
export function suggestedTerms(w: World, playerId: string, buyerTeamId: string, kind: OfferKind): OfferTerms {
  const p = w.players[playerId]!;
  const est = estimateForTeam(w, buyerTeamId, p);
  const rep = reputations(w)[buyerTeamId] ?? 0.5;
  const wage = clubSalary(marketWage(w, p, w.teams[buyerTeamId]!.region, est), rep);
  const years = Math.round(preferredYears(p.age));
  if (kind === "loan") return { fee: 0, wage: w.club!.contracts[playerId]?.salary ?? wage, years: 1, wageShare: M.loanMinWageShare };
  if (kind === "renewal") return { fee: 0, wage: Math.max(wage, w.club!.contracts[playerId]?.salary ?? 0), years };
  const fee = kind === "free" || !p.teamId ? 0 : playerValue(w, p, buyerTeamId);
  return { fee, wage, years };
}

// --- expiry of incoming bids -----------------------------------------------------------------------

export function expireOffers(w: World, date: string): void {
  for (const o of w.club!.offers) {
    if (o.status === "pending" && o.expires && date > o.expires) { o.status = "expired"; o.stage = "done"; o.updated = date; }
    if ((o.status === "pending" || o.status === "countered") && (o.kind === "transfer" || o.kind === "loan") && !windowStatus(date).open) { o.status = "expired"; o.stage = "done"; o.updated = date; }
  }
}

// --- the AI market ---------------------------------------------------------------------------------

/**
 * One AI market round (weekly in a window). Each AI club, in a date-rotated order, under its buy
 * limit for the window: finds its weakest starter by its own scout's estimate, and looks in its
 * region (other clubs' main rosters and free agents) for the player its scout rates highest that
 * is an upgrade by aiUpgradeMargin and fits its transfer budget (fee) and wage budget (salary).
 * It bids its estimated value · (1 + aiBidMarkup) and the salary its reputation pays; counters
 * within budget are accepted. A roster over the cap releases its weakest player; a club over its
 * wage budget first releases the bench player with the highest salary per estimated CA.
 */
export function aiMarketRound(w: World, date: string): void {
  const club = w.club!;
  const win = windowStatus(date);
  if (!win.open) return;
  const buys = (club.aiBuys[win.key] ??= {});
  const rep = reputations(w);
  const movedThisWindow = new Set(club.transfers.filter((r) => r.date >= win.from && r.date <= win.to).map((r) => r.playerId));
  const loaned = new Set(club.loans.map((l) => l.playerId));
  const ids = Object.keys(w.teams).sort();
  const k = Number(date.slice(5, 7)) * 31 + Number(date.slice(8, 10));
  const order = [...ids.slice(k % ids.length), ...ids.slice(0, k % ids.length)];
  for (const teamId of order) {
    if (teamId === club.userTeamId) continue;
    if ((buys[teamId] ?? 0) >= M.aiBuysPerWindow) continue;
    const t = w.teams[teamId]!;
    const f = club.finances[teamId]!;
    const scout = teamScout(w, teamId);
    const est = (p: WorldPlayer) => estimateAbility(w, scout, p);
    const starters = t.roster.slice(0, SEASON_MODEL.starters).map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p);
    const weakest = starters.length < SEASON_MODEL.starters ? -Infinity : Math.min(...starters.map((p) => est(p).ca));
    // Over the wage budget: release the bench player with the most salary per unit of estimated CA.
    if (wageBill(w, teamId).total > f.wageBudget * (1 + M.wageTolerance) && t.roster.length > SEASON_MODEL.starters) {
      const bench = t.roster.slice(SEASON_MODEL.starters).filter((id) => club.contracts[id] && !loaned.has(id));
      const worst = bench.sort((a, b) => club.contracts[b]!.salary / Math.max(0.05, est(w.players[b]!).ca) - club.contracts[a]!.salary / Math.max(0.05, est(w.players[a]!).ca) || a.localeCompare(b))[0];
      if (worst) releasePlayerMut(w, worst, date);
    }
    const bill = wageBill(w, teamId).total;
    const cands: Array<{ p: WorldPlayer; ca: number; fee: number; wage: number }> = [];
    for (const p of Object.values(w.players)) {
      if (!p.hasRatings || p.region !== t.region || p.teamId === teamId || movedThisWindow.has(p.playerId) || loaned.has(p.playerId)) continue;
      if (p.status === "academy") continue;
      if (p.teamId && p.teamId === club.userTeamId && club.offers.some((o) => o.playerId === p.playerId && o.status === "pending")) continue;
      const e = est(p);
      if (e.ca < weakest + M.aiUpgradeMargin) continue;
      const fee = p.teamId ? roundTo(playerValue(w, p, teamId) * (1 + M.aiBidMarkup), M.feeStep) : 0;
      if (fee > f.transferBudget) continue;
      const wage = clubSalary(marketWage(w, p, t.region, e), rep[teamId] ?? 0.5);
      if (bill + wage > f.wageBudget * (1 + M.wageTolerance)) continue;
      cands.push({ p, ca: e.ca, fee, wage });
    }
    if (!cands.length) continue;
    cands.sort((a, b) => b.ca - a.ca || a.fee - b.fee || a.p.playerId.localeCompare(b.p.playerId));
    for (const c of cands.slice(0, 3)) {
      if (t.roster.length >= SEASON_MODEL.maxRoster) {
        // Make room: release the weakest by the scout's estimate.
        const weak = t.roster.slice().sort((a, b) => est(w.players[a]!).ca - est(w.players[b]!).ca || a.localeCompare(b))[0]!;
        releasePlayerMut(w, weak, date);
      }
      const req: OfferRequest = { playerId: c.p.playerId, toTeamId: teamId, kind: c.p.teamId ? "transfer" : "free", terms: { fee: c.fee, wage: c.wage, years: Math.round(preferredYears(c.p.age)) } };
      const o = submitOfferMut(w, req, date);
      if (typeof o === "string") continue;
      // Accept counters that fit the budgets (one round of haggling).
      for (let i = 0; i < 2 && o.status === "countered" && o.counter; i++) {
        const fits = o.counter.fee <= f.transferBudget && bill + o.counter.wage <= f.wageBudget * (1 + M.wageTolerance);
        answerCounterMut(w, o.id, fits, date);
      }
      if (o.status === "completed") { buys[teamId] = (buys[teamId] ?? 0) + 1; break; }
      if (o.status === "pending" && o.fromTeamId === club.userTeamId) break; // waiting for the user
    }
  }
  trimOffers(club);
}
