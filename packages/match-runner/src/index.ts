// PROJECT V — @pv/match-runner public API.
//
// Match-level VALORANT simulation: extends PV-4's round loop into a full map
// (pistol → halves → first to 13 w/ 2-round lead → overtime) with cross-round economy and
// ultimate-point carryover, driven by PV-3's TeamDecisionPolicy over both sides
// (DECISION-004: policy input is observation-only; no WorldState). Deterministic per seed
// (DECISION-010).
export { runMatch, attackerFor, MatchEngine, observedTendencies } from "./match.js";
export type {
  MatchConfig,
  MatchTuning,
  MatchResult,
  RoundRecord,
  RunMatchOptions,
  TeamRef,
  TeamSlot,
  Side,
  OpponentMemory,
} from "./match.js";
// Interactive match session + tactical timeouts (PV-6 desktop drives this round-by-round).
export { createMatchSession } from "./session.js";
export type {
  MatchSession,
  MatchSessionState,
  MatchSessionOptions,
  MatchSessionResult,
  TimeoutLogEntry,
} from "./session.js";
export type {
  TeamOrder,
  StrategyOrder,
  AttackStrategyOrder,
  DefenseStrategyOrder,
} from "./orders.js";
export { resolveTeamRef, teamSkills, isKnownTeam, type RosterPlayer } from "./teams.js";
export {
  newTeamEconomy,
  decideBuy,
  decideBuyForCall,
  applyRoundOutcome,
  halfReset,
  overtimeReset,
  spend,
} from "./economy.js";
export type { TeamEconomy, BuyDecision, BuyTier, EconomyCall } from "./economy.js";
export { renderMatchSummary, renderDecisionTrace } from "./report.js";
// --- Series layer: veto, map mastery, scouting, best-of-N (docs/SERIES_AND_VETO.md) ---
export { runSeries, createSeriesSession, prepareSeries, seriesGameLogs, renderSeriesSummary, sideInRound, SIMULATED_GEOMETRY, VETO_BELIEF } from "./series.js";
export type {
  SeriesConfig,
  SeriesTeamConfig,
  SeriesPreparation,
  SeriesGameResult,
  SeriesResult,
  SeriesState,
  SeriesSession,
  SeriesSessionOptions,
  SeriesGameSession,
} from "./series.js";
export {
  VetoProcess,
  recommendVeto,
  recommendSide,
  seriesWinProbability,
  validateVetoFormat,
  vctGrandFinalBo5,
  VCT_BO1,
  VCT_BO3,
  VCT_BO5,
  VETO_FORMATS,
  MAP_POOLS,
  DEFAULT_MAP_POOL,
} from "./veto.js";
export type { VetoStep, VetoFormat, VetoMap, VetoAction, VetoPrompt, VetoBeliefs, VetoRecommendation, SeriesTeam, SeriesFormatId, StartSide } from "./veto.js";
export { mapMastery, masteryEngineInputs, leagueMasteryReference, experienceHalfGames, defaultLineup, MASTERY_MODEL, MASTERY_EFFECTS } from "./mastery.js";
export type { MapMastery, MasteryComponent, MasteryRequest, MasteryApplication } from "./mastery.js";
export { buildScoutingReport, opponentPriorFromLogs, siteEvidence, teamGameLog, estimateOpponentMastery, rosterUptake, gamesReviewed, SCOUTING_MODEL } from "./scouting.js";
export type { ScoutingReport, ScoutingRequest, ScoutingQuality, ScoutedMap, ScoutedPlayer, SiteEvidence, TeamGameLog, TeamRoundLog, PlayerGameLine, WeightedLog } from "./scouting.js";
export { gamePlanPrior, applyTraitDelta } from "./team-inputs.js";
export type { TeamMatchInputs, GamePlan, SeriesGameContext } from "./team-inputs.js";
