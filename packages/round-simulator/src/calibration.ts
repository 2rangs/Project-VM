import type { CombatCalibration } from "@pv/combat-engine";

/**
 * Ascent opening-duel calibration (PV-2 `combat_opening_duel.json`, Ascent attack
 * 0.437, 95% CI [0.420, 0.454]). Derived from the first validation run
 * (docs/research/FIRST_VALIDATION_RUN.md): the uncalibrated sim has attackers WINNING
 * first blood too often (0.531), because lowering global hit chance lengthens TTK and
 * lets the surprised side trade back, this symmetric `hitChanceScale` moves the opening-
 * duel split. 0.65 lands it at ~0.453 (within tolerance).
 *
 * ONLY the opening duel is calibrated here. Round win rate / outcome distribution are NOT
 * tuned via combat (they are policy-dominated — see the report), per README §31 (do not
 * distort combat params to force a round-level stat).
 */
export const ASCENT_OPENING_DUEL_CALIBRATION: CombatCalibration = {
  hitChanceScale: 0.65,
};
