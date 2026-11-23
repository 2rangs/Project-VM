// Gaze-based time to first shot: perception (reaction) + Fitts aim time over the crosshair's
// angle off the enemy (CombatParams.aim). Used when a posture carries aimOffsetDeg.
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../src/params.js";
import { aimTimeMs, bodyAngularWidthDeg, effectiveAimOffsetDeg, readyDelayMs } from "../src/skills.js";
import { resolveDuel } from "../src/engine.js";
import { mkCombatant } from "./fixtures/weapons.js";

const P = DEFAULT_PARAMS;

describe("Fitts aim time", () => {
  it("D = 0 costs only the intercept a; each doubling of D/W adds about b(aim)", () => {
    expect(aimTimeMs(0, 3, 0.5, P)).toBeCloseTo(P.aim.fittsA, 9);
    const b = (P.aim.fittsBSlowMs + P.aim.fittsBFastMs) / 2;
    const w = 3;
    // log2(1 + D/W): at D/W = 7 → 3 bits, at D/W = 15 → 4 bits
    expect(aimTimeMs(15 * w, w, 0.5, P) - aimTimeMs(7 * w, w, 0.5, P)).toBeCloseTo(b, 6);
  });

  it("a farther target is narrower, so the same angle takes longer to hit", () => {
    expect(bodyAngularWidthDeg(30, P)).toBeLessThan(bodyAngularWidthDeg(10, P));
    expect(aimTimeMs(20, bodyAngularWidthDeg(30, P), 0.6, P)).toBeGreaterThan(aimTimeMs(20, bodyAngularWidthDeg(10, P), 0.6, P));
  });

  it("crosshair placement removes the height error: placement 1 → the gaze error alone", () => {
    expect(effectiveAimOffsetDeg(0, 1, P)).toBe(0);
    expect(effectiveAimOffsetDeg(0, 0, P)).toBeCloseTo(P.aim.placementSigmaDeg, 9);
    expect(effectiveAimOffsetDeg(0, 0.8, P)).toBeLessThan(effectiveAimOffsetDeg(0, 0.4, P));
  });
});

describe("gaze decides who shoots first (counterfactuals)", () => {
  const fighter = (id: string, aimOffsetDeg: number, skills = {}) =>
    mkCombatant({ id, weapon: "Vandal", posture: { aimOffsetDeg }, skills });

  it("two equal players: the one watching the edge fires first ≥ 80% of 1,000 duels; the gap grows with range", () => {
    const firstShotShare = (distance: number): number => {
      let first = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const r = resolveDuel({ a: fighter("watch", 0), b: fighter("off", 30), distanceMeters: distance }, seed);
        const shot = r.events.find((e) => e.kind === "shot");
        if (shot?.actor === "watch") first++;
      }
      return first / 1000;
    };
    const near = firstShotShare(8), far = firstShotShare(30);
    expect(near).toBeGreaterThanOrEqual(0.8);
    // with a smaller target the 30° flick costs more: the watcher's lead (ms) grows with range
    const lead = (d: number) => readyDelayMs(fighter("off", 30), P, {}, d) - readyDelayMs(fighter("watch", 0), P, {}, d);
    expect(lead(30)).toBeGreaterThan(lead(8));
    expect(far).toBeGreaterThanOrEqual(near);
  });

  it("raising crosshairPlacement 0.4 → 0.8 moves the first shot earlier and the duel win rate up, not only head-shot share", () => {
    const wins = (cp: number) => {
      let w = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const r = resolveDuel({ a: fighter("x", 5, { crosshairPlacement: cp }), b: fighter("y", 5, { crosshairPlacement: 0.6 }), distanceMeters: 15 }, seed);
        if (r.winner === "x") w++;
      }
      return w / 1000;
    };
    expect(readyDelayMs(fighter("x", 5, { crosshairPlacement: 0.8 }), P, {}, 15)).toBeLessThan(readyDelayMs(fighter("x", 5, { crosshairPlacement: 0.4 }), P, {}, 15));
    expect(wins(0.8)).toBeGreaterThan(wins(0.4) + 0.05);
  });

  it("without aimOffsetDeg the legacy pre-aim model is unchanged", () => {
    const legacy = mkCombatant({ id: "l", weapon: "Vandal", posture: { preAim: true } });
    expect(readyDelayMs(legacy, P)).toBe(P.reaction.preAimMs);
  });
});
