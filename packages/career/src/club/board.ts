// The board of the manager's club (docs/CLUB_OPERATIONS.md §11): season objectives from stature and
// budget, a confidence that moves with results and finances, warnings and the sack, and the
// manager's requests (budget, facilities, staff). Constants: constants.ts DEPTH_MODEL.
//
//   objectives   expected place e = the club's strength rank in its region (stature);
//                target = max(1, e − [budget above the region's median]);
//                international = target ≤ internationalSlots;  wage objective always
//   match        c += boardMatchRate · (result − pExpected),  pExpected = σ(winSlope · (S_us − S_them))
//   month        c += boardFinanceRate · score,  score = +1 clean, −1 per breach (over wage budget, in the red)
//   season       league: ± boardLeagueWeight · clamp((target − place)/2 + (met ? 0.5 : −0.5), −1, 1)
//                international: ± boardIntlWeight;  wages: ± boardWageWeight
//   warning      once when c falls below warnBelow;  sack when c < sackBelow
//   requests     granted when c ≥ requestConfidence[kind] and the money is there; granting costs requestCost
import type { World } from "../model.ts";
import { clamp } from "../rng.ts";
import { CLUB_MODEL, DEPTH_MODEL } from "./constants.ts";
import { annualCosts, book, placements, regionOrder, wageBill } from "./finance.ts";
import { roundTo, teamStrength } from "./market.ts";
import { pushMessage } from "./messages.ts";
import type { BoardObjectives, BoardRequestKind, BoardState, ClubState, Text } from "./types.ts";

const D = DEPTH_MODEL;
const M = CLUB_MODEL;
const T = (ko: string, en: string): Text => ({ ko, en });
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export function emptyBoard(): BoardState {
  return { confidence: D.confidenceStart, objectives: null, requests: {}, warned: false, sacked: false, history: [] };
}

export const boardOf = (club: ClubState): BoardState => (club.board ??= emptyBoard());

/** Facilities level of a club (0..1; absent = 0.5, neutral). */
export const facilitiesOf = (club: ClubState | undefined, teamId: string): number => club?.facilities?.[teamId] ?? 0.5;

function move(w: World, date: string, delta: number, why: string): void {
  const club = w.club!;
  const b = boardOf(club);
  if (b.sacked || delta === 0) return;
  b.confidence = r4(clamp(b.confidence + delta, 0, 1));
  b.history.push({ date, value: b.confidence, why });
  if (b.history.length > 60) b.history.splice(0, b.history.length - 60);
  if (b.confidence < D.sackBelow) {
    b.sacked = true;
    pushMessage(club, date, { kind: "board", route: "board", title: T("이사회가 감독을 해임했습니다", "The board has sacked you"), body: T(`이사회 신뢰도가 ${Math.round(b.confidence * 100)}%로 떨어져 감독직에서 해임되었습니다.`, `Board confidence fell to ${Math.round(b.confidence * 100)}%; you have been relieved of your duties.`) });
  } else if (b.confidence < D.warnBelow && !b.warned) {
    b.warned = true;
    pushMessage(club, date, { kind: "board", route: "board", title: T("이사회 경고", "Board warning"), body: T(`이사회 신뢰도가 ${Math.round(b.confidence * 100)}%입니다. 결과와 재정이 나아지지 않으면 해임될 수 있습니다.`, `Board confidence is ${Math.round(b.confidence * 100)}%. Without better results and finances, your job is at risk.`) });
  } else if (b.confidence >= D.warnBelow + 0.05) b.warned = false;
}

/** Season objectives for the manager's club (season start). */
export function setObjectives(w: World, date: string): BoardObjectives | null {
  const club = w.club!;
  const uid = club.userTeamId;
  if (!uid || !w.teams[uid]) return null;
  const region = w.teams[uid]!.region;
  const order = regionOrder(w)[region] ?? [];
  const expected = Math.max(1, order.indexOf(uid) + 1);
  const budget = (id: string) => (club.finances[id]?.wageBudget ?? 0) + (club.finances[id]?.transferBudget ?? 0);
  const budgets = order.map(budget).sort((a, b) => a - b);
  const median = budgets[Math.floor(budgets.length / 2)] ?? 0;
  const leaguePlace = Math.max(1, expected - (budget(uid) > median ? 1 : 0));
  const o: BoardObjectives = { season: w.season, leaguePlace, international: leaguePlace <= D.internationalSlots, wageBudget: true, expectedPlace: expected };
  boardOf(club).objectives = o;
  pushMessage(club, date, {
    kind: "board", route: "board",
    title: T(`${w.season} 시즌 이사회 목표`, `${w.season} season objectives`),
    body: T(
      `지역 리그 ${leaguePlace}위 이내${o.international ? ", 국제 대회 진출" : ""}, 연봉 예산 준수.`,
      `Finish ${leaguePlace}${ord(leaguePlace)} or better in the region${o.international ? ", qualify for an international event" : ""}, and stay within the wage budget.`,
    ),
  });
  return o;
}

const ord = (n: number): string => (n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th");

/** After one of the manager's series: confidence moves with the result against expectation. */
export function boardOnSeries(w: World, date: string, opponent: string, won: boolean): void {
  const club = w.club;
  const uid = club?.userTeamId;
  if (!club || !uid) return;
  const p = sigmoid(D.winSlope * (teamStrength(w, uid) - teamStrength(w, opponent)));
  move(w, date, D.boardMatchRate * ((won ? 1 : 0) - p), won ? "win" : "loss");
}

/** Monthly finance check. */
export function boardOnMonth(w: World, date: string): void {
  const club = w.club;
  const uid = club?.userTeamId;
  if (!club || !uid || !club.finances[uid]) return;
  const f = club.finances[uid]!;
  let score = 1;
  if (wageBill(w, uid).total > f.wageBudget * (1 + M.wageTolerance)) score -= 1;
  if (f.balance < 0) score -= 1;
  move(w, date, D.boardFinanceRate * clamp(score, -1, 1), "finances");
}

/** Season review against the objectives (before the season loop advances). */
export function boardSeasonReview(w: World, date: string, standings?: Record<string, number>): void {
  const club = w.club;
  const uid = club?.userTeamId;
  if (!club || !uid) return;
  const b = boardOf(club);
  const o = b.objectives;
  if (!o || b.sacked) return;
  const place = standings?.[uid] ?? placements(regionOrder(w))[uid]?.place ?? o.leaguePlace;
  const leagueMet = place <= o.leaguePlace;
  const internationalMet = o.international ? place <= D.internationalSlots : null;
  const f = club.finances[uid]!;
  const wageMet = wageBill(w, uid).total <= f.wageBudget * (1 + M.wageTolerance);
  const delta = D.boardLeagueWeight * clamp((o.leaguePlace - place) / 2 + (leagueMet ? 0.5 : -0.5), -1, 1)
    + (internationalMet === null ? 0 : (internationalMet ? D.boardIntlWeight : -D.boardIntlWeight))
    + (wageMet ? D.boardWageWeight : -D.boardWageWeight);
  b.lastReview = { season: w.season, place, leagueMet, internationalMet, wageMet, delta: r4(delta) };
  pushMessage(club, date, {
    kind: "board", route: "board",
    title: T("이사회 시즌 평가", "Board season review"),
    body: T(
      `${place}위 (목표 ${o.leaguePlace}위) — ${leagueMet ? "목표 달성" : "목표 미달"}. 신뢰도 ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%p.`,
      `Finished ${place}${ord(place)} (target ${o.leaguePlace}${ord(o.leaguePlace)}) — ${leagueMet ? "objective met" : "objective missed"}. Confidence ${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts.`,
    ),
  });
  move(w, date, delta, "season review");
}

export interface RequestAnswer { readonly granted: boolean; readonly reason: Text; readonly amount?: number }

/** The manager asks the board for something. One of each kind per season. Mutates `w`. */
export function boardRequestMut(w: World, kind: BoardRequestKind, date: string): RequestAnswer {
  const club = w.club!;
  const uid = club.userTeamId!;
  const b = boardOf(club);
  const f = club.finances[uid]!;
  const asked = (b.requests[String(w.season)] ??= []);
  if (b.sacked) return { granted: false, reason: T("해임된 상태입니다.", "You have been sacked.") };
  if (asked.includes(kind)) return { granted: false, reason: T("이번 시즌에 이미 요청했습니다.", "You already asked this season.") };
  asked.push(kind);
  const need = D.requestConfidence[kind] ?? 0.5;
  const refuse = (ko: string, en: string): RequestAnswer => {
    const r = { granted: false, reason: T(ko, en) };
    pushMessage(club, date, { kind: "board", route: "board", title: T("이사회: 요청 거절", "Board: request refused"), body: r.reason });
    return r;
  };
  if (b.confidence < need) return refuse(`신뢰도가 부족합니다 (${Math.round(b.confidence * 100)}% < ${Math.round(need * 100)}%).`, `Not enough confidence (${Math.round(b.confidence * 100)}% < ${Math.round(need * 100)}%).`);
  const reserve = M.reserveYears * annualCosts(w, uid);
  let amount = 0;
  if (kind === "transferBudget") {
    amount = roundTo(Math.min(D.transferStepShare * f.expectedIncome, 0.5 * (f.balance - reserve)), M.feeStep);
    if (amount <= 0) return refuse("여유 자금이 없습니다.", "There is no money to spare.");
    f.transferBudget += amount;
  } else if (kind === "wageBudget" || kind === "staffBudget") {
    const cap = D.wageShareMax * f.expectedIncome;
    amount = kind === "wageBudget" ? roundTo(Math.min(f.wageBudget * D.wageStep, cap - f.wageBudget), M.wageStep) : Math.min(D.staffBudgetStep, roundTo(cap - f.wageBudget, M.wageStep));
    if (amount <= 0) return refuse("연봉 예산이 이미 수입 대비 한도입니다.", "The wage budget is already at its limit for the club's income.");
    f.wageBudget += amount;
  } else {
    const level = facilitiesOf(club, uid);
    if (level >= 1) return refuse("시설이 이미 최고 수준입니다.", "Facilities are already at the top level.");
    if (f.balance - D.facilityCost < reserve) return refuse("시설 투자 자금이 부족합니다.", "Not enough money to invest in facilities.");
    amount = D.facilityCost;
    (club.facilities ??= {})[uid] = r4(Math.min(1, level + D.facilityStep));
    book(club, uid, date, "facilities", -amount, "training facilities");
  }
  b.confidence = r4(clamp(b.confidence - D.requestCost, 0, 1));
  const reason = T("이사회가 요청을 승인했습니다.", "The board approved the request.");
  pushMessage(club, date, { kind: "board", route: "board", title: T("이사회: 요청 승인", "Board: request approved"), body: reason });
  return { granted: true, reason, amount };
}

export function boardRequest(world: World, kind: BoardRequestKind, date = world.club!.date): { world: World; answer: RequestAnswer } {
  const w = JSON.parse(JSON.stringify(world)) as World;
  const answer = boardRequestMut(w, kind, date);
  return { world: w, answer };
}
