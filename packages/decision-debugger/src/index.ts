/**
 * @pv/decision-debugger — structured decision trace + human-readable report (TASK 008),
 * and the end-to-end analysis pipeline (DecisionContext JSON → actions → trace).
 */
export { analyzeDecisionContext } from "./pipeline.js";
export type { Analysis } from "./pipeline.js";
export { buildTrace } from "./trace.js";
export type {
  DecisionTrace,
  TracePrediction,
  TraceExcluded,
  TraceGeneratedAction,
  TraceObservedEnemy,
  TraceBeliefZone,
} from "./trace.js";
export { renderMarkdown, renderText } from "./report.js";
export { runCli } from "./cli.js";
export {
  createAscentPlaceholderSpatial,
  AscentPlaceholderSpatial,
} from "./ascent-placeholder.js";
