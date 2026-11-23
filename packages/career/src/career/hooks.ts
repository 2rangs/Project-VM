// Extension hooks for career mode. Other career modules (contracts, wages, finance, transfers,
// training, …) plug into the calendar here instead of editing the day loop:
//
//   import { registerCareerHook } from "@pv/career";
//   registerCareerHook({
//     id: "finance",
//     onDay(world, date, ctx)      { … },                 // every day, after the day's matches
//     onMonth(world, date, ctx)    { ctx.post({ … }) },   // the 1st of each month, after onDay
//     onSeasonEnd(world, season, ctx) { … },              // before advanceSeason (development etc.)
//   });
//
// Contract (kept stable — see docs/CAREER_MODE.md §6):
// - Hooks run in ascending `order` (default 100), then by `id`, so the result never depends on
//   import order. They run synchronously inside the day step.
// - A hook may change the World for its own domain (contracts, wages, rosters through its own
//   rules). Changing rosters mid-season changes who plays the next fixture.
// - Randomness must come from `ctx.rng(label)` (seeded by career seed, hook id, date and label) so
//   the same save played twice gives the same career.
// - Saved state lives in `ctx.ext(() => initial)` — a JSON object stored in the career save under
//   the hook's id. Keep it plain JSON.
// - Inbox items go through `ctx.post(draft)`; `source` is set to the hook id, and answers to items
//   with `options` come back through `onAnswer`.
import type { World } from "../model.ts";
import type { Rng } from "../rng.ts";
import type { IsoDate } from "./calendar.ts";
import type { InboxDraft, InboxItem } from "./inbox.ts";
import type { CareerState, Fixture } from "./types.ts";

export interface HookContext {
  /** The whole career (read it freely; change only what belongs to your module). */
  readonly career: CareerState;
  readonly world: World;
  readonly date: IsoDate;
  /** Post an inbox item from this hook. */
  post(draft: InboxDraft): InboxItem;
  /** Deterministic random stream for (career seed, hook id, date, label). */
  rng(label: string): Rng;
  /** This hook's own saved state (created with `init` on first use). */
  ext<T>(init: () => T): T;
}

export interface CareerHook {
  /** Unique, stable id: names the saved `ext` slot and the `source` of posted inbox items. */
  readonly id: string;
  /** Run order (ascending, default 100). Core career bookkeeping runs at 0. */
  readonly order?: number;
  /** Once, when a new career is created (after the first season's schedule exists). */
  onCareerStart?(world: World, ctx: HookContext): void;
  /** Every calendar day, after that day's fixtures are played, before the date moves on. */
  onDay?(world: World, date: IsoDate, ctx: HookContext): void;
  /** The 1st of every month (after onDay of that day). */
  onMonth?(world: World, date: IsoDate, ctx: HookContext): void;
  /** After a series is recorded (any fixture in the user's league). */
  onMatchResult?(world: World, fixture: Fixture, ctx: HookContext): void;
  /** When the season ends, BEFORE advanceSeason (development, ageing, retirement, intake). */
  onSeasonEnd?(world: World, season: number, ctx: HookContext): void;
  /** After advanceSeason, once the new season's schedule exists. `world` is the new World. */
  onSeasonStart?(world: World, season: number, ctx: HookContext): void;
  /** The manager answered one of this hook's inbox items. */
  onAnswer?(world: World, item: InboxItem, answer: string, ctx: HookContext): void;
}

const registry = new Map<string, CareerHook>();

/** Register (or replace, by id) a hook for every career in this process. */
export function registerCareerHook(hook: CareerHook): () => void {
  registry.set(hook.id, hook);
  return () => { if (registry.get(hook.id) === hook) registry.delete(hook.id); };
}

export function unregisterCareerHook(id: string): void { registry.delete(id); }

/** Registered hooks in run order. */
export function careerHooks(extra: readonly CareerHook[] = []): CareerHook[] {
  const all = new Map(registry);
  for (const h of extra) all.set(h.id, h);
  return [...all.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
}
