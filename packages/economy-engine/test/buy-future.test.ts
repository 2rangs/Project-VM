import { describe, expect, it } from "vitest";
import {
  buyOptions,
  projectNextRoundBank,
  exitKillOptions,
  makeUltState,
  type BuyContext,
  type MatchScore,
} from "../src/index.js";

describe("buy strategy", () => {
  const rich: BuyContext = { teamCredits: 25_000, roundNum: 4, matchScore: [2, 1], teamIdx: 0 };

  it("offers a full buy when the team is rich, scored positively vs an eco opponent", () => {
    const opts = buyOptions({ ...rich, opponentEstimatedBank: 1500 });
    const full = opts.find((o) => o.action === "fullBuy");
    expect(full).toBeDefined();
    expect(full!.currentRoundValue).toBeGreaterThan(0); // full vs eco ~0.885
  });

  it("falls back to force/eco when poor, and eco keeps the most credits", () => {
    const poor = buyOptions({ teamCredits: 2_000, roundNum: 5, matchScore: [1, 3], teamIdx: 0 });
    expect(poor.some((o) => o.action === "forceBuy")).toBe(true);
    const eco = poor.find((o) => o.action === "eco")!;
    expect(eco.economicDelta).toBeGreaterThan(0); // keeps credits vs a full buy
  });

  it("zeroes future value at match point", () => {
    const opts = buyOptions({ ...rich, matchScore: [12, 5] as MatchScore });
    for (const o of opts) expect(o.futureValue).toBe(0);
  });
});

describe("future value", () => {
  it("projects next-round bank: win reward vs loss bonus", () => {
    const won = projectNextRoundBank({ leftoverCredits: 1000, wonRound: true, consecutiveLossesBefore: 0 });
    expect(won).toBe(4000); // 1000 + 3000 win reward

    const lost = projectNextRoundBank({ leftoverCredits: 1000, wonRound: false, consecutiveLossesBefore: 1 });
    expect(lost).toBe(3400); // 1000 + 2400 (2nd consecutive loss)

    const plantLost = projectNextRoundBank({
      leftoverCredits: 1000, wonRound: false, consecutiveLossesBefore: 0, plantedSpike: true,
    });
    expect(plantLost).toBe(3200); // 1000 + 1900 (1st loss) + 300 plant
  });
});

describe("exit kill", () => {
  it("favors chasing a saved Operator when kill prob is high and death risk low", () => {
    const [chase] = exitKillOptions({
      enemyWeaponKey: "operator", ownWeaponKey: "vandal", killProb: 0.7, ownDeathProb: 0.1,
    });
    expect(chase.action).toBe("EXIT_KILL");
    expect(chase.economicDelta).toBeGreaterThan(0); // destroying a 4700 op > risking a 2900 rifle
  });

  it("dying while chasing an enemy near ult is penalized", () => {
    const enemyUlt = makeUltState("e", "jett", 7); // one from ult (jett=8)
    const [chase] = exitKillOptions({
      enemyWeaponKey: "sheriff", ownWeaponKey: "vandal", killProb: 0.3, ownDeathProb: 0.6,
      enemyNearUlt: enemyUlt,
    });
    expect(chase.ultDelta).toBeLessThan(0);
    expect(chase.economicDelta).toBeLessThan(0); // risking a rifle to kill a cheap sheriff: bad
  });
});
