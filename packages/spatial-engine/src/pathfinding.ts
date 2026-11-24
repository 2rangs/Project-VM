import type { EdgeRoute, EdgeTraversal, NavEdge, TravelMode, Vec3, Waypoint, Zone } from "./types.js";
import { distance3 } from "./geometry.js";

interface AdjEntry {
  to: string;
  distanceUnits: number;
  runTimeMs: number;
  walkTimeMs: number;
  /** The directed traversal a mover follows (polyline + its own length/times). */
  traversal: EdgeTraversal;
}

const toVec = (w: Waypoint): Vec3 => ({ x: w[0], y: w[1], z: w[2] });

function polylineLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance3(points[i - 1]!, points[i]!);
  return total;
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
   * Zones that are temporarily impassable as intermediate waypoints (e.g. a standing wall).
   * They may still be the start or goal. Full physical blocks only.
   */
  blockedZones?: readonly string[];
  /**
   * Extra traversal cost (ms) for entering a zone — a passable HAZARD such as a molly /
   * area-denial. A path may still cross it, but pays the cost, so the planner detours when a
   * detour is cheaper and accepts the damage when it is not. Only increases g-scores, so the
   * straight-line-time heuristic stays admissible.
   */
  hazardCosts?: ReadonlyMap<string, number>;
  /**
   * Non-transit zones this query may still pass through — a team's own spawn. A spawn is no
   * thoroughfare for the other side, but on most maps it is the defenders' way between the sites.
   */
  passableZones?: readonly string[];
}

export class ZoneGraph {
  private readonly adj = new Map<string, AdjEntry[]>();
  private readonly zones = new Map<string, Zone>();
  private readonly transit = new Map<string, boolean>();
  private readonly speeds: { run: number; walk: number }; // units per ms
  /** <= 1: keeps the straight-line heuristic admissible (see constructor). */
  private heuristicScale = 1;
  private readonly unitsPerMeter: number;

  constructor(zones: Zone[], edges: NavEdge[], unitsPerMeter: number, runMps: number, walkMps: number) {
    for (const z of zones) {
      this.zones.set(z.id, z);
      this.transit.set(z.id, z.transit !== false);
      this.adj.set(z.id, []);
    }
    this.unitsPerMeter = unitsPerMeter;
    this.speeds = {
      run: (runMps * unitsPerMeter) / 1000,
      walk: (walkMps * unitsPerMeter) / 1000,
    };
    for (const e of edges) {
      this.addDirected(e.from, e.to, e, false);
      if (e.bidirectional) this.addDirected(e.to, e.from, e, true);
    }
    // The straight-line heuristic must never overestimate. A teleporter is faster than
    // running its straight line, and a measured route between two anchors can be marginally
    // shorter than the line between the two callouts — scale the heuristic by the worst case.
    for (const [from, list] of this.adj) {
      const a = this.zones.get(from)!;
      for (const e of list) {
        const b = this.zones.get(e.to)!;
        const units = distance3(a.position, b.position);
        if (units <= 0) continue;
        this.heuristicScale = Math.min(this.heuristicScale, e.runTimeMs / (units / this.speeds.run), e.walkTimeMs / (units / this.speeds.walk));
      }
    }
  }

  /** Where a player stands in a zone: its measured anchor, else the callout position. */
  standPosition(zoneId: string): Vec3 {
    const z = this.zones.get(zoneId);
    if (!z) throw new Error(`unknown zone: ${zoneId}`);
    return z.anchor ?? z.position;
  }

  private addDirected(from: string, to: string, e: NavEdge, reverse: boolean): void {
    const list = this.adj.get(from);
    if (!list) throw new Error(`edge from unknown zone: ${from}`);
    if (!this.zones.has(to)) throw new Error(`edge to unknown zone: ${to}`);
    // Which polyline this direction follows: the edge's own route, its dedicated way back,
    // the same route reversed, or — with no measured route — the straight segment.
    const route: EdgeRoute | undefined = reverse ? e.routeReverse ?? e.route : e.route;
    const reversed = reverse && !e.routeReverse;
    let waypoints: Vec3[];
    let distanceUnits = e.distanceUnits;
    let runTimeMs = e.runTimeMs;
    let walkTimeMs = e.walkTimeMs;
    if (route && route.waypoints.length >= 2) {
      waypoints = route.waypoints.map(toVec);
      if (reversed) waypoints.reverse();
      distanceUnits = Math.round(route.lengthMeters * this.unitsPerMeter);
      runTimeMs = route.runTimeMs;
      walkTimeMs = route.walkTimeMs;
    } else {
      waypoints = [{ ...this.standPosition(from) }, { ...this.standPosition(to) }];
    }
    const traversal: EdgeTraversal = {
      from, to, waypoints, lengthUnits: polylineLength(waypoints), runTimeMs, walkTimeMs,
      ...(e.kind ? { kind: e.kind } : {}),
      walkable: !!route,
    };
    list.push({ to, distanceUnits, runTimeMs, walkTimeMs, traversal });
  }

  /** The directed traversal from one zone to an adjacent one (fastest if several), or null. */
  traversal(from: string, to: string): EdgeTraversal | null {
    let best: AdjEntry | null = null;
    for (const e of this.adj.get(from) ?? []) {
      if (e.to === to && (!best || e.runTimeMs < best.runTimeMs)) best = e;
    }
    return best ? best.traversal : null;
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
    return (units / speed) * this.heuristicScale;
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
    const hazardCosts = opts.hazardCosts && opts.hazardCosts.size > 0 ? opts.hazardCosts : null;
    // A neighbor may be expanded only if it is a transit zone or it is the goal
    // (start is never reached as a neighbor since g-scores only decrease from 0).
    const passable = (id: string): boolean => {
      if (id === startId || id === goalId) return true;
      if (blocked && blocked.has(id)) return false;
      if (opts.passableZones && opts.passableZones.includes(id)) return true;
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
        // base travel time + any hazard cost for entering e.to (0 for a non-hazard zone, and
        // never for the goal — arriving at your destination isn't "passing through" a hazard).
        const hazard = hazardCosts && e.to !== goalId ? hazardCosts.get(e.to) ?? 0 : 0;
        const tentative = g + this.edgeTimeMs(e, mode) + hazard;
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
