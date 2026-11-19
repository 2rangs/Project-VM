import { describe, it, expect } from "vitest";
import { clutchReactionMs, crossfirePenaltyMs, infoWeight } from "../src/situational.js";

describe("crossfire — Hick–Hyman law", () => {
  it("no extra gun, no penalty; one extra gun costs exactly one bit", () => {
    expect(crossfirePenaltyMs(45, 0, 0.6)).toBe(0);
    expect(crossfirePenaltyMs(45, 1, 0.6)).toBeCloseTo(45);
  });
  it("grows with the log of the guns: more numbers is always worse, with diminishing steps", () => {
    const p = [1, 2, 3, 4].map((n) => crossfirePenaltyMs(45, n, 0.6));
    expect(p[1]).toBeCloseTo(45 * Math.log2(3));
    expect(p[3]).toBeCloseTo(45 * Math.log2(5));
    expect(p[1]! - p[0]!).toBeGreaterThan(p[3]! - p[2]!);
    expect(p[3]).toBeGreaterThan(p[2]!);
  });
  it("game sense shrinks it (1.0 → half), poor game sense grows it (0.2 → ×1.5)", () => {
    expect(crossfirePenaltyMs(45, 1, 1.0)).toBeCloseTo(22.5);
    expect(crossfirePenaltyMs(45, 1, 0.2)).toBeCloseTo(67.5);
  });
});

describe("info — exponential decay", () => {
  it("is 1 when fresh, 0.5 after one half-life, 0.25 after two", () => {
    expect(infoWeight(0, 2000, 0.6)).toBe(1);
    expect(infoWeight(2000, 2000, 0.6)).toBeCloseTo(0.5);
    expect(infoWeight(4000, 2000, 0.6)).toBeCloseTo(0.25);
  });
  it("a good trader keeps the call usable longer", () => {
    expect(infoWeight(2000, 2000, 1.0)).toBeGreaterThan(infoWeight(2000, 2000, 0.6));
    expect(infoWeight(2000, 2000, 0.2)).toBeLessThan(infoWeight(2000, 2000, 0.6));
  });
  it("no info window means no info", () => {
    expect(infoWeight(100, 0, 0.6)).toBe(0);
  });
});

describe("clutch composure", () => {
  it("average is neutral; elite reacts 100ms earlier, poor 100ms later", () => {
    expect(clutchReactionMs(0.6)).toBeCloseTo(0);
    expect(clutchReactionMs(1.0)).toBeCloseTo(-100);
    expect(clutchReactionMs(0.2)).toBeCloseTo(100);
  });
});
