import type { CombatCalibration } from "@pv/combat-engine";

/**
 * Ascent opening-duel calibration (PV-2 `combat_opening_duel.json`, Ascent attack
 * 0.437, 95% CI [0.420, 0.454]).
 *
 * RE-DERIVED 2026-11-18 after the hold-facing change: holders now watch their angle, so first
 * contact is MUTUAL sight (not attacker-surprise). That alone drops attacker opening to ~0.35
 * and `hitChanceScale` can no longer reach the target (it saturates ~0.37) — the realistic
 * missing factor is the entry attacker's PEEKER'S ADVANTAGE (initiative), modelled by
 * `SimConfig.peekerAdvantageMs` (a holder reacts late to a moving peeker, even on mutual sight).
 * With `peekerAdvantageMs = 210`, `hitChanceScale = 0.50` lands the ScriptedPolicy opening duel
 * at ~0.45 (within the CI). The two levers are the opening-duel calibration; the SAME values are
 * used for every policy ("one truth"), Scripted and PV-3's TeamDecisionPolicy alike.
 *
 * ONLY the opening duel is calibrated. Round win rate / outcome distribution are NOT tuned via
 * combat (they are policy-dominated — see the report), per README §31.
 */
export const ASCENT_OPENING_DUEL_CALIBRATION: CombatCalibration = {
  hitChanceScale: 0.5,
};
