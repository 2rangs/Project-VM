import type { SpatialEngine } from "@pv/spatial-engine";
import type { PlayerState, Vector2, Vector3 } from "./shared-mirror.js";
import type { PerceptionParams } from "./params.js";

function dist3(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Angle (radians) between the observer's facing direction and the direction to a point, in XY. */
export function facingAngleTo(facing: Vector2, from: Vector3, to: Vector3): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dmag = Math.hypot(dx, dy);
  const fmag = Math.hypot(facing.x, facing.y);
  if (dmag === 0) return 0; // same spot → in front
  if (fmag === 0) return Math.PI; // no facing → treat as worst case (behind)
  const cos = (facing.x * dx + facing.y * dy) / (fmag * dmag);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/**
 * A vision-blocking volume (a smoke): a sphere of `radius` around the point it landed on (the
 * floor point of a deployed smoke). Sight between two bodies is cut when the line between their
 * eyes passes through it — wherever the two stand, in the same zone or not, and from inside it.
 */
export interface SightOccluder {
  readonly center: Vector3;
  readonly radius: number;
}

/** Eye height above a body's floor position (world units; ≈1.5 m, manual-approx). */
export const EYE_HEIGHT_UNITS = 150;

/** Does the segment a→b pass through (or start/end inside) the sphere? */
export function segmentHitsSphere(a: Vector3, b: Vector3, c: Vector3, r: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const fx = a.x - c.x, fy = a.y - c.y, fz = a.z - c.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  // closest point of the segment to the centre
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(fx * dx + fy * dy + fz * dz) / len2)) : 0;
  const px = fx + dx * t, py = fy + dy * t, pz = fz + dz * t;
  return px * px + py * py + pz * pz <= r * r;
}

/** Whether a vision blocker cuts the eye-to-eye line between two floor positions. */
export function occluded(a: Vector3, b: Vector3, occluders: readonly SightOccluder[] | undefined): boolean {
  if (!occluders || occluders.length === 0) return false;
  const ea = { x: a.x, y: a.y, z: a.z + EYE_HEIGHT_UNITS };
  const eb = { x: b.x, y: b.y, z: b.z + EYE_HEIGHT_UNITS };
  for (const o of occluders) if (segmentHitsSphere(ea, eb, o.center, o.radius)) return true;
  return false;
}

/** A body (or a point) for a line-of-sight question: where it is and, when known, its zone. */
export interface SightPoint {
  readonly position: Vector3;
  readonly zoneId?: string | null;
}

export interface SightOptions {
  /** Use the map's measured node-to-node sight when it has one (default true). */
  readonly positionalSight?: boolean;
  /** Zone fallback only: a same-zone pair sees each other (default true). */
  readonly sameZoneAlwaysVisible?: boolean;
  /** Vision-blocking volumes (smokes) in force. */
  readonly occluders?: readonly SightOccluder[];
  /**
   * Zone-level smoke rule (legacy, for callers that know only which zone a smoke is in): a smoke in
   * either zone cuts a smokeable sightline between two different zones. Ignored when `occluders`
   * is given.
   */
  readonly smokedPairs?: ReadonlyArray<readonly [string, string]>;
  /**
   * Per-pass memo of `position object → located roadmap node` so the O(n²) visibility pass locates
   * each body once instead of once per pairing. Byte-identical to recomputing: within the cache's
   * lifetime (one perception tick) a given position object has one zone. Only the positional path uses it.
   */
  readonly nodeCache?: Map<object, number | null>;
}

/**
 * THE line-of-sight rule of the simulation — every question of the form "is there a clear line
 * between here and there" (a duel's first sight, a flash reaching an eye, a recon device seeing a
 * body, a tracer seen, a second gun on a crossfire) is answered here, so that what one system sees
 * another does not miss.
 *
 *  1. Positional: where the map carries measured line of sight between its roadmap nodes
 *     (`nav.sees`), it decides from where the two points really are — walls, corners, height.
 *  2. Fallback (no sight table, or a point off the roadmap): the zone sightline table; two points
 *     in one zone see each other (`sameZoneAlwaysVisible`).
 *  3. On top of either: a vision blocker cuts the line — as a volume (`occluders`) when the caller
 *     knows where the smokes are, else by the legacy zone rule (`smokedPairs`).
 * No facing and no distance limit here: those belong to an eye (canSee), not to the line.
 */
export function lineOfSight(spatial: SpatialEngine, a: SightPoint, b: SightPoint, opts: SightOptions = {}): boolean {
  const za = a.zoneId ?? spatial.nearestZone(a.position).id;
  const zb = b.zoneId ?? spatial.nearestZone(b.position).id;
  const nav = spatial.nav;
  let positional: boolean | null = null;
  if (opts.positionalSight !== false && nav) {
    const cache = opts.nodeCache;
    if (cache) {
      const nodeOf = (pos: SightPoint["position"], zone: string): number | null => {
        let n = cache.get(pos);
        if (n === undefined) { n = nav.locateInZone(pos, zone); cache.set(pos, n); }
        return n;
      };
      positional = nav.seesNodes(nodeOf(a.position, za), nodeOf(b.position, zb), a.position, b.position);
    } else {
      positional = nav.sees(a.position, za, b.position, zb);
    }
  }
  let clear: boolean;
  if (positional !== null) clear = positional;
  else if (za === zb) clear = opts.sameZoneAlwaysVisible ?? true;
  else clear = spatial.hasLineOfSight(za, zb);
  if (!clear) return false;
  if (opts.occluders) return !occluded(a.position, b.position, opts.occluders);
  if (opts.smokedPairs && opts.smokedPairs.length > 0 && za !== zb && opts.smokedPairs.some(([z]) => z === za || z === zb)) {
    if (spatial.hasLineOfSight(za, zb) && !spatial.hasLineOfSight(za, zb, { smokedPairs: opts.smokedPairs as Array<[string, string]> })) return false;
  }
  return true;
}

export interface VisionContext {
  readonly spatial: SpatialEngine;
  readonly params: PerceptionParams;
  /** Smokeable sightline pairs currently blocked by smoke (zone-id pairs; legacy rule). */
  readonly smokedPairs: ReadonlyArray<readonly [string, string]>;
  /** Smoke volumes in force; when given they replace the zone rule. */
  readonly occluders?: readonly SightOccluder[];
  /** Per-pass locate memo (see SightOptions.nodeCache); set once per tick by the oracle. */
  readonly nodeCache?: Map<object, number | null>;
}

/**
 * Deterministic line-of-sight test: an observer sees a target iff both are alive, the target is
 * within view distance and inside the FOV cone, and `lineOfSight` finds the line between them clear.
 * Fails safe: unknown zone relationships have no authored sightline → not visible.
 */
export function canSee(observer: PlayerState, target: PlayerState, ctx: VisionContext): boolean {
  if (!target.alive || !observer.alive) return false;
  if (observer.id === target.id) return false;

  const distance = dist3(observer.position, target.position);
  if (distance > ctx.params.vision.maxViewDistanceUnits) return false;

  const angle = facingAngleTo(observer.facing, observer.position, target.position);
  const halfFovRad = (ctx.params.vision.halfFovDeg * Math.PI) / 180;
  if (angle > halfFovRad) return false;

  return lineOfSight(ctx.spatial, observer, target, {
    positionalSight: ctx.params.vision.positionalSight !== false,
    sameZoneAlwaysVisible: ctx.params.vision.sameZoneAlwaysVisible,
    ...(ctx.nodeCache ? { nodeCache: ctx.nodeCache } : {}),
    ...(ctx.occluders ? { occluders: ctx.occluders } : { smokedPairs: ctx.smokedPairs }),
  });
}
