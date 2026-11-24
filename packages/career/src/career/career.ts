// Career mode's day loop (FM's "Continue"):
//
//   continueCareer(state, sim)
//     leave today:   the manager's match must be played and answers given first; the day's other
//                    fixtures are simulated; hooks run (onDay, onMonth); the date moves on
//     then, day by day, stop at the first day that needs the manager:
//                    · their match day                      → "matchDay"
//                    · an inbox item waiting for an answer  → "message"
//                    · the season's last day (review)       → "seasonEnd"
//
// Leaving the season's last day runs the season transition: review, hooks.onSeasonEnd,
// advanceSeason (with the maps each league player really played), the new schedule,
// hooks.onSeasonStart and the board's new objective.
//
// `sim` plays the day's AI fixtures: synchronous (quickSeries) or a Promise (the desktop sends them
// to the match engine in another process). Fixture seeds come from (career seed, fixture id), so a
// result never depends on the order fixtures are played in.
import { advanceSeason } from "../season.ts";
import { clubCareerHook, drainClubOutbox, syncClubInbox } from "../club/career-hook.ts";
import { seasonFocus } from "../club/training.ts";
import { newProspects, startingFive, teamStaffInputs } from "../world.ts";
import { applyMatchLoad } from "./readiness.ts";
import { toScale200, estimateAbility, teamScout } from "../scouting.ts";
import type { World } from "../model.ts";
import { deriveSeed, mulberry32 } from "../rng.ts";
import { addDays, isMonthStart, monthOf, type IsoDate } from "./calendar.ts";
import { careerHooks, type CareerHook, type HookContext } from "./hooks.ts";
import { awaitingAnswer, postInbox, type InboxDraft, type InboxItem } from "./inbox.ts";
import {
  buildSeason, careerStartDate, GROUPS, resolvePlayoffs, stageDone, stagePlacings, STAGES, teamStrength,
} from "./schedule.ts";
import { allFixtures, eventOf, INTL_EVENTS, isIntl, leaguesOf, newCircuit, resolveEvent } from "./circuit.ts";
import { circuitProgress, upsetNews } from "./progress.ts";
import { REGIONS } from "../regions.ts";
import type { CareerState, CompetitionId, Fixture, Manager, SeasonSummary, SeriesOutcome, SeriesRequest, SimDepth, SimScope, StageId } from "./types.ts";
import { estimateForTeam } from "../knowledge.ts";
import { scoutingCareerHook } from "../knowledge-hook.ts";

export const CAREER_MODE = {
  /** Form update rate per map (see PlayerSeasonLine.form). */
  formRate: 0.25,
  /** Days a single Continue may cover before it stops anyway (safety). */
  maxDaysPerContinue: 400,
} as const;

export type StopReason = "matchDay" | "message" | "seasonEnd" | "limit";

export interface ContinueResult {
  readonly stop: StopReason;
  readonly date: IsoDate;
  readonly daysAdvanced: number;
  readonly fixture?: Fixture;
  readonly items?: readonly InboxItem[];
  readonly simulated: number;
}

export type Outcome = Omit<SeriesOutcome, "lineups">;
/** Plays a batch of series (one day's AI fixtures). May be async. */
export type BatchSimulator = (reqs: readonly SeriesRequest[], career: CareerState) => Outcome[] | Promise<Outcome[]>;

export interface CareerRuntime {
  /** Hooks beyond the registered ones (tests). */
  readonly hooks?: readonly CareerHook[];
  /** Called after each day is left (the desktop autosaves / shows progress here). */
  readonly onDayEnd?: (state: CareerState) => void | Promise<void>;
  /** Called before a day's AI fixtures are played. */
  readonly onSimulate?: (reqs: readonly SeriesRequest[], state: CareerState) => void;
}

// --- hook plumbing ----------------------------------------------------------------------------------

function hookCtx(state: CareerState, hook: CareerHook): HookContext {
  return {
    career: state,
    world: state.world,
    date: state.date,
    post: (draft: InboxDraft) => postInbox(state, draft, hook.id),
    rng: (label: string) => mulberry32(deriveSeed(state.seed, `hook:${hook.id}:${state.date}:${label}`)),
    ext: <T,>(init: () => T): T => {
      if (!(hook.id in state.ext)) state.ext[hook.id] = init();
      return state.ext[hook.id] as T;
    },
  };
}

/** Built-in hooks first (core bookkeeping, then the club layer), then the registered ones. */
const BUILT_IN = (): CareerHook[] => [coreHook, clubCareerHook, scoutingCareerHook];
const allHooks = (rt: CareerRuntime | undefined): CareerHook[] => {
  const builtIn = BUILT_IN();
  const ids = new Set(builtIn.map((h) => h.id));
  return [...builtIn, ...careerHooks(rt?.hooks ?? []).filter((h) => !ids.has(h.id))];
};

function runHooks(state: CareerState, rt: CareerRuntime | undefined, fn: (h: CareerHook, ctx: HookContext) => void): void {
  for (const h of allHooks(rt)) fn(h, hookCtx(state, h));
}

// --- creating a career --------------------------------------------------------------------------------

export interface NewCareerOptions {
  readonly seed: number;
  readonly manager: Manager;
  readonly userTeamId: string;
}

export function newCareer(world: World, opts: NewCareerOptions, rt?: CareerRuntime): CareerState {
  const team = world.teams[opts.userTeamId];
  if (!team) throw new Error(`unknown team ${opts.userTeamId}`);
  const seed = opts.seed >>> 0;
  const state: CareerState = {
    version: 2, seed, manager: { ...opts.manager }, userTeamId: team.teamId, region: team.region,
    date: careerStartDate(world.season), world, ...buildLeagues(world, team.region, team.teamId, world.season, seed),
    stats: {}, inbox: [], nextInboxId: 0, history: [], objective: null, ext: {},
  };
  postInbox(state, { category: "board", key: "welcome", from: "board", params: { team: team.name, manager: state.manager.name } });
  seasonOpeningMail(state);
  runHooks(state, rt, (h, ctx) => h.onCareerStart?.(state.world, ctx));
  return state;
}

/** The manager's league, the three other regions' leagues (played in parallel) and a fresh circuit. */
function buildLeagues(world: World, region: CareerState["region"], userTeamId: string, season: number, seed: number): Pick<CareerState, "season" | "others" | "circuit"> {
  return {
    season: buildSeason(world, region, userTeamId, season, seed),
    others: REGIONS.filter((r) => r !== region).map((r) => buildSeason(world, r, null, season, seed)),
    circuit: newCircuit(season),
  };
}

const teamName = (state: CareerState, id: string | null): string => (id ? state.world.teams[id]?.name ?? id : "?");

function strengthRank(state: CareerState): number {
  const ranked = [...state.season.teams].sort((a, b) => teamStrength(state.world, b) - teamStrength(state.world, a) || a.localeCompare(b));
  return ranked.indexOf(state.userTeamId) + 1;
}

/** The board's expectation from where the squad ranks in the league. */
export function suggestedObjective(state: CareerState): "title" | "international" | "playoffs" | "midtable" {
  const r = strengthRank(state);
  return r <= 1 ? "title" : r <= 3 ? "international" : r <= 8 ? "playoffs" : "midtable";
}

function seasonOpeningMail(state: CareerState): void {
  const w = state.world;
  const s1 = state.season.stages[0]!;
  const group = GROUPS.find((g) => s1.groups[g].includes(state.userTeamId)) ?? "alpha";
  const first = nextUserFixture(state);
  postInbox(state, {
    category: "board", key: "board.objective", from: "board",
    params: { season: state.season.season, suggested: suggestedObjective(state), rank: strengthRank(state), teams: state.season.teams.length },
    options: [{ id: "title" }, { id: "international" }, { id: "playoffs" }, { id: "midtable" }],
  });
  postInbox(state, {
    category: "competition", key: "league.schedule", from: "league",
    params: { season: state.season.season, group, teams: state.season.teams.length, date: first?.date ?? "", opponent: first ? teamName(state, first.home === state.userTeamId ? first.away : first.home) : "" },
    ...(first ? { ref: { fixtureId: first.id } } : {}),
  });
  const five = startingFive(w, state.userTeamId);
  postInbox(state, {
    category: "squad", key: "squad.overview", from: "headCoach",
    params: { starters: five.map((p) => p.handle ?? p.playerId).join(", "), rank: strengthRank(state), teams: state.season.teams.length },
  });
  const pros = newProspects(w).filter((p) => p.region === state.region);
  if (pros.length) {
    const est = (p: typeof pros[number]) => estimateForTeam(w, state.userTeamId, p);
    const best = [...pros].sort((a, b) => est(b).pa - est(a).pa || a.playerId.localeCompare(b.playerId))[0]!;
    postInbox(state, {
      category: "scouting", key: "scouting.prospects", from: "scout",
      params: { n: pros.length, best: best.handle ?? best.playerId, pa: toScale200(est(best).pa) ?? 0 },
      ref: { playerId: best.playerId },
    });
  }
}

// --- queries ------------------------------------------------------------------------------------------

export const isUserFixture = (state: CareerState, f: Fixture): boolean => f.home === state.userTeamId || f.away === state.userTeamId;

const byDate = (a: Fixture, b: Fixture): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id));

/** The manager's next unplayed fixture (teams known), in their league or at an international event. */
export function nextUserFixture(state: CareerState): Fixture | null {
  return allFixtures(state).filter((f) => !f.result && f.date >= state.date && f.home && f.away && isUserFixture(state, f)).sort(byDate)[0] ?? null;
}

/**
 * World sim depth (FM style): which AI series the full match engine plays; the rest use the
 * calibrated quick estimate. `quick`: none (the manager's own match is always played for real);
 * `league`: the manager's own league; `full`: every region and the international events.
 */
export const SIM_DEPTH_ENGINE: Readonly<Record<SimDepth, readonly SimScope[]>> = { quick: [], league: ["league"], full: ["league", "international", "other"] };
export const SIM_DEPTHS: readonly SimDepth[] = ["quick", "league", "full"];
export const usesEngine = (depth: SimDepth, scope: SimScope): boolean => SIM_DEPTH_ENGINE[depth].includes(scope);

/** Where a fixture is simulated from (the world sim depth setting): our league, an international event, or another region. */
export function fixtureScope(state: CareerState, f: Fixture): SimScope {
  return isIntl(f.stage) ? "international" : f.region === state.region ? "league" : "other";
}

export interface DayAgenda {
  readonly date: IsoDate;
  readonly userFixture: Fixture | null;
  readonly aiFixtures: Fixture[];
  readonly awaiting: InboxItem[];
  readonly seasonEnd: boolean;
}

export function dayAgenda(state: CareerState): DayAgenda {
  const today = allFixtures(state).filter((f) => f.date === state.date && !f.result && f.home && f.away).sort(byDate);
  return {
    date: state.date,
    userFixture: today.find((f) => isUserFixture(state, f)) ?? null,
    aiFixtures: today.filter((f) => !isUserFixture(state, f)),
    awaiting: awaitingAnswer(state),
    seasonEnd: state.date === state.season.end && !state.season.ended,
  };
}

/**
 * A team's five for its next match: the manager's chosen lineup (players still in the squad) for
 * the user's club, topped up in roster order; the roster's first five for everyone else.
 */
export function lineupFor(state: CareerState, teamId: string): string[] {
  const t = state.world.teams[teamId];
  if (!t) return [];
  if (teamId !== state.userTeamId || !state.lineup) return startingFive(state.world, teamId).map((p) => p.playerId);
  const squad = [...t.roster, ...t.academy].filter((id) => state.world.players[id]);
  const chosen = state.lineup.filter((id) => squad.includes(id)).slice(0, 5);
  for (const id of squad) { if (chosen.length >= 5) break; if (!chosen.includes(id)) chosen.push(id); }
  return chosen;
}

/** The manager picks today's five from the squad (roster + academy). */
export function setLineup(state: CareerState, ids: readonly string[]): void {
  const t = state.world.teams[state.userTeamId]!;
  const squad = new Set([...t.roster, ...t.academy]);
  const uniq = [...new Set(ids)];
  if (uniq.length !== 5) throw new Error("a lineup is five players");
  for (const id of uniq) if (!squad.has(id)) throw new Error(`${id} is not in the squad`);
  state.lineup = uniq;
}

/** A fixture as a simulation request: today's five per side and each side's analyst. */
export function seriesRequest(state: CareerState, f: Fixture): SeriesRequest {
  if (!f.home || !f.away) throw new Error(`fixture ${f.id} has no teams yet`);
  const side = (id: string) => ({
    teamId: id, name: teamName(state, id),
    lineup: lineupFor(state, id),
    analyst: teamStaffInputs(state.world, id).analyst,
  });
  return { fixtureId: f.id, scope: fixtureScope(state, f), seed: deriveSeed(state.seed, `series:${f.id}`), format: f.format, home: side(f.home), away: side(f.away) };
}

// --- results ------------------------------------------------------------------------------------------

function creditPlayers(state: CareerState, lineup: readonly string[], f: Fixture, home: boolean): void {
  const r = f.result!;
  for (const id of lineup) {
    const line = (state.stats[id] ??= { maps: 0, mapsWon: 0, roundsWon: 0, roundsLost: 0, kills: 0, deaths: 0, form: 0.5 });
    for (const m of r.maps) {
      const [mine, theirs] = home ? m.score : [m.score[1], m.score[0]];
      line.maps += 1;
      if (mine > theirs) line.mapsWon += 1;
      line.roundsWon += mine; line.roundsLost += theirs;
      const share = mine + theirs > 0 ? mine / (mine + theirs) : 0.5;
      const kd = m.players?.[id];
      if (kd) { line.kills += kd.k; line.deaths += kd.d; }
      const perf = kd && kd.k + kd.d > 0 ? 0.5 * share + 0.5 * (kd.k / (kd.k + kd.d)) : share;
      line.form = Math.round((line.form + CAREER_MODE.formRate * (perf - line.form)) * 10000) / 10000;
    }
  }
}

/** Record a played series: standings, playing time and form, the bracket, inbox, hooks. */
export function recordResult(state: CareerState, fixtureId: string, outcome: SeriesOutcome, rt?: CareerRuntime): Fixture {
  const f = allFixtures(state).find((x) => x.id === fixtureId);
  if (!f) throw new Error(`unknown fixture ${fixtureId}`);
  if (f.result) throw new Error(`fixture ${fixtureId} already has a result`);
  if (!f.home || !f.away) throw new Error(`fixture ${fixtureId} has no teams yet`);
  if (outcome.winner !== f.home && outcome.winner !== f.away) throw new Error(`winner ${outcome.winner} is not in fixture ${fixtureId}`);
  f.result = { ...outcome, mapsWon: [outcome.mapsWon[0], outcome.mapsWon[1]], maps: outcome.maps.map((m) => ({ ...m, score: [m.score[0], m.score[1]] as const })) };
  creditPlayers(state, outcome.lineups.home, f, true);
  creditPlayers(state, outcome.lineups.away, f, false);
  applyMatchLoad(state, outcome.lineups.home, outcome.maps.length, f.home === state.userTeamId);
  applyMatchLoad(state, outcome.lineups.away, outcome.maps.length, f.away === state.userTeamId);
  if (isUserFixture(state, f)) {
    const home = f.home === state.userTeamId;
    const won = outcome.winner === state.userTeamId;
    const [a, b] = home ? outcome.mapsWon : [outcome.mapsWon[1], outcome.mapsWon[0]];
    postInbox(state, {
      category: "result", key: won ? "result.win" : "result.loss", from: "analyst",
      params: {
        opponent: teamName(state, home ? f.away : f.home), score: `${a}–${b}`,
        maps: outcome.maps.map((m) => `${m.map} ${home ? m.score[0] : m.score[1]}–${home ? m.score[1] : m.score[0]}`).join(", "),
      },
      ref: { fixtureId: f.id },
    });
  }
  // Brackets: regional playoffs of every league and the international double-elimination brackets.
  const resolved = [...leaguesOf(state).flatMap((l) => resolvePlayoffs(l)), ...state.circuit.events.flatMap((e) => resolveEvent(e))];
  for (const nf of resolved) {
    if (isUserFixture(state, nf)) {
      postInbox(state, {
        category: "competition", key: isIntl(nf.stage) ? "circuit.nextRound" : "competition.nextRound", from: "league",
        params: { round: String(nf.round), opponent: teamName(state, nf.home === state.userTeamId ? nf.away : nf.home), date: nf.date, stage: nf.stage },
        ref: { fixtureId: nf.id },
      });
    }
  }
  upsetNews(state, f);
  runHooks(state, rt, (h, ctx) => h.onMatchResult?.(state.world, f, ctx));
  return f;
}

/** Play today's AI fixtures with `sim`. */
export async function simulateToday(state: CareerState, sim: BatchSimulator, rt?: CareerRuntime): Promise<number> {
  const ag = dayAgenda(state);
  if (ag.aiFixtures.length === 0) return 0;
  const reqs = ag.aiFixtures.map((f) => seriesRequest(state, f));
  rt?.onSimulate?.(reqs, state);
  const outs = await sim(reqs, state);
  reqs.forEach((req, i) => recordResult(state, req.fixtureId, { ...outs[i]!, lineups: { home: req.home.lineup, away: req.away.lineup } }, rt));
  return reqs.length;
}

// --- leaving a day ------------------------------------------------------------------------------------

/** The manager's league stages and the international events: finish places (1 = champions; absent = not played / not in it). */
function objectiveMet(objective: string | null, finish: Partial<Record<CompetitionId, number>>): boolean | undefined {
  if (!objective) return undefined;
  const stages = STAGES.map((st) => finish[st] ?? 99);
  const intl = INTL_EVENTS.map((e) => finish[e] ?? 99);
  if (objective === "title") return [...stages, ...intl].some((p) => p === 1);
  if (objective === "international") return intl.some((p) => p < 99);
  if (objective === "playoffs") return stages.filter((p) => p <= 8).length >= 2;
  return stages.some((p) => p <= 8);
}

function seasonFinish(state: CareerState): { finish: Partial<Record<CompetitionId, number>>; champions: Partial<Record<CompetitionId, string>>; met: boolean | undefined } {
  const finish: Partial<Record<CompetitionId, number>> = {};
  const champions: Partial<Record<CompetitionId, string>> = {};
  for (const s of STAGES) {
    if (!stageDone(state.season, s)) continue;
    const pl = stagePlacings(state.season, s);
    finish[s] = pl.indexOf(state.userTeamId) + 1; champions[s] = pl[0]!;
  }
  for (const id of INTL_EVENTS) {
    const ev = eventOf(state.circuit, id);
    if (!ev.champion) continue;
    champions[id] = ev.champion;
    const p = ev.placings.indexOf(state.userTeamId) + 1;
    if (p > 0) finish[id] = p;
  }
  return { finish, champions, met: objectiveMet(state.objective, finish) };
}

/** Arriving on the season's last day: the board's review. */
function seasonReviewMail(state: CareerState): void {
  const { finish, met } = seasonFinish(state);
  postInbox(state, {
    category: "season", key: "season.review", from: "board",
    params: {
      season: state.season.season, kickoff: finish.kickoff ?? 0, stage1: finish.stage1 ?? 0, stage2: finish.stage2 ?? 0,
      m1: finish.masters1 ? String(finish.masters1) : "–", m2: finish.masters2 ? String(finish.masters2) : "–", ch: finish.champions ? String(finish.champions) : "–",
      objective: state.objective ?? "none", met: met === undefined ? "none" : met ? "yes" : "no",
    },
  });
}

/** The season's last day is left: review → onSeasonEnd → advanceSeason → new season. */
function endSeason(state: CareerState, rt?: CareerRuntime): void {
  const season = state.season;
  const { finish, champions, met } = seasonFinish(state);
  const summary: SeasonSummary = { season: season.season, champions, userFinish: finish, ...(state.objective ? { objective: state.objective } : {}), ...(met !== undefined ? { objectiveMet: met } : {}) };
  state.history.push(summary);
  season.ended = true;
  runHooks(state, rt, (h, ctx) => h.onSeasonEnd?.(state.world, season.season, ctx));

  // Playing time: the real count for every player of a league team (0 for those who never played);
  // players elsewhere keep the status estimate.
  const mapsPlayed: Record<string, number> = {};
  for (const l of leaguesOf(state)) for (const tid of l.teams) for (const pid of state.world.teams[tid]?.roster ?? []) mapsPlayed[pid] = 0;
  for (const [pid, line] of Object.entries(state.stats)) mapsPlayed[pid] = line.maps;
  const before = new Set(state.world.teams[state.userTeamId]?.roster ?? []);
  // Development with the season's training focus; the manager's squad is left to the manager.
  const form: Record<string, number> = {};
  for (const [pid, line] of Object.entries(state.stats)) if (line.maps > 0) form[pid] = line.form;
  state.world = advanceSeason(state.world, { mapsPlayed, focus: seasonFocus(state.world), managedTeams: [state.userTeamId], form });
  const rec = state.world.history[state.world.history.length - 1]!;
  const team = state.world.teams[state.userTeamId]!;
  const name = (id: string) => state.world.players[id]?.handle ?? state.world.retired.find((r) => r.id === id)?.label ?? id;
  const joined = team.roster.filter((id) => !before.has(id));
  const left = [...before].filter((id) => !team.roster.includes(id));
  postInbox(state, {
    category: "squad", key: "squad.changes", from: "headCoach",
    params: { season: state.world.season, joined: joined.map(name).join(", ") || "—", left: left.map(name).join(", ") || "—", retired: rec.retiredPlayers.length },
  });
  Object.assign(state, buildLeagues(state.world, state.region, state.userTeamId, state.world.season, state.seed));
  state.stats = {};
  state.objective = null;
  seasonOpeningMail(state);
  runHooks(state, rt, (h, ctx) => h.onSeasonStart?.(state.world, state.world.season, ctx));
}

/**
 * Leave today: requires the manager's match played and answers given; plays nothing itself
 * (call simulateToday first). Runs the day's hooks, stage bookkeeping, the season transition on
 * the season's last day, and moves the date on.
 */
export function endDay(state: CareerState, rt?: CareerRuntime): void {
  const ag = dayAgenda(state);
  if (ag.userFixture) throw new Error("play today's match first");
  if (ag.aiFixtures.length) throw new Error("today's fixtures are not played yet");
  if (ag.awaiting.length) throw new Error("answer the waiting messages first");
  circuitProgress(state);
  runHooks(state, rt, (h, ctx) => h.onDay?.(state.world, state.date, ctx));
  if (isMonthStart(state.date)) runHooks(state, rt, (h, ctx) => h.onMonth?.(state.world, state.date, ctx));
  const seasonEnd = state.date === state.season.end && !state.season.ended;
  if (seasonEnd) endSeason(state, rt);
  state.date = addDays(state.date, 1);
  if (state.date === state.season.end) seasonReviewMail(state);
}

/** Answer an inbox item (routes the answer to the hook that posted it). */
export function answerInbox(state: CareerState, itemId: string, answer: string, rt?: CareerRuntime): void {
  const item = state.inbox.find((m) => m.id === itemId);
  if (!item) throw new Error(`unknown inbox item ${itemId}`);
  if (!item.options?.some((o) => o.id === answer)) throw new Error(`"${answer}" is not an option of ${itemId}`);
  item.answer = answer;
  item.read = true;
  for (const h of allHooks(rt)) {
    if (h.id === item.source) h.onAnswer?.(state.world, item, answer, hookCtx(state, h));
  }
}

export function markRead(state: CareerState, itemId: string): void {
  const item = state.inbox.find((m) => m.id === itemId);
  if (item) item.read = true;
}

/** FM's Continue: leave today, then advance day by day until something needs the manager. */
export async function continueCareer(state: CareerState, sim: BatchSimulator, rt?: CareerRuntime): Promise<ContinueResult> {
  let simulated = 0;
  let days = 0;
  const stopIfNeeded = (first: boolean): ContinueResult | null => {
    const ag = dayAgenda(state);
    if (ag.userFixture) return { stop: "matchDay", date: state.date, daysAdvanced: days, fixture: ag.userFixture, simulated };
    if (ag.awaiting.length) return { stop: "message", date: state.date, daysAdvanced: days, items: ag.awaiting, simulated };
    if (!first && ag.seasonEnd) return { stop: "seasonEnd", date: state.date, daysAdvanced: days, simulated };
    return null;
  };
  // Today: the manager's match and answers block leaving it.
  const blocked = stopIfNeeded(true);
  if (blocked) return blocked;
  while (days < CAREER_MODE.maxDaysPerContinue) {
    simulated += await simulateToday(state, sim, rt);
    endDay(state, rt);
    days += 1;
    await rt?.onDayEnd?.(state);
    const stop = stopIfNeeded(false);
    if (stop) return stop;
  }
  return { stop: "limit", date: state.date, daysAdvanced: days, simulated };
}

/** A synchronous series simulator as a batch simulator. */
export const batchOf = (one: (req: SeriesRequest, career: CareerState) => Outcome): BatchSimulator =>
  (reqs, career) => reqs.map((r) => one(r, career));

// --- the core hook: the board's objective and monthly staff reports -----------------------------------

const coreHook: CareerHook = {
  id: "career",
  order: 0,
  onAnswer(_w, item, answer, ctx) {
    if (item.key === "board.objective") {
      ctx.career.objective = answer;
      ctx.post({ category: "board", key: "board.objectiveSet", from: "board", params: { objective: answer } });
    }
  },
  onMonth(w, date, ctx) {
    const state = ctx.career;
    if (state.season.ended || monthOf(date) === 9) return;
    // Head coach: who is in form and who is not (from maps actually played this season).
    const lines = (w.teams[state.userTeamId]?.roster ?? []).map((id) => ({ id, line: state.stats[id] })).filter((x) => x.line && x.line.maps > 0);
    if (lines.length >= 2) {
      const sorted = [...lines].sort((a, b) => b.line!.form - a.line!.form || a.id.localeCompare(b.id));
      const label = (id: string) => w.players[id]?.handle ?? id;
      ctx.post({
        category: "staff", key: "staff.formReport", from: "headCoach",
        params: { best: label(sorted[0]!.id), bestForm: Math.round(sorted[0]!.line!.form * 100), worst: label(sorted[sorted.length - 1]!.id), worstForm: Math.round(sorted[sorted.length - 1]!.line!.form * 100) },
        ref: { playerId: sorted[0]!.id },
      });
    }
    // Scout: the free agent in the region the scout rates highest right now.
    const free = Object.values(w.players).filter((p) => p.status === "free" && p.region === state.region && p.hasRatings);
    if (free.length) {
      const est = (p: typeof free[number]) => estimateForTeam(w, state.userTeamId, p);
      const best = [...free].sort((a, b) => (est(b).ca ?? 0) - (est(a).ca ?? 0) || a.playerId.localeCompare(b.playerId))[0]!;
      const core = ctx.ext(() => ({ flags: [] as string[] })) as { flags: string[]; lastFreeAgent?: string };
      if (core.lastFreeAgent === best.playerId) return;
      core.lastFreeAgent = best.playerId;
      ctx.post({
        category: "scouting", key: "scouting.freeAgent", from: "scout",
        params: { player: best.handle ?? best.playerId, ca: toScale200(est(best).ca) ?? 0, pa: toScale200(est(best).pa) ?? 0, age: best.age },
        ref: { playerId: best.playerId },
      });
    }
  },
};
