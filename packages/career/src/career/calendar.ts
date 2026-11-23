// Calendar dates for career mode: plain ISO "YYYY-MM-DD" strings (sortable, JSON-safe, no time
// zone). All arithmetic is done in UTC so a save loads to the same day on every machine.

export type IsoDate = string;

const toUtc = (d: IsoDate): Date => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
};
const fromUtc = (d: Date): IsoDate => d.toISOString().slice(0, 10);

export function isoDate(year: number, month: number, day: number): IsoDate {
  return fromUtc(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: IsoDate): number => toUtc(d).getUTCDay();
export const yearOf = (d: IsoDate): number => Number(d.slice(0, 4));
export const monthOf = (d: IsoDate): number => Number(d.slice(5, 7));
export const dayOf = (d: IsoDate): number => Number(d.slice(8, 10));

/** Whole days from a to b (b − a). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** The first date on or after `d` that falls on `wd` (0 = Sunday). */
export function nextWeekday(d: IsoDate, wd: number): IsoDate {
  return addDays(d, (wd - weekday(d) + 7) % 7);
}

/** True when `d` is the first day of a month. */
export const isMonthStart = (d: IsoDate): boolean => dayOf(d) === 1;
