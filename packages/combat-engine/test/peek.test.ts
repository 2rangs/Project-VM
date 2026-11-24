// Peeks as geometry: a target moving across the line of sight (tracking offset) and a fighter that
// leaves the line of sight on its own (exposure window → disengage). No flat bonus anywhere.
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "../src/params.js";
import { readyDelayMs, trackingOffsetDeg } from "../src/skills.js";
import { resolveDuel } from "../src/engine.js";
import { mkCombatant } from "./fixtures/weapons.js";

const P = DEFAULT_PARAMS;

describe("tracking a swing", () => {
  it("offset = atan(lateral · perception / distance): zero for a still target, larger close up", () => {
    expect(trackingOffsetDeg(0, 15, 180)).toBe(0);
    expect(trackingOffsetDeg(5.4, 15, 180)).toBeCloseTo((Math.atan2(5.4 * 0.18, 15) * 180) / Math.PI, 9);
    expect(trackingOffsetDeg(5.4, 8, 180)).toBeGreaterThan(trackingOffsetDeg(5.4, 20, 180));
  });

  it("a holder pre-aimed on the peek point is slower against a run swing than a walking slice, slower than vs a still target", () => {
    const holder = mkCombatant({ id: "h", weapon: "Vandal", posture: { aimOffsetDeg: 0 } });
    const still = readyDelayMs(holder, P, {}, 15, 0);
    const walk = readyDelayMs(holder, P, {}, 15, 2.5);
    const run = readyDelayMs(holder, P, {}, 15, 5.4);
    expect(walk).toBeGreaterThan(still);
    expect(run).toBeGreaterThan(walk);
    // a faster reaction sees less of the swing go past before it starts aiming
    const quick = mkCombatant({ id: "q", weapon: "Vandal", posture: { aimOffsetDeg: 0 }, skills: { reaction: 1 } });
    const slow = mkCombatant({ id: "s", weapon: "Vandal", posture: { aimOffsetDeg: 0 }, skills: { reaction: 0 } });
    const cost = (c: typeof holder) => readyDelayMs(c, P, {}, 15, 5.4) - readyDelayMs(c, P, {}, 15, 0);
    expect(cost(quick)).toBeLessThan(cost(slow));
  });

  it("legacy posture (no aimOffsetDeg) is unchanged by the target's lateral speed", () => {
    const c = mkCombatant({ id: "x", weapon: "Vandal" });
    expect(readyDelayMs(c, P, {}, 15, 5.4)).toBe(readyDelayMs(c, P, {}, 15, 0));
  });
});

describe("exposure window (jiggle / shoulder peek)", () => {
  it("a peek that leaves before the holder is ready ends as a disengage with nobody hurt", () => {
    const peeker = mkCombatant({ id: "p", weapon: "Vandal", posture: { aimOffsetDeg: 40, moving: true, exposedUntilMs: 120 } });
    const holder = mkCombatant({ id: "h", weapon: "Vandal", posture: { aimOffsetDeg: 0, seesEnemyAtMs: 0 } });
    const r = resolveDuel({ a: peeker, b: holder, distanceMeters: 15 }, 7);
    expect(r.winner).toBeNull();
    expect(r.disengagedAtMs).toBe(120);
    expect(r.outcomes.p!.health).toBe(100);
    expect(r.events.filter((e) => e.kind === "shot")).toHaveLength(0);
  });

  it("the longer the exposure, the more often the holder lands a shot (over 1,000 seeds)", () => {
    const hitShare = (exposure: number): number => {
      let hit = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const peeker = mkCombatant({ id: "p", weapon: "Vandal", posture: { aimOffsetDeg: 40, moving: true, exposedUntilMs: exposure } });
        const holder = mkCombatant({ id: "h", weapon: "Vandal", posture: { aimOffsetDeg: 0 } });
        const r = resolveDuel({ a: peeker, b: holder, distanceMeters: 15 }, seed);
        if (r.outcomes.p!.health < 100) hit++;
      }
      return hit / 1000;
    };
    const short = hitShare(250), long = hitShare(600);
    expect(long).toBeGreaterThan(short);
  });
});
