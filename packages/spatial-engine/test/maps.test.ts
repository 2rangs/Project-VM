// Per-map dataset validation: these tests FAIL on bad map data.
//
// Every map in the registry must load and satisfy the structural contract the engine relies
// on. The travel-time table printed at the end is the one reproduced in
// docs/research/MAPS_DATA.md.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_IDS, MAPS, defaultDatasetsRoot, isMapId, listMaps, loadMap, loadMapData, type MapId } from "../src/index.js";

/** Plausible straight-run times (ms). Outside these a graph is almost certainly wrong. */
const ATTACK_TO_SITE = { min: 6_000, max: 40_000 };
const DEFENSE_TO_SITE = { min: 1_500, max: 30_000 };
/** A callout must map into the minimap square and come back within this many uu. */
const ROUND_TRIP_TOLERANCE_UU = 1e-6;
/** Documented one-way relations are edges with these kinds; sightlines are always symmetric. */
const ONE_WAY_KINDS = new Set(["drop", "teleporter"]);

const NEW_MAPS = MAP_IDS.filter((id) => id !== "ascent");
const root = defaultDatasetsRoot();

describe("map registry", () => {
  it("lists eleven maps with their site letters; Haven and Lotus have three sites", () => {
    expect(listMaps().map((m) => m.id)).toEqual([...MAP_IDS]);
    expect(MAP_IDS).toHaveLength(11);
    expect(MAPS.haven.sites).toEqual(["A", "B", "C"]);
    expect(MAPS.lotus.sites).toEqual(["A", "B", "C"]);
    for (const id of MAP_IDS) if (id !== "haven" && id !== "lotus") expect(MAPS[id].sites).toEqual(["A", "B"]);
  });

  it("rejects unknown ids", () => {
    expect(isMapId("ascent")).toBe(true);
    expect(isMapId("dust2")).toBe(false);
    expect(() => loadMap("dust2")).toThrow(/unknown map id/);
  });

  it("still loads Ascent exactly as the direct loader does", () => {
    const viaRegistry = loadMapData("ascent");
    const direct = JSON.parse(readFileSync(resolve(root, "ascent", "ascent.navgraph.json"), "utf8"));
    expect(viaRegistry.data).toEqual(direct);
    expect(viaRegistry.data.zones).toHaveLength(22);
    expect(viaRegistry.data.edges).toHaveLength(32);
    const engine = loadMap("ascent");
    expect(engine.mapId).toBe("ascent");
    expect(engine.shortestTravelTimeMs("attacker-spawn", "a-site")).toBe(
      engine.shortestTravelTimeMs("attacker-spawn", "a-site", "run"),
    );
  });
});

const table: string[] = [];

describe.each(MAP_IDS.map((id) => [id] as const))("map dataset: %s", (id: MapId) => {
  const { data, transform, info } = loadMapData(id);
  const engine = loadMap(id);
  const zoneIds = new Set(data.zones.map((z) => z.id));
  const sites = data.zones.filter((z) => z.zoneType === "site");

  it("has the registry's identity, unique lowercase-hyphen zone ids and both spawns", () => {
    expect(data.mapId).toBe(id);
    expect(data.mapUuid).toBe(info.uuid);
    expect(zoneIds.size).toBe(data.zones.length);
    for (const z of data.zones) expect(z.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(zoneIds.has("attacker-spawn")).toBe(true);
    expect(zoneIds.has("defender-spawn")).toBe(true);
    expect(engine.getZone("attacker-spawn")!.transit).toBe(false);
    expect(engine.getZone("defender-spawn")!.transit).toBe(false);
  });

  it("has exactly the registry's sites, each plantable with a plant polygon containing its callout", () => {
    expect(sites.map((z) => z.superRegion).sort()).toEqual([...info.sites]);
    for (const s of sites) {
      expect(s.id).toBe(`${s.superRegion.toLowerCase()}-site`);
      expect(s.plantable).toBe(true);
      expect(engine.isPlantableZone(s.id)).toBe(true);
      expect(engine.plantZoneAt(s.position)?.zoneId).toBe(s.id);
    }
    expect(data.zones.filter((z) => z.plantable).length).toBe(sites.length);
  });

  it("edges reference real zones, have positive consistent lengths/times and a provenance", () => {
    expect(data.edges.length).toBeGreaterThanOrEqual(data.zones.length - 1);
    for (const e of data.edges) {
      expect(zoneIds.has(e.from) && zoneIds.has(e.to)).toBe(true);
      expect(e.from).not.toBe(e.to);
      expect(e.distanceMeters).toBeGreaterThan(0);
      expect(e.runTimeMs).toBeGreaterThan(0);
      expect(e.walkTimeMs).toBeGreaterThanOrEqual(e.runTimeMs);
      expect(e.provenance.length).toBeGreaterThan(0);
      if (!e.bidirectional) expect(ONE_WAY_KINDS.has(e.kind ?? "")).toBe(true);
    }
  });

  it("every zone is reachable from both spawns", () => {
    for (const spawn of ["attacker-spawn", "defender-spawn"]) {
      for (const z of data.zones) {
        expect(engine.isReachable(spawn, z.id), `${spawn} -> ${z.id}`).toBe(true);
      }
    }
  });

  it("every site is reachable within plausible run times from each spawn", () => {
    for (const s of sites) {
      const atk = engine.shortestTravelTimeMs("attacker-spawn", s.id)!;
      const def = engine.shortestTravelTimeMs("defender-spawn", s.id)!;
      expect(atk, `attackers -> ${s.id}`).toBeGreaterThanOrEqual(ATTACK_TO_SITE.min);
      expect(atk, `attackers -> ${s.id}`).toBeLessThanOrEqual(ATTACK_TO_SITE.max);
      expect(def, `defenders -> ${s.id}`).toBeGreaterThanOrEqual(DEFENSE_TO_SITE.min);
      expect(def, `defenders -> ${s.id}`).toBeLessThanOrEqual(DEFENSE_TO_SITE.max);
      table.push(`${id.padEnd(9)} ${s.superRegion}  attackers ${(atk / 1000).toFixed(1).padStart(5)} s   defenders ${(def / 1000).toFixed(1).padStart(5)} s`);
    }
  });

  it("sightlines are symmetric, unique and between distinct real zones", () => {
    const seen = new Set<string>();
    for (const s of data.sightlines) {
      expect(zoneIds.has(s.a) && zoneIds.has(s.b)).toBe(true);
      expect(s.a).not.toBe(s.b);
      const key = [s.a, s.b].sort().join("|");
      expect(seen.has(key), `duplicate sightline ${key}`).toBe(false);
      seen.add(key);
      expect(engine.hasLineOfSight(s.a, s.b)).toBe(true);
      expect(engine.hasLineOfSight(s.b, s.a)).toBe(true);
      expect(engine.hasLineOfSight(s.a, s.b, { smokedPairs: [[s.b, s.a]] })).toBe(!s.smokeable);
    }
  });

  it("sound links are valid; geometry-derived maps have no isolated sound node", () => {
    const linked = new Set<string>();
    for (const l of data.soundLinks) {
      expect(zoneIds.has(l.a) && zoneIds.has(l.b)).toBe(true);
      expect(l.attenuation).toBeGreaterThan(0);
      expect(l.attenuation).toBeLessThan(1);
      linked.add(l.a);
      linked.add(l.b);
    }
    // Ascent's hand-authored sound graph is sparse by design and is left untouched.
    if (info.graphSource === "geometry-derived") {
      for (const z of data.zones) expect(linked.has(z.id), `isolated sound node ${z.id}`).toBe(true);
    }
  });

  it("the minimap transform round-trips every zone position", () => {
    for (const z of data.zones) {
      const m = engine.coords.toMinimap(z.position);
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(1);
      const back = engine.coords.toGame(m);
      expect(Math.abs(back.x - z.position.x)).toBeLessThan(ROUND_TRIP_TOLERANCE_UU);
      expect(Math.abs(back.y - z.position.y)).toBeLessThan(ROUND_TRIP_TOLERANCE_UU);
    }
    expect(transform.xMultiplier).toBeGreaterThan(0);
  });
});

describe.each(NEW_MAPS.map((id) => [id] as const))("geometry evidence: %s", (id) => {
  const dir = resolve(root, id);
  const raw = JSON.parse(readFileSync(resolve(dir, `valorant-api-${id}.raw.json`), "utf8"));
  const { data } = loadMapData(id);

  it("zones are exactly the valorant-api callouts, at the callout x/y", () => {
    expect(data.zones).toHaveLength(raw.callouts.length);
    const xy = new Set(raw.callouts.map((c: { location: { x: number; y: number } }) => `${c.location.x.toFixed(1)}|${c.location.y.toFixed(1)}`));
    for (const z of data.zones) expect(xy.has(`${z.position.x.toFixed(1)}|${z.position.y.toFixed(1)}`), z.id).toBe(true);
  });

  it("the Blender->game transform is the plain export (x, -y, z)/0.01 and puts callouts on the floor", () => {
    const tf = JSON.parse(readFileSync(resolve(dir, "mesh", `${id}-blender-to-game-transform.json`), "utf8"));
    expect(tf.chosen).toEqual({ blenderUnitsPerUU: 0.01, swapXY: false, signX: 1, signY: -1 });
    // at least 85 % of the callouts stand over a walkable floor cell within 1.5 m
    expect(tf.calloutsOnWalkableFloorWithin1_5m ?? tf["calloutsOnWalkableFloorWithin1.5m"]).toBeGreaterThanOrEqual(0.85 * tf.calloutCount);
  });

  it("every edge, sightline and sound link carries one of the three provenance classes", () => {
    const cls = /measured-on-mesh|derived-by-rule|manual-approx/;
    for (const e of data.edges) expect(e.provenance).toMatch(cls);
    for (const s of data.sightlines) expect(s.provenance ?? "").toMatch(cls);
    for (const l of data.soundLinks) expect(l.provenance ?? "").toMatch(cls);
    for (const e of data.edges) if (e.kind === "approx-link" || e.kind === "teleporter" || e.kind === "zipline") expect(e.provenance).toMatch(/manual-approx/);
  });

  it("no geometry is committed next to the dataset", () => {
    expect(existsSync(resolve(dir, "mesh", "mesh.npz"))).toBe(false);
    expect(existsSync(resolve(dir, "mesh", "raw"))).toBe(false);
  });
});

describe("travel-time table", () => {
  it("prints attackers'/defenders' run time to every site (Ascent first, for comparison)", () => {
    // eslint-disable-next-line no-console
    console.log("\nmap       site  spawn -> site run time\n" + table.join("\n"));
    expect(table.length).toBe(2 * 9 + 3 * 2);
  });
});
