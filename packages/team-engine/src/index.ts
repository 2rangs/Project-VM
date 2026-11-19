/**
 * @pv/team-engine — IGL strategy/roles, player policy, teamwork, and the DecisionPolicy
 * the round-simulator drives (Handoff §17, README §23–24). Decisions use only the
 * team-observable PolicyView (no WorldState; DECISION-004) and a seeded RandomSource.
 */
export { TeamDecisionPolicy } from "./policy.js";
export type { TeamPolicyOptions, TeamRoundTrace, PolicyOrder } from "./policy.js";
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
