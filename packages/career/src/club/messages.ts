// Inbox messages of the club layer, in Korean and English. Money is formatted in USD.
import { CLUB_MODEL } from "./constants.ts";
import type { InboxCategory, InboxDraft } from "../career/inbox.ts";
import type { ClubState, InboxKind, Text } from "./types.ts";

export function money(v: number): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}

const T = (ko: string, en: string): Text => ({ ko, en });

export const MSG = {
  budget: (season: number, wage: number, transfer: number, sponsor: number) => ({
    kind: "board" as InboxKind, route: "finance",
    title: T(`${season} 시즌 예산 확정`, `${season} season budget set`),
    body: T(
      `이사회가 연봉 예산 ${money(wage)}, 이적 예산 ${money(transfer)}을 승인했습니다. 올해 스폰서 계약은 ${money(sponsor)}입니다.`,
      `The board approved a wage budget of ${money(wage)} and a transfer budget of ${money(transfer)}. Sponsorship this season: ${money(sponsor)}.`,
    ),
  }),
  wageWarning: (bill: number, budget: number) => ({
    kind: "board" as InboxKind, route: "finance",
    title: T("이사회: 연봉 지출 초과", "Board: wage bill over budget"),
    body: T(
      `연봉 총액 ${money(bill)}이 예산 ${money(budget)}을 넘었습니다. 지출을 줄이거나 선수를 정리하길 바랍니다.`,
      `The wage bill of ${money(bill)} is over the ${money(budget)} budget. The board expects spending to come down.`,
    ),
  }),
  negative: (balance: number) => ({
    kind: "board" as InboxKind, route: "finance",
    title: T("이사회: 잔고 적자", "Board: club in the red"),
    body: T(`클럽 잔고가 ${money(balance)}입니다. 이사회가 재정 상황을 우려하고 있습니다.`, `The club balance is ${money(balance)}. The board is concerned about the finances.`),
  }),
  ownerSupport: (amount: number) => ({
    kind: "board" as InboxKind, route: "finance",
    title: T("구단주가 부채를 메웠습니다", "The owner covered the debt"),
    body: T(`부채 한도를 넘어 구단주가 ${money(amount)}을 투입했습니다. 이사회 신뢰가 떨어졌습니다.`, `Debt passed the limit; the owner put in ${money(amount)}. The board's confidence has dropped.`),
  }),
  prize: (place: number, amount: number) => ({
    kind: "finance" as InboxKind, route: "finance",
    title: T(`시즌 상금: ${place}위`, `Season prize money: ${place}${place === 1 ? "st" : place === 2 ? "nd" : place === 3 ? "rd" : "th"}`),
    body: T(`지역 리그 ${place}위로 상금 ${money(amount)}을 받았습니다.`, `Finishing ${place} in the region earned ${money(amount)}.`),
  }),
  windowOpen: (to: string) => ({
    kind: "transfer" as InboxKind, route: "transfers",
    title: T("이적 시장 개장", "Transfer window open"), body: T(`${to}까지 이적 시장이 열립니다.`, `The transfer window is open until ${to}.`),
  }),
  windowClosed: () => ({
    kind: "transfer" as InboxKind, route: "transfers",
    title: T("이적 시장 마감", "Transfer window closed"), body: T("이적 시장이 닫혔습니다. 자유계약 선수는 계속 영입할 수 있습니다.", "The transfer window has closed. Free agents can still be signed."),
  }),
  incoming: (handle: string, team: string, fee: number) => ({
    kind: "transfer" as InboxKind, route: "transfers",
    options: [{ id: "accept", label: { en: "Accept the bid", ko: "제안 수락" } }, { id: "reject", label: { en: "Reject the bid", ko: "제안 거절" } }],
    title: T(`${team}의 ${handle} 영입 제안`, `${team} bid for ${handle}`),
    body: T(`${team}이(가) ${handle}에 대해 ${money(fee)}을 제시했습니다. ${CLUB_MODEL.offerExpiryDays}일 안에 여기나 이적 화면에서 답하세요. 답하지 않으면 제안은 소멸합니다.`, `${team} offered ${money(fee)} for ${handle}. Answer here or in Transfers within ${CLUB_MODEL.offerExpiryDays} days; an unanswered bid lapses.`),
  }),
  sold: (handle: string, team: string, fee: number) => ({
    kind: "transfer" as InboxKind, route: "transfers",
    title: T(`${handle} 이적 완료`, `${handle} sold`), body: T(`${handle}이(가) ${money(fee)}에 ${team}으로 이적했습니다.`, `${handle} joined ${team} for ${money(fee)}.`),
  }),
  signed: (handle: string, fee: number, wage: number, years: number) => ({
    kind: "transfer" as InboxKind, route: "transfers",
    title: T(`${handle} 영입 완료`, `${handle} signed`),
    body: T(`이적료 ${money(fee)}, 연봉 ${money(wage)}, ${years}시즌 계약으로 ${handle}이(가) 합류했습니다.`, `${handle} joined for a ${money(fee)} fee on ${money(wage)} a year for ${years} season(s).`),
  }),
  expiring: (handles: string[]) => ({
    kind: "contract" as InboxKind, route: "transfers",
    title: T("계약 만료 예정", "Contracts expiring"),
    body: T(`이번 시즌이 끝나면 계약이 끝나는 선수: ${handles.join(", ")}. 재계약하지 않으면 자유계약으로 떠납니다.`, `Contracts ending this season: ${handles.join(", ")}. Players not renewed leave as free agents.`),
  }),
  expired: (handles: string[]) => ({
    kind: "contract" as InboxKind, route: "transfers",
    title: T("계약 만료", "Contracts expired"), body: T(`계약이 끝나 떠난 선수: ${handles.join(", ")}.`, `Left at the end of their contracts: ${handles.join(", ")}.`),
  }),
} as const;

const CATEGORY: Record<InboxKind, InboxCategory> = { finance: "finance", board: "board", transfer: "transfer", contract: "transfer", training: "training" };
const FROM: Record<InboxKind, string> = { finance: "board", board: "board", transfer: "director", contract: "director", training: "headCoach" };

/**
 * Queue a message for the manager's inbox (career mode posts it on the next drain). Club messages
 * carry their own ko/en text; `key` names the message kind for the UI. `date` is kept for callers
 * that queue outside the day loop; the inbox stamps the career date when it is posted.
 */
export function pushMessage(
  club: ClubState, _date: string,
  m: { kind: InboxKind; title: Text; body: Text; route?: string; options?: InboxDraft["options"]; offerId?: string; playerId?: string },
): InboxDraft {
  const draft: InboxDraft = {
    category: CATEGORY[m.kind], key: `club.${m.kind}`, from: FROM[m.kind],
    text: { en: { title: m.title.en, body: m.body.en }, ko: { title: m.title.ko, body: m.body.ko } },
    ...(m.route || m.offerId || m.playerId ? { ref: { ...(m.route ? { route: m.route } : {}), ...(m.offerId ? { offerId: m.offerId } : {}), ...(m.playerId ? { playerId: m.playerId } : {}) } } : {}),
    ...(m.options ? { options: m.options } : {}),
  };
  club.outbox.push(draft);
  return draft;
}
