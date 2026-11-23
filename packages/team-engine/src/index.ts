/**
 * @pv/team-engine — IGL strategy/roles, player policy, teamwork, and the DecisionPolicy
 * the round-simulator drives (Handoff §17, README §23–24). Decisions use only the
 * team-observable PolicyView (no WorldState; DECISION-004) and a seeded RandomSource.
 */
export { TeamDecisionPolicy, lanchesterWinChance, throwChance, DEFAULT_POLICY_TUNING, DEFAULT_FOOTSTEP_RADIUS_UNITS } from "./policy.js";
export { chooseMoveMode, withinEarshot } from "./movement.js";
export type { MoveIntent, MoveModeInput } from "./movement.js";
export { updateHitBelief, rotationCount, siteLikelihood, PRESENCE_RATE, CONTACT_RATE, UTILITY_RATE, BASE_FAKE_RATE, NO_EVIDENCE } from "./hit-belief.js";
export type { HitBelief, HitBeliefInput, SiteEvidence, SiteRole } from "./hit-belief.js";
export type { TeamPolicyOptions, TeamRoundTrace, PolicyOrder, PolicyTuning, PlanSummary } from "./policy.js";
export {
  selectStrategy,
  reconsider,
  assignRoles,
  enemySiteBias,
  profileFor,
  ECO_BANK_THRESHOLD,
} from "./igl.js";
export type { Reconsideration } from "./igl.js";
export { choosePlayerCommand } from "./player-policy.js";
export type { PlayerChoice } from "./player-policy.js";
export { applyTeamwork } from "./teamwork.js";
export type { TeamworkEntry } from "./teamwork.js";
export { viewFromTeamContext, synthContextFromView } from "./view.js";
export { renderRoundReport } from "./report.js";
export { OpponentModel, Tendency, tendencyLean, FAKE_BASE_RATE } from "./opponent-model.js";
export type { OpponentRead, RoundObservation, TendencyEstimate, SiteKey, OpponentPrior } from "./opponent-model.js";
export { annotateRoutes, beliefZoneCosts, routeIntentOf } from "./route-intent.js";
export type { RouteIntent, RoutePreference } from "./route-intent.js";
