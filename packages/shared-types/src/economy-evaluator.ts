/**
 * EconomyEvaluator — dependency-inversion seam onto the Economy Engine (PV-2,
 * `packages/economy-engine`, origin/claude/pv-data @ 09894ea).
 *
 * Aligned to PV-2's public contract: every economic choice is an {@link EconomyOption}
 * (the exact shape `economy-engine` returns from `evaluateEconomy({phase, context})`). The
 * Action Generator depends only on this interface; an integration adapter maps PROJECT V's
 * {@link EconomyContext} to economy-engine's BuyContext/SaveContext/ExitKillContext and
 * calls `evaluateEconomy` (see docs/handoffs/PV-3-core.md phase-3 adapter spec). Tests use
 * a stub.
 */
import type { Side } from "./ids.js";

/** One evaluated economic choice — mirror of economy-engine's EconomyOption. */
export interface EconomyOption {
  /** Stable action key, e.g. "fullBuy", "SAVE_WEAPON", "PLAY_FOR_ROUND", "EXIT_KILL". */
  readonly action: string;
  /** Marginal effect on winning THE CURRENT round, in [-1, 1]. */
  readonly currentRoundValue: number;
  /** Effect on FUTURE rounds, in [-1, 1]; 0 at no-future boundaries (match point, resets). */
  readonly futureValue: number;
  /** Expected credit delta to own team minus enemy team, in credits. */
  readonly economicDelta: number;
  /** Expected ENEMY ultimate points DENIED by this choice (positive = good for us). */
  readonly ultDelta: number;
  /** Human-readable reason grounded in the numbers above. */
  readonly explanation: string;
}

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
  /** Save options (e.g. SAVE_WEAPON vs PLAY_FOR_ROUND) for this situation. */
  saveOptions(ctx: EconomyContext): readonly EconomyOption[];
  /** Exit-kill options (EXIT_KILL vs HOLD_WEAPON). */
  exitKillOptions(ctx: EconomyContext): readonly EconomyOption[];
}

/** Combined round value of an option, in [-2, 2]; the Action Generator's utility signal. */
export function economyOptionValue(o: EconomyOption): number {
  return o.currentRoundValue + o.futureValue;
}

/** Pick the option whose action matches `re`, else the highest combined-value option. */
export function pickEconomyOption(
  options: readonly EconomyOption[],
  re: RegExp,
): EconomyOption | null {
  if (options.length === 0) return null;
  const matched = options.find((o) => re.test(o.action));
  if (matched) return matched;
  return [...options].sort((a, b) => economyOptionValue(b) - economyOptionValue(a))[0] ?? null;
}
