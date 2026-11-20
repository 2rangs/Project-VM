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
/** A mover yields to a body this close ahead of it (uu). */
const YIELD_DISTANCE = 2 * PLAYER_RADIUS_UNITS * 0.85;
/** ...but not for longer than this many consecutive ticks (then it squeezes past). */
const MAX_YIELD_TICKS = 6;

export interface MoveGoal {
  readonly zoneId: string;
  readonly mode: MoveMode;
  readonly preference?: RoutePreference;
  /** Belief-based extra cost per zone (never true enemy positions). */
  readonly zoneCost?: (zoneId: string) => number;
  /** One-off cost (ms) of entering a zone: a hazard that can be waited out. */
  readonly zoneEntryMs?: (zoneId: string) => number;
}

export interface MoverHooks {
  /** May the mover step into `toZone` now? false = it stays this tick (it waits, or was re-routed). */
  canEnterZone?(p: SimPlayer, toZone: string): boolean;
  onZoneChange?(p: SimPlayer, fromZone: string, toZone: string): void;
  onArrive?(p: SimPlayer): void;
  onNavEvent?(e: NavEvent): void;
}

export interface NavEvent {
  readonly kind: "planned" | "replanned" | "blocked" | "unreachable";
  readonly playerId: string;
  readonly goalZone: string;
  readonly reason?: string;
  readonly pathLength?: number;
  readonly estimatedTravelMs?: number;
  readonly preference?: RoutePreference;
}

interface Mover {
  goal: MoveGoal | null;
  /** Roadmap node the player is heading for (its own spot in the goal zone), or -1. */
  spot: number;
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
  /** Ticks left during which the mover does not yield (it just gave way for long enough). */
  pushTicks: number;
  lane: number;
  /** Zone the entry gate was last passed for (so the hook is asked once per boundary). */
  gatePassed: string | null;
}

const LANES = [0, -0.7, 0.7, -0.35, 0.35];

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
  private readonly speeds: { run: number; walk: number }; // uu per ms

  constructor(private readonly spatial: SpatialEngine, speeds: { runUnitsPerSec: number; walkUnitsPerSec: number }) {
    if (!spatial.nav) throw new Error(`MovementExecutor: map "${spatial.mapId}" has no navigation roadmap (<map>.nav.json) loaded`);
    this.nav = spatial.nav;
    this.blockers = new NavBlockers(this.nav);
    this.noTransit = new Set(spatial.zones.filter((z) => z.transit === false).map((z) => z.id));
    this.speeds = { run: speeds.runUnitsPerSec / 1000, walk: speeds.walkUnitsPerSec / 1000 };
  }

  /** Put every player on its own standing spot in its starting zone. */
  reset(players: readonly SimPlayer[]): void {
    this.movers.clear();
    this.claims.clear();
    const perTeam = new Map<string, number>();
    for (const p of players) {
      const slot = perTeam.get(p.teamId) ?? 0;
      perTeam.set(p.teamId, slot + 1);
      const m: Mover = {
        goal: null, spot: -1, atNode: -1, waypoints: [], index: 0, zoneCursor: 0, blockersVersion: this.blockers.version,
        linkElapsedMs: 0, failure: null, yieldTicks: 0, pushTicks: 0, lane: LANES[slot % LANES.length]!, gatePassed: null,
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

  private claim(playerId: string, node: number): void {
    for (const [n, id] of this.claims) if (id === playerId) this.claims.delete(n);
    if (node >= 0) this.claims.set(node, playerId);
  }

  /**
   * A standing spot for this player in a zone: a roadmap node of that zone near its anchor that
   * nobody else has claimed. Deterministic per player, so teammates spread out the same way
   * every time. -1 if the zone has no standable node.
   */
  pickSpot(playerId: string, zoneId: string): number {
    const anchor = this.nav.anchorNode(zoneId);
    if (anchor === undefined) return -1;
    const a = this.nav.nodePosition(anchor);
    let best = -1, bestScore = Infinity;
    for (const n of this.nav.zoneNodes(zoneId)) {
      const holder = this.claims.get(n);
      if (holder !== undefined && holder !== playerId) continue;
      if (this.blockers.nodeBlocked(n)) continue;
      const q = this.nav.nodePosition(n);
      if (Math.abs(q.z - a.z) > 160) continue; // same floor as the zone's anchor
      const score = Math.hypot(q.x - a.x, q.y - a.y) + 350 * hash01(`${playerId}|${n}`);
      if (score < bestScore || (score === bestScore && n < best)) { bestScore = score; best = n; }
    }
    return best;
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
      if (w.zoneId !== p.zoneId) return ms + (w.fixedMs ?? d / speed) / 2; // the zone changes about half-way along the segment
      ms += w.fixedMs ?? d / speed;
      prev = w.position;
    }
    return ms;
  }

  /** Forget a player's route (it was displaced by an ability, or stopped). */
  stop(p: SimPlayer, atNode?: number): void {
    const m = this.movers.get(p.id);
    if (!m) return;
    m.goal = null; m.waypoints = []; m.index = 0; m.spot = -1; m.failure = null; m.linkElapsedMs = 0; m.gatePassed = null;
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
    const same = m.goal && m.goal.zoneId === goal.zoneId && (m.goal.preference ?? "FASTEST") === (goal.preference ?? "FASTEST");
    if (same) {
      m.goal = goal; // refresh the cost callbacks
      if (m.index < m.waypoints.length) return "SUCCESS";
      if (m.failure) return m.blockersVersion === this.blockers.version ? "UNREACHABLE" : this.plan(p, m, "planned", hooks);
      if (p.zoneId === goal.zoneId) return "SUCCESS"; // already standing there
    }
    m.goal = goal;
    if (p.zoneId === goal.zoneId && m.index >= m.waypoints.length && m.atNode >= 0) {
      // already standing in the goal zone: stay on the spot it holds
      m.failure = null;
      p.path = [p.zoneId]; p.pathIndex = 1;
      return "SUCCESS";
    }
    return this.plan(p, m, "planned", hooks);
  }

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

  private plan(p: SimPlayer, m: Mover, kind: "planned" | "replanned", hooks?: MoverHooks): NavigationResult["status"] {
    const goal = m.goal!;
    m.blockersVersion = this.blockers.version;
    const spot = this.pickSpot(p.id, goal.zoneId);
    if (spot < 0) return this.fail(p, m, "UNREACHABLE", `zone ${goal.zoneId} has no walkable standing spot`, hooks);
    const r = this.nav.findPath({
      actorId: p.id, start: p.position, destination: this.nav.nodePosition(spot), movementMode: goal.mode,
      routePreference: goal.preference ?? "FASTEST", blockers: this.blockers, noTransitZones: this.noTransit,
      startNodes: this.startNodes(m),
      ...(goal.zoneCost ? { zoneCost: goal.zoneCost } : {}), ...(goal.zoneEntryMs ? { zoneEntryMs: goal.zoneEntryMs } : {}),
    });
    if (r.status !== "SUCCESS") return this.fail(p, m, r.status, r.reason, hooks);
    m.failure = null;
    m.spot = spot;
    this.claim(p.id, spot);
    m.atNode = -1;
    m.waypoints = this.withLane(r.waypoints, m.lane);
    m.index = 1; // waypoint 0 is where the player stands
    m.linkElapsedMs = 0;
    m.gatePassed = null;
    m.yieldTicks = 0;
    // strategic view of the same route: the zones it passes, current zone first
    p.path = r.zones[0] === p.zoneId ? [...r.zones] : [p.zoneId, ...r.zones];
    m.zoneCursor = 0;
    p.pathIndex = Math.min(1, p.path.length - 1);
    p.edgeProgressMs = 0;
    if (m.waypoints.length <= 1) this.arrive(p, m, hooks);
    hooks?.onNavEvent?.({
      kind, playerId: p.id, goalZone: goal.zoneId, pathLength: r.pathLength, estimatedTravelMs: r.estimatedTravelMs,
      preference: goal.preference ?? "FASTEST",
    });
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
    hooks?.onNavEvent?.({ kind: this.blockers.empty ? "unreachable" : "blocked", playerId: p.id, goalZone: m.goal?.zoneId ?? "", reason: `${status}: ${reason}` });
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
    for (let i = m.index; i < m.waypoints.length; i++) if (m.waypoints[i]!.zoneId !== p.zoneId) return m.waypoints[i]!.zoneId;
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
      if (w.zoneId !== p.zoneId && m.gatePassed !== w.zoneId) {
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
        if (d > 1e-6) p.facing = { x: dx, y: dy };
        const stepLen = Math.min(d, speed * budget);
        // yield to a body just ahead (light separation; never for long)
        if (m.pushTicks > 0) m.pushTicks--;
        else if (stepLen > 0 && this.bodyAhead(p, dx / (d || 1), dy / (d || 1), stepLen, others)) {
          if (++m.yieldTicks < MAX_YIELD_TICKS) break;
          m.pushTicks = 15; // waited long enough: squeeze past
        }
        m.yieldTicks = 0;
        if (stepLen >= d) {
          p.position = { ...w.position };
          budget -= speed > 0 ? d / speed : budget;
        } else {
          const f = stepLen / d;
          p.position = { x: p.position.x + dx * f, y: p.position.y + dy * f, z: p.position.z + dz * f };
          budget = 0;
        }
        moved += stepLen;
        if (stepLen < d) { this.updateZone(p, m, prev, w, hooks); break; }
      }
      // reached waypoint w
      this.updateZone(p, m, w, w, hooks);
      m.index++;
      if (m.index >= m.waypoints.length) { this.arrive(p, m, hooks); break; }
    }
    if (m.index < m.waypoints.length && moved > 0) p.edgeProgressMs += dtMs;
    return moved;
  }

  private bodyAhead(p: SimPlayer, ux: number, uy: number, stepLen: number, others: readonly SimPlayer[]): boolean {
    const nx = p.position.x + ux * stepLen, ny = p.position.y + uy * stepLen;
    for (const q of others) {
      if (q.id === p.id || !q.alive) continue;
      if (Math.abs(q.position.z - p.position.z) > 120) continue;
      const ox = q.position.x - nx, oy = q.position.y - ny;
      if (ox * ox + oy * oy >= YIELD_DISTANCE * YIELD_DISTANCE) continue;
      // only to a body AHEAD, and between two movers the lower id goes first
      if ((q.position.x - p.position.x) * ux + (q.position.y - p.position.y) * uy <= 0) continue;
      if (this.isMoving(q) && q.id > p.id) continue;
      return true;
    }
    return false;
  }

  /** The player's zone is the zone of the nearer end of the segment it is on. */
  private updateZone(p: SimPlayer, m: Mover, a: NavWaypoint, b: NavWaypoint, hooks?: MoverHooks): void {
    let zone = b.zoneId;
    if (a !== b && a.zoneId !== b.zoneId) {
      const da = Math.hypot(p.position.x - a.position.x, p.position.y - a.position.y, p.position.z - a.position.z);
      const db = Math.hypot(p.position.x - b.position.x, p.position.y - b.position.y, p.position.z - b.position.z);
      zone = db <= da ? b.zoneId : a.zoneId;
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
