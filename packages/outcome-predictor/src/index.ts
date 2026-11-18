/**
 * @pv/outcome-predictor — budget-bounded limited lookahead (README §25). Abstracts combat
 * via the CombatEstimator seam (PV-4 combat-engine); ships a heuristic estimator default.
 */
export { predictOutcomes } from "./predict.js";
export type { PredictInput, PredictResult, PredictBudget, OutcomePrediction } from "./predict.js";
export { heuristicCombatEstimator } from "./heuristic-combat.js";
