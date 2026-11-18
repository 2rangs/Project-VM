import { describe, it, expect } from "vitest";
import {
  ECONOMY_RULES,
  lossBonusFor,
  canAfford,
  clampCredits,
  weaponPrice,
  SPIKE_RULES,
  canPlantWithin,
  canDefuseWithin,
  isUltimateReady,
  ultimatePointsRequired,
  ROUND_RULES,
  isRegulationWin,
  requireVerified,
} from "@pv/game-rules";

describe("economy rules", () => {
  it("loss bonus follows the ladder and clamps at the cap", () => {
    expect(lossBonusFor(0)).toBe(0);
    expect(lossBonusFor(1)).toBe(1900);
    expect(lossBonusFor(2)).toBe(2400);
    expect(lossBonusFor(3)).toBe(2900);
    expect(lossBonusFor(4)).toBe(2900); // capped at 3+
    expect(lossBonusFor(10)).toBe(2900);
  });

  it("canAfford compares credits against total cost", () => {
    expect(canAfford(2900, 2900)).toBe(true);
    expect(canAfford(2899, 2900)).toBe(false);
  });

  it("clampCredits keeps credits within [0, max]", () => {
    expect(clampCredits(-500)).toBe(0);
    expect(clampCredits(100_000)).toBe(ECONOMY_RULES.maxCredits.value);
    expect(clampCredits(4500)).toBe(4500);
  });

  it("weapon price lookup works and unknown weapons are undefined", () => {
    expect(weaponPrice("vandal")?.price.value).toBe(2900);
    expect(weaponPrice("operator")?.price.value).toBe(4700);
    expect(weaponPrice("classic")?.price.value).toBe(0);
    expect(weaponPrice("nonexistent")).toBeUndefined();
  });
});

describe("spike feasibility (README §15.3 / Scenario 04)", () => {
  it("cannot plant without the full plant duration remaining", () => {
    expect(canPlantWithin(SPIKE_RULES.plantDurationMs.value)).toBe(true);
    expect(canPlantWithin(SPIKE_RULES.plantDurationMs.value - 1)).toBe(false);
  });

  it("cannot fully defuse without the full defuse window", () => {
    expect(canDefuseWithin(SPIKE_RULES.defuseDurationMs.value)).toBe(true);
    expect(canDefuseWithin(1000)).toBe(false);
  });
});

describe("ultimate rules", () => {
  it("reports points required and readiness", () => {
    const req = ultimatePointsRequired("jett");
    expect(req).toBe(7);
    expect(isUltimateReady("jett", 7)).toBe(true);
    expect(isUltimateReady("jett", 6)).toBe(false);
    expect(isUltimateReady("unknown-agent", 99)).toBe(false);
  });
});

describe("round rules", () => {
  it("detects a regulation win", () => {
    expect(isRegulationWin(13, 11)).toBe(true);
    expect(isRegulationWin(12, 13)).toBe(false);
    expect(isRegulationWin(13, 13)).toBe(false);
  });

  it("exposes side-swap and OT rules", () => {
    expect(ROUND_RULES.roundsPerHalf.value).toBe(12);
  });
});

describe("provenance discipline (README §29)", () => {
  it("every shipped rule value is unverified in this scaffold", () => {
    // This agent did not perform live source verification; the Data agent must.
    expect(ECONOMY_RULES.startingCredits.verified).toBe(false);
    expect(ECONOMY_RULES.lossBonusLadder.verified).toBe(false);
    expect(SPIKE_RULES.plantDurationMs.verified).toBe(false);
    expect(ROUND_RULES.roundsToWinRegulation.verified).toBe(false);
  });

  it("requireVerified throws for an unverified value", () => {
    expect(() => requireVerified(ECONOMY_RULES.startingCredits, "startingCredits")).toThrow();
  });

  it("every rule value carries a source URL", () => {
    expect(ECONOMY_RULES.startingCredits.source).toMatch(/^https?:\/\//);
    expect(SPIKE_RULES.detonationMs.source).toMatch(/^https?:\/\//);
  });
});
