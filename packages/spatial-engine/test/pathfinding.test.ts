import { describe, it, expect } from "vitest";
import { createEngine } from "../src/loader.js";
import { loadAscent, loadTransform } from "./fixture.js";

const engine = createEngine(loadAscent(), loadTransform());

describe("pathfinding", () => {
  it("finds a path between connected zones", () => {
    const r = engine.findPath("attacker-spawn", "a-site", "run");
    expect(r).not.toBeNull();
    expect(r!.path[0]).toBe("attacker-spawn");
    expect(r!.path[r!.path.length - 1]).toBe("a-site");
    expect(r!.timeMs).toBeGreaterThan(0);
    expect(r!.distanceUnits).toBeGreaterThan(0);
  });

  it("returns a zero-cost single-node path for identical start/goal", () => {
    const r = engine.findPath("a-site", "a-site", "run");
    expect(r).toEqual({ path: ["a-site"], distanceUnits: 0, distanceMeters: 0, timeMs: 0, mode: "run" });
  });

  it("every zone is reachable from attacker spawn (graph is connected)", () => {
    for (const z of engine.zones) {
      expect(engine.isReachable("attacker-spawn", z.id), `reach ${z.id}`).toBe(true);
    }
  });

  it("walking a path takes longer than running the same path", () => {
    const run = engine.findPath("attacker-spawn", "b-site", "run");
    const walk = engine.findPath("attacker-spawn", "b-site", "walk");
    expect(run).not.toBeNull();
    expect(walk).not.toBeNull();
    expect(walk!.timeMs).toBeGreaterThan(run!.timeMs);
  });

  it("travel time is monotonic along the chosen path (each prefix costs less than the whole)", () => {
    const r = engine.findPath("attacker-spawn", "b-site", "run")!;
    let prev = 0;
    for (let i = 1; i < r.path.length; i++) {
      const seg = engine.shortestTravelTimeMs(r.path[0], r.path[i], "run")!;
      expect(seg).toBeGreaterThanOrEqual(prev);
      prev = seg;
    }
    // total equals the time to the final node (within A* optimality)
    expect(engine.shortestTravelTimeMs(r.path[0], r.path[r.path.length - 1], "run")).toBe(r.timeMs);
  });

  it("shortestTravelTimeMs agrees with findPath", () => {
    const r = engine.findPath("a-lobby", "b-site", "run")!;
    expect(engine.shortestTravelTimeMs("a-lobby", "b-site", "run")).toBe(r.timeMs);
  });

  it("throws on unknown zone ids", () => {
    expect(() => engine.findPath("nope", "a-site")).toThrow();
  });

  it("does not route through a spawn zone by default (no spawn pass-through)", () => {
    const r = engine.findPath("a-site", "b-site", "run")!;
    expect(r).not.toBeNull();
    // interior waypoints must exclude spawn zones
    const interior = r.path.slice(1, -1);
    expect(interior).not.toContain("defender-spawn");
    expect(interior).not.toContain("attacker-spawn");
    // the realistic route goes through mid
    expect(r.path).toContain("mid-bottom");
  });

  it("allows a spawn waypoint only when explicitly opted in", () => {
    // A Lobby -> B Lobby: the two attacker lanes meet at the attacker spawn, so cutting through
    // it is far shorter than going around through mid — but disallowed by default. (With the
    // measured walkable routes the A Site -> B Site path no longer gains from a spawn cut.)
    const strict = engine.findPath("a-lobby", "b-lobby", "run")!;
    const loose = engine.findPath("a-lobby", "b-lobby", "run", { allowNonTransitWaypoints: true })!;
    expect(strict.path).not.toContain("attacker-spawn");
    expect(loose.distanceUnits).toBeLessThan(strict.distanceUnits);
    expect(loose.path).toContain("attacker-spawn");
  });

  it("still allows a spawn as the start or goal of a path", () => {
    expect(engine.findPath("attacker-spawn", "a-site")).not.toBeNull();
    expect(engine.findPath("a-site", "defender-spawn")).not.toBeNull();
  });
});
