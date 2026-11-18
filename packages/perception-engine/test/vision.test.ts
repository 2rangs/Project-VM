import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld, smoke } from "./fixture.js";

const spatial = loadSpatial();

function setup(enemyZone: string, observerFacingTarget = true, smokes = false) {
  const obsPos = zonePos(spatial, "a-main");
  const enemyPos = zonePos(spatial, enemyZone);
  const facing = observerFacingTarget
    ? facingToward(obsPos, enemyPos)
    : facingToward(enemyPos, obsPos); // look the opposite way
  const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos, facing });
  const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
  const world = mkWorld([observer, enemy], { activeAbilities: smokes ? [smoke(zonePos(spatial, "a-site"))] : [] });
  const engine = new PerceptionEngine(spatial);
  return engine.observe(world, "obs")!;
}

describe("vision", () => {
  it("sees an enemy with an authored sightline, in FOV and range", () => {
    const obs = setup("a-site");
    const ids = obs.visibleEnemies.filter((e) => e.currentlyVisible).map((e) => e.playerId);
    expect(ids).toContain("enemy");
  });

  it("does NOT see an enemy with no line of sight (behind cover)", () => {
    // a-main <-> a-tree are adjacent for movement but have no authored sightline
    const obs = setup("a-tree");
    expect(obs.visibleEnemies.some((e) => e.currentlyVisible)).toBe(false);
  });

  it("does NOT see an enemy outside the FOV cone (behind the observer)", () => {
    const obs = setup("a-site", /*facingTarget*/ false);
    expect(obs.visibleEnemies.some((e) => e.currentlyVisible)).toBe(false);
  });

  it("does NOT see through a smoke on a smokeable sightline", () => {
    const clear = setup("a-site", true, false);
    const smoked = setup("a-site", true, true);
    expect(clear.visibleEnemies.some((e) => e.currentlyVisible)).toBe(true);
    expect(smoked.visibleEnemies.some((e) => e.currentlyVisible)).toBe(false);
  });
});
