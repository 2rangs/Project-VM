// Per-map tactical data derived from the map (src/tactics.ts). These tests FAIL when a map's
// derived data cannot be played: a site nobody reaches, a site whose defenders cannot see the
// way in, a plant point nobody can watch.
import { describe, expect, it } from "vitest";
import { MAP_IDS, MAPS, SpatialEngine, deriveMapTactics, loadMapData, loadMapTactics, type MapId } from "../src/index.js";

function engineOf(id: MapId): SpatialEngine {
  const l = loadMapData(id);
  return new SpatialEngine(l.data, { transform: l.transform, nav: l.nav, visibility: l.visibility });
}

describe("derived tactics: Ascent reproduces the tables the policy used to carry", () => {
  const t = loadMapTactics("ascent");
  it("defender starts, aims and smokes", () => {
    expect(t.defenderStarts).toEqual(["a-site", "a-site", "b-site", "b-site", "mid-courtyard"]);
    expect(t.aim).toEqual({ "a-site": "a-main", "b-site": "b-main", "mid-courtyard": "mid-top" });
    expect(t.smokes["a-site"]).toEqual(["a-main", "a-rafters", "a-wine"]);
    expect(t.smokes["b-site"]).toEqual(["b-main", "b-boathouse"]);
    expect(t.smokes["mid-courtyard"]).toEqual(["mid-top"]);
    expect(t.mid?.zone).toBe("mid-courtyard");
  });
  it("only the mid aim and the smoke lists are hand-authored; the rest is the rules' own answer", () => {
    const derived = deriveMapTactics(engineOf("ascent"), {});
    expect(derived.defenderStarts).toEqual(t.defenderStarts);
    expect(derived.sites.map((s) => [s.zone, s.mainEntry])).toEqual([["a-site", "a-main"], ["b-site", "b-main"]]);
    expect(derived.mid?.zone).toBe("mid-courtyard");
    expect(derived.authored).toEqual([]);
    expect(t.authored.length).toBeGreaterThan(0);
  });
});

describe.each(MAP_IDS.map((id) => [id] as const))("derived tactics: %s", (id: MapId) => {
  const engine = engineOf(id);
  const nav = engine.nav!;
  const t = deriveMapTactics(engine, loadMapData(id).tactics ?? {});
  const zoneIds = new Set(loadMapData(id).data.zones.map((z) => z.id as string));

  it("one playable site per site letter, reached by both sides", () => {
    expect(t.sites.map((s) => s.site)).toEqual([...MAPS[id].sites]);
    for (const s of t.sites) {
      expect(zoneIds.has(s.zone), s.zone).toBe(true);
      expect(s.attackTravelMs, `${s.zone} attack`).not.toBeNull();
      expect(s.defenseTravelMs, `${s.zone} defence`).not.toBeNull();
      expect(s.mainEntry, `${s.zone} main entry`).not.toBeNull();
      expect(s.entries[0]).toBe(s.mainEntry);
      for (const z of [...s.entries, ...s.smokes]) expect(zoneIds.has(z), z).toBe(true);
      expect(s.smokes[0]).toBe(s.mainEntry);
      expect(t.aim[s.zone]).toBeDefined();
    }
  });

  it("five defender starts, every site held, each start a real zone with somewhere to stand", () => {
    expect(t.defenderStarts).toHaveLength(5);
    for (const z of t.defenderStarts) {
      expect(zoneIds.has(z), z).toBe(true);
      expect(nav.zoneNodes(z).length, `${z} standing points`).toBeGreaterThan(0);
    }
    for (const s of t.sites) expect(t.defenderStarts, `${s.zone} is held`).toContain(s.zone);
    if (t.mid) expect(zoneIds.has(t.mid.zone)).toBe(true);
  });

  it("every site has defender spots that see the way in it watches", () => {
    for (const s of t.sites) {
      const aim = t.aim[s.zone]!;
      const spots = nav.zoneNodes(s.zone).filter((n) => nav.sightInto(n, aim) > 0);
      expect(spots.length, `${s.zone}: spots that see ${aim}`).toBeGreaterThan(0);
    }
  });

  it("every point of a site can be watched from another point of the site or of its entries", () => {
    for (const s of t.sites) {
      const watchers = [s.zone, ...s.entries].flatMap((z) => [...nav.zoneNodes(z)]);
      for (const p of nav.zoneNodes(s.zone)) {
        expect(watchers.some((w) => w !== p && nav.nodesVisible(w, p)), `${s.zone} node ${p} is seen by nobody`).toBe(true);
      }
    }
  });
});

describe("three-site maps", () => {
  it.each(["haven", "lotus"] as const)("%s: site C is derived like A and B, and a defender starts on it", (id) => {
    const t = loadMapTactics(id);
    const c = t.sites.find((s) => s.site === "C")!;
    expect(c.zone).toBe("c-site");
    expect(c.attackTravelMs).not.toBeNull();
    expect(t.defenderStarts).toContain("c-site");
    expect(t.mid === null || !t.defenderStarts.includes(t.mid.zone)).toBe(true); // the third site takes the mid's place
  });
});
