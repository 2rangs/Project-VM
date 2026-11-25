/**
 * Optional weapon fields (eco catalogue): pellets + spreadDeg (shotguns), altFire (Classic burst) and
 * movingAccuracy. Weapons without them resolve exactly as before (determinism.test.ts).
 */
import { describe, expect, it } from "vitest";
import { AVERAGE_SKILLS, OPEN_POSTURE, keepsMovingAgainst, monteCarloDuel, pelletLandChance, type Combatant, type WeaponSpec } from "../src/index.js";

const RIFLE: WeaponSpec = { id: "vandal", name: "Vandal", category: "Rifles", cost: 2900, fireRate: 9.75, magazineSize: 25, reloadTimeMs: 2500, equipTimeMs: 1000, runSpeedMultiplier: 0.95, provenance: "test", damageBands: [{ maxRangeMeters: 50, head: 160, body: 40, leg: 34 }] };
const SHOTGUN: WeaponSpec = { id: "bucky", name: "Bucky", category: "Shotguns", cost: 850, fireRate: 1.1, magazineSize: 5, reloadTimeMs: 2500, equipTimeMs: 1000, runSpeedMultiplier: 1, provenance: "test", pellets: 15, spreadDeg: 7, damageBands: [{ maxRangeMeters: 8, head: 44, body: 22, leg: 19 }, { maxRangeMeters: 12, head: 34, body: 17, leg: 14 }, { maxRangeMeters: 50, head: 18, body: 9, leg: 8 }] };
const PISTOL: WeaponSpec = { id: "classic", name: "Classic", category: "Sidearms", cost: 0, fireRate: 6.75, magazineSize: 12, reloadTimeMs: 1750, equipTimeMs: 750, runSpeedMultiplier: 1, provenance: "test", damageBands: [{ maxRangeMeters: 30, head: 78, body: 26, leg: 22 }] };
const fighter = (id: string, weapon: WeaponSpec, armor = 50, moving = false): Combatant => ({ id, teamId: id, health: 100, armor, weapon, skills: AVERAGE_SKILLS, posture: { ...OPEN_POSTURE, moving } });
const winRate = (a: Combatant, b: Combatant, d: number) => monteCarloDuel({ a, b, distanceMeters: d }, 1500, 7).winRateA;

describe("pellets", () => {
  it("every pellet lands point blank; the share falls with the square of range once the cone outgrows the body", () => {
    expect(pelletLandChance(7, 3)).toBe(1);
    const at10 = pelletLandChance(7, 10), at20 = pelletLandChance(7, 20);
    expect(at10).toBeLessThan(1);
    expect(at20 / at10).toBeCloseTo(0.25, 1);
  });

  it("a shotgun wins up close and loses at range against a rifle", () => {
    expect(winRate(fighter("a", SHOTGUN, 25), fighter("b", RIFLE), 5)).toBeGreaterThan(0.6);
    expect(winRate(fighter("a", SHOTGUN, 25), fighter("b", RIFLE), 15)).toBeLessThan(0.1);
  });
});

describe("alt-fire and moving accuracy", () => {
  it("a burst alt-fire is used only inside its range", () => {
    const burst: WeaponSpec = { ...PISTOL, altFire: { useWithinMeters: 3, pellets: 3, spreadDeg: 9, fireRate: 2.22, ammoPerShot: 3 } };
    const far = winRate(fighter("a", burst, 0), fighter("b", RIFLE), 10);
    expect(far).toBeCloseTo(winRate(fighter("a", PISTOL, 0), fighter("b", RIFLE), 10), 6); // same as no alt-fire
    expect(winRate(fighter("a", burst, 0), fighter("b", RIFLE), 2)).not.toBeCloseTo(winRate(fighter("a", PISTOL, 0), fighter("b", RIFLE), 2), 3);
  });

  it("a run-and-gun weapon fights on the move when that beats the opponent's moving-target penalty", () => {
    // Average tracking keeps lerp(0.7, 1, 0.6) = 0.88 against a moving target: a shotgun that keeps
    // 0.95 of its accuracy on the move stays a moving target instead of stopping; a pistol at 0.75 stops.
    const runShotgun: WeaponSpec = { ...SHOTGUN, movingAccuracy: 0.95 };
    const movingAt = (w: WeaponSpec) => winRate(fighter("a", w, 25, true), fighter("b", RIFLE), 5);
    expect(keepsMovingAgainst(fighter("a", runShotgun, 25, true), fighter("b", RIFLE))).toBe(true);
    expect(keepsMovingAgainst(fighter("a", { ...PISTOL, movingAccuracy: 0.75 }, 25, true), fighter("b", RIFLE))).toBe(false);
    expect(keepsMovingAgainst(fighter("a", runShotgun, 25, false), fighter("b", RIFLE))).toBe(false); // standing: nothing to keep
    // Size (manual-approx catalogue, 2026-11-25): Bucky moving vs a standing Vandal at 5 m 0.58 → 0.79.
    expect(movingAt(runShotgun) - movingAt(SHOTGUN)).toBeGreaterThan(0.1);
  });
});
