import { describe, it, expect } from "vitest";
import { PerceptionEngine, confidenceForAge, DEFAULT_PARAMS } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld } from "./fixture.js";

const spatial = loadSpatial();

describe("memory decay", () => {
  it("confidenceForAge decreases monotonically with staleness", () => {
    const hl = DEFAULT_PARAMS.memory.halfLifeMs;
    let prev = Infinity;
    for (let age = 0; age <= 20000; age += 1000) {
      const c = confidenceForAge(age, hl);
      expect(c).toBeLessThanOrEqual(prev);
      prev = c;
    }
    expect(confidenceForAge(hl, hl)).toBeCloseTo(0.5, 6);
  });

  it("remembers a last-seen enemy after it leaves sight, then forgets it", () => {
    const obsPos = zonePos(spatial, "a-main");
    const enemyPos = zonePos(spatial, "a-site");
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos, facing: facingToward(obsPos, enemyPos) });
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
    const engine = new PerceptionEngine(spatial);

    // t0: sees the enemy
    const t0 = engine.observe(mkWorld([observer, enemy], { timeRemainingMs: 60000 }), "obs")!;
    expect(t0.visibleEnemies.find((e) => e.playerId === "enemy")?.currentlyVisible).toBe(true);

    // t1: enemy now dead/absent → remembered (not currently visible), position = last seen
    const t1 = engine.observe(mkWorld([observer, { ...enemy, alive: false }], { timeRemainingMs: 58000 }), "obs")!;
    const remembered = t1.visibleEnemies.find((e) => e.playerId === "enemy");
    expect(remembered).toBeDefined();
    expect(remembered!.currentlyVisible).toBe(false);
    expect(remembered!.lastSeenPosition.x).toBeCloseTo(enemyPos.x, 6); // last seen, not live
    expect(remembered!.lastSeenAtMs).toBe(60000);

    // much later: confidence below threshold → forgotten
    const t2 = engine.observe(mkWorld([observer, { ...enemy, alive: false }], { timeRemainingMs: 20000 }), "obs")!;
    expect(t2.visibleEnemies.some((e) => e.playerId === "enemy")).toBe(false);
  });
});
