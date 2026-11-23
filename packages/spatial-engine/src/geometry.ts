import type { Vec2, Vec3 } from "./types.js";

export function distance3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distance2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Point-in-polygon test (ray casting) on the XY plane. Polygon vertices are
 * ordered (cw or ccw). Points exactly on an edge are treated as inside for the
 * horizontal ray convention used here; callers should not rely on exact-edge
 * behaviour for correctness-critical logic.
 */
export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];
    const intersects =
      vi.y > p.y !== vj.y > p.y &&
      p.x < ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * The point a given fraction (by length, clamped to 0..1) of the way along a polyline, and the
 * XY heading of the segment it lies on. A polyline needs at least one point.
 */
export function pointAlongPolyline(points: readonly Vec3[], fraction: number): { position: Vec3; heading: Vec2 } {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) return { position: { ...first }, heading: { x: 0, y: 0 } };
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance3(points[i - 1]!, points[i]!);
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  let remaining = f * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = distance3(a, b);
    if (remaining <= len || i === points.length - 1) {
      const t = len > 0 ? Math.min(1, remaining / len) : 1;
      return {
        position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        heading: { x: b.x - a.x, y: b.y - a.y },
      };
    }
    remaining -= len;
  }
  return { position: { ...last }, heading: { x: 0, y: 0 } };
}
