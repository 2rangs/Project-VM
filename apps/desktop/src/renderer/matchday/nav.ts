// Map graph model for the live match screen: zones, travel edges, authored sightlines and
// sound links, built from the same navgraph JSON the engine loads. The lookups mirror
// @pv/spatial-engine (nearestZone / hasLineOfSight / audibleZones / findPath) so the renderer
// can re-derive per-player vision and hearing with the engine's own rules.
//
// Pure module (no JSON / DOM / engine imports) so it runs under `node --test`.

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export interface Vec2 { readonly x: number; readonly y: number }

export interface NavZone {
  readonly id: string;
  readonly name: string;
  readonly zoneType: string;
  readonly plantable: boolean;
  readonly position: Vec3;
}

/** The subset of the navgraph JSON this module reads. */
export interface NavData {
  readonly zones: ReadonlyArray<{ id: string; name?: string; zoneType?: string; plantable?: boolean; position?: Vec3 }>;
  readonly edges: ReadonlyArray<{ from: string; to: string; bidirectional?: boolean; distanceUnits?: number; runTimeMs?: number; walkTimeMs?: number }>;
  readonly sightlines: ReadonlyArray<{ a: string; b: string }>;
  readonly soundLinks: ReadonlyArray<{ a: string; b: string; attenuation: number }>;
}

export interface NavEdge { readonly to: string; readonly runTimeMs: number; readonly walkTimeMs: number; readonly distanceUnits: number }

export interface NavModel {
  readonly zones: readonly NavZone[];
  zone(id: string): NavZone | undefined;
  /** Nearest zone centre to a world position (3D euclidean, as the engine does). */
  nearestZone(pos: Vec3): NavZone;
  /** Authored zone-to-zone line of sight; a zone always sees itself. */
  hasSight(a: string, b: string): boolean;
  /** Zones with an authored sightline from `a` (excluding `a`). */
  sightZones(a: string): readonly string[];
  /** Travel edge a → b, or null when the zones are not adjacent. */
  edge(a: string, b: string): NavEdge | null;
  /** Every travel edge once (undirected), for drawing the map schematic. */
  readonly links: ReadonlyArray<{ a: string; b: string }>;
  /** Fastest run path (zone ids, inclusive) or null when unreachable. */
  path(from: string, to: string): string[] | null;
  /** Sound strength 0..1 reaching `to` from a source in `from` (1 in the same zone). */
  audible(from: string, to: string): number;
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function buildNav(data: NavData): NavModel {
  const zones: NavZone[] = data.zones
    .filter((z): z is typeof z & { position: Vec3 } => !!z.position)
    .map((z) => ({ id: z.id, name: z.name ?? z.id, zoneType: z.zoneType ?? 'zone', plantable: !!z.plantable, position: z.position }));
  const byId = new Map(zones.map((z) => [z.id, z]));

  const adj = new Map<string, NavEdge[]>();
  const links: Array<{ a: string; b: string }> = [];
  const addEdge = (from: string, e: NavEdge) => { const l = adj.get(from) ?? []; l.push(e); adj.set(from, l); };
  for (const e of data.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const distanceUnits = e.distanceUnits ?? dist3(a.position, b.position);
    const runTimeMs = e.runTimeMs ?? (distanceUnits / 675) * 1000;
    const walkTimeMs = e.walkTimeMs ?? (distanceUnits / 340) * 1000;
    addEdge(e.from, { to: e.to, runTimeMs, walkTimeMs, distanceUnits });
    if (e.bidirectional !== false) addEdge(e.to, { to: e.from, runTimeMs, walkTimeMs, distanceUnits });
    links.push({ a: e.from, b: e.to });
  }

  const sight = new Map<string, Set<string>>();
  for (const s of data.sightlines) {
    if (!sight.has(s.a)) sight.set(s.a, new Set());
    if (!sight.has(s.b)) sight.set(s.b, new Set());
    sight.get(s.a)!.add(s.b);
    sight.get(s.b)!.add(s.a);
  }

  const sound = new Map<string, Array<{ to: string; attenuation: number }>>();
  for (const l of data.soundLinks) {
    sound.set(l.a, [...(sound.get(l.a) ?? []), { to: l.b, attenuation: l.attenuation }]);
    sound.set(l.b, [...(sound.get(l.b) ?? []), { to: l.a, attenuation: l.attenuation }]);
  }
  // Best-strength propagation over sound links from one origin (engine: audibleZones BFS).
  const audibleCache = new Map<string, Map<string, number>>();
  const audibleFrom = (origin: string): Map<string, number> => {
    const hit = audibleCache.get(origin);
    if (hit) return hit;
    const best = new Map<string, number>([[origin, 1]]);
    const queue = [origin];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const strength = best.get(cur)!;
      for (const link of sound.get(cur) ?? []) {
        const next = strength * (1 - link.attenuation);
        if (next >= 0.01 && next > (best.get(link.to) ?? 0)) { best.set(link.to, next); queue.push(link.to); }
      }
    }
    audibleCache.set(origin, best);
    return best;
  };

  const pathCache = new Map<string, string[] | null>();
  const path = (from: string, to: string): string[] | null => {
    const key = `${from}>${to}`;
    if (pathCache.has(key)) return pathCache.get(key)!;
    let out: string[] | null = null;
    if (byId.has(from) && byId.has(to)) {
      // Dijkstra on run time; the graph is tiny (22 zones) so a linear scan is enough.
      const cost = new Map<string, number>([[from, 0]]);
      const prev = new Map<string, string>();
      const done = new Set<string>();
      for (;;) {
        let cur: string | null = null; let curCost = Infinity;
        for (const [id, c] of cost) if (!done.has(id) && c < curCost) { cur = id; curCost = c; }
        if (cur == null) break;
        if (cur === to) break;
        done.add(cur);
        for (const e of adj.get(cur) ?? []) {
          const c = curCost + e.runTimeMs;
          if (c < (cost.get(e.to) ?? Infinity)) { cost.set(e.to, c); prev.set(e.to, cur); }
        }
      }
      if (cost.has(to)) {
        out = [to];
        while (out[0] !== from) out.unshift(prev.get(out[0])!);
      }
    }
    pathCache.set(key, out);
    return out;
  };

  return {
    zones,
    links,
    zone: (id) => byId.get(id),
    nearestZone(pos) {
      let best = zones[0]; let bestD = Infinity;
      for (const z of zones) { const d = dist3(z.position, pos); if (d < bestD) { bestD = d; best = z; } }
      return best;
    },
    hasSight: (a, b) => a === b || (sight.get(a)?.has(b) ?? false),
    sightZones: (a) => [...(sight.get(a) ?? [])],
    edge: (a, b) => (adj.get(a) ?? []).find((e) => e.to === b) ?? null,
    path,
    audible: (from, to) => (from === to ? 1 : audibleFrom(from).get(to) ?? 0),
  };
}
