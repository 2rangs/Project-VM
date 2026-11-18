import { describe, expect, it } from "vitest";
import {
  evaluateEconomy,
  makeUltState,
  recommendSave,
  saveOptions,
  optionScore,
  type SaveContext,
  type MatchScore,
} from "../src/index.js";

// Mirrors datasets/synthetic/scenarios/scenario_07/08/09 at the economy-engine level
// (the parts PV-3 leaves as TODO). teamIdx 0 is the deciding (attacking) team.

const base: SaveContext = {
  survivorWeaponKey: "operator",
  roundWinProb: 0.1, // 1v4
  aliveOwn: 1,
  aliveEnemy: 4,
  roundNum: 13,
  matchScore: [6, 6] as MatchScore,
  teamIdx: 0,
  consecutiveLosses: 0,
};

describe("Scenario 07 — Operator save (1v4, mid map)", () => {
  it("recommends saving: a 4700cr Operator with future rounds outweighs a 10% contest", () => {
    expect(recommendSave(base)).toBe(true);
    const [save] = saveOptions(base);
    expect(save!.action).toBe("SAVE_WEAPON");
    expect(save!.futureValue).toBeGreaterThan(0);
    expect(save!.economicDelta).toBeGreaterThan(0); // equipment preserved
  });
});

describe("Scenario 08 — Ultimate denial", () => {
  it("an enemy one point from ult raises save future value and ult denial", () => {
    const neon = makeUltState("e-neon", "neon", 7); // required 8 -> one from ready
    const withUlt: SaveContext = { ...base, enemyNearUlt: neon };
    const [saveNo] = saveOptions(base);
    const [saveYes] = saveOptions(withUlt);
    expect(saveYes!.futureValue).toBeGreaterThan(saveNo!.futureValue);
    expect(saveYes!.ultDelta).toBeGreaterThan(0); // surviving denies the point
    // and the PLAY option now carries a negative ult delta (feeding the point)
    const [, play] = saveOptions(withUlt);
    expect(play!.ultDelta).toBeLessThan(0);
  });
});

describe("Scenario 09 — Match point (no future round)", () => {
  it("weapon preservation has zero future value at match point, so saving is not preferred", () => {
    const matchPoint: SaveContext = {
      ...base,
      roundNum: 24,
      matchScore: [11, 12] as MatchScore, // opponent can clinch this round
    };
    const [save] = saveOptions(matchPoint);
    expect(save!.futureValue).toBe(0); // no future: weapon won't carry and the map can end
    expect(recommendSave(matchPoint)).toBe(false); // play for the win instead
  });

  it("the last round before the half (12) also zeroes weapon future value", () => {
    const preHalf: SaveContext = { ...base, roundNum: 12, matchScore: [5, 5] as MatchScore };
    const [save] = saveOptions(preHalf);
    expect(save!.futureValue).toBe(0);
  });
});

describe("determinism", () => {
  it("same input yields identical output", () => {
    const a = evaluateEconomy({ phase: "save", context: base });
    const b = evaluateEconomy({ phase: "save", context: { ...base } });
    expect(a).toStrictEqual(b);
  });

  it("save vs play scores are the multi-factor comparison, not a win-prob threshold", () => {
    // A low-value weapon (classic) with the same low win prob should NOT auto-save: no equipment to
    // protect, so playing scores at least as well. (Handoff §29: not a simple threshold.)
    const classic: SaveContext = { ...base, survivorWeaponKey: "classic" };
    const [save, play] = saveOptions(classic);
    expect(optionScore(play!)).toBeGreaterThanOrEqual(optionScore(save!));
  });
});
