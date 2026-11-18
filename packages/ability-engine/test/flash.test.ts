import { describe, it, expect } from "vitest";
import { monteCarloDuel, AVERAGE_SKILLS, OPEN_POSTURE, type Combatant } from "@project-v/combat-engine";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildCatalog, requireWeapon } from "@project-v/combat-engine";
import { AbilityEngine, combatFlashBlindMs } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

// Reuse combat-engine's committed manual-approx weapons fixture.
const weaponsRaw = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "combat-engine", "test", "fixtures", "weapons.manual-approx.json"),
    "utf8",
  ),
);
const WEAPONS = buildCatalog(weaponsRaw.weapons);
const spatial = loadSpatial();

function combatant(id: string, flashBlindMs = 0): Combatant {
  return {
    id, teamId: "t", health: 100, armor: 0,
    weapon: requireWeapon(WEAPONS, "Vandal"),
    skills: AVERAGE_SKILLS,
    posture: { ...OPEN_POSTURE, flashBlindMs },
  };
}

describe("flash ↔ combat integration", () => {
  it("a combatant flashed by an ability loses most duels vs an un-flashed foe", () => {
    const abilities = new AbilityEngine(spatial);
    abilities.use(ability("kayo:Grenade"), {
      instanceId: "f1", abilityId: "kayo:Grenade", ownerId: "b", teamId: "t2",
      origin: zonePos(spatial, "a-site"), startedAtMs: 0,
    }, { affectedPlayerIds: ["a"] });

    const blind = combatFlashBlindMs(abilities, "a", 0);
    expect(blind).toBeGreaterThan(0);

    const flashed = monteCarloDuel(
      { a: combatant("a", blind), b: combatant("b"), distanceMeters: 15 },
      500,
      9000,
    );
    const baseline = monteCarloDuel(
      { a: combatant("a"), b: combatant("b"), distanceMeters: 15 },
      500,
      9000,
    );
    expect(flashed.winRateA).toBeLessThan(0.25);
    expect(baseline.winRateA).toBeGreaterThan(flashed.winRateA);
  });

  it("the blind decays to zero after the flash duration", () => {
    const abilities = new AbilityEngine(spatial);
    abilities.use(ability("kayo:Grenade"), {
      instanceId: "f2", abilityId: "kayo:Grenade", ownerId: "b", teamId: "t2",
      origin: zonePos(spatial, "a-site"), startedAtMs: 0,
    }, { affectedPlayerIds: ["a"] });
    expect(combatFlashBlindMs(abilities, "a", 0)).toBe(2000);
    expect(combatFlashBlindMs(abilities, "a", 1000)).toBe(1000);
    expect(combatFlashBlindMs(abilities, "a", 2500)).toBe(0);
  });
});
