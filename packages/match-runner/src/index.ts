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
export { resolveTeamRef, teamSkills, isKnownTeam } from "./teams.js";
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
