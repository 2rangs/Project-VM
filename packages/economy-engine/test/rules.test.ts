import { describe, expect, it } from "vitest";
import {
  ULT_POINTS,
  lossBonusFor,
  ultPointsRequired,
  weaponPrice,
  clampCredits,
} from "../src/index.js";

describe("rules", () => {
  it("loss-bonus ladder matches the rules (1st/2nd/3rd+)", () => {
    expect(lossBonusFor(0)).toBe(0);
    expect(lossBonusFor(1)).toBe(1900);
    expect(lossBonusFor(2)).toBe(2400);
    expect(lossBonusFor(3)).toBe(2900);
    expect(lossBonusFor(5)).toBe(2900); // clamped to the 3+ cap
  });

  it("uses the canonical PV-1 catalog ult points (the 4 corrected agents)", () => {
    expect(ultPointsRequired("jett")).toBe(8); // PV-3 sample had 7
    expect(ultPointsRequired("sage")).toBe(7); // PV-3 sample had 8
    expect(ultPointsRequired("killjoy")).toBe(9); // PV-3 sample had 8
    expect(ultPointsRequired("brimstone")).toBe(8); // PV-3 sample had 7
    expect(ultPointsRequired("neon")).toBe(8);
    expect(ultPointsRequired("KAY-O".toLowerCase())).toBe(8);
    expect(Object.keys(ULT_POINTS).length).toBe(30);
  });

  it("weapon prices and credit clamp", () => {
    expect(weaponPrice("operator")).toBe(4700);
    expect(weaponPrice("vandal")).toBe(2900);
    expect(weaponPrice("classic")).toBe(0);
    expect(weaponPrice("nope")).toBeUndefined();
    expect(clampCredits(99999)).toBe(9000);
    expect(clampCredits(-5)).toBe(0);
  });
});
