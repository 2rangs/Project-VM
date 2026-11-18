import type { NavEdge, TravelMode, Zone } from "./types.js";
import { distance3 } from "./geometry.js";

interface AdjEntry {
  to: string;
  distanceUnits: number;
  runTimeMs: number;
  walkTimeMs: number;
}

/**
 * A* over the zone adjacency graph. Edge cost is travel time in ms for the
 * chosen mode; the heuristic is straight-line travel time to the goal, which is
 * admissible because edge distances are straight-line between node centers
 * (actual graph cost >= heuristic).
 */
export interface PathOptions {
  /**
   * Allow paths to pass through zones marked `transit: false` (e.g. spawns) as
   * intermediate waypoints. Default false — such zones may only be start/goal.
   */
  allowNonTransitWaypoints?: boolean;
  /**
   * Zones that are temporarily impassable as intermediate waypoints (e.g. a molly /
   * area-denial or a standing wall). They may still be the start or goal. Used by the
   * ability-engine for dynamic area denial.
   */
  blockedZones?: readonly string[];
}

export class ZoneGraph {
  private readonly adj = new Map<string, AdjEntry[]>();
  private readonly zones = new Map<string, Zone>();
  private readonly transit = new Map<string, boolean>();
  private readonly speeds: { run: number; walk: number }; // units per ms

  constructor(zones: Zone[], edges: NavEdge[], unitsPerMeter: number, runMps: number, walkMps: number) {
    for (const z of zones) {
      this.zones.set(z.id, z);
      this.transit.set(z.id, z.transit !== false);
      this.adj.set(z.id, []);
    }
    this.speeds = {
      run: (runMps * unitsPerMeter) / 1000,
      walk: (walkMps * unitsPerMeter) / 1000,
    };
    for (const e of edges) {
      this.addDirected(e.from, e.to, e);
      if (e.bidirectional) this.addDirected(e.to, e.from, e);
    }
  }

  private addDirected(from: string, to: string, e: NavEdge): void {
    const list = this.adj.get(from);
    if (!list) throw new Error(`edge from unknown zone: ${from}`);
    if (!this.zones.has(to)) throw new Error(`edge to unknown zone: ${to}`);
    list.push({ to, distanceUnits: e.distanceUnits, runTimeMs: e.runTimeMs, walkTimeMs: e.walkTimeMs });
  }

  hasZone(id: string): boolean {
    return this.zones.has(id);
  }

  private edgeTimeMs(e: AdjEntry, mode: TravelMode): number {
    return mode === "run" ? e.runTimeMs : e.walkTimeMs;
  }

  private heuristicMs(fromId: string, goalId: string, mode: TravelMode): number {
    const a = this.zones.get(fromId)!;
    const b = this.zones.get(goalId)!;
    const units = distance3(a.position, b.position);
    const speed = mode === "run" ? this.speeds.run : this.speeds.walk;
    return units / speed;
  }

  /** Returns ordered zone ids (start..goal) and total time/distance, or null if unreachable. */
  findPath(
    startId: string,
    goalId: string,
    mode: TravelMode,
    opts: PathOptions = {},
  ): { path: string[]; timeMs: number; distanceUnits: number } | null {
    if (!this.zones.has(startId)) throw new Error(`unknown start zone: ${startId}`);
    if (!this.zones.has(goalId)) throw new Error(`unknown goal zone: ${goalId}`);
    if (startId === goalId) return { path: [startId], timeMs: 0, distanceUnits: 0 };
    const allowNonTransit = opts.allowNonTransitWaypoints === true;
    const blocked = opts.blockedZones && opts.blockedZones.length > 0 ? new Set(opts.blockedZones) : null;
    // A neighbor may be expanded only if it is a transit zone or it is the goal
    // (start is never reached as a neighbor since g-scores only decrease from 0).
    const passable = (id: string): boolean => {
      if (id === startId || id === goalId) return true;
      if (blocked && blocked.has(id)) return false;
      return allowNonTransit || this.transit.get(id) === true;
    };

    const gScore = new Map<string, number>([[startId, 0]]);
    const gDist = new Map<string, number>([[startId, 0]]);
    const cameFrom = new Map<string, string>();
    const open = new Set<string>([startId]);
    // Simple array-backed priority selection (graph is small: ~22 nodes).
    const fScore = new Map<string, number>([[startId, this.heuristicMs(startId, goalId, mode)]]);

    while (open.size > 0) {
      let current: string | null = null;
      let best = Infinity;
      for (const id of open) {
        const f = fScore.get(id) ?? Infinity;
        if (f < best) {
          best = f;
          current = id;
        }
      }
      if (current === null) break;
      if (current === goalId) {
        return this.reconstruct(cameFrom, current, gScore.get(current)!, gDist.get(current)!);
      }
      open.delete(current);
      const g = gScore.get(current)!;
      const d = gDist.get(current)!;
      for (const e of this.adj.get(current)!) {
        if (!passable(e.to)) continue;
        const tentative = g + this.edgeTimeMs(e, mode);
        if (tentative < (gScore.get(e.to) ?? Infinity)) {
          cameFrom.set(e.to, current);
          gScore.set(e.to, tentative);
          gDist.set(e.to, d + e.distanceUnits);
          fScore.set(e.to, tentative + this.heuristicMs(e.to, goalId, mode));
          open.add(e.to);
        }
      }
    }
    return null;
  }

  private reconstruct(
    cameFrom: Map<string, string>,
    goalId: string,
    timeMs: number,
    distanceUnits: number,
  ): { path: string[]; timeMs: number; distanceUnits: number } {
    const path = [goalId];
    let cur = goalId;
    while (cameFrom.has(cur)) {
      cur = cameFrom.get(cur)!;
      path.push(cur);
    }
    path.reverse();
    return { path, timeMs, distanceUnits };
  }
}
