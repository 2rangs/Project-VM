// Geometric navigation on the map roadmap (Phase 6 tests A–F, G/H, J, M, N at the navigation
// layer; the simulator-level ones live in packages/round-simulator/test).
//
// "Local geometry only" checks need the walk grid, which is never committed:
//   PV_MAPS_DERIVED=<dir with <map>/walkable.json> npx vitest run
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAP_IDS, NavBlockers, loadMap, loadMapData, type MapId, type NavigationRequest, type NavigationResult, type Vec3 } from "../src/index.js";

const ascent = loadMap("ascent");
const nav = ascent.nav!;
const at = (zone: string): Vec3 => ascent.standPosition(zone);
const req = (from: Vec3, to: Vec3, extra: Partial<NavigationRequest> = {}): NavigationRequest =>
  ({ actorId: "t", start: from, destination: to, movementMode: "run", routePreference: "FASTEST", ...extra });
const ok = (r: NavigationResult) => {
  if (r.status !== "SUCCESS") throw new Error(`expected SUCCESS, got ${r.status}: ${r.reason}`);
  return r;
};
const straight = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Every hop of a path is a real roadmap arc (walk / drop / link) — never an invented segment. */
function onlyRoadmapArcs(engine: ReturnType<typeof loadMap>, r: Extract<NavigationResult, { status: "SUCCESS" }>): boolean {
  const n = engine.nav!;
  const nodes = r.waypoints.filter((w) => w.node >= 0);
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]!.node, b = nodes[i]!.node;
    if (a === b) continue;
    if (!n.arcsFrom(a).some((arc) => arc.to === b && arc.kind === nodes[i]!.via)) return false;
  }
  return true;
}

describe("navigation: Ascent", () => {
  it("A — simple move between neighbouring areas succeeds with a real path", () => {
    const r = ok(nav.findPath(req(at("a-main"), at("a-site"))));
    expect(r.waypoints[0]!.position).toEqual(at("a-main"));
    expect(straight(r.waypoints[r.waypoints.length - 1]!.position, at("a-site"))).toBeLessThan(1);
    expect(r.pathLength).toBeGreaterThanOrEqual(straight(at("a-main"), at("a-site")) - 1);
    expect(r.estimatedTravelMs).toBeCloseTo(r.pathLength / 0.675, -1);
    expect(onlyRoadmapArcs(ascent, r)).toBe(true);
  });

  it("B / F — a goal just behind a wall is reached the long way round, with the longer length and time", () => {
    // A Site -> A Rafters: 16 m apart, but there is no way up from the site
    const d = straight(at("a-site"), at("a-rafters"));
    const r = ok(nav.findPath(req(at("a-site"), at("a-rafters"))));
    expect(d).toBeLessThan(2000);
    expect(r.pathLength).toBeGreaterThan(4 * d);
    expect(r.estimatedTravelMs).toBeGreaterThan(4 * (d / 0.675));
    expect(r.waypoints.length).toBeGreaterThan(8);
    expect(onlyRoadmapArcs(ascent, r)).toBe(true);
  });

  it("C — a route through several corners turns with the corridors", () => {
    const r = ok(nav.findPath(req(at("attacker-spawn"), at("a-site"))));
    let turned = 0;
    for (let i = 2; i < r.waypoints.length; i++) {
      const a = r.waypoints[i - 2]!.position, b = r.waypoints[i - 1]!.position, c = r.waypoints[i]!.position;
      const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x);
      let dh = Math.abs(h2 - h1);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1 && Math.hypot(c.x - b.x, c.y - b.y) > 1) turned += dh;
    }
    expect(turned).toBeGreaterThan(Math.PI); // more than a half-turn in total
    expect(r.zones[0]).toBe("attacker-spawn");
    expect(r.zones[r.zones.length - 1]).toBe("a-site");
    expect(r.zones).toContain("a-main");
  });

  it("E — height changes go up real slopes and come down real drops", () => {
    const up = ok(nav.findPath(req(at("a-site"), at("a-rafters"))));
    expect(at("a-rafters").z - at("a-site").z).toBeGreaterThan(200);
    for (let i = 1; i < up.waypoints.length; i++) {
      const a = up.waypoints[i - 1]!.position, b = up.waypoints[i]!.position;
      // going UP is only ever a walkable slope (the grid links cells at <= ~50 degrees)
      if (b.z > a.z) expect(b.z - a.z, `step ${i}`).toBeLessThanOrEqual(1.3 * Math.hypot(b.x - a.x, b.y - a.y) + 35);
    }
    // any drop on the way only ever goes down
    for (let i = 1; i < up.waypoints.length; i++) {
      if (up.waypoints[i]!.via === "drop") expect(up.waypoints[i]!.position.z).toBeLessThan(up.waypoints[i - 1]!.position.z);
    }
    const down = ok(nav.findPath(req(at("a-rafters"), at("a-site"))));
    expect(down.waypoints.some((w) => w.via === "drop")).toBe(true);
    expect(down.pathLength).toBeLessThan(up.pathLength / 3);
  });

  it("G / H — a movement blocker forces a detour or blocks; removing it restores the route", () => {
    const from = at("mid-courtyard"), to = at("mid-bottom");
    const free = ok(nav.findPath(req(from, to)));
    const mid = free.waypoints[Math.floor(free.waypoints.length / 2)]!.position;
    const blockers = new NavBlockers(nav);
    const v0 = blockers.version;
    blockers.addDisc("wall-1", mid, 350);
    expect(blockers.version).toBeGreaterThan(v0);
    const blocked = nav.findPath(req(from, to, { blockers }));
    if (blocked.status === "SUCCESS") {
      expect(blocked.pathLength).toBeGreaterThan(free.pathLength);
      for (const w of blocked.waypoints) expect(Math.hypot(w.position.x - mid.x, w.position.y - mid.y)).toBeGreaterThan(350 - 1);
    } else {
      expect(blocked.status).toBe("UNREACHABLE");
      expect(blocked.reason).toMatch(/wall-1/);
    }
    expect(blockers.remove("wall-1")).toBe(true);
    expect(nav.findPath(req(from, to, { blockers }))).toEqual(free);
  });

  it("G — a blocker that seals the only way in reports UNREACHABLE and names the blocker", () => {
    const blockers = new NavBlockers(nav);
    blockers.addZone("seal", "b-main");
    blockers.addZone("seal-2", "mid-market");
    blockers.addZone("seal-3", "mid-link");
    blockers.addZone("seal-4", "defender-spawn");
    blockers.addZone("seal-5", "b-boathouse");
    const r = nav.findPath(req(at("attacker-spawn"), at("b-site"), { blockers }));
    expect(r.status).toBe("UNREACHABLE");
    if (r.status !== "SUCCESS") expect(r.reason).toMatch(/movement blocker/);
  });

  it("J — a start or goal off the floor is refused, not bridged with a straight line", () => {
    const off = { x: 99_000, y: 99_000, z: 0 };
    expect(nav.findPath(req(off, at("a-site"))).status).toBe("INVALID_START");
    expect(nav.findPath(req(at("a-site"), off)).status).toBe("INVALID_TARGET");
  });

  it("M — the same start and goal with a different danger picture takes a different route", () => {
    const from = at("a-site"), to = at("b-site");
    const fast = ok(nav.findPath(req(from, to)));
    const midIsHot = (z: string): number => (z.startsWith("mid-") ? 4 : 0);
    const safe = ok(nav.findPath(req(from, to, { routePreference: "SAFEST", zoneCost: midIsHot })));
    expect(safe.zones).not.toEqual(fast.zones);
    expect(safe.pathLength).toBeGreaterThan(fast.pathLength);
    expect(safe.zones.filter((z) => z.startsWith("mid-")).length).toBeLessThan(fast.zones.filter((z) => z.startsWith("mid-")).length);
    // FASTEST ignores the danger picture entirely
    expect(nav.findPath(req(from, to, { zoneCost: midIsHot }))).toEqual(fast);
    // STEALTH plans at walking speed
    const stealth = ok(nav.findPath(req(from, to, { routePreference: "STEALTH" })));
    expect(stealth.estimatedTravelMs).toBeGreaterThan(fast.estimatedTravelMs * 1.8);
  });

  it("N — the same request always gives the same path", () => {
    const a = nav.findPath(req(at("attacker-spawn"), at("b-site")));
    const b = nav.findPath(req(at("attacker-spawn"), at("b-site")));
    expect(a).toEqual(b);
  });

  it("a position belongs to the zone whose floor it is on", () => {
    for (const z of ascent.zones) {
      expect(ascent.nearestZone(z.position).id, z.id).toBe(z.id);
      expect(ascent.nearestZone({ x: z.position.x, y: z.position.y }).id, `${z.id} (2D)`).toBe(z.id);
      expect(ascent.nearestZone(ascent.standPosition(z.id)).id).toBe(z.id);
    }
    // half-way down the A Main -> A Site route the player is in one of the two, not a third zone
    const r = ok(nav.findPath(req(at("a-main"), at("a-site"))));
    for (const w of r.waypoints) expect(["a-main", "a-site"]).toContain(ascent.nearestZone(w.position).id);
  });

  it("roadmap travel times agree with the measured edge routes", () => {
    for (const [a, b] of [["a-main", "a-site"], ["b-main", "b-site"], ["mid-top", "mid-courtyard"], ["attacker-spawn", "b-lobby"]] as const) {
      const edge = ascent.edgeTraversal(a, b)!.runTimeMs;
      const road = nav.zoneTravelMs(a, b)!;
      expect(road / edge, `${a}->${b}`).toBeGreaterThan(0.85);
      expect(road / edge, `${a}->${b}`).toBeLessThan(1.2);
    }
    expect(nav.zoneTravelMs("a-site", "no-such-zone")).toBeNull();
  });
});

const summary: string[] = [];

describe.each(MAP_IDS.map((id) => [id] as const))("navigation roadmap: %s", (id: MapId) => {
  const engine = loadMap(id);
  const { data, nav: raw } = loadMapData(id);
  const n = engine.nav!;

  it("has a roadmap whose recorded checks are clean", () => {
    expect(raw).toBeDefined();
    const stats = (raw as unknown as { stats: { edgesHittingGeometry: number; roadmapDisagreesWithGrid: string[]; zonePairsReachableOnGrid: number; zonePairsTotal: number } }).stats;
    expect(stats.edgesHittingGeometry).toBe(0);
    expect(stats.roadmapDisagreesWithGrid).toEqual([]);
    expect(n.nodeCount).toBeGreaterThan(500);
    summary.push(`${id.padEnd(9)} nodes ${String(n.nodeCount).padStart(4)}  edges ${String(n.edgeCount()).padStart(5)}  drops ${String(raw!.drops.length).padStart(3)}  links ${raw!.links.length}  zone pairs reachable ${stats.zonePairsReachableOnGrid}/${stats.zonePairsTotal}`);
  });

  it("D / J — every zone pair is either a real roadmap path or UNREACHABLE, never a made-up segment", () => {
    const stats = (raw as unknown as { stats: { zonePairsReachableOnGrid: number } }).stats;
    const hasLinks = raw!.links.length > 0;
    let reachable = 0;
    for (const a of data.zones) for (const b of data.zones) {
      if (a.id === b.id || n.anchorNode(a.id) === undefined || n.anchorNode(b.id) === undefined) continue;
      const stacked = n.anchorNode(a.id) === n.anchorNode(b.id); // two callouts on one spot (Pearl club / shops)
      const r = n.findPath({ actorId: "t", start: engine.standPosition(a.id), destination: engine.standPosition(b.id), movementMode: "run", routePreference: "FASTEST" });
      if (r.status === "SUCCESS") {
        reachable++;
        expect(onlyRoadmapArcs(engine, r), `${a.id}->${b.id}`).toBe(true);
        if (!stacked) expect(r.pathLength).toBeGreaterThan(0);
        expect(n.zoneTravelMs(a.id, b.id)).not.toBeNull();
      } else {
        expect(r.status, `${a.id}->${b.id}`).toBe("UNREACHABLE");
        expect(n.zoneTravelMs(a.id, b.id)).toBeNull();
      }
    }
    // exactly what the walk grid reaches (authored links can only add to it)
    if (hasLinks) expect(reachable).toBeGreaterThanOrEqual(stats.zonePairsReachableOnGrid);
    else expect(reachable).toBe(stats.zonePairsReachableOnGrid);
  });

  const derived = process.env.PV_MAPS_DERIVED;
  const gridPath = derived ? resolve(derived, id, "walkable.json") : "";
  it.skipIf(!gridPath || !existsSync(gridPath))("every node and every walk edge lies on walkable grid cells (local geometry only)", () => {
    const g = JSON.parse(readFileSync(gridPath, "utf8")) as { originGameMeters: [number, number]; cellMeters: number; nx: number; ny: number; bitsBase64: string };
    const bits = Buffer.from(g.bitsBase64, "base64");
    const walkable = (x: number, y: number): boolean => {
      const ix = Math.floor((x / 100 - g.originGameMeters[0]) / g.cellMeters);
      const iy = Math.floor((y / 100 - g.originGameMeters[1]) / g.cellMeters);
      if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return false;
      const k = ix * g.ny + iy;
      return ((bits[k >> 3]! >> (7 - (k & 7))) & 1) === 1;
    };
    let samples = 0;
    for (let i = 0; i < n.edgeCount(); i++) {
      const [a, b] = n.walkEdge(i);
      const p = n.nodePosition(a), q = n.nodePosition(b);
      const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 20));
      for (let k = 0; k <= steps; k++) {
        expect(walkable(p.x + ((q.x - p.x) * k) / steps, p.y + ((q.y - p.y) * k) / steps), `edge ${a}-${b}`).toBe(true);
        samples++;
      }
    }
    expect(samples).toBeGreaterThan(10_000);
  });
});

describe("roadmap summary", () => {
  it("prints nodes / edges / reachability per map", () => {
    // eslint-disable-next-line no-console
    console.log("\n" + summary.join("\n"));
    expect(summary).toHaveLength(MAP_IDS.length);
  });
});
