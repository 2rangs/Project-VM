/**
 * Buy-plan value: the objective a team maximises when it picks how to buy (EC-01, backlog A5).
 *
 *     J(plan) = E[ P(win the map) after this round and the next ]
 *
 * The two rounds are scored with the team's BELIEF of a round win from the two loadouts
 * (`roundWinBelief`, the VCT economy-matchup table read continuously), and every later round is a
 * coin flip (`mapWinProbability`). So the weight of the next round against this one — the γ of
 * `P(win now) + γ·E[P(win next)]` — is not a constant: it falls out of the scoreline (a round that
 * can end the map leaves no next round to buy for; a round before the half or overtime has no
 * economic future because credits reset).
 *
 * Everything here is a pure, deterministic function of its input.
 */
import type { BuyTier } from "./priors-fixture.js";
import { WIN_ROUNDS, isPreResetRound } from "./round-boundaries.js";

/** The VCT tier of a team loadout value (eco < 5000, semi 5000–20000, full ≥ 20000; VALIDATION_BASELINES §2). */
export function vctTierForLoadout(teamLoadoutValue: number): Exclude<BuyTier, "pistol"> {
  if (teamLoadoutValue >= 20_000) return "full";
  if (teamLoadoutValue >= 5_000) return "semi";
  return "eco";
}

/**
 * Round-win belief from the two team loadout values, fitted to real rounds:
 *
 *     P(win) = σ(β · (g(own) − g(opp))),   g(v) = 1 − exp(−v / τ)
 *
 * Maximum likelihood on VCT Reference international rounds 2–24 (no pistols, no overtime) with both
 * loadouts known: 42,364 team-rounds, vct.duckdb sha256 a1a189d0…4890 (the priors' build). β = 4.12,
 * τ = 10,000 credits; log-loss 0.612 per round (a coin flip is 0.693). g saturates: the first
 * credits buy the most (a rifle over a pistol), the last few hundred little. Read against the data
 * (opponent on a ~22.5k full buy): own 7.9k → 0.19 (real 0.22), 12.5k → 0.32 (0.29),
 * 16.6k → 0.41 (0.39), 19.7k → 0.46 (0.48). An eco (≈2.7k) is under-read: 0.06 against 0.13 real
 * (n = 179); see docs/ECONOMY_MODEL.md.
 */
export const ROUND_WIN_BELIEF = {
  beta: 4.12,
  tauCredits: 10_000,
  source: "vct-reference vct.duckdb a1a189d0ec7d9a71d7586645a3ce5d39bfea719c2f782bb287a23a300cea4890 (international, rounds 2–24)",
  teamRounds: 42_364,
} as const;

/**
 * The same curve fitted to THIS simulator's rounds. Refit 2026-11-23 on the recalibrated engine
 * (main 4f72e64: damage carryover 0.4, positional smoke/plant, post-plant guards) — sim-batch real
 * rosters, Ascent, seeds 1–160, rounds 2–24, 5,618 team-rounds: β = 8.35, τ = 18,500, log-loss 0.532
 * (the previous fit 7.75 / 12,000 scores 0.534, the VCT curve 0.557). First fit, pre-recalibration
 * engine (38ab6a5, 5,392 team-rounds): 7.75 / 12,000. Loadout decides a simulated round harder than a
 * real one — rounds the VCT curve gives 0.3 are won 0.14 in the sim — so a team that believed the VCT
 * curve would force into fights its world does not give it. Match-runner teams use this curve by
 * default (they believe what their world does); refit it when the combat model changes
 * (docs/ECONOMY_MODEL.md, "Refitting the belief").
 */
export const SIM_ROUND_WIN_BELIEF = {
  beta: 8.35,
  tauCredits: 18_500,
  source: "sim-batch v-fp-1 (merge of 4f72e64), real rosters, Ascent, seeds 1–160, rounds 2–24",
  teamRounds: 5_618,
} as const;

/** Parameters of the round-win belief curve (β, τ); ROUND_WIN_BELIEF is the VCT fit. */
export interface WinBeliefParams { readonly beta: number; readonly tauCredits: number }

export function roundWinBelief(ownLoadoutValue: number, oppLoadoutValue: number, params: WinBeliefParams = ROUND_WIN_BELIEF): number {
  const { beta, tauCredits } = params;
  const g = (v: number) => 1 - Math.exp(-Math.max(0, v) / tauCredits);
  return 1 / (1 + Math.exp(-beta * (g(ownLoadoutValue) - g(oppLoadoutValue))));
}

/**
 * P(this team wins the map) from score (own, opp) when every remaining round is a coin flip.
 * First to 13; from 12–12 overtime is won by two (each OT pair a coin flip → 0.5 at a tie).
 */
export function mapWinProbability(own: number, opp: number): number {
  if (own >= WIN_ROUNDS && own - opp >= 2) return 1;
  if (opp >= WIN_ROUNDS && opp - own >= 2) return 0;
  if (own >= WIN_ROUNDS - 1 && opp >= WIN_ROUNDS - 1) {
    // Overtime: a lead of one wins with 0.75 (win the next, or tie and then 0.5), tie 0.5.
    const d = own - opp;
    return d === 0 ? 0.5 : d === 1 ? 0.75 : 0.25;
  }
  return memoMapWin(own, opp);
}

const MAP_WIN_MEMO = new Map<number, number>();
function memoMapWin(own: number, opp: number): number {
  const key = own * 64 + opp;
  const hit = MAP_WIN_MEMO.get(key);
  if (hit !== undefined) return hit;
  const v = 0.5 * mapWinProbability(own + 1, opp) + 0.5 * mapWinProbability(own, opp + 1);
  MAP_WIN_MEMO.set(key, v);
  return v;
}

/** Whether the map is over at this score. */
export function mapOver(own: number, opp: number): boolean {
  return (own >= WIN_ROUNDS && own - opp >= 2) || (opp >= WIN_ROUNDS && opp - own >= 2);
}

/** Inputs for scoring one candidate plan. */
export interface PlanValueInput {
  /** 1-based number of the round being bought for. */
  readonly roundNum: number;
  /** Score before this round: [own, opp]. */
  readonly score: readonly [number, number];
  /** Belief that we win THIS round with this plan (roundWinBelief of the two loadouts). */
  readonly winNow: number;
  /** Belief that we win the NEXT round if we win / lose this one. Ignored at a reset boundary. */
  readonly winNextIfWon: number;
  readonly winNextIfLost: number;
  /**
   * How fully the team weighs the next round's economy, from its players' discipline (1 = the
   * neutral, league-average weighting). The next-round beliefs are pulled toward a coin flip by
   * (1 − weight): an impatient team underrates what a save buys it.
   */
  readonly futureWeight?: number;
}

/**
 * J = E[P(map win)] over the outcomes of this round and the next. The next round's beliefs count
 * only when the economy carries into it (not before the half or overtime) and the map is not over.
 */
export function planValue(input: PlanValueInput): number {
  const [own, opp] = input.score;
  const w = input.futureWeight ?? 1;
  const carries = !isPreResetRound(input.roundNum);
  const shrink = (p: number) => (carries ? 0.5 + w * (p - 0.5) : 0.5);
  const branch = (won: boolean): number => {
    const a = own + (won ? 1 : 0);
    const b = opp + (won ? 0 : 1);
    if (mapOver(a, b)) return mapWinProbability(a, b);
    const pn = shrink(won ? input.winNextIfWon : input.winNextIfLost);
    return pn * mapWinProbability(a + 1, b) + (1 - pn) * mapWinProbability(a, b + 1);
  };
  return input.winNow * branch(true) + (1 - input.winNow) * branch(false);
}

// ---------------------------------------------------------------------------------------------
// Lookahead over future rounds (team level)
// ---------------------------------------------------------------------------------------------

/** One team's economy as the lookahead sees it. */
export interface LookaheadTeam {
  /** Credits per player at the start of the round. */
  readonly credits: readonly number[];
  /** Expected value (credits) of the equipment each player carries in. */
  readonly kept: readonly number[];
  /** Full loadout cost per player (rifle + heavy shield + kit) — what a buy is capped at. */
  readonly caps: readonly number[];
  /** Price of the weapon a rich player can buy for a poor one. */
  readonly dropPrice: number;
  readonly lossStreak: number;
  /** Share of a loadout still carried after a won / lost round (the team's survival belief). */
  readonly keptIfWon: number;
  readonly keptIfLost: number;
  /** Extra loadout value fielded in the next round this team plays (a held ultimate); then gone. */
  readonly extraValue?: number;
}

/** Per-player credit income after a round (win reward or loss-bonus ladder), injected from the rules. */
export interface IncomeRules {
  readonly win: number;
  readonly lossBonus: (consecutiveLosses: number) => number;
  readonly maxCredits: number;
}

/** What a team fields when it buys (each player up to their cap; surplus buys rifles for others). */
export function teamBuy(t: LookaheadTeam): { value: number; perPlayer: number[]; left: number[] } {
  const n = t.credits.length;
  const want = Array.from({ length: n }, (_, i) => Math.max(0, t.caps[i]! - t.kept[i]!));
  const own = Array.from({ length: n }, (_, i) => Math.min(t.credits[i]!, want[i]!));
  let surplus = 0;
  for (let i = 0; i < n; i++) surplus += t.credits[i]! - own[i]!;
  const perPlayer = own.map((s, i) => t.kept[i]! + s);
  const left = t.credits.map((c, i) => c - own[i]!);
  // Drops: surplus covers a short player's gap, at most one weapon each.
  for (let i = 0; i < n && surplus > 0; i++) {
    const gap = Math.min(t.dropPrice, want[i]! - own[i]!);
    if (gap <= 0) continue;
    const give = Math.min(gap, surplus);
    perPlayer[i] = perPlayer[i]! + give;
    surplus -= give;
    // Take it from the richest players' leftovers.
    let rest = give;
    const order = left.map((v, k) => [v, k] as const).sort((a, b) => b[0] - a[0]);
    for (const [, k] of order) { const d = Math.min(left[k]!, rest); left[k] = left[k]! - d; rest -= d; if (rest <= 0) break; }
  }
  return { value: perPlayer.reduce((a, b) => a + b, 0) + (t.extraValue ?? 0), perPlayer, left };
}

/** The team after a round: leftover + income, and the equipment its survivors carry. */
export function advanceLookahead(t: LookaheadTeam, fielded: readonly number[], left: readonly number[], won: boolean, rules: IncomeRules): LookaheadTeam {
  const income = won ? rules.win : rules.lossBonus(t.lossStreak + 1);
  const share = won ? t.keptIfWon : t.keptIfLost;
  return {
    ...t,
    credits: left.map((c) => Math.min(rules.maxCredits, c + income)),
    kept: fielded.map((v) => share * v),
    lossStreak: won ? 0 : t.lossStreak + 1,
    extraValue: 0,
  };
}

export interface LookaheadInput {
  /** The round about to be played (1-based) and the score before it: [own, opp]. */
  readonly roundNum: number;
  readonly score: readonly [number, number];
  readonly own: LookaheadTeam;
  readonly opp: LookaheadTeam;
  /** Future rounds to plan (each a choice of buy or save). Beyond them every round is a coin flip. */
  readonly depth: number;
  readonly rules: IncomeRules;
  /** See PlanValueInput.futureWeight. */
  readonly futureWeight?: number;
  /** Belief curve; the VCT fit when omitted. */
  readonly belief?: WinBeliefParams;
}

/**
 * E[P(map win)] from the start of `roundNum`, choosing buy or save in each of the next `depth`
 * rounds to maximise it. The opponent is assumed to buy whenever it plays (it fields everything it
 * can) — a cautious read. Rounds after a reset (half, overtime) are coin flips: the economy does
 * not carry. A round's belief is pulled toward 0.5 by (1 − futureWeight).
 */
export function lookaheadValue(input: LookaheadInput): number {
  const [own, opp] = input.score;
  if (mapOver(own, opp)) return mapWinProbability(own, opp);
  if (input.depth <= 0 || isPreResetRound(input.roundNum - 1)) return mapWinProbability(own, opp);
  const w = input.futureWeight ?? 1;
  const oppBuy = teamBuy(input.opp);
  const options: { value: number; perPlayer: readonly number[]; left: readonly number[] }[] = [
    teamBuy(input.own),
    { value: input.own.kept.reduce((a, b) => a + b, 0) + (input.own.extraValue ?? 0), perPlayer: input.own.kept, left: input.own.credits },
  ];
  let best = 0;
  for (const o of options) {
    const p = 0.5 + w * (roundWinBelief(o.value, oppBuy.value, input.belief) - 0.5);
    const next = (won: boolean) => lookaheadValue({
      ...input,
      roundNum: input.roundNum + 1,
      score: won ? [own + 1, opp] : [own, opp + 1],
      own: advanceLookahead(input.own, o.perPlayer, o.left, won, input.rules),
      opp: advanceLookahead(input.opp, oppBuy.perPlayer, oppBuy.left, !won, input.rules),
      depth: input.depth - 1,
    });
    best = Math.max(best, p * next(true) + (1 - p) * next(false));
  }
  return best;
}

/** Leverage of a round: how much winning it moves P(map win). Used to rank key rounds (ult timing). */
export function roundLeverage(own: number, opp: number): number {
  return mapWinProbability(own + 1, opp) - mapWinProbability(own, opp + 1);
}

