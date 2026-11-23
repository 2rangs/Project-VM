// The transfer-window calendar. Dates are the career calendar's ISO strings (career/calendar.ts —
// the one date helper of the package); the season's first and last day are career mode's.
import { addDays, daysBetween, isoDate, monthOf, weekday, yearOf } from "../career/calendar.ts";
import { CLUB_MODEL } from "./constants.ts";

export { addDays, daysBetween, monthOf, yearOf };
/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = weekday;
export const monthKey = (date: string): string => date.slice(0, 7);

/** A career's first day of a season, and the season's last day (career/schedule.ts SCHEDULE_MODEL). */
export const seasonStartDate = (season: number): string => isoDate(season, CLUB_MODEL.seasonStart[0], CLUB_MODEL.seasonStart[1]);
export const seasonEndDate = (season: number): string => isoDate(season, CLUB_MODEL.seasonEnd[0], CLUB_MODEL.seasonEnd[1]);

export interface WindowStatus {
  readonly open: boolean;
  /** The open window (or the next one). */
  readonly id: string;
  readonly from: string;
  readonly to: string;
  /** Days until it closes (open) or opens (closed). */
  readonly days: number;
  /** Key unique per window per year. */
  readonly key: string;
}

/** The transfer window on a date: the open one, or the next to open. */
export function windowStatus(date: string): WindowStatus {
  const y = yearOf(date);
  const all = [y, y + 1].flatMap((yy) => CLUB_MODEL.windows.map((w) => ({ id: w.id, from: `${yy}-${w.from}`, to: `${yy}-${w.to}`, key: `${yy}-${w.id}` })));
  for (const w of all) {
    if (date >= w.from && date <= w.to) return { ...w, open: true, days: daysBetween(date, w.to) };
  }
  const next = all.filter((w) => w.from > date).sort((a, b) => a.from.localeCompare(b.from))[0]!;
  return { ...next, open: false, days: daysBetween(date, next.from) };
}

export const windowOpen = (date: string): boolean => windowStatus(date).open;
