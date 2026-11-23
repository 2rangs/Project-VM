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

export interface VisionContext {
  readonly spatial: SpatialEngine;
  readonly params: PerceptionParams;
  /** Smokeable sightline pairs currently blocked by smoke (zone-id pairs). */
  readonly smokedPairs: ReadonlyArray<readonly [string, string]>;
}

/**
 * Deterministic line-of-sight test: an observer sees a target iff the target is alive,
 * within view distance, within the FOV cone, and has an unobstructed (non-smoked) zone
 * sightline — or shares the observer's zone when `sameZoneAlwaysVisible`.
 *
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

  const zo = observer.zoneId ?? ctx.spatial.nearestZone(observer.position).id;
  const zt = target.zoneId ?? ctx.spatial.nearestZone(target.position).id;
  // Positional sight: where the map carries measured line of sight between its roadmap nodes,
  // who sees whom is decided by where the two bodies really stand — walls, corners and height —
  // not by which zones they are in. Vision blockers keep their zone-level rule on top of it: a
  // smoke in either body's zone cuts the line between two different zones, unless the map marks
  // that line as one a smoke cannot cut.
  const positional = ctx.params.vision.positionalSight === false ? null : ctx.spatial.nav?.sees(observer.position, zo, target.position, zt) ?? null;
  if (positional !== null) {
    if (!positional) return false;
    if (zo !== zt && ctx.smokedPairs.some(([z]) => z === zo || z === zt)) {
      if (!ctx.spatial.hasLineOfSight(zo, zt)) return false;
      if (!ctx.spatial.hasLineOfSight(zo, zt, { smokedPairs: ctx.smokedPairs as Array<[string, string]> })) return false;
    }
    return true;
  }
  if (zo === zt) {
    return ctx.params.vision.sameZoneAlwaysVisible;
  }
  return ctx.spatial.hasLineOfSight(zo, zt, { smokedPairs: ctx.smokedPairs as Array<[string, string]> });
}
