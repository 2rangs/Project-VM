/**
 * Coach/IGL orders for the interactive match session (tactical timeouts).
 *
 * A `TeamOrder` is set during a timeout and shapes the NEXT round(s): the attack/defense strategy
 * the IGL commits to, the economy call (overriding the economy engine's pick), tempo, and pinned
 * roles. Orders the engine cannot honor are logged (the IGL falls back) rather than failing.
 */
import type { PolicyOrder } from "@pv/team-engine";
import type { EconomyCall } from "./economy.js";

export type AttackStrategyOrder = "aExecute" | "bExecute" | "midControl" | "default" | "split";
export type DefenseStrategyOrder = "defaultHold" | "stackA" | "stackB" | "aggroPush";
export type StrategyOrder = AttackStrategyOrder | DefenseStrategyOrder;

export interface TeamOrder {
  /** Attack (aExecute/bExecute/midControl/default/split) or defense (defaultHold/stackA/stackB/aggroPush). */
  readonly strategy?: StrategyOrder;
  /** Economy call, overriding the engine's recommendation (ignored on pistol rounds). */
  readonly economy?: EconomyCall;
  readonly tempo?: "slow" | "normal" | "fast";
  /** Pin specific roster players (ids like "atk3") as entry/lurker. */
  readonly roles?: { readonly entry?: string; readonly lurker?: string };
  /** Apply the order for this many upcoming rounds (default 1). */
  readonly durationRounds?: number;
  /**
   * [manager] Make the forced strategy the round's opening call, so the attack goes to the site it
   * names (PolicyOrder.asOpening). Default false: the strategy only relabels the IGL's own plan, as before.
   */
  readonly asOpening?: boolean;
}

/** Map an order's strategy string to the policy's TeamStrategy; `split` → mid split (midControl). */
export function strategyToPolicy(s: StrategyOrder | undefined): PolicyOrder["strategy"] | undefined {
  if (!s) return undefined;
  if (s === "split") return "midControl";
  return s;
}

/** Project a TeamOrder onto the PolicyOrder the TeamDecisionPolicy consumes (strategy/tempo/roles). */
export function toPolicyOrder(order: TeamOrder | null | undefined): PolicyOrder | null {
  if (!order) return null;
  const strategy = strategyToPolicy(order.strategy);
  if (!strategy && !order.tempo && !order.roles) return null;
  return {
    ...(strategy ? { strategy } : {}),
    ...(order.tempo ? { tempo: order.tempo } : {}),
    ...(order.roles ? { roles: order.roles } : {}),
    ...(order.asOpening && strategy ? { asOpening: true } : {}),
  };
}
