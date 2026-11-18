import { describe, it, expect } from "vitest";
import { createEngine } from "../src/loader.js";
import { loadAscent, loadTransform } from "./fixture.js";

const engine = createEngine(loadAscent(), loadTransform());

describe("zone lookup", () => {
  it("returns zones by id and type", () => {
    expect(engine.getZone("a-site")?.name).toBe("A Site");
    const sites = engine.zonesByType("site").map((z) => z.id).sort();
    expect(sites).toEqual(["a-site", "b-site"]);
  });

  it("finds the nearest zone to a game position", () => {
    const aSite = engine.getZone("a-site")!;
    const near = { x: aSite.position.x + 50, y: aSite.position.y - 40, z: aSite.position.z };
    expect(engine.nearestZone(near).id).toBe("a-site");
  });
});

describe("plant judgment", () => {
  it("marks site zones as plantable and others not", () => {
    expect(engine.isPlantableZone("a-site")).toBe(true);
    expect(engine.isPlantableZone("b-site")).toBe(true);
    expect(engine.isPlantableZone("a-lobby")).toBe(false);
    expect(engine.isPlantableZone("mid-link")).toBe(false);
  });

  it("accepts a point inside a plant polygon", () => {
    // center of A site plant polygon (approx)
    const inside = { x: 6150, y: -6600, z: 500 };
    expect(engine.isPointPlantable(inside)).toBe(true);
    expect(engine.plantZoneAt(inside)?.site).toBe("A");
  });

  it("rejects a point outside every plant polygon", () => {
    const lobby = engine.getZone("a-lobby")!.position;
    expect(engine.isPointPlantable(lobby)).toBe(false);
    expect(engine.plantZoneAt(lobby)).toBeNull();
  });
});

describe("visibility and sound", () => {
  it("reports authored line-of-sight pairs symmetrically", () => {
    expect(engine.hasLineOfSight("a-main", "a-site")).toBe(true);
    expect(engine.hasLineOfSight("a-site", "a-main")).toBe(true);
    expect(engine.hasLineOfSight("a-lobby", "b-site")).toBe(false);
  });

  it("blocks a smokeable sightline when smoked", () => {
    expect(engine.hasLineOfSight("a-main", "a-site", { smokedPairs: [["a-main", "a-site"]] })).toBe(false);
  });

  it("propagates sound with attenuation and a threshold", () => {
    const audible = engine.audibleZones("b-main", 0.1);
    const ids = audible.map((a) => a.zoneId);
    expect(ids).toContain("b-site");
    // strengths are within (0,1] and sorted descending
    for (const a of audible) {
      expect(a.strength).toBeGreaterThan(0);
      expect(a.strength).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < audible.length; i++) {
      expect(audible[i - 1].strength).toBeGreaterThanOrEqual(audible[i].strength);
    }
  });
});
