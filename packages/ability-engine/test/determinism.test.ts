import { describe, it, expect } from "vitest";
import { AbilityEngine, revealedEnemies } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

const spatial = loadSpatial();

function scriptedRun(): { events: unknown; reveals: unknown } {
  const e = new AbilityEngine(spatial);
  e.use(ability("omen:Ability2"), { instanceId: "s", abilityId: "omen:Ability2", ownerId: "o", teamId: "t", origin: zonePos(spatial, "a-site"), startedAtMs: 0 });
  e.use(ability("sova:Ability2"), { instanceId: "r", abilityId: "sova:Ability2", ownerId: "o", teamId: "t", origin: zonePos(spatial, "b-site"), startedAtMs: 100 }, { snapshotEnemies: [{ enemyId: "x", teamId: "d", position: zonePos(spatial, "b-site") }] });
  e.use(ability("sage:Ability3"), { instanceId: "w", abilityId: "sage:Ability3", ownerId: "o", teamId: "t", origin: zonePos(spatial, "a-main"), startedAtMs: 200 });
  e.damageWall("w", 900, 500);
  e.advance(4000);
  return { events: e.events, reveals: revealedEnemies(e) };
}

describe("determinism", () => {
  it("the same scripted sequence yields identical events and reveals", () => {
    expect(scriptedRun()).toEqual(scriptedRun());
  });
});
