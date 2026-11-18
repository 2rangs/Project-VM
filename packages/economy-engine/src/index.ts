/**
 * @pv/economy-engine — Economy & Ultimate decision engine v0.
 *
 * Turns an economic situation into scored candidate options the Action Generator (PV-3) can use as
 * Resource-Cost / Expected-Utility inputs. Every option is an `EconomyOption`:
 *   { action, currentRoundValue, futureValue, economicDelta, ultDelta, explanation }
 * with all values deterministic functions of the input (same input -> same output).
 *
 * Modules:
 *   - buyOptions(BuyContext)        -> eco/half/force/full candidates
 *   - saveOptions(SaveContext)      -> SAVE_WEAPON vs PLAY_FOR_ROUND (multi-factor, not a threshold)
 *   - exitKillOptions(ExitKillCtx)  -> EXIT_KILL vs HOLD_WEAPON
 *   - ultimate-economy              -> track charge, value ult-point denial / readiness
 *   - future-value / round-boundaries -> next-round economy + the "no future" boundaries
 *
 * Rule numbers mirror @pv/game-rules (provisional); ultimate point requirements are the canonical
 * PV-1 catalog values; win-prob priors are PV-2's real derived priors (priors-fixture.ts).
 */
export * from "./types.js";
export * from "./shared-mirror.js";
export * from "./rules.js";
export * from "./priors-fixture.js";
export * from "./round-boundaries.js";
export * from "./future-value.js";
export * from "./ultimate-economy.js";
export * from "./buy-strategy.js";
export * from "./save-decision.js";
export * from "./exit-kill.js";
export * from "./round-value-model.js";

import { buyOptions, type BuyContext } from "./buy-strategy.js";
import { saveOptions, type SaveContext } from "./save-decision.js";
import { exitKillOptions, type ExitKillContext } from "./exit-kill.js";
import type { EconomyOption } from "./types.js";

export type EconomyDecision =
  | { readonly phase: "buy"; readonly context: BuyContext }
  | { readonly phase: "save"; readonly context: SaveContext }
  | { readonly phase: "exitKill"; readonly context: ExitKillContext };

/** Single dispatch entry point: returns the candidate options for the given decision phase. */
export function evaluateEconomy(decision: EconomyDecision): EconomyOption[] {
  switch (decision.phase) {
    case "buy":
      return buyOptions(decision.context);
    case "save":
      return saveOptions(decision.context);
    case "exitKill":
      return exitKillOptions(decision.context);
  }
}

export const ENGINE_VERSION = "0.1.0";
