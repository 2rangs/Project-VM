// PROJECT V — geometric navigation on a map's roadmap (datasets/spatial/<map>/<map>.nav.json).
//
// The roadmap is measured on the real map geometry (tools/map-mesh/pipeline/nav_map.py): nodes
// are walkable standing points with their wall clearance, edges are straight segments that were
// walked cell by cell on the walk grid and ray-checked against the solid geometry, drops are
// one-way, links are authored special traversals. A path found here therefore never crosses a
// wall — and when there is no path the answer is UNREACHABLE, never a straight line.
import type { Vec2, Vec3 } from "./types.js";

/** "walk" and "drop" are measured floor; every other kind is a link with its own fixed travel time. */
export type NavEdgeKind = "walk" | "drop" | "teleporter" | "zipline" | "rope" | "jump";
export type MovementMode = "run" | "walk";
/**
 * FASTEST: time only. SAFEST: strongly avoids zones the caller marks dangerous. STEALTH: like
 * SAFEST but the estimate assumes walking. TACTICAL: a mild version of the same trade.
 */
export type RoutePreference = "FASTEST" | "SAFEST" | "STEALTH" | "TACTICAL";

/** Raw file shape. Positions in game uu. */
export interface NavData {
  mapId: string;
  zones: string[];
  anchors: Record<string, number>;
  /** [x, y, z (floor), clearance, zoneIndex] */
  nodes: number[][];
  /** [a, b, halfWidth] — walkable both ways */
  edges: number[][];
  /** [from, to] — one-way */
  drops: number[][];
  links: Array<{ from: number; to: number; kind: NavEdgeKind; travelTimeMs: number; bidirectional: boolean }>;
}

/** Line of sight between roadmap nodes (<map>.vis.json): one bit per unordered pair, upper triangle. */
export interface NavVisibility {
  nodes: number;
  rangeUnits: number;
  bitsBase64: string;
}

export interface NavigationRequest {
  actorId: string;
  start: Vec3;
  destination: Vec3;
  movementMode: MovementMode;
  routePreference: RoutePreference;
  /**
   * Extra cost of passing through a zone, >= 0 (0 = neutral, 1 = "twice as costly"). The tactical
   * layer fills this from the TEAM'S BELIEF (seen / heard / suspected enemies, utility) — never
   * from true enemy positions. Ignored by FASTEST.
   */
  zoneCost?: (zoneId: string) => number;
  /** Movement blockers in force (walls that physically stop a body). */
  blockers?: NavBlockers;
  /**
   * One-off cost (ms) of ENTERING a zone on the way — a passable hazard such as fire that can be
   * waited out. Not charged for the zone the route starts or ends in. Applies to every preference.
   */
  zoneEntryMs?: (zoneId: string) => number;
  /**
   * The strategic route's zones. Floor belonging to any other zone costs `penalty` times more
   * time (0.5 = half as much again), so the geometric path follows the lanes the route planner
   * chose instead of cutting across a neighbouring zone's floor. Applies to every preference.
   */
  corridor?: { zones: ReadonlySet<string>; penalty: number };
  /**
   * Passable hazards on the floor (a fire patch that can be waited out, a slow field): stepping
   * INTO the disc from outside costs `costMs` once. A route that skirts the disc pays nothing.
   */
  hazards?: ReadonlyArray<{ center: Vec3; radius: number; costMs: number }>;
  /**
   * Zones that may be the start or the goal of a route but are not to be used as a way through
   * (spawns). Their floor is taken only when the goal cannot be reached any other way.
   */
  noTransitZones?: ReadonlySet<string>;
  /**
   * Roadmap nodes the mover can step to directly from `start` (the two ends of the segment it is
   * on). When given, the route leaves through whichever is cheaper overall, instead of through the
   * nearest node — which might be on the far side of a wall.
   */
  startNodes?: readonly number[];
}

export interface NavWaypoint {
  position: Vec3;
  /** Roadmap node this waypoint is (-1 for the free start / destination points). */
  node: number;
  /** How the mover gets HERE from the previous waypoint. */
  via: NavEdgeKind;
  /** Sideways room on the segment leading here (uu); 0 for drops and links. */
  halfWidth: number;
  /** Fixed traversal time of the segment leading here, for links (ms). */
  fixedMs?: number;
  zoneId: string;
}

export type NavigationResult =
  | { status: "SUCCESS"; waypoints: NavWaypoint[]; pathLength: number; estimatedTravelMs: number; zones: string[] }
  | { status: "UNREACHABLE" | "INVALID_START" | "INVALID_TARGET"; reason: string };

interface Arc {
  to: number;
  kind: NavEdgeKind;
  length: number;
  halfWidth: number;
  fixedMs: number;
  /** Index into the undirected walk edge list, or -1. Blockers refer to it. */
  edge: number;
}

/** Cost (ms) of crossing from one node's zone into another's; Infinity = not allowed. */
type ZoneGate = (fromNode: number, toNode: number) => number;

const GRID = 300; // spatial-hash cell (uu)
/**
 * Search cost of stepping onto the floor of a no-transit zone (a spawn) that is neither the start
 * nor the goal. Larger than any detour on these maps, so a route uses that floor only when there
 * is no other way to the goal — on some maps the only stairs to a zone lie on floor that the zone
 * partition gives to a spawn (Ascent: A Rafters). It is a search cost only: it is never part of
 * the travel time a path reports.
 */
const NO_TRANSIT_MS = 120_000;
/** A point further than this from every node (XY) is not on the roadmap. */
const LOCATE_RADIUS = 450;
/** Height band within which a node counts as "this floor" for a 3D lookup (uu). */
const FLOOR_BAND = 160;

/** Movement blockers: sets of roadmap nodes / edges a body cannot pass. Vision is NOT their business. */
export class NavBlockers {
  private readonly byId = new Map<string, { nodes: number[]; edges: number[] }>();
  private readonly nodeCount = new Map<number, number>();
  private readonly edgeCount = new Map<number, number>();
  /** Bumped on every change, so a mover can tell its path needs revalidating. */
  version = 0;

  constructor(private readonly nav: Navigator) {}

  /** Block a disc of floor: every node inside it and every walk edge passing through it. */
  addDisc(id: string, center: Vec3, radius: number): void {
    this.remove(id);
    const { nodes, edges } = this.nav.withinDisc(center, radius);
    this.byId.set(id, { nodes, edges });
    for (const n of nodes) this.nodeCount.set(n, (this.nodeCount.get(n) ?? 0) + 1);
    for (const e of edges) this.edgeCount.set(e, (this.edgeCount.get(e) ?? 0) + 1);
    this.version++;
  }

  /** Block a whole zone's floor (a coarse wall: nothing walks through that zone). */
  addZone(id: string, zoneId: string): void {
    this.remove(id);
    const nodes = this.nav.zoneNodes(zoneId);
    const set = new Set(nodes);
    const edges = this.nav.edgesTouching(set);
    this.byId.set(id, { nodes: [...nodes], edges });
    for (const n of nodes) this.nodeCount.set(n, (this.nodeCount.get(n) ?? 0) + 1);
    for (const e of edges) this.edgeCount.set(e, (this.edgeCount.get(e) ?? 0) + 1);
    this.version++;
  }

  remove(id: string): boolean {
    const b = this.byId.get(id);
    if (!b) return false;
    this.byId.delete(id);
    for (const n of b.nodes) {
      const c = (this.nodeCount.get(n) ?? 1) - 1;
      if (c <= 0) this.nodeCount.delete(n); else this.nodeCount.set(n, c);
    }
    for (const e of b.edges) {
      const c = (this.edgeCount.get(e) ?? 1) - 1;
      if (c <= 0) this.edgeCount.delete(e); else this.edgeCount.set(e, c);
    }
    this.version++;
    return true;
  }

  has(id: string): boolean { return this.byId.has(id); }
  ids(): string[] { return [...this.byId.keys()]; }
  nodeBlocked(n: number): boolean { return this.nodeCount.has(n); }
  edgeBlocked(e: number): boolean { return e >= 0 && this.edgeCount.has(e); }
  get empty(): boolean { return this.byId.size === 0; }
}

export class Navigator {
  readonly mapId: string;
  readonly nodeCount: number;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly clearance: Float64Array;
  private readonly zoneIdx: Int32Array;
  private readonly zones: string[];
  private readonly arcs: Arc[][];
  private readonly walkEdges: Array<[number, number, number]>;
  private readonly hash = new Map<number, number[]>();
  private readonly anchors: Map<string, number>;
  private readonly byZone = new Map<string, number[]>();
  private readonly speeds: { run: number; walk: number }; // uu per ms
  private readonly hasLinks: boolean;
  private readonly pairCache = new Map<string, number>();
  private visBits: Uint8Array | null = null;
  private visRange = 0;
  private seenCache: Map<number, Int32Array> | null = null;

  constructor(data: NavData, movement: { unitsPerMeter: number; runSpeedMetersPerSec: number; walkSpeedMetersPerSec: number }) {
    this.mapId = data.mapId;
    const n = (this.nodeCount = data.nodes.length);
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.z = new Float64Array(n);
    this.clearance = new Float64Array(n); this.zoneIdx = new Int32Array(n);
    this.zones = data.zones;
    this.arcs = Array.from({ length: n }, () => []);
    data.nodes.forEach((v, i) => {
      this.x[i] = v[0]!; this.y[i] = v[1]!; this.z[i] = v[2]!; this.clearance[i] = v[3]!; this.zoneIdx[i] = v[4]!;
      const k = this.key(v[0]!, v[1]!);
      const cell = this.hash.get(k);
      if (cell) cell.push(i); else this.hash.set(k, [i]);
      const zid = data.zones[v[4]!];
      if (zid !== undefined) {
        const list = this.byZone.get(zid);
        if (list) list.push(i); else this.byZone.set(zid, [i]);
      }
    });
    this.walkEdges = data.edges.map((e) => [e[0]!, e[1]!, e[2]!]);
    this.walkEdges.forEach(([a, b, w], idx) => {
      const length = this.dist(a, b);
      this.arcs[a]!.push({ to: b, kind: "walk", length, halfWidth: w, fixedMs: 0, edge: idx });
      this.arcs[b]!.push({ to: a, kind: "walk", length, halfWidth: w, fixedMs: 0, edge: idx });
    });
    for (const [a, b] of data.drops) {
      this.arcs[a!]!.push({ to: b!, kind: "drop", length: this.dist(a!, b!), halfWidth: 0, fixedMs: 0, edge: -1 });
    }
    for (const l of data.links) {
      const length = this.dist(l.from, l.to);
      this.arcs[l.from]!.push({ to: l.to, kind: l.kind, length, halfWidth: 0, fixedMs: l.travelTimeMs, edge: -1 });
      if (l.bidirectional) this.arcs[l.to]!.push({ to: l.from, kind: l.kind, length, halfWidth: 0, fixedMs: l.travelTimeMs, edge: -1 });
    }
    this.hasLinks = data.links.length > 0;
    this.anchors = new Map(Object.entries(data.anchors));
    this.speeds = {
      run: (movement.runSpeedMetersPerSec * movement.unitsPerMeter) / 1000,
      walk: (movement.walkSpeedMetersPerSec * movement.unitsPerMeter) / 1000,
    };
  }

  /** Attach the measured node-to-node line of sight. Ignored (returns false) if it is for another roadmap. */
  setVisibility(v: NavVisibility): boolean {
    if (v.nodes !== this.nodeCount) return false;
    const bin = atob(v.bitsBase64);
    const bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
    this.visBits = bits;
    this.visRange = v.rangeUnits;
    this.seenCache = null;
    return true;
  }
  get hasVisibility(): boolean { return this.visBits !== null; }

  /** Per node: how many nodes of each zone have measured line of sight to it (row = node, column = zone). */
  private seenFrom(n: number): Int32Array {
    const rows = (this.seenCache ??= new Map<number, Int32Array>());
    let row = rows.get(n);
    if (!row) {
      row = new Int32Array(this.zones.length);
      if (this.visBits) for (let j = 0; j < this.nodeCount; j++) if (j !== n && this.nodesVisible(n, j)) row[this.zoneIdx[j]!]!++;
      rows.set(n, row);
    }
    return row;
  }

  /**
   * How exposed a standing point is: the number of roadmap nodes in OTHER zones with measured line
   * of sight to it — how much of the rest of the map can see a body standing there. A corner
   * behind cover scores low, the middle of an open site high. `exceptZone` leaves one more zone
   * out of the count: the zone the body is there to watch. 0 without visibility data.
   */
  exposure(n: number, exceptZone?: string): number {
    if (!this.visBits) return 0;
    const row = this.seenFrom(n), own = this.zoneIdx[n]!;
    const skip = exceptZone !== undefined ? this.zones.indexOf(exceptZone) : -1;
    let c = 0;
    for (let z = 0; z < row.length; z++) if (z !== own && z !== skip) c += row[z]!;
    return c;
  }

  /** How many standing points of a zone this node has measured line of sight to (0 without visibility data). */
  sightInto(n: number, zoneId: string): number {
    if (!this.visBits) return 0;
    const z = this.zones.indexOf(zoneId);
    return z < 0 ? 0 : this.seenFrom(n)[z]!;
  }

  /** Measured line of sight between two roadmap nodes (false beyond the measured range). */
  nodesVisible(a: number, b: number): boolean {
    if (a === b) return true;
    if (!this.visBits) return false;
    const i = Math.min(a, b), j = Math.max(a, b), n = this.nodeCount;
    const k = i * n - (i * (i + 1)) / 2 + (j - i - 1);
    return ((this.visBits[k >> 3]! >> (7 - (k & 7))) & 1) === 1;
  }

  /**
   * The roadmap node a body stands at, given the zone the simulation has it in: the nearest node
   * of that zone (so a point near a wall is not matched to the floor behind the wall), else the
   * nearest node of any zone.
   */
  locateInZone(p: Vec2 | Vec3, zoneId: string | null | undefined, maxDist = 700): number | null {
    if (zoneId) {
      const hasZ = typeof (p as Vec3).z === "number";
      let best = -1, bestScore = Infinity;
      for (const i of this.byZone.get(zoneId) ?? []) {
        const d = Math.hypot(this.x[i]! - p.x, this.y[i]! - p.y);
        if (d > maxDist) continue;
        const dz = hasZ ? Math.abs(this.z[i]! - (p as Vec3).z) : 0;
        const score = d + (dz > FLOOR_BAND ? 4 * dz : dz * 0.5);
        if (score < bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) return best;
    }
    return this.locate(p);
  }

  /**
   * Can a body at `a` see a body at `b`? Decided by where they really are: the measured line of
   * sight between the roadmap nodes they stand at (walls, corners and height included), within
   * the measured range. null when this map has no visibility data or a position is off the
   * roadmap — the caller then falls back to its zone-level rule.
   */
  sees(a: Vec3, aZone: string | null | undefined, b: Vec3, bZone: string | null | undefined): boolean | null {
    if (!this.visBits) return null;
    return this.seesNodes(this.locateInZone(a, aZone), this.locateInZone(b, bZone), a, b);
  }

  /**
   * `sees` once the two bodies' roadmap nodes are already located (`locateInZone`). Pulled out so a
   * caller running the O(n²) visibility pass can locate each body once per tick and reuse the node
   * across every pairing — byte-identical to `sees`, just without the repeated locate. `na`/`nb` must
   * be the `locateInZone(pos, zone)` of `a`/`b`.
   */
  seesNodes(na: number | null, nb: number | null, a: Vec3, b: Vec3): boolean | null {
    if (!this.visBits) return null;
    if (na === null || nb === null) return null;
    if (na === nb) return true;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > this.visRange) return false;
    return this.nodesVisible(na, nb);
  }

  private key(x: number, y: number): number {
    return Math.floor(x / GRID) * 100003 + Math.floor(y / GRID);
  }

  private dist(a: number, b: number): number {
    return Math.hypot(this.x[a]! - this.x[b]!, this.y[a]! - this.y[b]!, this.z[a]! - this.z[b]!);
  }

  nodePosition(n: number): Vec3 {
    return { x: this.x[n]!, y: this.y[n]!, z: this.z[n]! };
  }
  nodeClearance(n: number): number { return this.clearance[n]!; }
  nodeZone(n: number): string { return this.zones[this.zoneIdx[n]!]!; }
  anchorNode(zoneId: string): number | undefined { return this.anchors.get(zoneId); }
  /** Roadmap nodes lying in a zone's area (its standing spots), in file order. */
  zoneNodes(zoneId: string): readonly number[] { return this.byZone.get(zoneId) ?? []; }
  /** Arcs out of a node (read-only view for the executor / debug views). */
  arcsFrom(n: number): ReadonlyArray<Readonly<Arc>> { return this.arcs[n]!; }
  edgeCount(): number { return this.walkEdges.length; }
  walkEdge(i: number): readonly [number, number, number] { return this.walkEdges[i]!; }

  /**
   * The roadmap node a position stands at: the nearest node in XY; with a z, nodes on the same
   * floor (within a height band) are preferred, so stacked floors resolve correctly. null when
   * the position is not on the roadmap at all.
   */
  locate(p: Vec2 | Vec3, maxDist = LOCATE_RADIUS): number | null {
    const hasZ = typeof (p as Vec3).z === "number";
    const r = Math.ceil(maxDist / GRID);
    const cx = Math.floor(p.x / GRID), cy = Math.floor(p.y / GRID);
    let best = -1, bestScore = Infinity;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) {
      const cell = this.hash.get(ix * 100003 + iy);
      if (!cell) continue;
      for (const i of cell) {
        const d = Math.hypot(this.x[i]! - p.x, this.y[i]! - p.y);
        if (d > maxDist) continue;
        const dz = hasZ ? Math.abs(this.z[i]! - (p as Vec3).z) : 0;
        const score = d + (dz > FLOOR_BAND ? 4 * dz : dz * 0.5);
        if (score < bestScore || (score === bestScore && i < best)) { bestScore = score; best = i; }
      }
    }
    return best < 0 ? null : best;
  }

  /** The zone whose area a position lies in, or null off the roadmap. */
  zoneAt(p: Vec2 | Vec3): string | null {
    const n = this.locate(p);
    return n === null ? null : this.nodeZone(n);
  }

  /**
   * Distance (uu, XY) from a position to walkable floor as the roadmap knows it: 0 inside a
   * node's clearance disc or inside an edge's corridor, else how far outside the nearest one.
   */
  distanceToWalkable(p: Vec3): number {
    const n = this.locate(p, LOCATE_RADIUS + 600);
    if (n === null) return Infinity;
    let best = Math.max(0, Math.hypot(this.x[n]! - p.x, this.y[n]! - p.y) - Math.max(25, this.clearance[n]!));
    // every arc near the position counts: a walk edge with its half-width, a drop / link as a
    // thin line (the body is on it while it falls or is carried)
    const consider = new Set<number>([n]);
    for (const a of this.arcs[n]!) consider.add(a.to);
    for (const u of consider) for (const a of this.arcs[u]!) {
      const d = this.distToSegment(p, u, a.to) - Math.max(25, a.halfWidth);
      if (d < best) best = Math.max(0, d);
    }
    // arcs that END at a nearby node but start further off (one-way drops down to here)
    if (best > 0) {
      for (let u = 0; u < this.nodeCount && best > 0; u++) {
        if (Math.abs(this.x[u]! - p.x) > 900 || Math.abs(this.y[u]! - p.y) > 900) continue;
        for (const a of this.arcs[u]!) {
          const d = this.distToSegment(p, u, a.to) - Math.max(25, a.halfWidth);
          if (d < best) best = Math.max(0, d);
        }
      }
    }
    return best;
  }

  private distToSegment(p: Vec2, a: number, b: number): number {
    const ax = this.x[a]!, ay = this.y[a]!, bx = this.x[b]!, by = this.y[b]!;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
    return Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t));
  }

  /** Nodes inside a disc and walk edges passing through it (same floor band as the centre). */
  withinDisc(center: Vec3, radius: number): { nodes: number[]; edges: number[] } {
    const nodes: number[] = [];
    const edges = new Set<number>();
    const reach = radius + 700; // an edge is at most ~6 m long
    const r = Math.ceil(reach / GRID);
    const cx = Math.floor(center.x / GRID), cy = Math.floor(center.y / GRID);
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) {
      for (const i of this.hash.get(ix * 100003 + iy) ?? []) {
        if (Math.abs(this.z[i]! - center.z) > 2 * FLOOR_BAND) continue;
        if (Math.hypot(this.x[i]! - center.x, this.y[i]! - center.y) <= radius) nodes.push(i);
        for (const a of this.arcs[i]!) {
          if (a.edge >= 0 && this.distToSegment(center, i, a.to) <= radius) edges.add(a.edge);
        }
      }
    }
    return { nodes: nodes.sort((p, q) => p - q), edges: [...edges].sort((p, q) => p - q) };
  }

  edgesTouching(nodes: ReadonlySet<number>): number[] {
    const out: number[] = [];
    this.walkEdges.forEach(([a, b], i) => { if (nodes.has(a) || nodes.has(b)) out.push(i); });
    return out;
  }

  private arcMs(a: Arc, mode: MovementMode): number {
    if (a.fixedMs > 0) return a.fixedMs;
    return a.length / (mode === "run" ? this.speeds.run : this.speeds.walk);
  }

  /** Geometric path between two world positions. Never a straight-line fallback. */
  findPath(req: NavigationRequest): NavigationResult {
    const given = (req.startNodes ?? []).filter((n) => n >= 0 && n < this.nodeCount);
    const located = given.length > 0 ? given[0]! : this.locate(req.start);
    if (located === null) return { status: "INVALID_START", reason: `start (${req.start.x.toFixed(0)}, ${req.start.y.toFixed(0)}) is not on walkable floor` };
    const g = this.locate(req.destination);
    if (g === null) return { status: "INVALID_TARGET", reason: `destination (${req.destination.x.toFixed(0)}, ${req.destination.y.toFixed(0)}) is not on walkable floor` };
    const blockers = req.blockers && !req.blockers.empty ? req.blockers : null;
    if (blockers?.nodeBlocked(g)) return { status: "UNREACHABLE", reason: `destination is inside a movement blocker (${blockers.ids().join(", ")})` };
    const mode: MovementMode = req.routePreference === "STEALTH" ? "walk" : req.movementMode;
    const speed = mode === "run" ? this.speeds.run : this.speeds.walk;
    const dangerWeight = req.routePreference === "FASTEST" || !req.zoneCost ? 0 : req.routePreference === "TACTICAL" ? 1 : 3;
    const zoneCost = new Map<number, number>();
    const corridor = req.corridor && req.corridor.zones.size > 0 && req.corridor.penalty > 0 ? req.corridor : null;
    const costOf = (node: number): number => {
      if (dangerWeight === 0 && !corridor) return 0;
      const zi = this.zoneIdx[node]!;
      let c = zoneCost.get(zi);
      if (c === undefined) {
        const zid = this.zones[zi]!;
        c = (dangerWeight > 0 ? Math.max(0, req.zoneCost!(zid)) * dangerWeight : 0) + (corridor && !corridor.zones.has(zid) ? corridor.penalty : 0);
        zoneCost.set(zi, c);
      }
      return c;
    };
    const startNodes = given.length > 0 ? given : [located];
    const sources = startNodes.map((n) => ({ node: n, ms: Math.hypot(this.x[n]! - req.start.x, this.y[n]! - req.start.y, this.z[n]! - req.start.z) / speed }));
    const startZone = this.zoneIdx[located]!, goalZone = this.zoneIdx[g]!;
    const entryMs = new Map<number, number>();
    const forbidden = req.noTransitZones && req.noTransitZones.size > 0 ? req.noTransitZones : null;
    const hazardAt = new Map<number, number>(); // node inside a hazard disc -> its cost
    for (const h of req.hazards ?? []) {
      if (!(h.costMs > 0)) continue;
      for (const n of this.withinDisc(h.center, h.radius).nodes) hazardAt.set(n, Math.max(hazardAt.get(n) ?? 0, h.costMs));
    }
    const gate: ZoneGate | null = req.zoneEntryMs || forbidden || hazardAt.size > 0
      ? (fromNode, toNode) => {
          let cost = 0;
          const hz = hazardAt.get(toNode);
          if (hz !== undefined && !hazardAt.has(fromNode)) cost += hz;
          const zi = this.zoneIdx[toNode]!;
          if (zi === this.zoneIdx[fromNode]! || zi === goalZone || zi === startZone) return cost;
          if (forbidden?.has(this.zones[zi]!)) cost += NO_TRANSIT_MS;
          if (!req.zoneEntryMs) return cost;
          let c = entryMs.get(zi);
          if (c === undefined) { c = Math.max(0, req.zoneEntryMs(this.zones[zi]!)); entryMs.set(zi, c); }
          return cost + c;
        }
      : null;
    const path = this.search(sources, g, mode, blockers, costOf, gate, true);
    if (!path) {
      const without = blockers ? this.search(sources, g, mode, null, costOf, gate, false) : null;
      return {
        status: "UNREACHABLE",
        reason: without ? `every route is cut by a movement blocker (${blockers!.ids().join(", ")})` : "no walkable connection between start and destination",
      };
    }
    const s = path.nodes[0]!;
    // waypoints: the free start point, the roadmap nodes, the free destination point
    const waypoints: NavWaypoint[] = [{ position: { ...req.start }, node: -1, via: "walk", halfWidth: 0, zoneId: this.nodeZone(s) }];
    let length = 0, ms = 0;
    const push = (position: Vec3, node: number, via: NavEdgeKind, halfWidth: number, fixedMs: number, zoneId: string): void => {
      const prev = waypoints[waypoints.length - 1]!.position;
      const d = Math.hypot(position.x - prev.x, position.y - prev.y, position.z - prev.z);
      if (d === 0 && fixedMs === 0 && node === -1) return;
      length += d;
      ms += fixedMs > 0 ? fixedMs : d / speed;
      waypoints.push({ position, node, via, halfWidth, ...(fixedMs > 0 ? { fixedMs } : {}), zoneId });
    };
    push(this.nodePosition(s), s, "walk", 0, 0, this.nodeZone(s));
    for (let i = 1; i < path.nodes.length; i++) {
      const a = path.arcs[i]!;
      push(this.nodePosition(path.nodes[i]!), path.nodes[i]!, a.kind, a.halfWidth, a.fixedMs, this.nodeZone(path.nodes[i]!));
    }
    // step off the last node to the exact destination only if that keeps the body on floor
    const dOff = Math.hypot(req.destination.x - this.x[g]!, req.destination.y - this.y[g]!);
    if (dOff > 0 && dOff <= Math.max(25, this.clearance[g]!)) {
      push({ x: req.destination.x, y: req.destination.y, z: this.z[g]! }, -1, "walk", 0, 0, this.nodeZone(g));
    }
    const zones: string[] = [];
    for (const w of waypoints) if (zones[zones.length - 1] !== w.zoneId) zones.push(w.zoneId);
    return { status: "SUCCESS", waypoints, pathLength: length, estimatedTravelMs: ms, zones };
  }

  private search(
    sources: ReadonlyArray<{ node: number; ms: number }>, g: number, mode: MovementMode, blockers: NavBlockers | null,
    costOf: (node: number) => number, gate: ZoneGate | null, useHeuristic: boolean,
  ): { nodes: number[]; arcs: Array<Arc | null> } | null {
    const n = this.nodeCount;
    const gScore = new Float64Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const cameArc: Array<Arc | null> = new Array(n).fill(null);
    const closed = new Uint8Array(n);
    // a link may beat the straight line, so the straight-line heuristic is only used without links
    const vmax = this.speeds.run;
    const h = (i: number): number => (useHeuristic && !this.hasLinks ? this.dist(i, g) / vmax : 0);
    const heap = new MinHeap();
    for (const src of sources) {
      if (blockers?.nodeBlocked(src.node)) continue;
      if (src.ms < gScore[src.node]!) { gScore[src.node] = src.ms; heap.push(src.ms + h(src.node), src.node); }
    }
    while (heap.size > 0) {
      const u = heap.pop();
      if (closed[u]) continue;
      closed[u] = 1;
      if (u === g) break;
      for (const a of this.arcs[u]!) {
        const v = a.to;
        if (closed[v]) continue;
        if (blockers && (blockers.nodeBlocked(v) || blockers.edgeBlocked(a.edge))) continue;
        const enter = gate ? gate(u, v) : 0;
        if (enter === Infinity) continue;
        const t = this.arcMs(a, mode);
        const nd = gScore[u]! + t * (1 + costOf(v)) + enter;
        if (nd < gScore[v]!) {
          gScore[v] = nd; came[v] = u; cameArc[v] = a;
          heap.push(nd + h(v), v);
        }
      }
    }
    if (!closed[g]) return null;
    const nodes: number[] = [], arcs: Array<Arc | null> = [];
    for (let u = g; u !== -1; u = came[u]!) { nodes.push(u); arcs.push(cameArc[u]!); }
    nodes.reverse(); arcs.reverse();
    return { nodes, arcs };
  }

  /**
   * Travel time between two zones' standing points on the roadmap (ms), or null if unreachable —
   * the number the tactical layer plans with. `noTransitZones` (spawns) may be the start or the goal and
   * are otherwise passed through only when there is no other floor to walk, as for a mover. Cached per (from, to, mode).
   */
  zoneTravelMs(fromZone: string, toZone: string, mode: MovementMode = "run", noTransitZones?: ReadonlySet<string>): number | null {
    const s = this.anchors.get(fromZone), g = this.anchors.get(toZone);
    if (s === undefined || g === undefined) return null;
    if (s === g) return 0;
    const forbid = noTransitZones && noTransitZones.size > 0 ? noTransitZones : null;
    const key = `${s}|${g}|${mode}|${forbid ? 1 : 0}`;
    const hit = this.pairCache.get(key);
    if (hit !== undefined) return hit < 0 ? null : hit;
    const startZone = this.zoneIdx[s]!, goalZone = this.zoneIdx[g]!;
    const gate: ZoneGate | null = forbid
      ? (fromNode, toNode) => {
          const zi = this.zoneIdx[toNode]!;
          if (zi === this.zoneIdx[fromNode]! || zi === goalZone || zi === startZone) return 0;
          return forbid.has(this.zones[zi]!) ? NO_TRANSIT_MS : 0;
        }
      : null;
    const path = this.search([{ node: s, ms: 0 }], g, mode, null, () => 0, gate, true);
    let ms = -1;
    if (path) {
      ms = 0;
      for (let i = 1; i < path.nodes.length; i++) ms += this.arcMs(path.arcs[i]!, mode);
    }
    this.pairCache.set(key, ms);
    return ms < 0 ? null : ms;
  }

  /** Is this node still usable under the blockers (for revalidating a path in progress)? */
  nodeOpen(n: number, blockers?: NavBlockers): boolean {
    return !blockers || !blockers.nodeBlocked(n);
  }
}

/** Binary min-heap of (priority, node); ties broken by node index for determinism. */
class MinHeap {
  private readonly pr: number[] = [];
  private readonly id: number[] = [];
  get size(): number { return this.pr.length; }
  private less(i: number, j: number): boolean {
    return this.pr[i]! < this.pr[j]! || (this.pr[i]! === this.pr[j]! && this.id[i]! < this.id[j]!);
  }
  private swap(i: number, j: number): void {
    const p = this.pr[i]!, n = this.id[i]!;
    this.pr[i] = this.pr[j]!; this.id[i] = this.id[j]!;
    this.pr[j] = p; this.id[j] = n;
  }
  push(priority: number, node: number): void {
    this.pr.push(priority); this.id.push(node);
    let i = this.pr.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent); i = parent;
    }
  }
  pop(): number {
    const top = this.id[0]!;
    const lp = this.pr.pop()!, li = this.id.pop()!;
    if (this.pr.length > 0) {
      this.pr[0] = lp; this.id[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.pr.length && this.less(l, m)) m = l;
        if (r < this.pr.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
}
