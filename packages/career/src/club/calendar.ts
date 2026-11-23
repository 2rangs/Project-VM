// Date helpers (YYYY-MM-DD strings, UTC) and the transfer-window calendar.
import { CLUB_MODEL } from "./constants.ts";

const parse = (d: string): Date => new Date(`${d}T00:00:00Z`);
const fmt = (t: Date): string => t.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const t = parse(date);
  t.setUTCDate(t.getUTCDate() + n);
  return fmt(t);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export const dayOfWeek = (date: string): number => parse(date).getUTCDay();
export const yearOf = (date: string): number => Number(date.slice(0, 4));
export const monthOf = (date: string): number => Number(date.slice(5, 7));
export const monthKey = (date: string): string => date.slice(0, 7);
export const isFirstOfMonth = (date: string): boolean => date.slice(8, 10) === "01";

export const seasonStartDate = (season: number): string => `${season}-${CLUB_MODEL.seasonStart}`;
export const seasonEndDate = (season: number): string => `${season}-${CLUB_MODEL.seasonEnd}`;

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
