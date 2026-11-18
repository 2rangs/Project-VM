import { describe, it, expect } from "vitest";
import { AbilityEngine, deniedZoneIds } from "../src/index.js";
import { loadSpatial, zonePos, ability } from "./fixtures/abilities.js";

const spatial = loadSpatial();

describe("molly area denial ↔ spatial path", () => {
  it("routes around a denied zone at higher cost", () => {
    const from = "mid-bottom";
    const to = "b-site";
    const open = spatial.findPath(from, to, "run")!;
    expect(open).not.toBeNull();
    // the open shortest path goes through mid-market
    expect(open.path).toContain("mid-market");

    // drop a molly on mid-market
    const abilities = new AbilityEngine(spatial);
    abilities.use(ability("brimstone:Ability1"), {
      instanceId: "m1", abilityId: "brimstone:Ability1", ownerId: "x", teamId: "t",
      origin: zonePos(spatial, "mid-market"), startedAtMs: 0,
    });
    const denied = deniedZoneIds(abilities);
    expect(denied).toContain("mid-market");

    const avoid = spatial.findPath(from, to, "run", { blockedZones: denied })!;
    expect(avoid).not.toBeNull();
    expect(avoid.path).not.toContain("mid-market");
    expect(avoid.distanceUnits).toBeGreaterThan(open.distanceUnits);

    // once the molly expires the denial lifts
    abilities.advance(8000); // duration 7000
    expect(deniedZoneIds(abilities)).toHaveLength(0);
  });
});
