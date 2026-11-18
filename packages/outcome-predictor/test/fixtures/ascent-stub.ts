/**
 * Small deterministic Ascent SpatialQuery stub for tests (NOT the real spatial engine).
 *
 * Mirrors a subset of PV-4's Ascent zone ids (origin/claude/pv-spatial) with plausible
 * run travel times and sightlines so the decision packages can be tested without merging
 * the spatial-engine branch. Travel times are hand-set for testable thresholds (e.g. a
 * cross-map A↔B rotation is long enough to be infeasible in an 8 s round). The real
 * SpatialEngine adapter replaces this at final integration.
 *
 * Coordinate frame: minimapUnits (x right, y down, ~0..1000), matching PV-2 scenarios.
 */
import {
  asZoneId,
  type AudibleZoneResult,
  type LineOfSightOptions,
  type SpatialQuery,
  type TravelMode,
  type Vector2,
  type ZoneId,
  type ZoneMeta,
  type ZonePath,
  type ZoneType,
} from "@pv/shared-types";

interface ZoneDef {
  id: string;
  zoneType: ZoneType;
  site: string | null;
  plantable: boolean;
  anchor: Vector2; // minimapUnits
}

const ZONES: ZoneDef[] = [
  { id: "attacker-spawn", zoneType: "spawn", site: null, plantable: false, anchor: { x: 500, y: 905 } },
  { id: "defender-spawn", zoneType: "spawn", site: null, plantable: false, anchor: { x: 500, y: 120 } },
  { id: "a-lobby", zoneType: "lobby", site: null, plantable: false, anchor: { x: 650, y: 820 } },
  { id: "a-main", zoneType: "main", site: null, plantable: false, anchor: { x: 720, y: 615 } },
  { id: "a-site", zoneType: "site", site: "A", plantable: true, anchor: { x: 780, y: 360 } },
  { id: "b-lobby", zoneType: "lobby", site: null, plantable: false, anchor: { x: 350, y: 820 } },
  { id: "b-main", zoneType: "main", site: null, plantable: false, anchor: { x: 280, y: 615 } },
  { id: "b-site", zoneType: "site", site: "B", plantable: true, anchor: { x: 230, y: 360 } },
  { id: "mid-bottom", zoneType: "mid", site: null, plantable: false, anchor: { x: 500, y: 650 } },
  { id: "mid-courtyard", zoneType: "mid", site: null, plantable: false, anchor: { x: 500, y: 505 } },
  { id: "mid-top", zoneType: "mid", site: null, plantable: false, anchor: { x: 500, y: 250 } },
];

/** Bidirectional run-time edges in ms. */
const EDGES: Array<[string, string, number]> = [
  ["attacker-spawn", "a-lobby", 3000],
  ["attacker-spawn", "b-lobby", 3000],
  ["attacker-spawn", "mid-bottom", 2500],
  ["a-lobby", "a-main", 2500],
  ["a-main", "a-site", 2500],
  ["b-lobby", "b-main", 2500],
  ["b-main", "b-site", 2500],
  ["mid-bottom", "mid-courtyard", 2500],
  ["mid-courtyard", "mid-top", 2500],
  ["mid-top", "defender-spawn", 2500],
  ["mid-courtyard", "a-site", 4000],
  ["mid-courtyard", "b-site", 4000],
  ["a-site", "defender-spawn", 3500],
  ["b-site", "defender-spawn", 3500],
];

/** Authored sightlines (bidirectional); `smokeable` ones are cut by a smoked pair. */
const SIGHTLINES: Array<[string, string, boolean]> = [
  ["a-main", "a-site", true],
  ["mid-courtyard", "a-site", true],
  ["mid-courtyard", "b-site", true],
  ["b-main", "b-site", true],
  ["mid-courtyard", "mid-top", false],
  ["a-site", "defender-spawn", false],
  ["b-site", "defender-spawn", false],
];

const WALK_FACTOR = 6.75 / 3.4; // run:walk speed ratio → walk is slower

export class AscentSpatialStub implements SpatialQuery {
  readonly mapId = "ascent";
  private readonly meta = new Map<string, ZoneMeta>();
  private readonly anchors = new Map<string, Vector2>();
  private readonly adj = new Map<string, Array<{ to: string; ms: number }>>();
  private readonly sight = new Map<string, Map<string, boolean>>();

  constructor() {
    for (const z of ZONES) {
      this.meta.set(z.id, {
        id: asZoneId(z.id),
        zoneType: z.zoneType,
        site: z.site,
        plantable: z.plantable,
        callout: z.id,
      });
      this.anchors.set(z.id, z.anchor);
      this.adj.set(z.id, []);
    }
    for (const [a, b, ms] of EDGES) {
      this.adj.get(a)!.push({ to: b, ms });
      this.adj.get(b)!.push({ to: a, ms });
    }
    for (const [a, b, smokeable] of SIGHTLINES) {
      this.addSight(a, b, smokeable);
      this.addSight(b, a, smokeable);
    }
  }

  private addSight(a: string, b: string, smokeable: boolean): void {
    let m = this.sight.get(a);
    if (!m) {
      m = new Map();
      this.sight.set(a, m);
    }
    m.set(b, smokeable);
  }

  nearestZone(position: Vector2): ZoneId {
    let best = ZONES[0]!.id;
    let bestD = Infinity;
    for (const [id, a] of this.anchors) {
      const d = (a.x - position.x) ** 2 + (a.y - position.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return asZoneId(best);
  }

  getZoneMeta(zoneId: ZoneId): ZoneMeta | undefined {
    return this.meta.get(zoneId);
  }
  allZones(): readonly ZoneId[] {
    return ZONES.map((z) => asZoneId(z.id));
  }
  zonesByType(type: ZoneType): readonly ZoneId[] {
    return ZONES.filter((z) => z.zoneType === type).map((z) => asZoneId(z.id));
  }

  private dijkstra(from: string, to: string): { path: string[]; ms: number } | null {
    if (!this.adj.has(from) || !this.adj.has(to)) return null;
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    while (visited.size < this.adj.size) {
      let cur: string | null = null;
      let curD = Infinity;
      for (const [z, d] of dist) {
        if (!visited.has(z) && d < curD) {
          curD = d;
          cur = z;
        }
      }
      if (cur === null) break;
      if (cur === to) break;
      visited.add(cur);
      for (const e of this.adj.get(cur)!) {
        const nd = curD + e.ms;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, cur);
        }
      }
    }
    if (!dist.has(to)) return null;
    const path: string[] = [to];
    let c = to;
    while (c !== from) {
      const p = prev.get(c);
      if (p === undefined) break;
      path.unshift(p);
      c = p;
    }
    return { path, ms: dist.get(to)! };
  }

  findPath(from: ZoneId, to: ZoneId, mode: TravelMode = "run"): ZonePath | null {
    const r = this.dijkstra(from, to);
    if (!r) return null;
    const ms = mode === "walk" ? Math.round(r.ms * WALK_FACTOR) : r.ms;
    return {
      path: r.path.map(asZoneId),
      timeMs: ms,
      distanceMeters: Number(((r.ms / 1000) * 6.75).toFixed(1)),
      mode,
    };
  }

  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode: TravelMode = "run"): number | null {
    return this.findPath(from, to, mode)?.timeMs ?? null;
  }

  isReachable(from: ZoneId, to: ZoneId): boolean {
    return this.dijkstra(from, to) !== null;
  }

  hasLineOfSight(a: ZoneId, b: ZoneId, opts: LineOfSightOptions = {}): boolean {
    if (a === b) return true;
    const smokeable = this.sight.get(a)?.get(b);
    if (smokeable === undefined) return false;
    if (smokeable && opts.smokedPairs) {
      for (const [x, y] of opts.smokedPairs) {
        if ((x === a && y === b) || (x === b && y === a)) return false;
      }
    }
    return true;
  }

  visibleZonesFrom(zoneId: ZoneId): readonly ZoneId[] {
    const m = this.sight.get(zoneId);
    return m ? [...m.keys()].map(asZoneId) : [];
  }

  isPlantableZone(zoneId: ZoneId): boolean {
    return this.meta.get(zoneId)?.plantable ?? false;
  }

  audibleZones(originZone: ZoneId, threshold = 0.1): readonly AudibleZoneResult[] {
    // BFS over edges; strength halves each hop (stub approximation).
    const best = new Map<string, number>([[originZone, 1]]);
    const queue: string[] = [originZone];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const s = best.get(cur)!;
      for (const e of this.adj.get(cur) ?? []) {
        const next = s * 0.5;
        if (next >= threshold && next > (best.get(e.to) ?? 0)) {
          best.set(e.to, next);
          queue.push(e.to);
        }
      }
    }
    best.delete(originZone);
    return [...best.entries()]
      .map(([zoneId, strength]) => ({ zoneId: asZoneId(zoneId), strength: Number(strength.toFixed(3)) }))
      .sort((a, b) => b.strength - a.strength);
  }
}
