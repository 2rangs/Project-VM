import { describe, it, expect } from "vitest";
import { resolveDuel, monteCarloDuel } from "../src/index.js";
import { mkCombatant } from "./fixtures/weapons.js";

function scene() {
  return {
    a: mkCombatant({ id: "a", weapon: "Phantom", posture: { preAim: true } }),
    b: mkCombatant({ id: "b", weapon: "Spectre", armor: 25 }),
    distanceMeters: 22,
  };
}

describe("determinism", () => {
  it("same seed + same input ⇒ identical event log", () => {
    const r1 = resolveDuel(scene(), 42);
    const r2 = resolveDuel(scene(), 42);
    expect(r1).toEqual(r2);
  });

  it("different seeds can give different logs", () => {
    const r1 = resolveDuel(scene(), 1);
    const r2 = resolveDuel(scene(), 2);
    // not a guarantee for every pair, but these two differ
    expect(JSON.stringify(r1.events)).not.toEqual(JSON.stringify(r2.events));
  });

  it("monte-carlo is reproducible for a fixed base seed", () => {
    const a = monteCarloDuel(scene(), 200, 777);
    const b = monteCarloDuel(scene(), 200, 777);
    expect(a).toEqual(b);
  });
});
