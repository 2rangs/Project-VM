/**
 * Local movement execution (navigation layer C).
 *
 * The tactical layer only issues GOALS ("go to this zone, run/walk, this route preference").
 * This executor is the only code that changes a player's position: it asks the map's Navigator
 * for a geometric path on the roadmap, gives the player its own spot and its own lane, and then
 * walks the player along the waypoints with a continuous position every tick.
 *
 *  - no straight-line fallback and no teleport: if there is no path the player stays where it is
 *    and the failure is reported (`failureOf`), so the decision layer can choose another goal;
 *  - no tunnelling: a tick's movement is consumed waypoint by waypoint along validated segments;
 *  - movement blockers: when they change, the rest of the path is revalidated and replanned;
 *  - a player's zone is derived from where it is: the zone of the nearer end of the roadmap
 *    segment it is on.
 */
import { NavBlockers, type NavWaypoint, type NavigationResult, type Navigator, type RoutePreference, type SpatialEngine } from "@pv/spatial-engine";
import type { MoveMode } from "./policy-contract.js";
import type { SimPlayer } from "./types.js";

/** VALORANT agents are ~0.7 m wide; used for lanes and yielding (manual-approx). */
export const PLAYER_RADIUS_UNITS = 35;
/** A lane never strays further than this from the roadmap segment (uu). */
const MAX_LANE_OFFSET = 110;
/** Gap kept between a body and the corridor's edge (uu). */
const WALL_MARGIN = 10;
/**
 * Floor outside the strategic route's zones costs this much more time, so the path keeps to the
 * lanes the route planner chose rather than clipping a neighbouring zone's corner.
 */
const OFF_ROUTE_PENALTY = 0.6;
/** Zone-graph cost (ms) per unit of belief-supplied zone cost, per preference. */
const ZONE_COST_MS: Record<RoutePreference, number> = { FASTEST: 0, TACTICAL: 2500, SAFEST: 7000, STEALTH: 7000 };
/** A mover yields to a body this close ahead of it (uu). */
const YIELD_DISTANCE = 2 * PLAYER_RADIUS_UNITS * 0.85;
/** ...but not for longer than this many consecutive ticks (then it squeezes past). */
const MAX_YIELD_TICKS = 6;
/**
 * A mover follows the body it is queued behind for as long as that body is getting somewhere.
 * Queued this many consecutive ticks without advancing at all, the line is not moving for a
 * reason that is not this mover's (3 s — longer than a stack-up's wait): it squeezes past.
 */
const MAX_QUEUE_TICKS = 30;

/**
 * What the player will do where it stops — which decides the standing spot it takes in the goal zone.
 *  - "stand" (the default): a free spot near the zone's anchor.
 *  - "hold": a covered angle — a spot that sees the zone it is there to watch and that the rest
 *    of the map sees least, as near as possible to where its route enters the zone.
 *  - "plant": a spot on the zone's plant area, scored like a held angle but with nothing to watch:
 *    the less the rest of the map sees it and the nearer it is to where the route enters the zone,
 *    the better. The carrier plants behind what cover the plant area has, not on the callout.
 *  - "at": as near a point as the floor allows (the planted spike, for the defuser).
 *  - "see": a spot from which the thing being watched is visible — a zone (a defender holding the
 *    way in: the spot nearest to where it stands, or to the zone's anchor, that sees that zone) or
 *    a point (an attacker guarding the planted spike: of the spots that see the spike, the one the
 *    rest of the map sees least, then the nearest). A body that already stands on such a spot does
 *    not move. Where the zone has no spot that sees it, the player stands as usual.
 */
export type SpotIntent =
  | { readonly kind: "stand" }
  | { readonly kind: "hold"; readonly watchZone: string }
  | { readonly kind: "plant" }
  | { readonly kind: "at"; readonly position: { readonly x: number; readonly y: number; readonly z: number } }
  | { readonly kind: "see"; readonly zone: string }
  | { readonly kind: "see"; readonly point: { readonly x: number; readonly y: number; readonly z: number } };

/** A body this close (uu) to an "at" spot's point already stands at it. */
const AT_SPOT_TOLERANCE_UNITS = 100;

/** Share of a spot's score that is the player's own preference (so teammates spread out the same way every time). */
const SPOT_JITTER = 0.25;

export interface MoveGoal {
  readonly zoneId: string;
  readonly mode: MoveMode;
  /** What the stop is for (default "stand"). */
  readonly spot?: SpotIntent;
  readonly preference?: RoutePreference;
  /** Belief-based extra cost per zone (never true enemy positions). */
  readonly zoneCost?: (zoneId: string) => number;
  /** One-off cost (ms) of entering a zone: a hazard that can be waited out. */
  readonly zoneEntryMs?: (zoneId: string) => number;
  /** Passable hazards on the floor (fire, slow field): entering the disc costs `costMs` once. */
  readonly hazards?: ReadonlyArray<{ center: { x: number; y: number; z: number }; radius: number; costMs: number }>;
}

export interface MoverHooks {
  /** May the mover step into `toZone` now? false = it stays this tick (it waits, or was re-routed). */
  canEnterZone?(p: SimPlayer, toZone: string): boolean;
  /** May the mover take this tick's step to `next`? false = it stays this tick (it waits, or was re-routed). */
  canStep?(p: SimPlayer, next: { x: number; y: number; z: number }): boolean;
  onZoneChange?(p: SimPlayer, fromZone: string, toZone: string): void;
  onArrive?(p: SimPlayer): void;
  onNavEvent?(e: NavEvent): void;
  /** The mover came down a one-way drop of this height (uu) and landed at `at`. */
  onLanding?(p: SimPlayer, heightUnits: number, at: { x: number; y: number; z: number }): void;
}

export interface NavEvent {
  readonly kind: "planned" | "replanned" | "blocked" | "unreachable";
  readonly playerId: string;
  readonly goalZone: string;
  readonly reason?: string;
  readonly pathLength?: number;
  readonly estimatedTravelMs?: number;
  readonly preference?: RoutePreference;
  /** Where the player stood when the path was planned or refused. */
  readonly from?: { x: number; y: number; z: number };
  /** The planned path, as the points the player will walk through (its own lane applied). */
  readonly waypoints?: ReadonlyArray<{ x: number; y: number; z: number }>;
  /** The strategic route: the zones the path was asked to follow, current zone first. */
  readonly zones?: readonly string[];
  /** Zones the planner was told to avoid, with their cost (the team's belief), heaviest first. */
  readonly avoided?: ReadonlyArray<{ zoneId: string; cost: number }>;
  /** Ground patches (fire, slow) priced into the plan. */
  readonly hazards?: ReadonlyArray<{ x: number; y: number; z: number; radius: number }>;
}

interface Mover {
  goal: MoveGoal | null;
  /** Roadmap node the player is heading for (its own spot in the goal zone), or -1. */
  spot: number;
  /** What `spot` was chosen for (zone + intent): the same request keeps the same spot. */
  spotKey: string;
  /** Roadmap node the player stands on when not moving, or -1 if between nodes. */
  atNode: number;
  waypoints: NavWaypoint[];
  index: number;
  /** Index into p.path of the zone the player is in. */
  zoneCursor: number;
  blockersVersion: number;
  linkElapsedMs: number;
  failure: string | null;
  yieldTicks: number;
  /** Consecutive ticks spent queued behind another mover without advancing. */
  queueTicks: number;
  /** Ticks left during which the mover does not yield (it just gave way for long enough). */
  pushTicks: number;
  lane: number;
  /** Zone the entry gate was last passed for (so the hook is asked once per boundary). */
  gatePassed: string | null;
  /** Zones of the strategic route in force; the player's zone is always one of them. null = no route. */
  corridor: Set<string> | null;
  /** Unit heading of the last step taken, and the tick-count it was taken on (to tell a mover that is advancing from one that waits). */
  dirX: number;
  dirY: number;
  advanced: boolean;
}

const LANES = [0, -0.7, 0.7, -0.35, 0.35];

/** The identity of a spot request: the zone and what the stop is for. */
function spotKey(goal: MoveGoal): string {
  const k = goal.spot;
  if (!k || k.kind === "stand") return `${goal.zoneId}|stand`;
  if (k.kind === "plant") return `${goal.zoneId}|plant`;
  if (k.kind === "hold") return `${goal.zoneId}|hold|${k.watchZone}`;
  if (k.kind === "see") return "zone" in k ? `${goal.zoneId}|see|${k.zone}` : `${goal.zoneId}|see|${Math.round(k.point.x)},${Math.round(k.point.y)},${Math.round(k.point.z)}`;
  return `${goal.zoneId}|at|${Math.round(k.position.x)},${Math.round(k.position.y)},${Math.round(k.position.z)}`;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

export class MovementExecutor {
  readonly nav: Navigator;
  readonly blockers: NavBlockers;
  private readonly movers = new Map<string, Mover>();
  /** zone → (node → player id) so two players never share a standing spot. */
  private readonly claims = new Map<number, string>();
  private readonly noTransit: ReadonlySet<string>;
  /** blocker id → the zone it seals (zone blockers only), for the strategic route. */
  private readonly zoneOfBlocker = new Map<string, string>();
  private readonly speeds: { run: number; walk: number }; // uu per ms
  /**
   * Crowd counters for the round (report-only, never read by the simulation): mover-ticks spent
   * queued behind a mover / giving way to a body, and how often a mover gave up waiting and
   * squeezed past (the body-overlap cases). Reset with the executor's `reset`.
   */
  readonly crowd = { queueTicks: 0, queuePushes: 0, yieldTicks: 0, yieldPushes: 0 };

  constructor(private readonly spatial: SpatialEngine, speeds: { runUnitsPerSec: number; walkUnitsPerSec: number }) {
    if (!spatial.nav) throw new Error(`MovementExecutor: map "${spatial.mapId}" has no navigation roadmap (<map>.nav.json) loaded`);
    this.nav = spatial.nav;
    this.blockers = new NavBlockers(this.nav);
    this.noTransit = new Set(spatial.zones.filter((z) => z.transit === false).map((z) => z.id));
    this.speeds = { run: speeds.runUnitsPerSec / 1000, walk: speeds.walkUnitsPerSec / 1000 };
  }

  /** Seal a whole zone's floor / a disc of floor against bodies. */
  addZoneBlocker(id: string, zoneId: string): void {
    this.blockers.addZone(id, zoneId);
    this.zoneOfBlocker.set(id, zoneId);
  }
  addDiscBlocker(id: string, center: { x: number; y: number; z: number }, radius: number): void {
    this.blockers.addDisc(id, center, radius);
  }
  removeBlocker(id: string): void {
    this.blockers.remove(id);
    this.zoneOfBlocker.delete(id);
  }

  /** Put every player on its own standing spot in its starting zone. */
  reset(players: readonly SimPlayer[]): void {
    this.movers.clear();
    this.claims.clear();
    this.crowd.queueTicks = 0; this.crowd.queuePushes = 0; this.crowd.yieldTicks = 0; this.crowd.yieldPushes = 0;
    const perTeam = new Map<string, number>();
    for (const p of players) {
      const slot = perTeam.get(p.teamId) ?? 0;
      perTeam.set(p.teamId, slot + 1);
      const m: Mover = {
        goal: null, spot: -1, spotKey: "", atNode: -1, waypoints: [], index: 0, zoneCursor: 0, blockersVersion: this.blockers.version,
        linkElapsedMs: 0, failure: null, yieldTicks: 0, queueTicks: 0, pushTicks: 0, lane: LANES[slot % LANES.length]!, gatePassed: null, corridor: null, dirX: 0, dirY: 0, advanced: false,
      };
      this.movers.set(p.id, m);
      const zone = this.spatial.getZone(p.zoneId);
      // a player set down on its zone's callout takes a free standing spot of that zone; one
      // placed somewhere else by the scenario stays there if that is on the roadmap
      const onCallout = !!zone && p.position.x === zone.position.x && p.position.y === zone.position.y;
      const node = onCallout ? this.pickSpot(p.id, p.zoneId) : this.nav.locate(p.position) ?? this.pickSpot(p.id, p.zoneId);
      if (node >= 0) {
        if (onCallout || this.nav.locate(p.position) === null) p.position = this.nav.nodePosition(node);
        m.atNode = node;
        this.claim(p.id, node);
      }
    }
  }

  /**
   * A dead body holds no standing spot: its claim is released, so the living can stand there —
   * the defuser on the spot the planter planted from, a teammate on a fallen anchor's angle.
   */
  releaseDead(players: readonly SimPlayer[]): void {
    if (this.claims.size === 0) return;
    for (const p of players) {
      if (p.alive) continue;
      for (const [n, id] of this.claims) if (id === p.id) this.claims.delete(n);
    }
  }

  private claim(playerId: string, node: number): void {
    for (const [n, id] of this.claims) if (id === playerId) this.claims.delete(n);
    if (node >= 0) this.claims.set(node, playerId);
  }

  /**
   * A standing spot for this player in a zone: a roadmap node of that zone that nobody else has
   * claimed, chosen by what the stop is for (SpotIntent). Every choice carries the player's own
   * fixed preference, so teammates spread out the same way every time. -1 if the zone has no
   * standable node.
   *
   * "hold" and "plant" score each candidate by how far it is from `from` (where the player's
   * route enters the zone) and by how much of the rest of the map can see it — each as a share
   * of the worst value among the candidates, equally weighted. Without measured line of sight the
   * node's wall clearance stands in for exposure (open floor is exposed, a wall is cover).
   */
  pickSpot(playerId: string, zoneId: string, opts: { from?: { x: number; y: number; z: number }; intent?: SpotIntent } = {}): number {
    const anchor = this.nav.anchorNode(zoneId);
    if (anchor === undefined) return -1;
    const a = this.nav.nodePosition(anchor);
    const intent = opts.intent ?? { kind: "stand" };
    let pool: number[] = [];
    for (const n of this.nav.zoneNodes(zoneId)) {
      const holder = this.claims.get(n);
      if (holder !== undefined && holder !== playerId) continue;
      if (this.blockers.nodeBlocked(n)) continue;
      if (Math.abs(this.nav.nodePosition(n).z - a.z) > 160) continue; // same floor as the zone's anchor
      pool.push(n);
    }
    if (pool.length === 0) return -1;
    const pick = (score: (n: number) => number): number => {
      let best = -1, bestScore = Infinity;
      for (const n of pool) {
        const sc = score(n);
        if (sc < bestScore || (sc === bestScore && n < best)) { bestScore = sc; best = n; }
      }
      return best;
    };
    const flat = (n: number, to: { x: number; y: number }): number => { const q = this.nav.nodePosition(n); return Math.hypot(q.x - to.x, q.y - to.y); };
    if (intent.kind === "stand") return pick((n) => flat(n, a) + 350 * hash01(`${playerId}|${n}`));
    if (intent.kind === "at") {
      const t = intent.position;
      return pick((n) => { const q = this.nav.nodePosition(n); return Math.hypot(q.x - t.x, q.y - t.y, q.z - t.z); });
    }
    if (intent.kind === "see") {
      const seeing = pool.filter((n) => this.nodeSees(n, intent));
      if (seeing.length === 0) return pick((n) => flat(n, a) + 350 * hash01(`${playerId}|${n}`)); // nothing sees it from here: stand
      pool = seeing;
      const ref = opts.from ?? a;
      if ("zone" in intent) return pick((n) => flat(n, ref) + 350 * hash01(`${playerId}|${n}`));
      // a point (the spike): least seen by the rest of the map first, then nearest
      let maxD = 1, maxE = 1;
      for (const n of pool) { maxD = Math.max(maxD, flat(n, ref)); maxE = Math.max(maxE, this.nav.exposure(n)); }
      return pick((n) => this.nav.exposure(n) / maxE + flat(n, ref) / maxD + SPOT_JITTER * hash01(`${playerId}|${n}`));
    }
    let watch: string | undefined;
    if (intent.kind === "plant") {
      const onArea = pool.filter((n) => this.spatial.plantZoneAt(this.nav.nodePosition(n))?.zoneId === zoneId);
      if (onArea.length > 0) pool = onArea;
    } else {
      // a held angle sees what it watches: only spots with line of sight into the watched zone
      watch = intent.watchZone;
      const seeing = this.nav.hasVisibility ? pool.filter((n) => this.nav.sightInto(n, watch!) > 0) : [];
      if (seeing.length === 0) return pick((n) => flat(n, a) + 350 * hash01(`${playerId}|${n}`)); // nothing to hold from: stand
      pool = seeing;
    }
    const ref = opts.from ?? a;
    const exposureOf = (n: number): number => (this.nav.hasVisibility ? this.nav.exposure(n, watch) : this.nav.nodeClearance(n));
    let maxD = 1, maxE = 1;
    for (const n of pool) { maxD = Math.max(maxD, flat(n, ref)); maxE = Math.max(maxE, exposureOf(n)); }
    return pick((n) => flat(n, ref) / maxD + exposureOf(n) / maxE + SPOT_JITTER * hash01(`${playerId}|${n}`));
  }

  /** Can a body on this roadmap node see what the intent watches? (Always true without measured sight.) */
  private nodeSees(n: number, intent: Extract<SpotIntent, { kind: "see" }>): boolean {
    if (!this.nav.hasVisibility) return true;
    if ("zone" in intent) return this.nav.sightInto(n, intent.zone) > 0;
    const target = this.nav.locate(intent.point);
    return target === null || n === target || this.nav.nodesVisible(n, target);
  }

  /** Does this standing player already see what the intent watches from its spot? Movers: not yet decided (true). */
  seesFromSpot(p: SimPlayer, intent: Extract<SpotIntent, { kind: "see" }>): boolean {
    const m = this.movers.get(p.id);
    if (!m || m.index < m.waypoints.length) return true;
    const node = m.atNode >= 0 ? m.atNode : this.nav.locate(p.position);
    return node === null || node < 0 || this.nodeSees(node, intent);
  }

  /** Is there a spot in the zone, free for this player, that sees what the intent watches? */
  hasSpotThatSees(playerId: string, zoneId: string, intent: Extract<SpotIntent, { kind: "see" }>): boolean {
    return this.nav.zoneNodes(zoneId).some((n) => {
      const holder = this.claims.get(n);
      return (holder === undefined || holder === playerId) && !this.blockers.nodeBlocked(n) && this.nodeSees(n, intent);
    });
  }

  isMoving(p: SimPlayer): boolean {
    const m = this.movers.get(p.id);
    return !!m && m.index < m.waypoints.length;
  }
  goalOf(p: SimPlayer): string | null { return this.movers.get(p.id)?.goal?.zoneId ?? null; }
  /** Why the last navigation request of this player failed, if it did (cleared on success). */
  failureOf(p: SimPlayer): string | null { return this.movers.get(p.id)?.failure ?? null; }
  /** The waypoints still ahead of the player (debug views). */
  remainingWaypoints(p: SimPlayer): readonly NavWaypoint[] {
    const m = this.movers.get(p.id);
    return m ? m.waypoints.slice(m.index) : [];
  }
  /** Path length still to walk (uu). */
  remainingLength(p: SimPlayer): number {
    const m = this.movers.get(p.id);
    if (!m) return 0;
    let d = 0, prev = p.position;
    for (let i = m.index; i < m.waypoints.length; i++) {
      const w = m.waypoints[i]!.position;
      d += Math.hypot(w.x - prev.x, w.y - prev.y, w.z - prev.z);
      prev = w;
    }
    return d;
  }
  /** Time until the player enters the next zone on its route at its current speed (ms), or null. */
  msToNextZone(p: SimPlayer): number | null {
    const m = this.movers.get(p.id);
    if (!m || m.index >= m.waypoints.length) return null;
    const speed = p.moveMode === "run" ? this.speeds.run : this.speeds.walk;
    let ms = 0, prev = p.position;
    for (let i = m.index; i < m.waypoints.length; i++) {
      const w = m.waypoints[i]!;
      const d = Math.hypot(w.position.x - prev.x, w.position.y - prev.y, w.position.z - prev.z);
      if (this.eff(m, w) !== null && w.zoneId !== p.zoneId) return ms + (w.fixedMs ?? d / speed) / 2; // the zone changes about half-way along the segment
      ms += w.fixedMs ?? d / speed;
      prev = w.position;
    }
    return ms;
  }

  /** A waypoint's zone as far as the mover's own zone goes: only zones of its strategic route count. */
  private eff(m: Mover, w: NavWaypoint): string | null {
    return !m.corridor || m.corridor.has(w.zoneId) ? w.zoneId : null;
  }

  /**
   * Strategic route (navigation layer A): the zones to pass, chosen on the zone graph by travel
   * time plus what the team BELIEVES about each zone (zoneCost, weighted by the preference) and
   * minus zones sealed by a movement blocker. null when the zone graph offers none.
   */
  private strategicRoute(p: SimPlayer, goal: MoveGoal): string[] | null {
    const pref = goal.preference ?? "FASTEST";
    const hazardCosts = new Map<string, number>();
    const w = ZONE_COST_MS[pref];
    if (w > 0 && goal.zoneCost) for (const z of this.spatial.zones) {
      const c = goal.zoneCost(z.id);
      if (c > 0) hazardCosts.set(z.id, c * w);
    }
    const blockedZones = this.blockers.ids().map((id) => this.zoneOfBlocker.get(id)).filter((z): z is string => !!z);
    const r = this.spatial.findPath(p.zoneId, goal.zoneId, pref === "STEALTH" ? "walk" : goal.mode, { hazardCosts, blockedZones });
    return r ? r.path : null;
  }

  /** Forget a player's route (it was displaced by an ability, or stopped). */
  stop(p: SimPlayer, atNode?: number): void {
    const m = this.movers.get(p.id);
    if (!m) return;
    m.goal = null; m.waypoints = []; m.index = 0; m.spot = -1; m.failure = null; m.linkElapsedMs = 0; m.gatePassed = null; m.corridor = null;
    p.path = []; p.pathIndex = 0; p.edgeProgressMs = 0;
    const node = atNode ?? this.nav.locate(p.position) ?? -1;
    m.atNode = node;
    this.claim(p.id, node);
  }

  /** Displace a player to a standing spot of a zone (a movement ability). */
  placeInZone(p: SimPlayer, zoneId: string): boolean {
    const node = this.pickSpot(p.id, zoneId);
    if (node < 0) return false;
    p.zoneId = zoneId;
    p.position = this.nav.nodePosition(node);
    this.stop(p, node);
    return true;
  }

  /**
   * Give a player a goal. Plans (or re-plans) only when the goal changed; returns the result of
   * the plan in force. UNREACHABLE / INVALID_* leave the player exactly where it is.
   */
  setGoal(p: SimPlayer, goal: MoveGoal, hooks?: MoverHooks): NavigationResult["status"] {
    const m = this.movers.get(p.id);
    if (!m) return "INVALID_START";
    p.moveMode = goal.mode;
    const same = m.goal && m.goal.zoneId === goal.zoneId && (m.goal.preference ?? "FASTEST") === (goal.preference ?? "FASTEST") && spotKey(m.goal) === spotKey(goal);
    if (same) {
      m.goal = goal; // refresh the cost callbacks
      if (m.index < m.waypoints.length) return "SUCCESS";
      if (m.failure) return m.blockersVersion === this.blockers.version ? "UNREACHABLE" : this.plan(p, m, "replanned", hooks);
      if (p.zoneId === goal.zoneId) return "SUCCESS"; // already standing there
    }
    m.goal = goal;
    // Standing in the goal zone already keeps the spot — unless it does not serve the new intent:
    // a "see" spot that does not see, a plant spot off the zone's plant area, an "at" spot away
    // from its point.
    const sp = goal.spot;
    const respot = sp?.kind === "see" ? !this.seesFromSpot(p, sp)
      : sp?.kind === "plant" ? this.spatial.plantZoneAt(p.position)?.zoneId !== goal.zoneId && this.zoneHasPlantArea(goal.zoneId)
      : sp?.kind === "at" ? Math.hypot(p.position.x - sp.position.x, p.position.y - sp.position.y) > AT_SPOT_TOLERANCE_UNITS
      : false;
    if (!respot && p.zoneId === goal.zoneId && m.index >= m.waypoints.length && m.atNode >= 0) {
      // already standing in the goal zone: stay on the spot it holds
      m.failure = null;
      p.path = [p.zoneId]; p.pathIndex = 1;
      return "SUCCESS";
    }
    return this.plan(p, m, "planned", hooks);
  }

  /** Whether any floor of the zone lies on a plant polygon (a map may draw none). */
  private zoneHasPlantArea(zoneId: string): boolean {
    let v = this.plantAreaZones.get(zoneId);
    if (v === undefined) {
      const z = this.spatial.getZone(zoneId);
      v = !!z && (this.spatial.plantZoneAt(z.position) !== null || this.spatial.plantZoneAt(this.spatial.standPosition(zoneId)) !== null);
      this.plantAreaZones.set(zoneId, v);
    }
    return v;
  }
  private readonly plantAreaZones = new Map<string, boolean>();

  private startNodes(m: Mover): number[] {
    if (m.index < m.waypoints.length) {
      const prev = m.index > 0 ? m.waypoints[m.index - 1]! : null;
      const next = m.waypoints[m.index]!;
      // on a one-way segment (drop / link) the only way is on
      if (next.via !== "walk") return next.node >= 0 ? [next.node] : [];
      const out: number[] = [];
      if (next.node >= 0) out.push(next.node);
      if (prev && prev.node >= 0 && prev.node !== next.node) out.push(prev.node);
      if (out.length > 0) return out;
    }
    return m.atNode >= 0 ? [m.atNode] : [];
  }

  /**
   * The spot this player goes to for a goal. The same request keeps the spot it already has (a
   * replan on the way must not send it somewhere else); otherwise the spot is chosen from where
   * its route enters the goal zone — the first point of the path to the zone that lies in it.
   */
  private spotFor(p: SimPlayer, m: Mover, goal: MoveGoal, corridor: ReadonlySet<string> | null): number {
    const key = spotKey(goal);
    if (m.spot >= 0 && m.spotKey === key && !this.blockers.nodeBlocked(m.spot)) {
      const holder = this.claims.get(m.spot);
      if (holder === undefined || holder === p.id) return m.spot;
    }
    const intent = goal.spot ?? { kind: "stand" as const };
    if (intent.kind === "at" || intent.kind === "stand") return this.pickSpot(p.id, goal.zoneId, { intent });
    if (intent.kind === "see" && p.zoneId === goal.zoneId) return this.pickSpot(p.id, goal.zoneId, { from: p.position, intent });
    let from: { x: number; y: number; z: number } = p.position;
    const anchor = this.nav.anchorNode(goal.zoneId);
    if (p.zoneId !== goal.zoneId && anchor !== undefined) {
      const r = this.nav.findPath({
        ...(corridor ? { corridor: { zones: corridor, penalty: OFF_ROUTE_PENALTY } } : {}),
        actorId: p.id, start: p.position, destination: this.nav.nodePosition(anchor), movementMode: goal.mode,
        routePreference: goal.preference ?? "FASTEST", blockers: this.blockers, noTransitZones: this.noTransit,
        startNodes: this.startNodes(m),
        ...(goal.zoneCost ? { zoneCost: goal.zoneCost } : {}),
      });
      if (r.status === "SUCCESS") {
        const entry = r.waypoints.find((w) => w.node >= 0 && w.zoneId === goal.zoneId);
        if (entry) from = entry.position;
      }
    }
    return this.pickSpot(p.id, goal.zoneId, { from, intent });
  }

  private plan(p: SimPlayer, m: Mover, kind: "planned" | "replanned", hooks?: MoverHooks): NavigationResult["status"] {
    const goal = m.goal!;
    m.blockersVersion = this.blockers.version;
    const route = this.strategicRoute(p, goal);
    const corridor = route ? new Set(route) : null;
    const spot = this.spotFor(p, m, goal, corridor);
    if (spot < 0) return this.fail(p, m, "UNREACHABLE", `zone ${goal.zoneId} has no walkable standing spot`, hooks);
    const r = this.nav.findPath({
      ...(corridor ? { corridor: { zones: corridor, penalty: OFF_ROUTE_PENALTY } } : {}),
      actorId: p.id, start: p.position, destination: this.nav.nodePosition(spot), movementMode: goal.mode,
      routePreference: goal.preference ?? "FASTEST", blockers: this.blockers, noTransitZones: this.noTransit,
      startNodes: this.startNodes(m),
      ...(goal.zoneCost ? { zoneCost: goal.zoneCost } : {}), ...(goal.zoneEntryMs ? { zoneEntryMs: goal.zoneEntryMs } : {}),
      ...(goal.hazards && goal.hazards.length > 0 ? { hazards: goal.hazards } : {}),
    });
    if (r.status !== "SUCCESS") return this.fail(p, m, r.status, r.reason, hooks);
    m.failure = null;
    m.spot = spot;
    m.spotKey = spotKey(goal);
    this.claim(p.id, spot);
    m.atNode = -1;
    // a body held in or carried by a timed link (teleporter, rope) stays on that link: the new path
    // starts at the link's far end, so the link itself is kept with the time already spent on it —
    // otherwise the rest of the link would become a straight walk through whatever lies between
    const riding = m.index > 0 && m.index < m.waypoints.length && m.waypoints[m.index]!.fixedMs !== undefined
      ? { from: m.waypoints[m.index - 1]!, link: m.waypoints[m.index]!, elapsedMs: m.linkElapsedMs } : null;
    const planned = this.withLane(r.waypoints, m.lane);
    const rejoin = riding ? planned.findIndex((w) => w.node >= 0 && w.node === riding.link.node) : -1;
    if (riding && rejoin >= 0) {
      m.waypoints = [riding.from, riding.link, ...planned.slice(rejoin + 1)];
      m.linkElapsedMs = riding.elapsedMs;
    } else {
      m.waypoints = planned;
      m.linkElapsedMs = 0;
    }
    m.index = 1; // waypoint 0 is where the player stands
    m.gatePassed = null;
    m.yieldTicks = 0;
    m.queueTicks = 0;
    // the strategic route is the player's path of zones (current zone first); where the zone
    // graph offers none, the zones the geometric path itself passes
    m.corridor = corridor;
    p.path = route ?? (r.zones[0] === p.zoneId ? [...r.zones] : [p.zoneId, ...r.zones]);
    m.zoneCursor = 0;
    p.pathIndex = Math.min(1, p.path.length - 1);
    p.edgeProgressMs = 0;
    if (m.waypoints.length <= 1) this.arrive(p, m, hooks);
    if (hooks?.onNavEvent) {
      const round = (v: { x: number; y: number; z: number }) => ({ x: Math.round(v.x), y: Math.round(v.y), z: Math.round(v.z) });
      const avoided = goal.zoneCost && (goal.preference ?? "FASTEST") !== "FASTEST"
        ? this.spatial.zones.map((z) => ({ zoneId: z.id, cost: goal.zoneCost!(z.id) })).filter((z) => z.cost > 0).sort((a, b) => b.cost - a.cost || (a.zoneId < b.zoneId ? -1 : 1))
        : [];
      hooks.onNavEvent({
        kind, playerId: p.id, goalZone: goal.zoneId, pathLength: r.pathLength, estimatedTravelMs: r.estimatedTravelMs,
        preference: goal.preference ?? "FASTEST",
        from: round(m.waypoints[0]?.position ?? p.position),
        waypoints: m.waypoints.map((w) => round(w.position)),
        zones: [...p.path],
        ...(avoided.length > 0 ? { avoided } : {}),
        ...(goal.hazards && goal.hazards.length > 0 ? { hazards: goal.hazards.map((h) => ({ ...round(h.center), radius: Math.round(h.radius) })) } : {}),
      });
    }
    return "SUCCESS";
  }

  private fail(p: SimPlayer, m: Mover, status: Exclude<NavigationResult["status"], "SUCCESS">, reason: string, hooks?: MoverHooks): NavigationResult["status"] {
    // the player stays exactly where it is — no straight line, no teleport
    const moving = m.index < m.waypoints.length;
    m.failure = reason;
    m.waypoints = []; m.index = 0; m.spot = -1;
    p.path = []; p.pathIndex = 0; p.edgeProgressMs = 0;
    if (moving || m.atNode < 0) {
      const node = this.nav.locate(p.position) ?? -1;
      m.atNode = node;
      this.claim(p.id, node);
    }
    hooks?.onNavEvent?.({
      kind: this.blockers.empty ? "unreachable" : "blocked", playerId: p.id, goalZone: m.goal?.zoneId ?? "", reason: `${status}: ${reason}`,
      preference: m.goal?.preference ?? "FASTEST",
      from: { x: Math.round(p.position.x), y: Math.round(p.position.y), z: Math.round(p.position.z) },
    });
    return status;
  }

  /**
   * Shift the roadmap waypoints sideways onto this player's lane, inside the corridor: never
   * further from the roadmap segment than the segment's half-width allows a body of this radius.
   */
  private withLane(wps: readonly NavWaypoint[], lane: number): NavWaypoint[] {
    const out = wps.map((w) => ({ ...w, position: { ...w.position } }));
    if (lane === 0) return out;
    for (let i = 1; i < out.length - 1; i++) {
      const w = wps[i]!, next = wps[i + 1]!, prev = wps[i - 1]!;
      if (w.node < 0 || w.via !== "walk" || next.via !== "walk") continue;
      if (i === out.length - 2 && next.node < 0) continue;
      const room = Math.min(w.halfWidth, next.halfWidth, this.nav.nodeClearance(w.node)) - PLAYER_RADIUS_UNITS - WALL_MARGIN;
      if (room <= 0) continue;
      let dx = (w.position.x - prev.position.x), dy = (w.position.y - prev.position.y);
      const l1 = Math.hypot(dx, dy) || 1;
      let ex = (next.position.x - w.position.x), ey = (next.position.y - w.position.y);
      const l2 = Math.hypot(ex, ey) || 1;
      dx = dx / l1 + ex / l2; dy = dy / l1 + ey / l2;
      const l = Math.hypot(dx, dy);
      if (l < 1e-6) continue;
      const shift = lane * Math.min(room, MAX_LANE_OFFSET);
      out[i]!.position.x += (-dy / l) * shift;
      out[i]!.position.y += (dx / l) * shift;
    }
    // the last roadmap node before the spot is left unshifted so the final approach is exact
    return out;
  }

  private arrive(p: SimPlayer, m: Mover, hooks?: MoverHooks): void {
    m.atNode = m.spot;
    m.waypoints = []; m.index = 0; m.linkElapsedMs = 0; m.gatePassed = null;
    p.pathIndex = p.path.length;
    p.edgeProgressMs = 0;
    hooks?.onArrive?.(p);
  }

  /** Plan again from where the player is (same goal) — used when the ground ahead changed. */
  replan(p: SimPlayer, hooks?: MoverHooks): NavigationResult["status"] {
    const m = this.movers.get(p.id);
    if (!m || !m.goal) return "INVALID_TARGET";
    return this.plan(p, m, "replanned", hooks);
  }

  /** The next zone on the player's route that is not the one it is in, or null. */
  nextZoneOf(p: SimPlayer): string | null {
    const m = this.movers.get(p.id);
    if (!m) return null;
    for (let i = m.index; i < m.waypoints.length; i++) {
      const w = m.waypoints[i]!;
      if (this.eff(m, w) !== null && w.zoneId !== p.zoneId) return w.zoneId;
    }
    return null;
  }

  /** Revalidate the route against the blockers in force; replan if it is cut. */
  private revalidate(p: SimPlayer, m: Mover, hooks?: MoverHooks): void {
    if (m.blockersVersion === this.blockers.version) return;
    m.blockersVersion = this.blockers.version;
    if (!m.goal) return;
    if (m.failure) { this.plan(p, m, "replanned", hooks); return; } // a blocker may have gone
    let cut = this.blockers.nodeBlocked(m.spot);
    for (let i = m.index; i < m.waypoints.length && !cut; i++) {
      const w = m.waypoints[i]!;
      if (w.node >= 0 && this.blockers.nodeBlocked(w.node)) cut = true;
      const prev = m.waypoints[i - 1];
      if (!cut && prev && prev.node >= 0 && w.node >= 0 && w.via === "walk") {
        const arc = this.nav.arcsFrom(prev.node).find((a) => a.to === w.node && a.kind === "walk");
        if (arc && this.blockers.edgeBlocked(arc.edge)) cut = true;
      }
    }
    if (cut) this.plan(p, m, "replanned", hooks);
  }

  /**
   * Advance one player by one tick. `others` are the other living players (for yielding).
   * Returns the distance moved (uu).
   */
  step(p: SimPlayer, dtMs: number, others: readonly SimPlayer[], hooks?: MoverHooks): number {
    const m = this.movers.get(p.id);
    if (!m) return 0;
    this.revalidate(p, m, hooks);
    if (m.index >= m.waypoints.length) return 0;
    // a delay owed (a slow field crossed): time passes, the body does not advance
    if (p.edgeProgressMs < 0) {
      p.edgeProgressMs = Math.min(0, p.edgeProgressMs + dtMs);
      return 0;
    }
    let budget = dtMs, moved = 0;
    const speed = p.moveMode === "run" ? this.speeds.run : this.speeds.walk;
    while (budget > 1e-9 && m.index < m.waypoints.length) {
      const w = m.waypoints[m.index]!;
      const prev = m.waypoints[m.index - 1]!;
      // zone gate: asked once, before the first step of a segment that ends in another zone
      if (this.eff(m, w) !== null && w.zoneId !== p.zoneId && m.gatePassed !== w.zoneId) {
        if (hooks?.canEnterZone && !hooks.canEnterZone(p, w.zoneId)) break;
        if (m.index >= m.waypoints.length || m.waypoints[m.index] !== w) continue; // the hook re-planned
        m.gatePassed = w.zoneId;
      }
      const dx = w.position.x - p.position.x, dy = w.position.y - p.position.y, dz = w.position.z - p.position.z;
      const d = Math.hypot(dx, dy, dz);
      if (w.fixedMs !== undefined) {
        // an authored link with its own travel time: a teleporter holds the body then moves it,
        // a zipline / rope carries it along the link
        m.linkElapsedMs += budget;
        const done = m.linkElapsedMs >= w.fixedMs;
        if (w.via !== "teleporter" || done) {
          const f = Math.min(1, m.linkElapsedMs / w.fixedMs);
          const before = { ...p.position };
          p.position = { x: prev.position.x + (w.position.x - prev.position.x) * f, y: prev.position.y + (w.position.y - prev.position.y) * f, z: prev.position.z + (w.position.z - prev.position.z) * f };
          moved += Math.hypot(p.position.x - before.x, p.position.y - before.y, p.position.z - before.z);
        }
        if (!done) { budget = 0; break; }
        budget = m.linkElapsedMs - w.fixedMs;
        m.linkElapsedMs = 0;
      } else {
        if (d > 1e-6) p.facing = this.facingFor(p, m, dx, dy);
        const stepLen = Math.min(d, speed * budget);
        // yield to a body just ahead (light separation; never for long)
        let ahead: "queue" | "standing" | null = null;
        if (m.pushTicks > 0) m.pushTicks--;
        else if (stepLen > 0) {
          ahead = this.bodyAhead(p, dx / (d || 1), dy / (d || 1), stepLen, others);
          // behind a mover going the same way (or queued at a boundary): simply follow — unless the
          // line has not moved at all for MAX_QUEUE_TICKS (then pass it, as past a standing body)
          if (ahead === "queue") {
            this.crowd.queueTicks++;
            if (++m.queueTicks < MAX_QUEUE_TICKS) break;
            m.queueTicks = 0;
            m.pushTicks = 15;
            this.crowd.queuePushes++;
          }
          // a body standing in the way: give it a moment, then squeeze past
          if (ahead === "standing") {
            this.crowd.yieldTicks++;
            if (++m.yieldTicks < MAX_YIELD_TICKS) break;
            m.pushTicks = 15;
            this.crowd.yieldPushes++;
          }
        }
        m.yieldTicks = 0;
        if (ahead !== "queue") m.queueTicks = 0;
        if (stepLen > 0 && hooks?.canStep) {
          const f = stepLen / d;
          if (!hooks.canStep(p, { x: p.position.x + dx * f, y: p.position.y + dy * f, z: p.position.z + dz * f })) break;
          if (m.index >= m.waypoints.length || m.waypoints[m.index] !== w) continue; // the hook re-planned
        }
        if (stepLen >= d) {
          p.position = { ...w.position };
          budget -= speed > 0 ? d / speed : budget;
        } else {
          const f = stepLen / d;
          p.position = { x: p.position.x + dx * f, y: p.position.y + dy * f, z: p.position.z + dz * f };
          budget = 0;
        }
        moved += stepLen;
        if (stepLen > 0) { m.dirX = dx / d; m.dirY = dy / d; }
        if (stepLen < d) { this.updateZone(p, m, prev, w, hooks); break; }
      }
      // reached waypoint w
      if (w.via === "drop" && hooks?.onLanding) hooks.onLanding(p, Math.max(0, prev.position.z - w.position.z), { ...w.position });
      this.updateZone(p, m, w, w, hooks);
      m.index++;
      if (m.index >= m.waypoints.length) { this.arrive(p, m, hooks); break; }
    }
    if (m.index < m.waypoints.length && moved > 0) p.edgeProgressMs += dtMs;
    m.advanced = moved > 0;
    return moved;
  }

  /**
   * Where a mover looks. Sight is zone-level, so a mover watches the space it is about to enter:
   * it faces the next zone of its route (as a body rounding a corner looks into the room, not
   * along its last two metres of floor). Inside its goal zone it faces the way it walks.
   */
  private facingFor(p: SimPlayer, m: Mover, dx: number, dy: number): { x: number; y: number } {
    const next = p.pathIndex < p.path.length ? p.path[p.pathIndex] : undefined;
    if (next && next !== p.zoneId) {
      const z = this.spatial.getZone(next);
      if (z) {
        const fx = z.position.x - p.position.x, fy = z.position.y - p.position.y;
        if (fx !== 0 || fy !== 0) return { x: fx, y: fy };
      }
    }
    void m;
    return { x: dx, y: dy };
  }

  /**
   * Is there a body just ahead of this mover's next step?
   *  - "queue": a mover going the same way, or one waiting (at a boundary, at fire) — follow it;
   *  - "standing": a body that is not going anywhere, or a mover coming the other way that has
   *    the right of way (lower id) — give way briefly;
   *  - null: the way is clear.
   */
  private bodyAhead(p: SimPlayer, ux: number, uy: number, stepLen: number, others: readonly SimPlayer[]): "queue" | "standing" | null {
    const nx = p.position.x + ux * stepLen, ny = p.position.y + uy * stepLen;
    let found: "queue" | "standing" | null = null;
    for (const q of others) {
      if (q.id === p.id || !q.alive) continue;
      if (Math.abs(q.position.z - p.position.z) > 120) continue;
      const ox = q.position.x - nx, oy = q.position.y - ny;
      if (ox * ox + oy * oy >= YIELD_DISTANCE * YIELD_DISTANCE) continue;
      if ((q.position.x - p.position.x) * ux + (q.position.y - p.position.y) * uy <= 0) continue; // not ahead
      const mq = this.movers.get(q.id);
      const qMoving = !!mq && mq.index < mq.waypoints.length;
      if (!qMoving) { found = found ?? "standing"; continue; }
      // Which way q WANTS to go — toward its next waypoint — not whether it advanced last tick:
      // two movers that meet head-on are both stopped, and judged by "advanced" each took the
      // other for the back of a queue and neither ever moved again.
      const wq = mq!.waypoints[mq!.index]!.position;
      const qx = wq.x - q.position.x, qy = wq.y - q.position.y;
      const ql = Math.hypot(qx, qy);
      const headOn = ql > 1e-6 ? (qx * ux + qy * uy) / ql < -0.3 : mq!.advanced && mq!.dirX * ux + mq!.dirY * uy < -0.3;
      if (headOn) { if (q.id < p.id) found = found ?? "standing"; continue; } // lower id goes first
      return "queue";
    }
    return found;
  }

  /**
   * The player's zone is the zone of the nearer end of the segment it is on — among the zones of
   * its strategic route. Floor that belongs to some other zone (a corner of a neighbouring area
   * the path clips) leaves the player in the route zone it was in.
   */
  private updateZone(p: SimPlayer, m: Mover, a: NavWaypoint, b: NavWaypoint, hooks?: MoverHooks): void {
    const zb = this.eff(m, b);
    if (zb === null) return;
    const za = this.eff(m, a) ?? p.zoneId;
    let zone = zb;
    if (a !== b && za !== zb) {
      const da = Math.hypot(p.position.x - a.position.x, p.position.y - a.position.y, p.position.z - a.position.z);
      const db = Math.hypot(p.position.x - b.position.x, p.position.y - b.position.y, p.position.z - b.position.z);
      zone = db <= da ? zb : za;
    }
    if (zone === p.zoneId) return;
    const from = p.zoneId;
    p.zoneId = zone;
    // keep the strategic path in step: the cursor moves to this zone's next occurrence
    const at = p.path.indexOf(zone, m.zoneCursor + 1);
    if (at >= 0) m.zoneCursor = at;
    p.pathIndex = Math.min(m.zoneCursor + 1, Math.max(0, p.path.length - 1));
    p.edgeProgressMs = 0;
    hooks?.onZoneChange?.(p, from, zone);
  }
}
