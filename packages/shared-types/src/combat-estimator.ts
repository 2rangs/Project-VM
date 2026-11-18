/**
 * CombatEstimator — dependency-inversion seam onto the Combat Engine (PV-4,
 * `packages/combat-engine`). The Outcome Predictor needs a duel win-probability without
 * depending on the combat engine's branch; the real adapter builds a `Duel` and runs
 * `monteCarloDuel`, returning wins[attacker]/trials. Tests use a stub.
 *
 * Winner is emergent, never pre-decided (DECISION-002): this only ESTIMATES a probability
 * from physical/informational inputs; it does not decide an outcome.
 */

export interface CombatEstimateInput {
  /** Weapon slugs (e.g. "vandal", "operator"); null if unknown/none. */
  readonly attackerWeapon: string | null;
  readonly defenderWeapon: string | null;
  readonly attackerHealth: number; // 0..100 (+armor folded in by the caller if desired)
  readonly defenderHealth: number;
  readonly distanceMeters: number | null;
  readonly attackerHasCover: boolean;
  readonly defenderHasCover: boolean;
  readonly attackerFlashed: boolean;
  readonly defenderFlashed: boolean;
  /** Skill proxies in [0,1] (README §23.1 Aim). */
  readonly attackerAim: number;
  readonly defenderAim: number;
}

export interface CombatEstimator {
  /** Probability the attacker (first party) wins the duel, in [0,1]. */
  estimateDuelWinProb(input: CombatEstimateInput): number;
}
