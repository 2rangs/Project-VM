// Walkable edge routes: every map's edges either carry a measured polyline that is
// internally consistent, or are flagged as a straight segment.
//
// The walkable grid is never committed (it reproduces map geometry). When it is available
// locally — PV_MAPS_DERIVED=<dir with <map>/walkable.json from tools/map-mesh/pipeline/
// route_map.py> — every polyline is ALSO sampled against it.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_IDS, loadMap, loadMapData, pointAlongPolyline, type MapId, type Vec3 } from "../src/index.js";

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const coverage: string[] = [];

describe.each(MAP_IDS.map((id) => [id] as const))("edge routes: %s", (id: MapId) => {
  const { data } = loadMapData(id);
  const engine = loadMap(id);
  const zone = new Map(data.zones.map((z) => [z.id, z]));
  const routed = data.edges.filter((e) => e.route);
  const straight = data.edges.filter((e) => !e.route);

  it("every edge has a measured route or is flagged straight", () => {
    for (const e of straight) expect(e.routeStatus ?? "", `${e.from}->${e.to}`).toMatch(/^straight \(/);
    for (const e of routed) expect(e.routeStatus).toBeUndefined();
    const summary = (data as unknown as { routes: { edgesWithWalkableRoute: number; edgesFlaggedStraight: string[] } }).routes;
    expect(summary.edgesWithWalkableRoute).toBe(routed.length);
    expect(summary.edgesFlaggedStraight.sort()).toEqual(straight.map((e) => `${e.from}->${e.to}`).sort());
    // ordinary walk / drop edges must be routed; only special or approximate links may be straight
    // (Pearl's b-club / mid-shops callouts are stacked on one spot and cannot be routed)
    for (const e of straight) {
      const stacked = dist(engine.standPosition(e.from), engine.standPosition(e.to)) === 0;
      expect(["teleporter", "zipline", "rope", "approx-link"].includes(e.kind ?? "walk") || stacked, `${e.from}->${e.to} (${e.kind})`).toBe(true);
    }
    coverage.push(`${id.padEnd(9)} ${String(routed.length).padStart(2)}/${String(data.edges.length).padStart(2)} routed   straight: ${straight.map((e) => `${e.from}->${e.to}`).join(", ") || "-"}`);
  });

  it("routes start and end at the zones' walkable anchors and match their recorded length and time", () => {
    for (const e of routed) {
      for (const [r, a, b] of [[e.route!, e.from, e.to], ...(e.routeReverse ? [[e.routeReverse, e.to, e.from] as const] : [])] as const) {
        const pts = r.waypoints.map(([x, y, z]) => ({ x, y, z }));
        expect(pts.length).toBeGreaterThanOrEqual(2);
        expect(dist(pts[0]!, zone.get(a)!.anchor!), `${a}->${b} start`).toBe(0);
        expect(dist(pts[pts.length - 1]!, zone.get(b)!.anchor!), `${a}->${b} end`).toBe(0);
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
        expect(Math.abs(len / 100 - r.lengthMeters), `${a}->${b} length`).toBeLessThan(0.15); // waypoints are rounded to 1 uu
        expect(r.runTimeMs).toBe(Math.round((r.lengthMeters / data.movement.runSpeedMetersPerSec) * 1000));
        expect(r.walkTimeMs).toBe(Math.round((r.lengthMeters / data.movement.walkSpeedMetersPerSec) * 1000));
        // a walkable route is never shorter than the straight line between its ends
        expect(r.lengthMeters * 100 + 1).toBeGreaterThanOrEqual(dist(pts[0]!, pts[pts.length - 1]!));
      }
      // the route wins: the edge's own distance/time are the route's
      expect(e.distanceMeters).toBe(e.route!.lengthMeters);
      expect(e.runTimeMs).toBe(e.route!.runTimeMs);
      expect(e.provenance).toMatch(/measured-on-mesh/);
    }
  });

  it("edgeTraversal gives each direction its own polyline, length and time", () => {
    for (const e of data.edges) {
      const fwd = engine.edgeTraversal(e.from, e.to)!;
      // (when two edges lead the same way — a walk edge and a drop — the engine takes the faster)
      const sameWay = data.edges.filter((o) => (o.from === e.from && o.to === e.to) || (o.bidirectional && o.from === e.to && o.to === e.from));
      if (sameWay.length === 1) expect(fwd.walkable).toBe(!!e.route);
      expect(dist(fwd.waypoints[0]!, engine.standPosition(e.from))).toBe(0);
      expect(dist(fwd.waypoints[fwd.waypoints.length - 1]!, engine.standPosition(e.to))).toBe(0);
      expect(engine.pointAlongEdge(e.from, e.to, 0)!.position).toEqual(engine.standPosition(e.from));
      expect(dist(engine.pointAlongEdge(e.from, e.to, 1)!.position, engine.standPosition(e.to))).toBeLessThan(1e-6);
      const back = engine.edgeTraversal(e.to, e.from);
      if (!e.bidirectional) continue; // (a separate edge may still lead back)
      expect(back).not.toBeNull();
      expect(dist(back!.waypoints[0]!, engine.standPosition(e.to))).toBe(0);
      if (e.route && !e.routeReverse) expect(back!.runTimeMs).toBe(fwd.runTimeMs);
      if (e.routeReverse) expect(back!.runTimeMs).toBe(e.routeReverse.runTimeMs);
    }
    expect(engine.edgeTraversal("attacker-spawn", "attacker-spawn")).toBeNull();
  });

  it("pathfinding stays optimal with route times (A* equals an exhaustive search)", () => {
    const ids = data.zones.map((z) => z.id);
    const d = new Map<string, number>();
    for (const a of ids) for (const b of ids) d.set(`${a}|${b}`, a === b ? 0 : engine.edgeTraversal(a, b)?.runTimeMs ?? Infinity);
    for (const k of ids) for (const a of ids) for (const b of ids) {
      const via = d.get(`${a}|${k}`)! + d.get(`${k}|${b}`)!;
      if (via < d.get(`${a}|${b}`)!) d.set(`${a}|${b}`, via);
    }
    for (const a of ids) for (const b of ids) {
      const t = engine.shortestTravelTimeMs(a, b, "run", { allowNonTransitWaypoints: true });
      const want = d.get(`${a}|${b}`)!;
      if (want === Infinity) expect(t).toBeNull();
      else expect(t, `${a} -> ${b}`).toBe(want);
    }
  });

  const derived = process.env.PV_MAPS_DERIVED;
  const gridPath = derived ? resolve(derived, id, "walkable.json") : "";
  it.skipIf(!gridPath || !existsSync(gridPath))("every routed polyline stays on walkable grid cells (local geometry only)", () => {
    const g = JSON.parse(readFileSync(gridPath, "utf8")) as { originGameMeters: [number, number]; cellMeters: number; nx: number; ny: number; bitsBase64: string };
    const bits = Buffer.from(g.bitsBase64, "base64");
    const walkable = (p: Vec3): boolean => {
      const ix = Math.floor((p.x / 100 - g.originGameMeters[0]) / g.cellMeters);
      const iy = Math.floor((p.y / 100 - g.originGameMeters[1]) / g.cellMeters);
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return false;
      const k = ix * g.ny + iy;
      return ((bits[k >> 3]! >> (7 - (k & 7))) & 1) === 1;
    };
    let samples = 0;
    for (const e of routed) for (const [a, b] of [[e.from, e.to], ...(e.bidirectional ? [[e.to, e.from]] : [])] as string[][]) {
      const t = engine.edgeTraversal(a!, b!)!;
      const n = Math.max(2, Math.ceil(t.lengthUnits / 20)); // every 0.2 m
      for (let i = 0; i <= n; i++) {
        const p = pointAlongPolyline(t.waypoints, i / n).position;
        expect(walkable(p), `${a}->${b} at ${(i / n).toFixed(3)} (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).toBe(true);
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(1000);
  });
});

describe("route coverage", () => {
  it("prints edges with a walkable route vs flagged straight, per map", () => {
    // eslint-disable-next-line no-console
    console.log("\nmap       edges with a walkable route\n" + coverage.join("\n"));
    expect(coverage).toHaveLength(MAP_IDS.length);
  });
});
