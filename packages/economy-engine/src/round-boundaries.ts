/**
 * Round/half/match boundary rules that decide whether "future value" exists.
 *
 * VALORANT: first to 13; sides swap at the half, where loadouts reset to the pistol economy, so a
 * weapon saved in the last round of a half does NOT carry over. Overtime (round > 24) resets the
 * same way. If this round can end the map, there is no next round for the loser to save for.
 */
import type { MatchScore } from "./types.js";
import type { TeamIdx } from "./shared-mirror.js";

export const ROUNDS_PER_HALF = 12;
export const REGULATION_ROUNDS = 24;
export const WIN_ROUNDS = 13;

/** Rounds after which the economy resets (weapons do not carry): end of each half / regulation. */
export function isPreResetRound(roundNum: number): boolean {
  if (roundNum === ROUNDS_PER_HALF || roundNum === REGULATION_ROUNDS) return true;
  // In overtime each round is its own fixed-credit round, so a saved weapon doesn't carry either.
  return roundNum > REGULATION_ROUNDS;
}

/** Can THIS round end the map (someone reaches 13, or wins an OT by two)? */
export function isMapPoint(score: MatchScore): boolean {
  const [a, b] = score;
  if (a >= WIN_ROUNDS - 1 && a >= b) return true;
  if (b >= WIN_ROUNDS - 1 && b >= a) return true;
  return false;
}

/**
 * Does a future round exist for `teamIdx` to save equipment for? False when winning weapons won't
 * carry (half/OT reset) or when losing this round ends the map for that team.
 */
export function weaponPreservationHasFuture(
  roundNum: number,
  score: MatchScore,
  teamIdx: TeamIdx,
): boolean {
  if (isPreResetRound(roundNum)) return false;
  // If the OPPONENT can clinch the map by winning this round, a save buys nothing for teamIdx.
  const opp = score[teamIdx === 0 ? 1 : 0];
  if (opp >= WIN_ROUNDS - 1 && opp >= score[teamIdx]) return false;
  return true;
}
