import { describe, it, expect } from "vitest";
import { monteCarloDuel } from "../src/index.js";
import { mkCombatant } from "./fixtures/weapons.js";

const N = 500;

describe("monte-carlo win rates", () => {
  it("pre-aiming (and seeing first) beats an otherwise identical opponent", () => {
    const duel = {
      a: mkCombatant({ id: "a", weapon: "Vandal", posture: { preAim: true } }),
      b: mkCombatant({ id: "b", weapon: "Vandal" }),
      distanceMeters: 20,
    };
    const stats = monteCarloDuel(duel, N, 1000);
    expect(stats.winRateA).toBeGreaterThan(0.6);
  });

  it("a rifle beats an SMG at long range", () => {
    const duel = {
      a: mkCombatant({ id: "a", weapon: "Vandal" }),
      b: mkCombatant({ id: "b", weapon: "Spectre" }),
      distanceMeters: 42,
    };
    const stats = monteCarloDuel(duel, N, 2000);
    expect(stats.winRateA).toBeGreaterThan(0.55);
  });

  it("an SMG is competitive with a rifle up close (not dominated)", () => {
    const duel = {
      a: mkCombatant({ id: "a", weapon: "Vandal" }),
      b: mkCombatant({ id: "b", weapon: "Spectre" }),
      distanceMeters: 8,
    };
    const stats = monteCarloDuel(duel, N, 3000);
    expect(stats.winRateA).toBeLessThan(0.65); // much closer than at range
  });

  it("information advantage can beat a higher-skill opponent (no OVR determinism)", () => {
    const lowSkillButInformed = mkCombatant({
      id: "a",
      weapon: "Vandal",
      posture: { preAim: true, seesEnemyAtMs: 0 },
      skills: { aim: 0.4, reaction: 0.4, crosshairPlacement: 0.4, firstBulletAccuracy: 0.4, tracking: 0.4, movement: 0.4, weaponControl: 0.4 },
    });
    const highSkillButLate = mkCombatant({
      id: "b",
      weapon: "Vandal",
      posture: { seesEnemyAtMs: 250 }, // reacts late, no pre-aim
      skills: { aim: 0.95, reaction: 0.95, crosshairPlacement: 0.95, firstBulletAccuracy: 0.95, tracking: 0.95, movement: 0.95, weaponControl: 0.95 },
    });
    const stats = monteCarloDuel({ a: lowSkillButInformed, b: highSkillButLate, distanceMeters: 18 }, N, 4000);
    expect(stats.winRateA).toBeGreaterThan(0.5);
  });
});
