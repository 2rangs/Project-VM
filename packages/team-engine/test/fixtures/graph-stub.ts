/**
 * A tiny hand-authored SpatialQuery for tests that need a specific map shape (NOT the real
 * spatial engine): zones with a position, bidirectional run-time edges, and bidirectional
 * sightlines. A test builds two graphs that differ in exactly one edge or sightline to ask a
 * counterfactual question about routing.
 */
import {
  asZoneId,
  type AudibleZoneResult,
  type SpatialQuery,
  type TravelMode,
  type Vector2,
  type ZoneId,
  type ZoneMeta,
  type ZonePath,
  type ZoneType,
} from "@pv/shared-types";

export interface GraphZone {
  readonly id: string;
  readonly zoneType: ZoneType;
  readonly site?: string;
  readonly at: Vector2;
}

export class GraphStub implements SpatialQuery {
  readonly mapId = "graph-stub";
  private readonly adj = new Map<string, Array<{ to: string; ms: number }>>();
  private readonly sight = new Map<string, Set<string>>();

  constructor(
    private readonly zones: readonly GraphZone[],
    edges: ReadonlyArray<readonly [string, string, number]>,
    sightlines: ReadonlyArray<readonly [string, string]>,
  ) {
    for (const z of zones) { this.adj.set(z.id, []); this.sight.set(z.id, new Set()); }
    for (const [a, b, ms] of edges) { this.adj.get(a)!.push({ to: b, ms }); this.adj.get(b)!.push({ to: a, ms }); }
    for (const [a, b] of sightlines) { this.sight.get(a)!.add(b); this.sight.get(b)!.add(a); }
  }

  nearestZone(p: Vector2): ZoneId {
    let best = this.zones[0]!;
    for (const z of this.zones) if ((z.at.x - p.x) ** 2 + (z.at.y - p.y) ** 2 < (best.at.x - p.x) ** 2 + (best.at.y - p.y) ** 2) best = z;
    return asZoneId(best.id);
  }
  getZoneMeta(id: ZoneId): ZoneMeta | undefined {
    const z = this.zones.find((q) => q.id === id);
    return z ? { id: asZoneId(z.id), zoneType: z.zoneType, site: z.site ?? null, plantable: z.zoneType === "site", callout: z.id } : undefined;
  }
  allZones(): readonly ZoneId[] { return this.zones.map((z) => asZoneId(z.id)); }
  zonesByType(type: ZoneType): readonly ZoneId[] { return this.zones.filter((z) => z.zoneType === type).map((z) => asZoneId(z.id)); }

  findPath(from: ZoneId, to: ZoneId, mode: TravelMode = "run"): ZonePath | null {
    if (!this.adj.has(from) || !this.adj.has(to)) return null;
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    for (;;) {
      let cur: string | null = null;
      for (const [z, d] of dist) if (!done.has(z) && (cur === null || d < dist.get(cur)!)) cur = z;
      if (cur === null || cur === to) break;
      done.add(cur);
      for (const e of this.adj.get(cur)!) {
        const nd = dist.get(cur)! + e.ms;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); }
      }
    }
    if (!dist.has(to)) return null;
    const path = [String(to)];
    while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
    const ms = dist.get(to)!;
    return { path: path.map(asZoneId), timeMs: ms, distanceMeters: (ms / 1000) * 6.75, mode };
  }
  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode: TravelMode = "run"): number | null { return this.findPath(from, to, mode)?.timeMs ?? null; }
  isReachable(from: ZoneId, to: ZoneId): boolean { return this.findPath(from, to) !== null; }
  hasLineOfSight(a: ZoneId, b: ZoneId): boolean { return a === b || (this.sight.get(a)?.has(b) ?? false); }
  visibleZonesFrom(id: ZoneId): readonly ZoneId[] { return [...(this.sight.get(id) ?? [])].map(asZoneId); }
  isPlantableZone(id: ZoneId): boolean { return this.zones.find((z) => z.id === id)?.zoneType === "site"; }
  audibleZones(): readonly AudibleZoneResult[] { return []; }
}
