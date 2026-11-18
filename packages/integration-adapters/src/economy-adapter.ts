/**
 * EconomyEvaluator adapter over PV-2's economy-engine.
 *
 * MIRROR SOURCE: origin/claude/pv-data @ fe354096
 *   packages/economy-engine/src/{index.ts (evaluateEconomy, EconomyDecision), types.ts
 *   (EconomyOption), save-decision.ts (SaveContext), exit-kill.ts (ExitKillContext)}.
 * At merge, import { evaluateEconomy } from "@pv/economy-engine" and delete the mirror.
 *
 * economy-engine's EconomyOption is identical to @pv/shared-types EconomyOption (1:1
 * passthrough). This maps PROJECT V's EconomyContext to economy-engine's Save/ExitKill
 * contexts; fields PV-3 does not carry (survivor weapon, round win-prob, teamIdx,
 * consecutive losses) are filled by injectable mappers (defaults provided + flagged).
 */
import type { EconomyContext, EconomyEvaluator, EconomyOption, Side } from "@pv/shared-types";

// ---- structural mirror of economy-engine ----
interface SaveContextLike {
  readonly survivorWeaponKey: string;
  readonly roundWinProb: number;
  readonly aliveOwn: number;
  readonly aliveEnemy: number;
  readonly roundNum: number;
  readonly matchScore: readonly [number, number];
  readonly teamIdx: 0 | 1;
  readonly consecutiveLosses: number;
  readonly escapeRisk?: number;
}
interface ExitKillContextLike {
  readonly enemyWeaponKey: string;
  readonly ownWeaponKey: string;
  readonly killProb: number;
  readonly ownDeathProb: number;
}
type EconomyDecisionLike =
  | { readonly phase: "save"; readonly context: SaveContextLike }
  | { readonly phase: "exitKill"; readonly context: ExitKillContextLike };
export type EvaluateEconomyLike = (decision: EconomyDecisionLike) => EconomyOption[];

export interface EconomyAdapterOptions {
  readonly evaluateEconomy: EvaluateEconomyLike;
  readonly teamIdxForSide?: (side: Side) => 0 | 1;
  readonly toSaveContext?: (ctx: EconomyContext) => SaveContextLike;
  readonly toExitKillContext?: (ctx: EconomyContext) => ExitKillContextLike;
  /** Default round win-probability when PV-3 has not run a lookahead; refine at integration. */
  readonly defaultRoundWinProb?: number;
  readonly defaultSurvivorWeapon?: string;
  readonly defaultOwnWeapon?: string;
  readonly defaultEnemyWeapon?: string;
}

export function economyEvaluatorFromEngine(opts: EconomyAdapterOptions): EconomyEvaluator {
  const teamIdxForSide = opts.teamIdxForSide ?? ((s: Side): 0 | 1 => (s === "attack" ? 0 : 1));
  const winProb = opts.defaultRoundWinProb ?? 0.3;
  const survivorWeapon = opts.defaultSurvivorWeapon ?? "vandal";
  const ownWeapon = opts.defaultOwnWeapon ?? "vandal";
  const enemyWeapon = opts.defaultEnemyWeapon ?? "operator";

  const toSave = opts.toSaveContext ?? ((ctx: EconomyContext): SaveContextLike => ({
    survivorWeaponKey: survivorWeapon,
    roundWinProb: winProb,
    aliveOwn: ctx.aliveSelf,
    aliveEnemy: ctx.aliveEnemy,
    roundNum: ctx.roundNumber,
    matchScore: ctx.matchScore ?? [0, 0],
    teamIdx: teamIdxForSide(ctx.side),
    consecutiveLosses: 0, // PV-3 EconomyContext does not carry this — fill at integration
  }));

  const toExit = opts.toExitKillContext ?? ((_ctx: EconomyContext): ExitKillContextLike => ({
    enemyWeaponKey: enemyWeapon,
    ownWeaponKey: ownWeapon,
    killProb: 0.4,
    ownDeathProb: 0.4,
  }));

  return {
    saveOptions: (ctx) => opts.evaluateEconomy({ phase: "save", context: toSave(ctx) }),
    exitKillOptions: (ctx) => opts.evaluateEconomy({ phase: "exitKill", context: toExit(ctx) }),
  };
}
