/**
 * Public I/O types for the economy engine. The Action Generator (PV-3) consumes `EconomyOption`
 * as the Resource-Cost / Expected-Utility input for a candidate (README §13.4, §15.1).
 */
import type { TeamIdx } from "./shared-mirror.js";

/** One evaluated economic choice. All value fields are deterministic functions of the input. */
export interface EconomyOption {
  /** Stable action key, e.g. "fullBuy", "SAVE_WEAPON", "EXIT_KILL", "USE_ULTIMATE". */
  readonly action: string;
  /** Marginal effect on winning THE CURRENT round, in [-1, 1] (0 = neutral). */
  readonly currentRoundValue: number;
  /** Effect on FUTURE rounds, in [-1, 1]. Forced to 0 at boundaries with no future (match point,
   *  or the last round before a half/OT reset where weapons do not carry). */
  readonly futureValue: number;
  /** Expected credit delta to own team minus enemy team, in credits (can be negative). */
  readonly economicDelta: number;
  /** Expected ENEMY ultimate points DENIED by this choice (positive = good for us). */
  readonly ultDelta: number;
  /** Human-readable reason, grounded in the numbers above (for the Decision Debugger, §21/§29). */
  readonly explanation: string;
}

/** Match score [team0Rounds, team1Rounds]. */
export type MatchScore = readonly [number, number];

export interface RoundLocator {
  readonly roundNum: number;
  readonly matchScore: MatchScore;
  readonly teamIdx: TeamIdx;
}
