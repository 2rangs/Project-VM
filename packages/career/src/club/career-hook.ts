// The club layer inside career mode. Career mode owns the calendar and the inbox; this hook runs
// the club's day, month and season-end steps on them (docs/CAREER_MODE.md §6, CLUB_OPERATIONS.md §7).
// It is built into the career day loop (career.ts runs it right after the core hook), so every
// career has contracts, finances, transfers and training.
//
//   onCareerStart  initClub: contracts and finances for every club; the manager's club is the user's
//   onDay          clubOnDayMut (windows, bids expiring, Monday training + AI market round)
//   onMonth        clubOnMonthMut (ledger, board checks, contracts-expiring notice)
//   onSeasonEnd    clubBeforeSeasonEndMut with the career's real standings (loans back, prize
//                  money, expiring contracts). career.ts then runs advanceSeason with the season's
//                  training focus and the user's club left to its manager
//   onSeasonStart  clubAfterSeasonAdvanceMut (contracts for the season loop's signings, budgets)
//   onAnswer       an incoming bid answered from the inbox → answerIncomingMut
// After every step the club's outbox is posted to the career inbox.
import type { World } from "../model.ts";
import { REGIONS } from "../regions.ts";
import type { CareerHook } from "../career/hooks.ts";
import { postInbox } from "../career/inbox.ts";
import { stageDone, stagePlacings, STAGES } from "../career/schedule.ts";
import type { CareerState } from "../career/types.ts";
import { regionOrder } from "./finance.ts";
import { clubAfterSeasonAdvanceMut, clubBeforeSeasonEndMut, clubOnDayMut, clubOnMonthMut, initClub } from "./ops.ts";
import { answerIncomingMut } from "./transfers.ts";

/** Post the club layer's queued messages into the career inbox (source "club"). */
export function drainClubOutbox(state: CareerState): void {
  const club = state.world.club;
  if (!club || club.outbox.length === 0) return;
  for (const d of club.outbox.splice(0)) postInbox(state, d, "club");
}

/**
 * Inbox questions about bids that were settled elsewhere (the Transfers screen, or the bid lapsed)
 * get the outcome as their answer, so they no longer hold up Continue.
 */
export function syncClubInbox(state: CareerState): void {
  const club = state.world.club;
  if (!club) return;
  for (const m of state.inbox) {
    const id = m.ref?.offerId;
    if (!id || m.answer !== undefined || !m.options?.length) continue;
    const o = club.offers.find((x) => x.id === id);
    if (!o || o.status === "pending" || o.status === "countered") continue;
    m.answer = o.status === "accepted" || o.status === "completed" ? "accept" : "reject";
  }
}

/**
 * teamId → place within its region for the club's prize money: the manager's region from the
 * league (mean of the two stage placings; teams outside the league after it, by strength), the
 * other regions by strength with the seeded placement noise.
 */
export function careerStandings(state: CareerState): Record<string, number> {
  const w = state.world;
  const out: Record<string, number> = {};
  const noisy = regionOrder(w, w.season);
  for (const r of REGIONS) {
    if (r !== state.region) { noisy[r]!.forEach((id, i) => { out[id] = i + 1; }); continue; }
    const lists = STAGES.filter((s) => stageDone(state.season, s)).map((s) => stagePlacings(state.season, s));
    const score = (id: string) => (lists.length ? lists.reduce((s, l) => s + (l.indexOf(id) + 1 || l.length + 1), 0) / lists.length : 99);
    const league = [...state.season.teams].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
    const rest = noisy[r]!.filter((id) => !league.includes(id));
    [...league, ...rest].forEach((id, i) => { out[id] = i + 1; });
  }
  return out;
}

const after = (state: CareerState) => { drainClubOutbox(state); syncClubInbox(state); };

export const clubCareerHook: CareerHook = {
  id: "club",
  order: 10,
  onCareerStart(world: World, ctx) {
    const state = ctx.career;
    const w = initClub(world, { userTeamId: state.userTeamId, date: state.date });
    state.world = w;
    after(state);
  },
  onDay(_w, date, ctx) {
    const state = ctx.career;
    if (!state.world.club) return;
    clubOnDayMut(state.world, date);
    after(state);
  },
  onMonth(_w, date, ctx) {
    const state = ctx.career;
    if (!state.world.club) return;
    clubOnMonthMut(state.world, date);
    after(state);
  },
  onSeasonEnd(_w, _season, ctx) {
    const state = ctx.career;
    if (!state.world.club) return;
    clubBeforeSeasonEndMut(state.world, { standings: careerStandings(state), date: state.date });
    after(state);
  },
  onSeasonStart(_w, _season, ctx) {
    const state = ctx.career;
    if (!state.world.club) return;
    clubAfterSeasonAdvanceMut(state.world, state.date);
    after(state);
  },
  onAnswer(_w, item, answer, ctx) {
    const state = ctx.career;
    if (!state.world.club || !item.ref?.offerId) return;
    answerIncomingMut(state.world, item.ref.offerId, answer === "accept", state.date);
    after(state);
  },
};
