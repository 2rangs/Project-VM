/**
 * @pv/action-generator — situation-aware candidate generation, constraint validation,
 * and rule/utility evaluation (TASK 007). No ML (DECISION-005).
 */
export { generateActions } from "./generate.js";
export { estimateRisk, expectedUtility, WEIGHTS } from "./evaluate.js";
export type {
  GeneratorInput,
  GenerationResult,
  EvaluatedAction,
  ExcludedAction,
  ActionEvaluation,
  ResourceCost,
  EnemyPressureFn,
} from "./types.js";
