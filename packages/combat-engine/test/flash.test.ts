import { describe, it, expect } from "vitest";
import { resolveDuel, monteCarloDuel } from "../src/index.js";
import { mkCombatant } from "./fixtures/weapons.js";

describe("flash", () => {
  it("a flashed combatant fires later than an un-flashed one", () => {
    const flashed = mkCombatant({ id: "a", weapon: "Vandal", posture: { flashBlindMs: 1000 } });
    const clear = mkCombatant({ id: "b", weapon: "Vandal" });
    const r = resolveDuel({ a: flashed, b: clear, distanceMeters: 15 }, 5);
    const firstShotA = r.events.find((e) => e.kind === "shot" && e.actor === "a")?.timeMs ?? Infinity;
    const firstShotB = r.events.find((e) => e.kind === "shot" && e.actor === "b")?.timeMs ?? Infinity;
    expect(firstShotB).toBeLessThan(firstShotA);
  });

  it("the flashed side loses the majority of duels", () => {
    const duel = {
      a: mkCombatant({ id: "a", weapon: "Vandal", posture: { flashBlindMs: 1000 } }),
      b: mkCombatant({ id: "b", weapon: "Vandal" }),
      distanceMeters: 15,
    };
    const stats = monteCarloDuel(duel, 500, 6000);
    expect(stats.winRateA).toBeLessThan(0.25);
  });
});
