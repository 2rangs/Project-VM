/**
 * A simple deterministic CombatEstimator (default/fallback; NOT the real combat engine).
 *
 * Gives a plausible duel win probability from weapon tier, health, cover, flash and aim —
 * enough for the Outcome Predictor to reason before PV-4's combat-engine adapter is wired
 * in. Winner is never pre-decided (DECISION-002): this returns a probability only.
 */
import type { CombatEstimateInput, CombatEstimator } from "@pv/shared-types";

const TIER: Record<string, number> = {
  classic: 0, shorty: 0, frenzy: 0, ghost: 0.5, sheriff: 0.8,
  stinger: 1, spectre: 1.2, bucky: 0.8, judge: 1.3,
  bulldog: 1.6, guardian: 1.7, phantom: 2, vandal: 2, marshal: 1.4,
  outlaw: 1.8, operator: 2.4, ares: 1.5, odin: 1.8,
};

const tierOf = (slug: string | null): number => (slug ? TIER[slug] ?? 1 : 0);

export const heuristicCombatEstimator: CombatEstimator = {
  estimateDuelWinProb(i: CombatEstimateInput): number {
    let p = 0.5;
    p += 0.09 * (tierOf(i.attackerWeapon) - tierOf(i.defenderWeapon));
    p += 0.2 * (i.attackerAim - i.defenderAim);
    p += 0.0025 * (i.attackerHealth - i.defenderHealth);
    if (i.attackerHasCover && !i.defenderHasCover) p += 0.08;
    if (i.defenderHasCover && !i.attackerHasCover) p -= 0.08;
    if (i.defenderFlashed && !i.attackerFlashed) p += 0.25;
    if (i.attackerFlashed && !i.defenderFlashed) p -= 0.25;
    return Math.max(0.02, Math.min(0.98, p));
  },
};
