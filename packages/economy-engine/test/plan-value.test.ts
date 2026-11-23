import { describe, expect, it } from "vitest";
import {
  lookaheadValue,
  mapWinProbability,
  roundWinBelief,
  teamBuy,
  vctTierForLoadout,
  type LookaheadTeam,
} from "../src/index.js";

const rules = { win: 3000, lossBonus: (n: number) => [1900, 2400, 2900][Math.min(n, 3) - 1] ?? 0, maxCredits: 9000 };
const team = (credits: number, extra: Partial<LookaheadTeam> = {}): LookaheadTeam => ({
  credits: [credits, credits, credits, credits, credits],
  kept: [0, 0, 0, 0, 0],
  caps: [4550, 4550, 4550, 4550, 4550],
  dropPrice: 2900,
  lossStreak: 0,
  keptIfWon: 0.5,
  keptIfLost: 0.12,
  ...extra,
});

describe("round-win belief (fitted to VCT loadouts)", () => {
  it("is symmetric and 0.5 on equal loadouts", () => {
    expect(roundWinBelief(15_000, 15_000)).toBeCloseTo(0.5, 10);
    for (const [a, b] of [[2_700, 22_500], [12_000, 20_000], [7_900, 16_600]]) {
      expect(roundWinBelief(a!, b!) + roundWinBelief(b!, a!)).toBeCloseTo(1, 10);
    }
  });
  it("rises with own loadout and reads the real cells within a few points", () => {
    let prev = 0;
    for (let v = 0; v <= 26_000; v += 2_000) {
      const p = roundWinBelief(v, 22_566);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
    // Real (VCT international, opponent ≈ 22.6k): 7.9k 0.215, 12.5k 0.293, 16.6k 0.394, 19.7k 0.480.
    expect(Math.abs(roundWinBelief(7_945, 22_566) - 0.215)).toBeLessThan(0.03);
    expect(Math.abs(roundWinBelief(12_466, 22_566) - 0.293)).toBeLessThan(0.03);
    expect(Math.abs(roundWinBelief(16_582, 22_566) - 0.394)).toBeLessThan(0.03);
    expect(Math.abs(roundWinBelief(19_732, 22_566) - 0.48)).toBeLessThan(0.03);
  });
  it("classifies loadouts with the VCT tier thresholds", () => {
    expect(vctTierForLoadout(4_999)).toBe("eco");
    expect(vctTierForLoadout(5_000)).toBe("semi");
    expect(vctTierForLoadout(20_000)).toBe("full");
  });
});

describe("map-win probability and lookahead", () => {
  it("is 0.5 at 0–0, terminal at 13–11, and OT is win-by-two", () => {
    expect(mapWinProbability(0, 0)).toBeCloseTo(0.5, 10);
    expect(mapWinProbability(13, 11)).toBe(1);
    expect(mapWinProbability(12, 12)).toBe(0.5);
    expect(mapWinProbability(13, 12)).toBe(0.75);
  });
  it("a richer team is worth more over the next rounds", () => {
    const base = { roundNum: 5, score: [2, 2] as const, depth: 2, rules };
    const poor = lookaheadValue({ ...base, own: team(1_000), opp: team(5_000) });
    const rich = lookaheadValue({ ...base, own: team(5_000), opp: team(5_000) });
    expect(rich).toBeGreaterThan(poor);
    expect(rich).toBeCloseTo(0.5, 1);
  });
  it("has no economic future across the half: round 13 is a coin flip whatever the bank", () => {
    const base = { roundNum: 13, score: [6, 6] as const, depth: 2, rules };
    expect(lookaheadValue({ ...base, own: team(0), opp: team(9_000) })).toBeCloseTo(0.5, 10);
  });
  it("teamBuy drops: surplus buys a rifle for a short teammate", () => {
    const t = team(0, { credits: [9_000, 9_000, 9_000, 9_000, 500] });
    const b = teamBuy(t);
    expect(b.perPlayer[4]).toBeGreaterThanOrEqual(500 + 2_900);
  });
});
