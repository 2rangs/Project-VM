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

describe.each(MAP_IDS.map((id) => [id] as const))("named spots: %s", (id: MapId) => {
  const engine = engineOf(id);
  const nav = engine.nav!;
  const t = deriveMapTactics(engine, loadMapData(id).tactics ?? {});

  it("holding spots: on the floor of their site, see the way in they are for, an off-angle among them", () => {
    for (const s of t.sites) {
      const seeing = new Set(s.entries.flatMap((e) => nav.zoneNodes(s.zone).filter((n) => nav.sightInto(n, e) > 0)));
      expect(s.holdSpots.length, `${s.zone}: ${s.holdSpots.length} spots of ${seeing.size} candidates`).toBeGreaterThanOrEqual(Math.min(6, seeing.size > 6 ? 4 : 1));
      expect(new Set(s.holdSpots.map((h) => h.id)).size).toBe(s.holdSpots.length);
      expect(new Set(s.holdSpots.map((h) => h.node)).size).toBe(s.holdSpots.length);
      for (const h of s.holdSpots) {
        expect(nav.nodeZone(h.node)).toBe(s.zone);
        expect(nav.distanceToWalkable(h.position)).toBeLessThanOrEqual(1);
        expect(s.entries).toContain(h.watches);
        expect(nav.sightInto(h.node, h.watches), h.id).toBeGreaterThan(0);
        for (const [e, c] of Object.entries(h.sees)) expect(nav.sightInto(h.node, e), `${h.id} sees ${e}`).toBe(c);
        expect(h.provenance).toBe("derived");
      }
    }
  });

  it("plant spots: default, safe and open, each on the plantable area; safe is the least exposed", () => {
    for (const s of t.sites) {
      expect(s.plantSpots.map((p) => p.kind)).toEqual(["default", "safe", "open"]);
      for (const p of s.plantSpots) {
        expect(engine.isPointPlantable(p.position), `${s.zone} ${p.kind}`).toBe(true);
        expect(engine.plantZoneAt(p.position)?.zoneId).toBe(s.zone);
      }
      const [, safe, open] = s.plantSpots;
      expect(safe!.exposure).toBeLessThanOrEqual(open!.exposure);
      for (const p of s.plantSpots) expect(p.exposure).toBeGreaterThanOrEqual(safe!.exposure);
    }
  });
});

describe("named spots: Ascent has at least six holding spots per site", () => {
  it("six or more, with standard and off-angle kinds", () => {
    for (const s of loadMapTactics("ascent").sites) {
      expect(s.holdSpots.length, s.zone).toBeGreaterThanOrEqual(6);
      expect(s.holdSpots.some((h) => h.kind === "off-angle"), s.zone).toBe(true);
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

describe("attacker ground and the defenders' way between sites", () => {
  it.each(MAP_IDS.map((id) => [id] as const))("%s: attacker ground holds no spawn and no site, and every zone of it is reached by the attack first", (id: MapId) => {
    const engine = engineOf(id);
    const t = deriveMapTactics(engine, loadMapData(id).tactics ?? {});
    const sites = new Set(t.sites.map((s) => s.zone));
    for (const z of t.attackerGround) {
      expect(z === t.attackerSpawn || z === t.defenderSpawn || sites.has(z), z).toBe(false);
      expect(engine.shortestTravelTimeMs(t.attackerSpawn, z)!).toBeLessThan(engine.shortestTravelTimeMs(t.defenderSpawn, z)!);
    }
  });

  it("Split: the zone route between the sites runs through the attackers' lobbies unless a team may cross its own spawn", () => {
    const engine = engineOf("split");
    const ground = new Set(loadMapTactics("split").attackerGround);
    const plain = engine.findPath("b-site", "a-site", "run")!.path;
    expect(plain.some((z) => ground.has(z))).toBe(true);
    expect(plain).not.toContain("defender-spawn");
    const own = engine.findPath("b-site", "a-site", "run", { passableZones: ["defender-spawn"] })!.path;
    expect(own).toContain("defender-spawn");
    expect(own.some((z) => ground.has(z))).toBe(false);
    // the other side's spawn stays shut
    const theirs = engine.findPath("b-site", "a-site", "run", { passableZones: ["attacker-spawn"] })!.path;
    expect(theirs).toEqual(plain);
  });
});

describe("which site an unnamed zone leads the attack to", () => {
  it.each(MAP_IDS.map((id) => [id] as const))("%s: only zones without a site letter, each on the attackers' way to that site and clearly off the way to the others", (id: MapId) => {
    const engine = engineOf(id);
    const t = deriveMapTactics(engine, loadMapData(id).tactics ?? {});
    for (const [z, site] of Object.entries(t.approachSide)) {
      const letter = /^([a-z])-/.exec(z)?.[1]?.toUpperCase();
      expect(t.sites.some((s) => s.site === letter), z).toBe(false);
      const detour = (s: (typeof t.sites)[number]) => engine.shortestTravelTimeMs(t.attackerSpawn, z)! + engine.shortestTravelTimeMs(z, s.zone)! - s.attackTravelMs!;
      const own = t.sites.find((s) => s.site === site)!;
      expect(detour(own), `${z} → ${site}`).toBeLessThanOrEqual(2000);
      for (const o of t.sites) if (o !== own) expect(detour(o) - detour(own), `${z}: ${o.site}`).toBeGreaterThanOrEqual(4000);
    }
  });
  it("Breeze: Mid Cannon speaks for B, Mid Bottom for neither", () => {
    const t = loadMapTactics("breeze");
    expect(t.approachSide["mid-cannon"]).toBe("B");
    expect(t.approachSide["mid-bottom"]).toBeUndefined();
  });
});

describe("the map's mid area", () => {
  const NO_MID: readonly MapId[] = ["bind", "fracture", "lotus"];
  it("Bind, Fracture and Lotus have no mid zones; every other map has a mid", () => {
    for (const id of MAP_IDS) expect(loadMapTactics(id).midArea === null, id).toBe(NO_MID.includes(id));
  });

  it.each(MAP_IDS.filter((id) => !NO_MID.includes(id)).map((id) => [id] as const))("%s: zones both sides reach, entries, a meeting zone, chokes that leave mid, links that avoid the main entry", (id: MapId) => {
    const engine = engineOf(id);
    const t = loadMapTactics(id);
    const m = t.midArea!;
    const zoneIds = new Set(loadMapData(id).data.zones.map((z) => z.id as string));
    expect(m.zones.length).toBeGreaterThan(0);
    for (const z of m.zones) {
      expect(zoneIds.has(z), z).toBe(true);
      expect(engine.shortestTravelTimeMs(t.attackerSpawn, z), `${z} attack`).not.toBeNull();
      expect(engine.shortestTravelTimeMs(t.defenderSpawn, z), `${z} defence`).not.toBeNull();
    }
    for (const z of [m.attackEntry, m.defenseEntry, m.contest]) expect(m.zones).toContain(z);
    for (const z of m.zones) {
      expect(engine.shortestTravelTimeMs(t.attackerSpawn, z)!).toBeGreaterThanOrEqual(m.attackMs);
      expect(engine.shortestTravelTimeMs(t.defenderSpawn, z)!).toBeGreaterThanOrEqual(m.defenseMs);
    }
    expect(m.chokes.length).toBeGreaterThan(0);
    for (const c of m.chokes) {
      expect(m.zones).toContain(c.zone);
      expect(m.zones).not.toContain(c.onto);
      expect(zoneIds.has(c.onto), c.onto).toBe(true);
      if (c.leadsTo !== null) expect(t.sites.some((s) => s.site === c.leadsTo), `${c.onto} → ${c.leadsTo}`).toBe(true);
    }
    expect(Object.keys(m.siteLinks).sort()).toEqual(t.sites.map((s) => s.site).sort());
    for (const s of t.sites) {
      const link = m.siteLinks[s.site];
      if (!link) continue;
      expect(m.zones).toContain(link.from);
      expect(link.path[0]).toBe(link.from);
      expect(link.path[link.path.length - 1]).toBe(s.zone);
      expect(link.entry).toBe(link.path[link.path.length - 2]);
      if (s.mainEntry && !m.zones.includes(s.mainEntry)) expect(link.path, `${s.site} link`).not.toContain(s.mainEntry);
      for (const z of link.path.slice(1, -1)) expect(m.zones.includes(z) || t.sites.some((o) => o.zone === z), `${z} on the ${s.site} link`).toBe(false);
    }
    for (const r of [...m.attackSwitch, ...m.defenseRotate]) if (r.throughMs !== null && r.aroundMs !== null) expect(r.aroundMs).toBeGreaterThanOrEqual(r.throughMs);
    expect(m.attackValue).toBeGreaterThanOrEqual(0);
    expect(m.attackValue).toBeLessThanOrEqual(1);
  });

  it("Ascent: the attack comes in at Mid Top, the defence at Market; Cubby opens A through Tree and Market opens B", () => {
    const m = loadMapTactics("ascent").midArea!;
    expect(m.attackEntry).toBe("mid-top");
    expect(m.defenseEntry).toBe("mid-market");
    expect(m.contest).toBe("mid-catwalk");
    expect(m.siteLinks["A"]!.path).toEqual(["mid-cubby", "a-tree", "a-site"]);
    expect(m.siteLinks["B"]!.path).toEqual(["mid-market", "b-site"]);
    expect(m.attackValue).toBeCloseTo(0.2, 1); // a site switch through mid is a fifth shorter
  });

  it("mid is worth most where there is no way round it (Icebox, Pearl, Haven) and nothing on Abyss", () => {
    for (const id of ["icebox", "pearl", "haven"] as const) expect(loadMapTactics(id).midArea!.attackValue, id).toBe(1);
    expect(loadMapTactics("abyss").midArea!.attackValue).toBe(0);
    expect(loadMapTactics("breeze").midArea!.attackValue).toBeGreaterThan(loadMapTactics("ascent").midArea!.attackValue);
  });
});
