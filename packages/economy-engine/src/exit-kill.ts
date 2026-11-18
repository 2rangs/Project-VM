/**
 * Exit-kill / weapon-destruction expected value (README §22, Handoff §20.10).
 *
 * When a team has effectively won the round, chasing a saving enemy can destroy a high-value weapon
 * (big economic hit next round) — but risks feeding your own rifles and the enemy's ult. This weighs
 * the two sides.
 */
import { weaponPrice } from "./rules.js";
import type { EconomyOption } from "./types.js";
import { ultDenialValue, type UltState } from "./ultimate-economy.js";

export interface ExitKillContext {
  readonly enemyWeaponKey: string; // weapon the fleeing enemy is saving, e.g. "operator"
  readonly ownWeaponKey: string; // weapon you'd risk by chasing
  readonly killProb: number; // [0,1] chance you destroy the enemy weapon (get the kill)
  readonly ownDeathProb: number; // [0,1] chance you die chasing
  /** Your own ult state — dying while chasing feeds the enemy; omit if irrelevant. */
  readonly enemyNearUlt?: UltState;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function exitKillOptions(ctx: ExitKillContext): EconomyOption[] {
  const enemyVal = weaponPrice(ctx.enemyWeaponKey) ?? 0;
  const ownVal = weaponPrice(ctx.ownWeaponKey) ?? 0;
  const killP = clamp01(ctx.killProb);
  const deathP = clamp01(ctx.ownDeathProb);
  const ultFeed = ctx.enemyNearUlt ? ultDenialValue(ctx.enemyNearUlt) : 0;

  const chase: EconomyOption = {
    action: "EXIT_KILL",
    currentRoundValue: 0, // the round is already decided; this is purely economic/future
    futureValue: round3((enemyVal / 4700) * killP - (ownVal / 4700) * deathP - ultFeed * deathP),
    economicDelta: Math.round(enemyVal * killP - ownVal * deathP), // enemy loss minus own expected loss
    ultDelta: round3(ctx.enemyNearUlt ? -deathP : 0), // dying feeds their ult
    explanation:
      `EXIT_KILL: destroy enemy ${ctx.enemyWeaponKey} (${enemyVal}cr) at ${(killP * 100).toFixed(0)}% ` +
      `vs ${(deathP * 100).toFixed(0)}% chance of losing your ${ctx.ownWeaponKey} (${ownVal}cr)`,
  };

  const hold: EconomyOption = {
    action: "HOLD_WEAPON",
    currentRoundValue: 0,
    futureValue: 0,
    economicDelta: 0,
    ultDelta: 0,
    explanation: "HOLD_WEAPON: bank the round, keep your rifle, give up the exit kill",
  };

  return [chase, hold];
}
