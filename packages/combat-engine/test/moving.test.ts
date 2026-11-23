// A shooter who is moving when the fight starts pays the moving penalty only until it has
// stopped (CombatParams.accuracy.stopMs). Stopping takes longer from a run than from a walk, and
// less time with a better movement skill.
import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, type CombatParams } from "../src/params.js";
import { headshotChance, hitChance, movingAt, stoppedAtMs } from "../src/skills.js";
import { monteCarloDuel } from "../src/montecarlo.js";
import { mkCombatant } from "./fixtures/weapons.js";

const P = DEFAULT_PARAMS;
const stand = mkCombatant({ id: "stand", weapon: "Vandal" });
const mover = (over: Parameters<typeof mkCombatant>[0]["posture"] = {}, skills = {}) =>
  mkCombatant({ id: "mover", weapon: "Vandal", posture: { moving: true, ...over }, skills });

describe("stopping time of a moving shooter", () => {
  it("is 0 for a standing player; from a run it is twice the walk's; perception delay comes first", () => {
    expect(stoppedAtMs(stand, P)).toBe(0);
    const run = stoppedAtMs(mover({ pace: "run" }, { movement: 0.5 }), P);
    const walk = stoppedAtMs(mover({ pace: "walk" }, { movement: 0.5 }), P);
    expect(run).toBeCloseTo(P.accuracy.stopMs.run, 6);
    expect(walk).toBeCloseTo(P.accuracy.stopMs.walk, 6);
    expect(run).toBeCloseTo(2 * walk, 6);
    expect(stoppedAtMs(mover({}, { movement: 0.5 }), P)).toBeCloseTo(run, 6); // no pace given = a run
    // it cannot start stopping before it has seen the enemy
    expect(stoppedAtMs(mover({ pace: "run", seesEnemyAtMs: 300 }, { movement: 0.5 }), P)).toBeCloseTo(300 + run, 6);
  });

  it("movement skill decides how fast: ×1.4 at 0, ×0.6 at 1", () => {
    const at = (movement: number) => stoppedAtMs(mover({ pace: "run" }, { movement }), P);
    expect(at(0)).toBeCloseTo(P.accuracy.stopMs.run * 1.4, 6);
    expect(at(1)).toBeCloseTo(P.accuracy.stopMs.run * 0.6, 6);
    expect(at(0.9)).toBeLessThan(at(0.3));
  });

  it("shots before the stop are moving shots, shots after it are standing shots", () => {
    const m = mover({ pace: "run" }, { movement: 0.5 });
    const stop = stoppedAtMs(m, P);
    const standing = hitChance(stand, stand, 15, false, P);
    const early = hitChance(m, stand, 15, false, P, {}, stop - 1);
    const late = hitChance(m, stand, 15, false, P, {}, stop);
    expect(early).toBeLessThan(standing * 0.75);
    expect(late).toBeCloseTo(standing, 9);
    expect(headshotChance(m, P, {}, stop - 1)).toBeCloseTo(headshotChance(stand, P) * P.headshot.movingMultiplier, 9);
    expect(headshotChance(m, P, {}, stop)).toBeCloseTo(headshotChance(stand, P), 9);
    // the opponent shoots at a moving target only until then, too
    expect(hitChance(stand, m, 15, false, P, {}, stop - 1)).toBeLessThan(hitChance(stand, m, 15, false, P, {}, stop));
    // without a time the question is "as it was at contact" (the earlier, whole-duel reading)
    expect(hitChance(m, stand, 15, false, P)).toBeCloseTo(early, 9);
    expect(movingAt(m, P, {})).toBe(true);
  });

  it("the stop-time scale is a calibration hook: Infinity is a shooter who never settles", () => {
    const m = mover({ pace: "run" });
    expect(stoppedAtMs(m, P, { stopTimeScale: 2 })).toBeCloseTo(2 * stoppedAtMs(m, P), 6);
    expect(movingAt(m, P, { stopTimeScale: Infinity }, 60_000)).toBe(true);
    expect(movingAt(m, P, {}, 60_000)).toBe(false);
  });
});

describe("what it does to a duel (5,000 seeded duels each, Vandal v Vandal at 15 m)", () => {
  const winRate = (a: ReturnType<typeof mkCombatant>, params: CombatParams = P): number =>
    monteCarloDuel({ a, b: mkCombatant({ id: "holder", weapon: "Vandal" }), distanceMeters: 15 }, 5000, 7, { params }).winRateA;

  it("standing > walking in > running in > never stopping, for the same player", () => {
    const standing = winRate(mkCombatant({ id: "a", weapon: "Vandal" }));
    const walking = winRate(mkCombatant({ id: "a", weapon: "Vandal", posture: { moving: true, pace: "walk" } }));
    const running = winRate(mkCombatant({ id: "a", weapon: "Vandal", posture: { moving: true, pace: "run" } }));
    const never = winRate(mkCombatant({ id: "a", weapon: "Vandal", posture: { moving: true, pace: "run" } }),
      { ...P, accuracy: { ...P.accuracy, stopMs: { run: Infinity, walk: Infinity } } });
    // (two equal standing players are not 50/50 here: on a tie the engine lets combatant a fire first)
    expect(walking).toBeLessThan(standing);
    expect(running).toBeLessThan(walking);
    expect(never).toBeLessThan(running);
    // eslint-disable-next-line no-console
    console.log(`win rate vs a standing equal: standing ${standing.toFixed(3)}, walking in ${walking.toFixed(3)}, running in ${running.toFixed(3)}, never stopping ${never.toFixed(3)}`);
  });

  it("a better mover loses less by arriving on the run", () => {
    const run = (movement: number) => winRate(mkCombatant({ id: "a", weapon: "Vandal", posture: { moving: true, pace: "run" }, skills: { movement } }));
    expect(run(0.9)).toBeGreaterThan(run(0.3));
  });
});
