import { describe, expect, it } from "vitest";
import {
  advanceMatchEconomy,
  advanceTeamEconomy,
  creditAward,
  lossBonusTierFor,
  projectNextRoundBank,
  retainedWeaponValue,
  ECONOMY,
  type RoundEconomyOutcome,
  type TeamEconomyState,
} from "../src/index.js";

const team = (over: Partial<TeamEconomyState> = {}): TeamEconomyState => ({
  teamId: "t0", side: "attack", credits: 0, lossBonusTier: 0, consecutiveLosses: 0, ...over,
});

describe("creditAward", () => {
  it("awards the win reward and resets no loss bonus on a win", () => {
    const a = creditAward({ won: true, consecutiveLossesBefore: 2, planted: false, kills: 3 });
    expect(a.win).toBe(3000);
    expect(a.lossBonus).toBe(0);
    expect(a.kills).toBe(600); // 3 * 200
    expect(a.total).toBe(3600);
  });

  it("uses the loss-bonus ladder on the streak INCLUDING this loss, plus plant + kills", () => {
    // first loss -> ladder[0]=1900; planted -> +300; 2 kills -> +400
    const a = creditAward({ won: false, consecutiveLossesBefore: 0, planted: true, kills: 2 });
    expect(a.lossBonus).toBe(1900);
    expect(a.plant).toBe(300);
    expect(a.kills).toBe(400);
    expect(a.total).toBe(2600);
  });

  it("caps the loss-bonus ladder at the 3rd-plus tier", () => {
    expect(creditAward({ won: false, consecutiveLossesBefore: 5, planted: false, kills: 0 }).lossBonus).toBe(2900);
  });
});

describe("advanceTeamEconomy", () => {
  it("agrees with projectNextRoundBank plus kill rewards", () => {
    const prev = team({ credits: 0, consecutiveLosses: 0 });
    const leftover = 1500, kills = 4;
    const next = advanceTeamEconomy(prev, { won: false, planted: true, kills, leftoverCredits: leftover });
    const expected =
      projectNextRoundBank({ leftoverCredits: leftover, wonRound: false, consecutiveLossesBefore: 0, plantedSpike: true })
      + kills * ECONOMY.killReward.value;
    expect(next.credits).toBe(expected);
  });

  it("increments the loss streak and tier on a loss, resets on a win", () => {
    const afterLoss = advanceTeamEconomy(team({ consecutiveLosses: 1 }), { won: false, planted: false, kills: 0, leftoverCredits: 0 });
    expect(afterLoss.consecutiveLosses).toBe(2);
    expect(afterLoss.lossBonusTier).toBe(2);
    const afterWin = advanceTeamEconomy(afterLoss, { won: true, planted: false, kills: 0, leftoverCredits: 0 });
    expect(afterWin.consecutiveLosses).toBe(0);
    expect(afterWin.lossBonusTier).toBe(0);
  });

  it("clamps next-round credits to the economy maximum", () => {
    const next = advanceTeamEconomy(team(), { won: true, planted: true, kills: 5, leftoverCredits: 9000 });
    expect(next.credits).toBe(ECONOMY.maxCredits.value); // 9000
  });
});

describe("advanceMatchEconomy", () => {
  it("advances both teams from one outcome (winner gets win reward, loser the loss bonus)", () => {
    const prev: [TeamEconomyState, TeamEconomyState] = [
      team({ teamId: "t0", side: "attack" }),
      team({ teamId: "t1", side: "defense" }),
    ];
    const outcome: RoundEconomyOutcome = {
      roundNum: 3, winnerTeamIdx: 0, plantingTeamIdx: 0, kills: [3, 2], leftoverCredits: [500, 1000],
    };
    const [t0, t1] = advanceMatchEconomy(prev, outcome);
    // team0 won: 500 leftover + 3000 win + 300 plant + 600 kills = 4400
    expect(t0.credits).toBe(4400);
    expect(t0.consecutiveLosses).toBe(0);
    // team1 lost: 1000 leftover + 1900 (1st loss) + 400 kills = 3300
    expect(t1.credits).toBe(3300);
    expect(t1.consecutiveLosses).toBe(1);
    expect(t1.lossBonusTier).toBe(1);
  });
});

describe("retainedWeaponValue (equipment retention)", () => {
  it("sums surviving weapon prices when weapons carry over", () => {
    expect(retainedWeaponValue(["vandal", "operator"], 5)).toBe(2900 + 4700);
  });
  it("returns 0 at a half/OT reset round (loadouts reset)", () => {
    expect(retainedWeaponValue(["vandal"], 12)).toBe(0); // last round of first half
    expect(retainedWeaponValue(["vandal"], 24)).toBe(0); // last round of regulation
    expect(retainedWeaponValue(["vandal"], 25)).toBe(0); // overtime
  });
  it("ignores unknown weapon keys", () => {
    expect(retainedWeaponValue(["vandal", "not_a_gun"], 4)).toBe(2900);
  });
});

describe("lossBonusTierFor", () => {
  it("maps streak to tier, capped at the ladder length", () => {
    expect(lossBonusTierFor(0)).toBe(0);
    expect(lossBonusTierFor(1)).toBe(1);
    expect(lossBonusTierFor(3)).toBe(3);
    expect(lossBonusTierFor(9)).toBe(3);
  });
});
