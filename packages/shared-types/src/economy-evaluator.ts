/**
 * EconomyEvaluator — the dependency-inversion seam onto the Economy Engine (PV-2).
 *
 * PV-2 owns `packages/economy-engine` (buy strategy, save decisions, ultimate economy,
 * future-round value — README §19–22). The Action Generator must NOT implement that
 * judgement itself; it depends only on this interface and, when an evaluator is supplied,
 * uses it to value economy-sensitive actions (SAVE, EXIT_KILL). Without one, the generator
 * falls back to a provisional heuristic and labels the action's rationale as delegated.
 *
 * This interface is PV-3's proposed shape; reconcile with PV-2's economy-engine at final
 * integration (an adapter can bridge any differences).
 */
import type { Side } from "./ids.js";

export interface EconomyContext {
  readonly roundNumber: number;
  readonly side: Side;
  readonly aliveSelf: number;
  readonly aliveEnemy: number;
  readonly timeRemainingMs: number;
  /** Rounds won so far [team0, team1], if known (match-point reasoning). */
  readonly matchScore: readonly [number, number] | null;
  /** Credit value of the deciding team's equipment at risk, if known. */
  readonly selfLoadoutValue: number | null;
}

export interface EconomyEvaluator {
  /** Utility contribution of saving (preserving equipment) in this situation. */
  saveValue(ctx: EconomyContext): number;
  /** Utility of an exit-kill / chasing a high-value enemy weapon. */
  exitKillValue(ctx: EconomyContext): number;
  /** False when there is no future round to save for (match point / last round). */
  hasFutureRounds(ctx: EconomyContext): boolean;
}
