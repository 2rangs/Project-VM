import { describe, it, expect } from "vitest";
import { ZoneGraph, type NavEdge, type Zone } from "../src/index.js";

// Diamond graph: S→A→G (short) and S→B→G (long). A hazard on A makes the planner weigh the
// detour via B against the cost of crossing A.
function zone(id: string, x: number, y: number): Zone {
  return { id, name: id, callout: id, superRegion: "r", zoneType: "connector", plantable: false, position: { x, y, z: 0 } };
}
function edge(from: string, to: string, runTimeMs: number): NavEdge {
  return { from, to, bidirectional: true, door: null, destructible: null, distanceUnits: runTimeMs, distanceMeters: runTimeMs / 100, runTimeMs, walkTimeMs: runTimeMs * 2, provenance: "test" };
}

function graph(): ZoneGraph {
  const zones = [zone("S", 0, 0), zone("A", 1, 0), zone("G", 2, 0), zone("B", 1, -50)];
  const edges = [edge("S", "A", 1000), edge("A", "G", 1000), edge("S", "B", 1500), edge("B", "G", 1500)];
  // unitsPerMeter/speeds only scale the heuristic; edge times are explicit above.
  return new ZoneGraph(zones, edges, 100, 6.75, 3.4);
}

describe("hazard-cost pathfinding (passable area-denial)", () => {
  const g = graph();

  it("takes the short route with no hazard", () => {
    const r = g.findPath("S", "G", "run")!;
    expect(r.path).toEqual(["S", "A", "G"]);
    expect(r.timeMs).toBe(2000);
  });

  it("detours around a costly hazard when the detour is cheaper", () => {
    const r = g.findPath("S", "G", "run", { hazardCosts: new Map([["A", 2000]]) })!;
    expect(r.path).toEqual(["S", "B", "G"]); // via-A would be 2000 + 2000 > via-B 3000
    expect(r.timeMs).toBe(3000);
  });

  it("still crosses a mild hazard when crossing is cheaper than detouring", () => {
    const r = g.findPath("S", "G", "run", { hazardCosts: new Map([["A", 100]]) })!;
    expect(r.path).toEqual(["S", "A", "G"]); // 2000 + 100 < 3000
    expect(r.timeMs).toBe(2100); // cost reflects the hazard penalty
  });

  it("never charges a hazard on the goal zone itself", () => {
    const r = g.findPath("S", "A", "run", { hazardCosts: new Map([["A", 9999]]) })!;
    expect(r.path).toEqual(["S", "A"]);
    expect(r.timeMs).toBe(1000); // arriving at A is not 'passing through' it
  });
});
