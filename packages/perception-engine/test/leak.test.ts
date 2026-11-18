import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld } from "./fixture.js";

const spatial = loadSpatial();

describe("ground-truth boundary (no omniscience leak)", () => {
  it("observation has only ObservationState keys — no players/events/world", () => {
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: zonePos(spatial, "a-main") });
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: zonePos(spatial, "b-site") });
    const obs = new PerceptionEngine(spatial).observe(mkWorld([observer, enemy]), "obs")!;
    expect(Object.keys(obs).sort()).toEqual(
      ["audibleEvents", "knownMapChanges", "observerId", "teamId", "teammateReports", "timestampMs", "visibleEnemies"].sort(),
    );
    // explicitly assert the omniscient containers are absent
    for (const forbidden of ["players", "events", "economy", "activeAbilities", "spike"]) {
      expect(obs as unknown as Record<string, unknown>).not.toHaveProperty(forbidden);
    }
  });

  it("does not expose an unseen enemy's exact current position anywhere", () => {
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: zonePos(spatial, "a-main"), facing: { x: 1, y: 0 } });
    // enemy far away, no sightline, at a unique recognisable coordinate
    const secretX = 123456.75;
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: { x: secretX, y: -98765.5, z: 400 } });
    const obs = new PerceptionEngine(spatial).observe(mkWorld([observer, enemy]), "obs")!;
    expect(obs.visibleEnemies.some((e) => e.playerId === "enemy")).toBe(false);
    expect(JSON.stringify(obs)).not.toContain("123456.75");
  });

  it("remembers the last-seen position, never the enemy's post-sighting live position", () => {
    const obsPos = zonePos(spatial, "a-main");
    const seenPos = zonePos(spatial, "a-site");
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos, facing: facingToward(obsPos, seenPos) });
    const engine = new PerceptionEngine(spatial);

    // t0: sighted at a-site
    engine.observe(mkWorld([observer, mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: seenPos })], { timeRemainingMs: 60000 }), "obs");

    // t1: enemy secretly moved somewhere the observer cannot see; it's not currently visible
    const movedX = 777777.25;
    const t1 = engine.observe(
      mkWorld(
        [observer, mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: { x: movedX, y: -5000, z: 400 } })],
        { timeRemainingMs: 59500 },
      ),
      "obs",
    )!;
    const mem = t1.visibleEnemies.find((e) => e.playerId === "enemy")!;
    expect(mem.currentlyVisible).toBe(false);
    expect(mem.lastSeenPosition.x).toBeCloseTo(seenPos.x, 6);
    expect(JSON.stringify(t1)).not.toContain("777777.25");
  });
});
