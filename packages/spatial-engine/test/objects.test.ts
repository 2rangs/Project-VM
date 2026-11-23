// Per-map gameplay objects (datasets/spatial/<map>/<map>.objects.json, written by
// tools/map-mesh/pipeline/objects_map.py): drops, traversals, doors, breakables as points and types.
// These tests FAIL when the file is missing or no longer matches the map's roadmap.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_IDS, Navigator, defaultDatasetsRoot, loadMap, loadMapData, type MapId } from "../src/index.js";

interface P { x: number; y: number; z: number }
interface ObjectsFile {
  mapId: string; schemaVersion: string; note: string; provenance: string;
  drops: Array<{ from: P; to: P; fallMeters: number; fromZone: string | null; toZone: string | null; fromNode: number; toNode: number }>;
  traversals: Array<{ id: string; kind: string; bidirectional: boolean; travelTimeMs: number; from: P; to: P; fromNode: number; toNode: number; zones: Array<string | null>; soundSource: P; soundSourceExit: P; soundRadiusUu: number | null; soundVerified: boolean; objectNames: string[]; provenance: string; bottom?: P; top?: P; ascending?: boolean }>;
  doors: Array<{ id: string; kind: string; position: P; zones: Array<string | null>; defaultState: string; objectNames: string[]; provenance: string }>;
  breakables: Array<{ id: string; kind: string; position: P; zones: Array<string | null>; defaultState: string; objectNames: string[]; provenance: string }>;
  ultOrbs: Array<{ position: P }>;
  notLocated: Array<{ name: string; reason: string }>;
}

const root = defaultDatasetsRoot();
const summary: string[] = [];

describe.each(MAP_IDS.map((id) => [id] as const))("gameplay objects: %s", (id: MapId) => {
  const path = resolve(root, id, `${id}.objects.json`);
  const nav = loadMapData(id).nav!;
  const zones = new Set(loadMapData(id).data.zones.map((z) => z.id));
  const read = (): ObjectsFile => JSON.parse(readFileSync(path, "utf8")) as ObjectsFile;
  const at = (i: number): P => ({ x: nav.nodes[i]![0]!, y: nav.nodes[i]![1]!, z: nav.nodes[i]![2]! });

  it("has the file, with a note, a schema version and a provenance", () => {
    expect(existsSync(path), path).toBe(true);
    const o = read();
    expect(o.mapId).toBe(id);
    expect(o.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(o.note.length).toBeGreaterThan(100);
    expect(o.provenance).toMatch(/measured-on-mesh/);
    for (const key of ["drops", "traversals", "doors", "breakables", "ultOrbs", "notLocated"] as const) expect(Array.isArray(o[key]), key).toBe(true);
    for (const n of o.notLocated) { expect(n.name.length).toBeGreaterThan(0); expect(n.reason.length).toBeGreaterThan(20); }
    // an empty orb list is a statement that none could be located, and says why
    if (o.ultOrbs.length === 0) expect(o.notLocated.some((n) => /orb/i.test(n.name))).toBe(true);
  });

  it("every position lies within the roadmap's bounds", () => {
    const o = read();
    const xs = nav.nodes.map((n) => n[0]!), ys = nav.nodes.map((n) => n[1]!), zs = nav.nodes.map((n) => n[2]!);
    const lo = { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) }, hi = { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) };
    const HEAD = 400; // a sound source or a hatch may sit above the floor it belongs to (uu)
    const inside = (p: P, what: string): void => {
      expect(p.x, what).toBeGreaterThanOrEqual(lo.x); expect(p.x, what).toBeLessThanOrEqual(hi.x);
      expect(p.y, what).toBeGreaterThanOrEqual(lo.y); expect(p.y, what).toBeLessThanOrEqual(hi.y);
      expect(p.z, what).toBeGreaterThanOrEqual(lo.z); expect(p.z, what).toBeLessThanOrEqual(hi.z + HEAD);
    };
    o.drops.forEach((d, i) => { inside(d.from, `drop ${i}`); inside(d.to, `drop ${i}`); });
    for (const t of o.traversals) { inside(t.from, t.id); inside(t.to, t.id); inside(t.soundSource, t.id); inside(t.soundSourceExit, t.id); }
    for (const d of [...o.doors, ...o.breakables]) inside(d.position, d.id);
    for (const u of o.ultOrbs) inside(u.position, "orb");
  });

  it("drops are exactly the roadmap's one-way drops, each a real fall between two zones of the map", () => {
    const o = read();
    expect(o.drops.length).toBe(nav.drops.length);
    o.drops.forEach((d, i) => {
      const [a, b] = nav.drops[i]!;
      expect([d.fromNode, d.toNode]).toEqual([a, b]);
      expect(d.from).toEqual(at(a!)); expect(d.to).toEqual(at(b!));
      expect(d.fallMeters).toBeCloseTo((d.from.z - d.to.z) / 100, 2);
      expect(d.fallMeters).toBeGreaterThan(0);
      for (const z of [d.fromZone, d.toZone]) if (z !== null) expect(zones.has(z), z).toBe(true);
    });
  });

  it("every roadmap link has a traversal entry of the same kind, ends and time", () => {
    const o = read();
    expect(o.traversals.length).toBe(nav.links.length);
    nav.links.forEach((l, i) => {
      const t = o.traversals[i]!;
      expect(t.kind).toBe(l.kind);
      expect([t.fromNode, t.toNode]).toEqual([l.from, l.to]);
      expect(t.from).toEqual(at(l.from)); expect(t.to).toEqual(at(l.to));
      expect(t.travelTimeMs).toBe(l.travelTimeMs);
      expect(t.bidirectional).toBe(l.bidirectional);
      expect(t.travelTimeMs).toBeGreaterThan(0);
      expect(t.soundRadiusUu).toBeNull(); expect(t.soundVerified).toBe(false);
      expect(t.provenance.length).toBeGreaterThan(10);
      for (const z of t.zones) if (z !== null) expect(zones.has(z), z).toBe(true);
      if (t.kind === "rope") { expect(t.top!.z).toBeGreaterThan(t.bottom!.z); expect(t.ascending).toBe(t.to.z > t.from.z); }
    });
    expect(new Set(o.traversals.map((t) => t.id)).size).toBe(o.traversals.length);
  });

  it("doors and breakables name a kind, a state, their scene objects and zones of the map", () => {
    const o = read();
    for (const d of [...o.doors, ...o.breakables]) {
      expect(d.kind.length).toBeGreaterThan(0);
      expect(["open", "closed", "intact", "unknown"]).toContain(d.defaultState);
      expect(d.objectNames.length).toBeGreaterThan(0);
      expect(d.provenance).toMatch(/measured-on-mesh/);
      for (const z of d.zones) if (z !== null) expect(zones.has(z), z).toBe(true);
    }
    summary.push(`${id.padEnd(9)} drops ${String(o.drops.length).padStart(3)}  traversals ${o.traversals.length} (${[...new Set(o.traversals.map((t) => t.kind))].join(", ") || "-"})  doors ${o.doors.length}  breakables ${o.breakables.length}  orbs ${o.ultOrbs.length}  not located ${o.notLocated.length}`);
  });
});

describe("a link of a kind the navigator has no special case for", () => {
  it("is a fixed-time arc: taken when it is the faster way, and its time is the authored one", () => {
    // four points on a line; a "jump" link joins the two ends of a gap no walk edge crosses
    const data = {
      mapId: "t", zones: ["a", "b"], anchors: { a: 0, b: 3 },
      nodes: [[0, 0, 0, 100, 0], [500, 0, 0, 100, 0], [800, 0, 0, 100, 1], [1300, 0, 0, 100, 1]],
      edges: [[0, 1, 100], [2, 3, 100]], drops: [],
      links: [{ from: 1, to: 2, kind: "jump" as const, travelTimeMs: 444, bidirectional: true }],
    };
    const n = new Navigator(data, { unitsPerMeter: 100, runSpeedMetersPerSec: 5, walkSpeedMetersPerSec: 2.5 });
    const there = n.zoneTravelMs("a", "b"), back = n.zoneTravelMs("b", "a");
    expect(there).toBeCloseTo(1000 + 444 + 1000, 0);
    expect(back).toBeCloseTo(there!, 0);
    const r = n.findPath({ actorId: "t", start: { x: 0, y: 0, z: 0 }, destination: { x: 1300, y: 0, z: 0 }, movementMode: "run", routePreference: "FASTEST" });
    expect(r.status).toBe("SUCCESS");
    if (r.status === "SUCCESS") expect(r.waypoints.some((w) => w.via === "jump" && w.fixedMs === 444)).toBe(true);
  });

  it("Abyss: the two ledges are reached only through their jump links", () => {
    const abyss = loadMap("abyss");
    const raw = loadMapData("abyss").nav!;
    expect(raw.links.filter((l) => l.kind === "jump").length).toBe(4);
    for (const z of ["a-secret", "b-danger"]) {
      const r = abyss.nav!.findPath({ actorId: "t", start: abyss.standPosition("attacker-spawn"), destination: abyss.standPosition(z), movementMode: "run", routePreference: "FASTEST" });
      expect(r.status, z).toBe("SUCCESS");
      if (r.status === "SUCCESS") expect(r.waypoints.some((w) => w.via === "jump"), z).toBe(true);
    }
  });

  it("prints the objects table", () => { console.log("\nGAMEPLAY OBJECTS\n" + summary.join("\n")); });
});
