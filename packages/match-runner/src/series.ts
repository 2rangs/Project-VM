/**
 * Series layer (docs/SERIES_AND_VETO.md): best-of-1/3/5 above the single-map match engine.
 *
 *   prepare  → each team's map mastery, its scouting report on the other, its veto beliefs
 *   veto     → bans / picks / sides step by step (human or AI per team), last map = decider
 *   games    → one MatchEngine game per map; the team that starts on attack takes engine slot A,
 *              and each team's mastery / scouting prior / game plan go in as `teamInputs`
 *   result   → every game carries its map, who picked it and the starting sides
 *
 * Deterministic: the same config (seed included) and the same human choices give the same series.
 * Game seeds depend only on the series seed, the game number and the map — not on mastery or
 * scouting — so a counterfactual changes exactly the inputs it names.
 *
 * LIMITATION (temporary): the engine has spatial data for Ascent only. Every map of a series is
 * simulated on the Ascent geometry with THAT map's mastery, scouting and veto applied; the map id
 * still travels on every game (MatchConfig.map, SeriesGameContext), so real geometry is a loader
 * change (`loadSpatial`) and nothing here moves.
 */
import type { TeamMapRecord } from "@pv/game-data";
import { deriveSeed } from "@pv/round-simulator";
import type { OpponentPrior } from "@pv/team-engine";
import type { MatchConfig, Side, TeamRef, TeamSlot } from "./match.js";
import { createMatchSession, type MatchSession, type MatchSessionResult } from "./session.js";
import { gamePlanPrior, type GamePlan, type SeriesGameContext, type TeamMatchInputs } from "./team-inputs.js";
import { leagueMasteryReference, mapMastery, masteryEngineInputs, type MapMastery } from "./mastery.js";
import { buildScoutingReport, opponentPriorFromLogs, teamGameLog, type ScoutingReport, type TeamGameLog, type WeightedLog } from "./scouting.js";
import {
  DEFAULT_MAP_POOL,
  VETO_FORMATS,
  VetoProcess,
  recommendVeto,
  type SeriesFormatId,
  type SeriesTeam,
  type VetoAction,
  type VetoBeliefs,
  type VetoFormat,
  type VetoMap,
  type VetoPrompt,
  type VetoRecommendation,
} from "./veto.js";

/** The map whose spatial data every game is currently simulated on. */
export const SIMULATED_GEOMETRY = "Ascent";

/**
 * The veto's belief model — how a team turns mastery into "our chance on that map". It steers
 * choices only; no outcome is computed from it.
 *
 *     p(map) = σ( logit(base) + masterySlope · (M_own − M̂_opp) )
 *
 * masterySlope 0.8 reads a mastery gap of 0.25 as about 5 points of map win rate — a design value
 * of the same order as the measurement (docs §6.1: 54.0% → 57.5% → 61.0% for d = −0.25 / 0 / +0.25,
 * n = 200 maps each, ±7 points).
 */
export const VETO_BELIEF = { masterySlope: 0.8 } as const;

export interface SeriesTeamConfig extends TeamRef {
  /** Today's five (game-data player ids) for mastery. Default: the first five of the roster. */
  readonly lineup?: ReadonlyArray<string | null>;
  /** The team's record per map. Default: game-data. A career mode passes its running record. */
  readonly mapRecords?: Readonly<Record<string, TeamMapRecord>>;
  /** Staff: analyst quality 0..1 (pre-match option). Default 0.5. */
  readonly staff?: { readonly analyst?: number };
  /** Study the opponent before the series. Default true (needs the opponent's `history`). */
  readonly scouting?: boolean;
  /** The team's own standing game plan (site leans). Default none. */
  readonly gamePlan?: GamePlan;
  /** THIS team's observable past games, most recent last — what the opponent can scout. */
  readonly history?: readonly TeamGameLog[];
}

export interface SeriesConfig {
  /** Team A starts the map selection (the ruleset lets the better seed choose to be A or B). */
  readonly teamA: SeriesTeamConfig;
  readonly teamB: SeriesTeamConfig;
  /** "bo1" | "bo3" | "bo5" (VCT presets) or any VetoFormat. Default "bo3". */
  readonly format?: SeriesFormatId | VetoFormat;
  /** Default: DEFAULT_MAP_POOL. */
  readonly mapPool?: readonly string[];
  readonly seed: number;
  /** Apply map mastery to the games. Default true; false plays every map on default values. */
  readonly mastery?: boolean;
  /** Carry what each team saw of the other from one map of the series into the next. Default true. */
  readonly carryOver?: boolean;
  /** Team A's baseline chance to win a map against B, as both teams estimate it. Default 0.5. */
  readonly baselineWinProbabilityA?: number;
  /** Options passed through to every game. */
  readonly match?: Pick<MatchConfig, "tuning" | "minThrowRates" | "opponentMemory" | "enableAbilities" | "maxRounds" | "recordPerception">;
}

export interface SeriesPreparation {
  readonly pool: readonly string[];
  readonly format: VetoFormat;
  /** League reference mastery M₀ for this pool. */
  readonly reference: number;
  /** Each team's own mastery per pool map. */
  readonly mastery: Readonly<Record<SeriesTeam, Readonly<Record<string, MapMastery>>>>;
  /** Each team's report on the OTHER team (null when it did not scout). */
  readonly scouting: Readonly<Record<SeriesTeam, ScoutingReport | null>>;
  /** Each team's estimated chance per map — what its veto is decided on. */
  readonly beliefs: Readonly<Record<SeriesTeam, VetoBeliefs>>;
}

export interface SeriesGameResult extends SeriesGameContext {
  readonly winner: SeriesTeam;
  /** Round score by series team. */
  readonly score: Readonly<Record<SeriesTeam, number>>;
  /** Mastery of the map and its distance d from the league reference, per series team. */
  readonly mastery: Readonly<Record<SeriesTeam, { readonly value: number; readonly delta: number }>>;
  /** The per-team values that went into the engine for this game. */
  readonly inputs: Readonly<Record<SeriesTeam, TeamMatchInputs>>;
  /** The full match result (its config carries `map` and `series`). Engine slots: see `slots`. */
  readonly match: MatchSessionResult;
}

export interface SeriesResult {
  readonly config: SeriesConfig;
  readonly preparation: SeriesPreparation;
  readonly veto: { readonly actions: readonly VetoAction[]; readonly maps: readonly VetoMap[]; readonly banned: readonly string[] };
  readonly games: readonly SeriesGameResult[];
  readonly winner: SeriesTeam;
  /** Maps won. */
  readonly score: Readonly<Record<SeriesTeam, number>>;
}

export interface SeriesState {
  readonly phase: "veto" | "playing" | "finished";
  readonly score: Readonly<Record<SeriesTeam, number>>;
  readonly winsNeeded: number;
  readonly vetoActions: readonly VetoAction[];
  readonly maps: readonly VetoMap[];
  readonly banned: readonly string[];
  readonly remaining: readonly string[];
  readonly gamesPlayed: number;
  /** The game that is open (started, not yet finished), if any. */
  readonly gameInProgress: boolean;
}

/** One map of the series, opened for round-by-round play. */
export interface SeriesGameSession {
  readonly context: SeriesGameContext;
  /** The interactive match (rounds, timeouts, orders). Engine slots: `context.slots`. */
  readonly session: MatchSession;
}

export interface SeriesSession {
  /** Mastery, scouting reports and veto beliefs — available before the first veto step. */
  preparation(): SeriesPreparation;
  state(): SeriesState;
  /** The veto choice being waited for, with the acting team's own recommendation. Null when done. */
  pendingVeto(): (VetoPrompt & { readonly recommendation: VetoRecommendation; readonly ai: boolean }) | null;
  /** Make the pending veto choice by hand: a map name, or "attack" / "defense". */
  chooseVeto(choice: string): VetoAction;
  /** Let the acting team's AI make the pending veto choice. */
  autoVeto(): VetoAction;
  /** Run AI steps until a human team has to choose (or the veto is complete). */
  advanceVeto(): readonly VetoAction[];
  /** Open the next map for round-by-round play. `aiTeams` here are SERIES teams. */
  startGame(): SeriesGameSession;
  /** Close the open map once its session is finished and record it. */
  finishGame(): SeriesGameResult;
  /** Play the next map start to finish. */
  playNextGame(): SeriesGameResult;
  isFinished(): boolean;
  result(): SeriesResult;
}

export interface SeriesSessionOptions {
  /** Series teams the AI drives (veto choices, and timeouts inside games). Default: both. */
  readonly aiTeams?: readonly SeriesTeam[];
}

const TEAMS: readonly SeriesTeam[] = ["A", "B"];
const otherTeam = (t: SeriesTeam): SeriesTeam => (t === "A" ? "B" : "A");
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (p: number): number => Math.log(p / (1 - p));
const mapKey = (m: string): string => m.trim().toLowerCase();

function resolveFormat(format: SeriesConfig["format"]): VetoFormat {
  if (format === undefined) return VETO_FORMATS.bo3;
  return typeof format === "string" ? VETO_FORMATS[format] : format;
}

/** Everything decided before the veto: mastery, scouting, beliefs. Pure given the config. */
export function prepareSeries(config: SeriesConfig): SeriesPreparation {
  const pool = config.mapPool ?? DEFAULT_MAP_POOL;
  const format = resolveFormat(config.format);
  const reference = leagueMasteryReference(pool);
  const cfg: Record<SeriesTeam, SeriesTeamConfig> = { A: config.teamA, B: config.teamB };

  const mastery = {} as Record<SeriesTeam, Record<string, MapMastery>>;
  for (const t of TEAMS) {
    mastery[t] = {};
    for (const map of pool) {
      mastery[t][map] = mapMastery({ teamId: cfg[t].id, map, ...(cfg[t].lineup ? { lineup: cfg[t].lineup } : {}), ...(cfg[t].mapRecords ? { records: cfg[t].mapRecords } : {}) });
    }
  }

  const scouting = {} as Record<SeriesTeam, ScoutingReport | null>;
  for (const t of TEAMS) {
    const opp = otherTeam(t);
    const analyst = cfg[t].staff?.analyst ?? 0.5;
    scouting[t] = cfg[t].scouting === false || analyst <= 0
      ? null
      : buildScoutingReport({ by: cfg[t].id, of: cfg[opp].id, logs: cfg[opp].history ?? [], pool, opponentMastery: mastery[opp], reference, analyst, seed: deriveSeed(config.seed, `scouting:${t}`) });
  }

  const baseA = Math.min(0.99, Math.max(0.01, config.baselineWinProbabilityA ?? 0.5));
  const beliefs = {} as Record<SeriesTeam, VetoBeliefs>;
  for (const t of TEAMS) {
    const base = logit(t === "A" ? baseA : 1 - baseA);
    const winProbability: Record<string, number> = {};
    for (const map of pool) {
      const own = mastery[t][map]!.value;
      const theirs = scouting[t]?.maps.find((m) => m.map === map)?.estimatedMastery ?? reference;
      winProbability[map] = sigmoid(base + VETO_BELIEF.masterySlope * (own - theirs));
    }
    beliefs[t] = { winProbability };
  }
  return { pool, format, reference, mastery, scouting, beliefs };
}

export function createSeriesSession(config: SeriesConfig, options: SeriesSessionOptions = {}): SeriesSession {
  const prep = prepareSeries(config);
  const cfg: Record<SeriesTeam, SeriesTeamConfig> = { A: config.teamA, B: config.teamB };
  const aiTeams = new Set<SeriesTeam>(options.aiTeams ?? TEAMS);
  const veto = new VetoProcess(prep.format, prep.pool);
  const winsNeeded = Math.floor(prep.format.games / 2) + 1;
  const seriesId = `${cfg.A.id}-vs-${cfg.B.id}:${config.seed}`;
  const games: SeriesGameResult[] = [];
  const score: Record<SeriesTeam, number> = { A: 0, B: 0 };
  /** What each team has SEEN of the other in this series (the other team's game logs). */
  const seenThisSeries: Record<SeriesTeam, TeamGameLog[]> = { A: [], B: [] };
  let open: { context: SeriesGameContext; session: MatchSession; mastery: SeriesGameResult["mastery"]; inputs: Record<SeriesTeam, TeamMatchInputs> } | null = null;

  const seriesWinner = (): SeriesTeam | null => (score.A >= winsNeeded ? "A" : score.B >= winsNeeded ? "B" : null);
  const isFinished = (): boolean => seriesWinner() !== null;

  const pendingVeto: SeriesSession["pendingVeto"] = () => {
    const prompt = veto.pending();
    if (!prompt) return null;
    return { ...prompt, recommendation: recommendVeto(veto, prompt.team, prep.beliefs[prompt.team]), ai: aiTeams.has(prompt.team) };
  };
  const autoVeto = (): VetoAction => {
    const p = pendingVeto();
    if (!p) throw new Error("series: the veto is complete");
    return veto.apply(p.recommendation.choice, "ai", p.recommendation.reason);
  };
  const advanceVeto = (): VetoAction[] => {
    const done: VetoAction[] = [];
    for (let p = veto.pending(); p && aiTeams.has(p.team); p = veto.pending()) done.push(autoVeto());
    return done;
  };

  /** The opponent-model prior a team takes into a game on `map`: its report + what it has seen in the series. */
  const priorFor = (team: SeriesTeam, map: string): OpponentPrior | undefined => {
    const logs: WeightedLog[] = [
      ...(prep.scouting[team]?.reviewed ?? []),
      ...((config.carryOver ?? true) ? seenThisSeries[team].map((log) => ({ log, weight: 1 })) : []),
    ];
    return logs.length ? opponentPriorFromLogs(logs, map) : undefined;
  };

  const inputsFor = (team: SeriesTeam, map: string): { inputs: TeamMatchInputs; mastery: { value: number; delta: number } } => {
    const value = prep.mastery[team][map]!.value;
    const applied = masteryEngineInputs(value, prep.reference);
    const prior = priorFor(team, map);
    const standing = gamePlanPrior(cfg[team].gamePlan);
    const inputs: TeamMatchInputs = {
      ...((config.mastery ?? true) ? applied.inputs : {}),
      ...(prior ? { opponentPrior: prior } : {}),
      ...(standing ? { standingPrior: standing } : {}),
    };
    return { inputs, mastery: { value, delta: applied.delta } };
  };

  const startGame = (): SeriesGameSession => {
    if (!veto.isComplete()) throw new Error("series: finish the veto before starting a game");
    if (isFinished()) throw new Error("series is finished");
    if (open) throw new Error("series: a game is already in progress — finish it first");
    const gameNumber = games.length + 1;
    const vm = veto.maps[gameNumber - 1];
    if (!vm) throw new Error(`series: no map for game ${gameNumber}`);
    // The engine's slot A attacks first, so the team that starts on attack takes slot A.
    const attackFirst: SeriesTeam = vm.startingSides.A === "attack" ? "A" : "B";
    const slots: Record<SeriesTeam, TeamSlot> = { [attackFirst]: "A", [otherTeam(attackFirst)]: "B" } as Record<SeriesTeam, TeamSlot>;
    const context: SeriesGameContext = {
      seriesId,
      gameNumber,
      map: vm.map,
      geometry: SIMULATED_GEOMETRY,
      pickedBy: vm.pickedBy,
      sideChosenBy: vm.sideChosenBy,
      startingSides: vm.startingSides,
      slots,
    };
    const perTeam = { A: inputsFor("A", vm.map), B: inputsFor("B", vm.map) };
    const ref = (t: SeriesTeam): TeamRef => ({ id: cfg[t].id, name: cfg[t].name });
    const matchConfig: MatchConfig = {
      ...(config.match ?? {}),
      teamA: ref(attackFirst),
      teamB: ref(otherTeam(attackFirst)),
      map: vm.map,
      seed: deriveSeed(config.seed, `game:${gameNumber}:${mapKey(vm.map)}`),
      teamInputs: { [slots.A]: perTeam.A.inputs, [slots.B]: perTeam.B.inputs } as Record<TeamSlot, TeamMatchInputs>,
      series: context,
    };
    const session = createMatchSession(matchConfig, { aiTeams: TEAMS.filter((t) => aiTeams.has(t)).map((t) => slots[t]) });
    open = { context, session, mastery: { A: perTeam.A.mastery, B: perTeam.B.mastery }, inputs: { A: perTeam.A.inputs, B: perTeam.B.inputs } };
    return { context, session };
  };

  const finishGame = (): SeriesGameResult => {
    if (!open) throw new Error("series: no game in progress");
    if (!open.session.isFinished()) throw new Error("series: the game in progress has rounds left to play");
    const { context, session, mastery, inputs } = open;
    const match = session.result();
    const teamOfSlot = (slot: TeamSlot): SeriesTeam => (context.slots.A === slot ? "A" : "B");
    const winner = teamOfSlot(match.winner);
    const game: SeriesGameResult = {
      ...context,
      winner,
      score: { A: match.score[context.slots.A], B: match.score[context.slots.B] },
      mastery,
      inputs,
      match,
    };
    games.push(game);
    score[winner] += 1;
    // Each team has now watched the other for a whole map.
    for (const t of TEAMS) seenThisSeries[t].push(teamGameLog(match, context.slots[otherTeam(t)]));
    open = null;
    return game;
  };

  const playNextGame = (): SeriesGameResult => {
    const { session } = open ?? startGame();
    while (!session.isFinished()) session.playNextRound();
    return finishGame();
  };

  return {
    preparation: () => prep,
    state: () => ({
      phase: !veto.isComplete() ? "veto" : isFinished() ? "finished" : "playing",
      score: { ...score },
      winsNeeded,
      vetoActions: [...veto.actions],
      maps: [...veto.maps],
      banned: [...veto.banned],
      remaining: [...veto.remaining],
      gamesPlayed: games.length,
      gameInProgress: open !== null,
    }),
    pendingVeto,
    chooseVeto: (choice) => veto.apply(choice, "human"),
    autoVeto,
    advanceVeto,
    startGame,
    finishGame,
    playNextGame,
    isFinished,
    result: () => {
      const winner = seriesWinner();
      if (!winner) throw new Error("series is not finished");
      return { config, preparation: prep, veto: { actions: [...veto.actions], maps: [...veto.maps], banned: [...veto.banned] }, games: [...games], winner, score: { ...score } };
    },
  };
}

/** Run a whole series from its seed: AI veto for both teams, then maps until one team has won. */
export function runSeries(config: SeriesConfig): SeriesResult {
  const s = createSeriesSession(config);
  s.advanceVeto();
  while (!s.isFinished()) s.playNextGame();
  return s.result();
}

/** This team's observable logs from a finished series — append to its `history` for the next one. */
export function seriesGameLogs(result: SeriesResult, team: SeriesTeam): TeamGameLog[] {
  return result.games.map((g) => teamGameLog(g.match, g.slots[team]));
}

/** The side a series team played in a given round of a game. */
export function sideInRound(game: SeriesGameContext, team: SeriesTeam, attackerSlot: TeamSlot): Side {
  return game.slots[team] === attackerSlot ? "attack" : "defense";
}

/** Plain-text summary of a series (veto, maps, scores). */
export function renderSeriesSummary(result: SeriesResult): string {
  const name = (t: SeriesTeam): string => (t === "A" ? result.config.teamA.name : result.config.teamB.name);
  const lines: string[] = [];
  lines.push(`${name("A")} ${result.score.A} – ${result.score.B} ${name("B")}  (${result.preparation.format.name}, seed ${result.config.seed})`);
  lines.push("Veto:");
  for (const a of result.veto.actions) {
    if (a.kind === "decider") lines.push(`  ${a.map} remains (decider)`);
    else if (a.kind === "side") lines.push(`  ${name(a.team!)} starts on ${a.side} on ${a.map}`);
    else lines.push(`  ${name(a.team!)} ${a.kind}s ${a.map}`);
  }
  for (const g of result.games) {
    const by = g.pickedBy === "decider" ? "decider" : `${name(g.pickedBy)} pick`;
    lines.push(`Map ${g.gameNumber} ${g.map} (${by}; ${name("A")} starts ${g.startingSides.A}; mastery ${g.mastery.A.value.toFixed(2)} / ${g.mastery.B.value.toFixed(2)}): ${g.score.A}–${g.score.B} → ${name(g.winner)}`);
  }
  if (result.games.some((g) => mapKey(g.map) !== mapKey(g.geometry))) {
    lines.push(`Note: maps other than ${SIMULATED_GEOMETRY} were simulated on the ${SIMULATED_GEOMETRY} geometry with their own mastery applied.`);
  }
  return lines.join("\n");
}
