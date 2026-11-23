// How the club layer plugs into the career shell's calendar.
//
// The shell (app shell, calendar, inbox, season loop) owns time. It exposes hooks; the club layer
// registers handlers on them with `registerClubOps(hooks)`. Until the shell's own API lands, this
// is the interface the club layer is written against, and `createLocalDriver` is a minimal
// stand-in calendar for tests and the desktop's temporary "advance a week" button.
//
// What the shell must do (docs/CLUB_OPERATIONS.md §7):
//   1. after the user picks a club: world = initClub(world, { userTeamId, date })
//   2. every day:     world = handler(world, date) for the onDay handlers
//   3. on the 1st:    world = handler(world, date) for the onMonth handlers (after onDay)
//   4. season end:    world = handler(world, { standings }) for the onSeasonEnd handlers — the club
//                     handler runs advanceSeason itself (with the training focus); the shell must not
//                     also call advanceSeason. A shell that must call it itself uses
//                     clubBeforeSeasonEnd → advanceSeason(world, { focus: seasonFocus(world) }) →
//                     clubAfterSeasonAdvance instead of the handler.
//   5. postInbox:     receives every message the club layer writes (also kept in world.club.messages).
import type { World } from "../model.ts";
import { addDays, isFirstOfMonth, seasonEndDate, seasonStartDate } from "./calendar.ts";
import { clubOnDay, clubOnMonth, clubSeasonEnd, type SeasonEndContext } from "./ops.ts";
import type { InboxItem } from "./types.ts";

export type DayHandler = (world: World, date: string) => World;
export type SeasonEndHandler = (world: World, ctx: SeasonEndContext) => World;

export interface CareerHooks {
  onDay(handler: DayHandler): void;
  onMonth(handler: DayHandler): void;
  onSeasonEnd(handler: SeasonEndHandler): void;
  postInbox(item: InboxItem): void;
}

/** Messages a handler added (by id), so they can be posted to the shell's inbox. */
function newMessages(before: World, after: World): InboxItem[] {
  const seen = new Set((before.club?.messages ?? []).map((m) => m.id));
  return (after.club?.messages ?? []).filter((m) => !seen.has(m.id));
}

/** Register the club layer's handlers on the shell's hooks. */
export function registerClubOps(hooks: CareerHooks): void {
  const post = (a: World, b: World) => { for (const m of newMessages(a, b)) hooks.postInbox(m); return b; };
  hooks.onDay((w, date) => post(w, clubOnDay(w, date)));
  hooks.onMonth((w, date) => post(w, clubOnMonth(w, date)));
  hooks.onSeasonEnd((w, ctx) => post(w, clubSeasonEnd(w, ctx)));
}

export interface LocalDriver {
  readonly world: World;
  readonly date: string;
  readonly inbox: readonly InboxItem[];
  /** Advance n days: onDay each day, onMonth on the 1st, and the season end after seasonEnd. */
  advanceDays(n: number): void;
  /** Run to the end of the current season and into the next one. */
  advanceToNextSeason(): void;
  /** Replace the world (e.g. after the user made an offer). */
  setWorld(w: World): void;
}

/**
 * A minimal calendar: one day at a time from the club date. After CLUB_MODEL.seasonEnd the season
 * ends (standings from `standingsFor`, else the strength order) and the date jumps to the next
 * season's first day.
 */
export function createLocalDriver(world: World, opts: { standingsFor?: (w: World) => Record<string, number> | undefined } = {}): LocalDriver {
  const day: DayHandler[] = [];
  const month: DayHandler[] = [];
  const end: SeasonEndHandler[] = [];
  const inbox: InboxItem[] = [];
  const hooks: CareerHooks = {
    onDay: (h) => { day.push(h); },
    onMonth: (h) => { month.push(h); },
    onSeasonEnd: (h) => { end.push(h); },
    postInbox: (m) => { inbox.push(m); },
  };
  registerClubOps(hooks);
  let w = world;
  let date = world.club?.date ?? seasonStartDate(world.season);
  const step = () => {
    const next = addDays(date, 1);
    if (next > seasonEndDate(w.season)) {
      const ctx: SeasonEndContext = { standings: opts.standingsFor?.(w), date: seasonEndDate(w.season) };
      for (const h of end) w = h(w, ctx);
      date = seasonStartDate(w.season);
      for (const h of month) w = h(w, date);
      return;
    }
    date = next;
    for (const h of day) w = h(w, date);
    if (isFirstOfMonth(date)) for (const h of month) w = h(w, date);
  };
  return {
    get world() { return w; },
    get date() { return date; },
    inbox,
    advanceDays(n: number) { for (let i = 0; i < n; i++) step(); },
    advanceToNextSeason() { const s = w.season; while (w.season === s) step(); },
    setWorld(nw: World) { w = nw; date = nw.club?.date ?? date; },
  };
}
