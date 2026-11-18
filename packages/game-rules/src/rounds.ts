/**
 * Round structure rules (README §19, Handoff §16). Standard competitive (Bo-map) ruleset.
 *
 * Provisional (verified: false). Sources: Riot patch notes
 * https://playvalorant.com/en-us/news/game-updates/ and the gameplay wiki.
 */
import { provisional, type RuleValue } from "./rule-value.js";

const PATCH_NOTES = "https://playvalorant.com/en-us/news/game-updates/";
const WIKI = "https://wiki.playvalorant.com/en-us/";

export interface RoundRules {
  readonly buyPhaseMs: RuleValue<number>;
  readonly roundLengthMs: RuleValue<number>; // from barrier drop to timeout (pre-plant)
  readonly roundsToWinRegulation: RuleValue<number>; // first to N
  readonly roundsPerHalf: RuleValue<number>; // side swap after this many rounds
  readonly overtimeWinMargin: RuleValue<number>; // must win by this many in OT
  readonly overtimeCredits: RuleValue<number>; // credits granted each OT round
}

export const ROUND_RULES: RoundRules = {
  buyPhaseMs: provisional(30_000, WIKI + "Rounds", {
    unit: "ms",
    patch: "estimate:>=1.0",
    note: "Barrier/buy phase before the round goes live.",
  }),
  roundLengthMs: provisional(100_000, WIKI + "Rounds", {
    unit: "ms",
    patch: "estimate:>=1.0",
    note: "Live round time before pre-plant timeout (100s).",
  }),
  roundsToWinRegulation: provisional(13, PATCH_NOTES, {
    unit: "rounds",
    patch: "estimate:>=1.0",
    note: "First to 13 (best of 24 + OT).",
  }),
  roundsPerHalf: provisional(12, PATCH_NOTES, {
    unit: "rounds",
    patch: "estimate:>=1.0",
    note: "Side swap after 12 rounds.",
  }),
  overtimeWinMargin: provisional(2, PATCH_NOTES, {
    unit: "rounds",
    patch: "UNVERIFIED",
    note: "OT: win by 2. Format/credits have changed across patches — verify.",
  }),
  overtimeCredits: provisional(5000, PATCH_NOTES, {
    unit: "credits",
    patch: "UNVERIFIED",
    note: "Credits granted per OT round — patch/format dependent.",
  }),
};

/** True if a score is a regulation win (reached target, opponent below target). */
export function isRegulationWin(scoreFor: number, scoreAgainst: number): boolean {
  const target = ROUND_RULES.roundsToWinRegulation.value;
  return scoreFor >= target && scoreAgainst < target;
}

/** True if the next round is the side-swap (half) boundary. */
export function isHalfBoundary(roundsPlayed: number): boolean {
  return roundsPlayed === ROUND_RULES.roundsPerHalf.value;
}
