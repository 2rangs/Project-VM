// Career-mode data: the manager, the calendar, the season's competition, results and inbox.
// Everything here is plain JSON so a CareerState saves and loads as-is (save.ts).
import type { World } from "../model.ts";
import type { Region } from "../regions.ts";
import type { IsoDate } from "./calendar.ts";
import type { InboxItem } from "./inbox.ts";

export type SeriesFormatId = "bo1" | "bo3" | "bo5";
export type StageId = "stage1" | "stage2";
export type GroupId = "alpha" | "omega";
export type PlayoffRound = "qf" | "sf" | "final";

/** Where a playoff slot's team comes from before it is known. */
export type SlotSource =
  | { readonly kind: "seed"; readonly group: GroupId; readonly rank: number }
  | { readonly kind: "winner"; readonly fixtureId: string };

export interface MapResult {
  readonly map: string;
  /** Rounds won: [home, away]. */
  readonly score: readonly [number, number];
  readonly overtime?: boolean;
}

export interface SeriesOutcome {
  readonly winner: string;
  /** Maps won: [home, away]. */
  readonly mapsWon: readonly [number, number];
  readonly maps: readonly MapResult[];
  /** Who produced it: the full match engine, the quick estimate, or the manager's own match. */
  readonly source: "engine" | "quick" | "user";
  /** The five who played for each side (player ids). */
  readonly lineups: { readonly home: readonly string[]; readonly away: readonly string[] };
}

export interface Fixture {
  readonly id: string;
  readonly season: number;
  readonly stage: StageId;
  readonly phase: "group" | "playoff";
  readonly group?: GroupId;
  /** Group round number (1-based) or the playoff round. */
  readonly round: number | PlayoffRound;
  readonly date: IsoDate;
  readonly format: SeriesFormatId;
  home: string | null;
  away: string | null;
  readonly homeFrom?: SlotSource;
  readonly awayFrom?: SlotSource;
  result?: SeriesOutcome;
}

export interface StageState {
  readonly id: StageId;
  /** Group draw (team ids); empty until the stage is drawn. */
  groups: Record<GroupId, string[]>;
  /** First and last match day (known once drawn). */
  start: IsoDate | null;
  end: IsoDate | null;
  /** Date the stage is drawn (stage 2 is drawn from stage 1's results). */
  readonly drawDate: IsoDate;
  champion: string | null;
}

export interface SeasonState {
  readonly season: number;
  readonly region: Region;
  /** League members (team ids), strongest first at the start of the season. */
  readonly teams: string[];
  stages: StageState[];
  fixtures: Fixture[];
  /** Season end: the season review and advanceSeason run when this day is reached. */
  readonly end: IsoDate;
  /** The day the next season starts (the new schedule's first day). */
  readonly nextStart: IsoDate;
  ended: boolean;
}

export interface PlayerSeasonLine {
  /** Maps played this season (development uses it as playing time). */
  maps: number;
  mapsWon: number;
  roundsWon: number;
  roundsLost: number;
  /**
   * Form: exponentially-weighted round share of the maps played (0.5 = even), updated per map:
   *   form ← form + FORM_RATE · (roundsWon / roundsPlayed − form)
   */
  form: number;
}

export interface Manager {
  readonly name: string;
  /** ISO-3166 alpha-2 country code (lowercase). */
  readonly nationality: string;
}

export interface SeasonSummary {
  readonly season: number;
  readonly champions: Partial<Record<StageId, string>>;
  readonly userFinish: Partial<Record<StageId, number>>;
  readonly objective?: string;
  readonly objectiveMet?: boolean;
}

export interface CareerState {
  readonly version: 1;
  /** Career seed (the world has its own seed, derived from this). */
  readonly seed: number;
  readonly manager: Manager;
  readonly userTeamId: string;
  readonly region: Region;
  date: IsoDate;
  world: World;
  season: SeasonState;
  /** Current-season playing time and form per player. */
  stats: Record<string, PlayerSeasonLine>;
  inbox: InboxItem[];
  nextInboxId: number;
  history: SeasonSummary[];
  /** The board's objective for this season (set by the manager's answer). */
  objective: string | null;
  /** Saved state of extension hooks, by hook id (see hooks.ts). */
  ext: Record<string, unknown>;
}

/** One side of a series to simulate: the team, today's five and its analyst. */
export interface SeriesSide {
  readonly teamId: string;
  readonly name: string;
  readonly lineup: readonly string[];
  readonly analyst: number;
}

/** A fixture ready to simulate (both teams known, not yet played). */
export interface SeriesRequest {
  readonly fixtureId: string;
  readonly seed: number;
  readonly format: SeriesFormatId;
  readonly home: SeriesSide;
  readonly away: SeriesSide;
}

/** Plays one series synchronously (tests, quick sim). The desktop runs the engine off-thread instead. */
export type SeriesSimulator = (req: SeriesRequest, career: CareerState) => Omit<SeriesOutcome, "lineups">;
