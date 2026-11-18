import { describe, it, expect } from "vitest";
import { AbilityEngine, toPerceptionAbilityStates } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

const spatial = loadSpatial();

describe("destructible wall", () => {
  it("survives partial damage and is destroyed past its HP", () => {
    const abilities = new AbilityEngine(spatial);
    abilities.use(ability("sage:Ability3"), {
      instanceId: "w1", abilityId: "sage:Ability3", ownerId: "sage", teamId: "defenders",
      origin: zonePos(spatial, "a-main"), startedAtMs: 0,
    });
    expect(abilities.getEffect("w1")?.hp).toBe(800);
    // blocks vision while standing
    expect(toPerceptionAbilityStates(abilities).some((a) => a.abilityId === "wall")).toBe(true);

    expect(abilities.damageWall("w1", 300, 1000)).toBe(false);
    expect(abilities.getEffect("w1")?.hp).toBe(500);

    expect(abilities.damageWall("w1", 600, 2000)).toBe(true); // 500 - 600 <= 0
    expect(abilities.getEffect("w1")).toBeUndefined();
    expect(abilities.events.some((e) => e.kind === "effectDestroyed" && e.instanceId === "w1")).toBe(true);
    // no longer blocks vision
    expect(toPerceptionAbilityStates(abilities).some((a) => a.abilityId === "wall")).toBe(false);
  });
});
