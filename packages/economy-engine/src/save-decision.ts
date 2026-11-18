/**
 * Save decision: evaluate preserving equipment vs contesting the round (Handoff §15, §20.7–20.9,
 * README §20). This is explicitly a WEIGHTED combination of weapon value, ultimate-point denial,
 * loss-bonus/economy and current-round win probability — NOT a win-probability threshold
 * (Handoff §29 forbids `if (winProb < x) save()`).
 */
import { weaponPrice } from "./rules.js";
import { weaponFutureValue } from "./future-value.js";
import { ultDenialValue, type UltState } from "./ultimate-economy.js";
import type { EconomyOption, MatchScore } from "./types.js";
import type { TeamIdx } from "./shared-mirror.js";

export interface SaveContext {
  readonly survivorWeaponKey: string; // weapon the survivor would preserve, e.g. "operator"
  readonly roundWinProb: number; // [0,1] chance of winning THIS round if contested
  readonly aliveOwn: number;
  readonly aliveEnemy: number;
  readonly roundNum: number;
  readonly matchScore: MatchScore;
  readonly teamIdx: TeamIdx;
  readonly consecutiveLosses: number;
  /** An enemy whose ult would charge if they get the kill; omit if none relevant. */
  readonly enemyNearUlt?: UltState;
  /** Probability the survivor dies anyway while trying to save, [0,1]. Default derived. */
  readonly escapeRisk?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function saveOptions(ctx: SaveContext): EconomyOption[] {
  const weaponValue = weaponPrice(ctx.survivorWeaponKey) ?? 0;
  const escapeRisk = clamp01(ctx.escapeRisk ?? Math.min(0.6, 0.15 + 0.12 * ctx.aliveEnemy));
  const survive = 1 - escapeRisk;

  const wfv = weaponFutureValue({
    weaponValueCredits: weaponValue,
    roundNum: ctx.roundNum,
    matchScore: ctx.matchScore,
    teamIdx: ctx.teamIdx,
  });
  const ultDenial = ctx.enemyNearUlt ? ultDenialValue(ctx.enemyNearUlt) : 0;
  const deathProbIfPlay = clamp01(1 - ctx.roundWinProb);

  const save: EconomyOption = {
    action: "SAVE_WEAPON",
    currentRoundValue: round3(-ctx.roundWinProb), // forfeits the contest
    futureValue: round3(clamp01(wfv * survive + ultDenial * survive)),
    economicDelta: Math.round(weaponValue * survive), // equipment credits preserved (expected)
    ultDelta: round3(ctx.enemyNearUlt ? survive : 0), // enemy points denied by surviving
    explanation:
      `SAVE_WEAPON: preserve ${ctx.survivorWeaponKey} (${weaponValue}cr) ` +
      `future=${wfv === 0 ? "0 (half/OT reset or match point)" : wfv.toFixed(2)}` +
      (ultDenial > 0 ? `, denies enemy ${ctx.enemyNearUlt?.agentKey} ult point` : "") +
      `, escapeRisk ${(escapeRisk * 100).toFixed(0)}%`,
  };

  const play: EconomyOption = {
    action: "PLAY_FOR_ROUND",
    currentRoundValue: round3(ctx.roundWinProb),
    futureValue: round3(-(wfv * deathProbIfPlay) - (ultDenial * deathProbIfPlay)),
    economicDelta: -Math.round(weaponValue * deathProbIfPlay), // expected equipment lost
    ultDelta: round3(ctx.enemyNearUlt ? -deathProbIfPlay : 0), // may feed the point
    explanation:
      `PLAY_FOR_ROUND: contest at ${(ctx.roundWinProb * 100).toFixed(0)}% win; ` +
      `risks the ${ctx.survivorWeaponKey} (${(deathProbIfPlay * 100).toFixed(0)}% loss)` +
      (ultDenial > 0 ? " and may feed the enemy ult point" : ""),
  };

  return [save, play];
}

/** Total score of an option = current + future (the decision layer may weight differently). */
export const optionScore = (o: EconomyOption): number => o.currentRoundValue + o.futureValue;

/**
 * Convenience recommendation: the higher combined score. This is the multi-factor comparison, not a
 * win-probability cutoff — a low win prob alone does not force a save if the weapon/ult has no
 * future value (e.g. match point), and a high weapon+ult value can justify saving even at a
 * moderate win prob.
 */
export function recommendSave(ctx: SaveContext): boolean {
  const [save, play] = saveOptions(ctx);
  return optionScore(save!) >= optionScore(play!);
}
