import { describe, it, expect } from "vitest";
import { PerceptionEngine, lineOfSight, occluded, segmentHitsSphere, EYE_HEIGHT_UNITS } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld } from "./fixture.js";

const spatial = loadSpatial();

describe("segmentHitsSphere / occluded (smoke as a volume)", () => {
  it("a segment through the sphere is cut, one passing beside it is not", () => {
    const c = { x: 0, y: 0, z: 0 };
    expect(segmentHitsSphere({ x: -1000, y: 0, z: 0 }, { x: 1000, y: 0, z: 0 }, c, 400)).toBe(true);
    expect(segmentHitsSphere({ x: -1000, y: 500, z: 0 }, { x: 1000, y: 500, z: 0 }, c, 400)).toBe(false);
    // the sphere beyond the segment's end does not cut it
    expect(segmentHitsSphere({ x: -1000, y: 0, z: 0 }, { x: -600, y: 0, z: 0 }, c, 400)).toBe(false);
    // starting inside it does
    expect(segmentHitsSphere({ x: 100, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }, c, 400)).toBe(true);
  });

  it("eyes are above the floor: a smoke that only reaches knee height does not cut the line", () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 2000, y: 0, z: 0 };
    expect(occluded(a, b, [{ center: { x: 1000, y: 0, z: 0 }, radius: EYE_HEIGHT_UNITS - 20 }])).toBe(false);
    expect(occluded(a, b, [{ center: { x: 1000, y: 0, z: 0 }, radius: EYE_HEIGHT_UNITS + 20 }])).toBe(true);
  });
});

describe("lineOfSight — one rule for every sight question", () => {
  it("a smoke volume cuts sight between two bodies INSIDE one zone (the zone rule never could)", () => {
    const site = zonePos(spatial, "a-site");
    const a = { position: { x: site.x - 800, y: site.y, z: site.z }, zoneId: "a-site" };
    const b = { position: { x: site.x + 800, y: site.y, z: site.z }, zoneId: "a-site" };
    expect(lineOfSight(spatial, a, b, { positionalSight: false })).toBe(true);
    expect(lineOfSight(spatial, a, b, { positionalSight: false, occluders: [{ center: site, radius: 400 }] })).toBe(false);
    // the legacy zone rule leaves a same-zone pair alone
    expect(lineOfSight(spatial, a, b, { positionalSight: false, smokedPairs: [["a-site", "a-main"]] })).toBe(true);
  });

  it("a smoke in the target's zone but off the line does not cut it", () => {
    const from = { position: zonePos(spatial, "a-main"), zoneId: "a-main" };
    const to = { position: zonePos(spatial, "a-site"), zoneId: "a-site" };
    const s = zonePos(spatial, "a-site");
    expect(lineOfSight(spatial, from, to, { positionalSight: false, occluders: [{ center: { x: s.x + 3000, y: s.y + 3000, z: s.z }, radius: 400 }] })).toBe(true);
    expect(lineOfSight(spatial, from, to, { positionalSight: false, occluders: [{ center: s, radius: 400 }] })).toBe(false);
  });

  it("the oracle with smokeVolumes uses the smoke's own radius at its landing point", () => {
    const obsPos = zonePos(spatial, "a-main");
    const enemyPos = zonePos(spatial, "a-site");
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos, facing: facingToward(obsPos, enemyPos) });
    const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
    const mid = { x: (obsPos.x + enemyPos.x) / 2, y: (obsPos.y + enemyPos.y) / 2, z: (obsPos.z + enemyPos.z) / 2 };
    const sees = (radiusUnits: number) => {
      const world = mkWorld([observer, enemy], { activeAbilities: [{ instanceId: "s", ownerId: "x", abilityId: "smoke", origin: mid, expiresAtMs: null, radiusUnits }] });
      return new PerceptionEngine(spatial, { smokeVolumes: true }).observe(world, "obs")!.visibleEnemies.some((e) => e.currentlyVisible);
    };
    expect(sees(400)).toBe(false);
    expect(sees(50)).toBe(true); // too small to reach eye height
  });
});
