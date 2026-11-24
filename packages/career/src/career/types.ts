// Career-mode data: the manager, the calendar, the season's competition, results and inbox.
// Everything here is plain JSON so a CareerState saves and loads as-is (save.ts).
import type { World } from "../model.ts";
import type { Region } from "../regions.ts";
import type { IsoDate } from "./calendar.ts";
import type { InboxItem } from "./inbox.ts";

export type SeriesFormatId = "bo1" | "bo3" | "bo5";
/** The three regional stages of the circuit, in the order they are played. */
export type StageId = "kickoff" | "stage1" | "stage2";
/** The international events: Masters after Stage 1 and Stage 2, Champions at the end. */
export type IntlId = "masters1" | "masters2" | "champions";
export type CompetitionId = StageId | IntlId;
/** Regional groups; international groups are "a".."d". */
export type GroupId = "alpha" | "omega";
export type PlayoffRound = "qf" | "sf" | "final";
/** Double-elimination rounds of an international playoff: upper (u), lower (l), grand final. */
export type BracketRound = "ubr1" | "lbr1" | "ubr2" | "lbr2" | "lbr3" | "ubf" | "lbf" | "gf";

/** Where a slot's team comes from before it is known. */
export type SlotSource =
  | { readonly kind: "seed"; readonly group: string; readonly rank: number }
  | { readonly kind: "winner"; readonly fixtureId: string }
  | { readonly kind: "loser"; readonly fixtureId: string };

export interface MapResult {
  readonly map: string;
  /** Rounds won: [home, away]. */
  readonly score: readonly [number, number];
  readonly overtime?: boolean;
  /** Kills / deaths per player id on this map, when the simulator reports them. */
  readonly players?: Readonly<Record<string, { readonly k: number; readonly d: number }>>;
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
  readonly stage: CompetitionId;
  readonly phase: "group" | "playoff";
  readonly group?: string;
  /** Group round number (1-based), the regional playoff round or the double-elimination round. */
  readonly round: number | PlayoffRound | BracketRound;
  /** The region of a regional fixture (absent for internationals). */
  readonly region?: Region;
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

/** One international event: Masters (12 teams) or Champions (16): groups, then 8-team double elimination. */
export interface IntlEvent {
  readonly id: IntlId;
  /** Qualified teams in seed order (best Champions Points first); empty until drawn. */
  teams: string[];
  /** Why each team is there: teamId → its region and Champions Points at the draw. */
  qualified: Record<string, { region: Region; points: number }>;
  /** Group draw: "a".."d" → team ids. */
  groups: Record<string, string[]>;
  fixtures: Fixture[];
  start: IsoDate | null;
  end: IsoDate | null;
  champion: string | null;
  /** Final placing of every team (1 = champion), once the event is over. */
  placings: string[];
}

/** Champions Points awarded for a placing in a competition. */
export interface PointsAward {
  readonly event: CompetitionId;
  readonly region?: Region;
  readonly teamId: string;
  readonly place: number;
  readonly points: number;
}

/** The international side of the season: events, and the Champions Points that qualify for them. */
export interface CircuitState {
  readonly season: number;
  events: IntlEvent[];
  /** Champions Points this season, by team. */
  points: Record<string, number>;
  awards: PointsAward[];
  /** Competitions whose points have been awarded and news posted ("kickoff:pacific", "masters1"). */
  done: string[];
}

export interface PlayerSeasonLine {
  /** Maps played this season (development uses it as playing time). */
  maps: number;
  mapsWon: number;
  roundsWon: number;
  roundsLost: number;
  kills: number;
  deaths: number;
  /**
   * Form (0..1, 0.5 = par), exponentially weighted over the maps played:
   *   perf  = ½ · roundsWon / roundsPlayed + ½ · k / (k + d)      (round share alone without K/D)
   *   form ← form + formRate · (perf − form)
   */
  form: number;
  /** Match sharpness after the last map played (career/readiness.ts), and that day. */
  sharpness?: number;
  lastPlayed?: IsoDate;
}

export interface Manager {
  readonly name: string;
  /** ISO-3166 alpha-2 country code (lowercase). */
  readonly nationality: string;
}

export interface SeasonSummary {
  readonly season: number;
  readonly champions: Partial<Record<CompetitionId, string>>;
  readonly userFinish: Partial<Record<CompetitionId, number>>;
  readonly objective?: string;
  readonly objectiveMet?: boolean;
}

export interface CareerState {
  readonly version: 2;
  /** Career seed (the world has its own seed, derived from this). */
  readonly seed: number;
  readonly manager: Manager;
  readonly userTeamId: string;
  readonly region: Region;
  date: IsoDate;
  world: World;
  /** The manager's own league (their region). */
  season: SeasonState;
  /** The other three regions' leagues, played in parallel (they meet the manager's region only at internationals). */
  others: SeasonState[];
  /** The international circuit: events, Champions Points. */
  circuit: CircuitState;
  /** Current-season playing time and form per player. */
  stats: Record<string, PlayerSeasonLine>;
  inbox: InboxItem[];
  nextInboxId: number;
  history: SeasonSummary[];
  /** The board's objective for this season (set by the manager's answer). */
  objective: string | null;
  /**
   * The manager's chosen starting five (player ids). Players no longer in the squad drop out and
   * the roster order fills the gaps (lineupFor). Absent: the roster's first five.
   */
  lineup?: string[];
  /** Saved state of extension hooks, by hook id (see hooks.ts). */
  ext: Record<string, unknown>;
}

/** league = the manager's own league, international = Masters/Champions, other = other regions' leagues. */
export type SimScope = "league" | "international" | "other";
/** World sim depth: which AI series the full engine plays (the rest use the calibrated quick estimate). */
export type SimDepth = "quick" | "league" | "full";

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
  /** Where the fixture belongs (decides engine vs quick under the world sim depth setting). */
  readonly scope: SimScope;
  readonly seed: number;
  readonly format: SeriesFormatId;
  readonly home: SeriesSide;
  readonly away: SeriesSide;
}

/** Plays one series synchronously (tests, quick sim). The desktop runs the engine off-thread instead. */
export type SeriesSimulator = (req: SeriesRequest, career: CareerState) => Omit<SeriesOutcome, "lineups">;
