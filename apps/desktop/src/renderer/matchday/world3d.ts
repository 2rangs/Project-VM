// 3D world helpers for the team cams: the game → scene coordinate mapping, the first-person
// camera pose, and a BLOCKOUT of the map generated from the navgraph alone.
//
// The blockout is what the cams render when no real map mesh is installed
// (apps/desktop/assets/maps/<map>.glb, which is never committed). It is a schematic, not the
// map: every zone becomes a round room, every travel edge a walled corridor between two rooms,
// with the zone heights from the navgraph. It is exactly as detailed as the data the engine
// simulates on, so nothing the cams show on it contradicts the simulation.
//
// Pure module (no three.js / DOM): runs under `node --test`.
import type { NavModel, Vec3 } from './nav.ts';

/** Scene units are metres; the game uses centimetre-ish "uu". */
export const UU_TO_M = 0.01;
export const EYE_HEIGHT_M = 1.55;

export interface P3 { readonly x: number; readonly y: number; readonly z: number }

/**
 * Game (x, y, z-up, left-handed) → scene (x, y-up, z, right-handed), in metres:
 *   scene = (game.x, game.z, game.y) × 0.01
 * Swapping y and z is the handedness change, so a top-down view of the scene with +x up has
 * +game.y to the right — the same orientation as the minimap.
 */
export function toScene(p: Vec3): P3 { return { x: p.x * UU_TO_M, y: p.z * UU_TO_M, z: p.y * UU_TO_M }; }

export interface CameraPose { readonly position: P3; readonly target: P3 }

/** First-person camera: at eye height over `groundY` (scene metres), looking along the heading. */
export function firstPersonPose(pos: Vec3, facingRad: number, groundY: number, pitchDeg = -4): CameraPose {
  const s = toScene(pos);
  const eye = { x: s.x, y: groundY + EYE_HEIGHT_M, z: s.z };
  const pitch = (pitchDeg * Math.PI) / 180;
  const cp = Math.cos(pitch);
  // heading is atan2(game.y, game.x) → scene direction (cos, ·, sin)
  return { position: eye, target: { x: eye.x + Math.cos(facingRad) * cp * 10, y: eye.y + Math.sin(pitch) * 10, z: eye.z + Math.sin(facingRad) * cp * 10 } };
}

// ── blockout ───────────────────────────────────────────────────────────────────────────────

export const BLOCKOUT = {
  roomRadius: 560,      // uu
  corridorHalfWidth: 280,
  wallHeight: 380,
  roomSegments: 20,
} as const;

/** A flat or sloped floor polygon (game coordinates, wound counter-clockwise seen from above). */
export interface FloorPoly { readonly pts: readonly Vec3[]; readonly kind: 'room' | 'corridor' | 'site' }
/** A vertical wall slab between two floor points. */
export interface WallSeg { readonly a: Vec3; readonly b: Vec3; readonly height: number }
export interface ZoneLabel { readonly id: string; readonly name: string; readonly pos: Vec3; readonly site: boolean }

export interface Blockout {
  readonly floors: readonly FloorPoly[];
  readonly walls: readonly WallSeg[];
  readonly labels: readonly ZoneLabel[];
  readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
}

const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function pointSegDist(p: Vec3, a: Vec3, b: Vec3): number {
  const dx = b.x - a.x, dy = b.y - a.y; const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * u), p.y - (a.y + dy * u));
}
/** Shortest distance between two segments in the ground plane (0 when they cross). */
export function segDist2d(p: Vec3, q: Vec3, a: Vec3, b: Vec3): number {
  const cross = (o: Vec3, m: Vec3, n: Vec3) => (m.x - o.x) * (n.y - o.y) - (m.y - o.y) * (n.x - o.x);
  const d1 = cross(p, q, a), d2 = cross(p, q, b), d3 = cross(a, b, p), d4 = cross(a, b, q);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointSegDist(p, a, b), pointSegDist(q, a, b), pointSegDist(a, p, q), pointSegDist(b, p, q));
}

export function buildBlockout(nav: NavModel, plantZones: ReadonlyArray<{ zoneId: string; polygon: ReadonlyArray<{ x: number; y: number }> }> = []): Blockout {
  const { roomRadius: R, corridorHalfWidth: W, wallHeight: H, roomSegments: N } = BLOCKOUT;
  const floors: FloorPoly[] = [];
  const walls: WallSeg[] = [];
  const labels: ZoneLabel[] = [];
  const doorHalfAngle = Math.asin(Math.min(1, W / R)) + 0.02;
  // where a corridor leaves a room, measured from the room centre
  const reach = Math.sqrt(Math.max(0, R * R - W * W));

  const doors = new Map<string, number[]>();
  for (const z of nav.zones) doors.set(z.id, []);
  for (const l of nav.links) {
    const a = nav.zone(l.a), b = nav.zone(l.b);
    if (!a || !b) continue;
    const dir = Math.atan2(b.position.y - a.position.y, b.position.x - a.position.x);
    doors.get(a.id)!.push(dir);
    doors.get(b.id)!.push(dir + Math.PI);
    const len = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    if (len <= reach * 2) continue; // rooms overlap: the doorways already connect them
    const ux = Math.cos(dir), uy = Math.sin(dir), nx = -uy, ny = ux;
    const zAt = (d: number) => a.position.z + ((b.position.z - a.position.z) * d) / len;
    const pt = (d: number, side: number): Vec3 => ({ x: a.position.x + ux * d + nx * W * side, y: a.position.y + uy * d + ny * W * side, z: zAt(d) });
    const d0 = reach, d1 = len - reach;
    floors.push({ kind: 'corridor', pts: [pt(d0, -1), pt(d1, -1), pt(d1, 1), pt(d0, 1)] });
    // walls in short pieces, so only the pieces that would cut another route are dropped below
    const pieces = Math.max(1, Math.round((d1 - d0) / 320));
    for (let i = 0; i < pieces; i++) {
      const da = d0 + ((d1 - d0) * i) / pieces, db = d0 + ((d1 - d0) * (i + 1)) / pieces;
      walls.push({ a: pt(da, -1), b: pt(db, -1), height: H }, { a: pt(da, 1), b: pt(db, 1), height: H });
    }
  }

  for (const z of nav.zones) {
    const c = z.position;
    const ring: Vec3[] = [];
    for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; ring.push({ x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R, z: c.z }); }
    floors.push({ kind: 'room', pts: ring });
    const open = doors.get(z.id) ?? [];
    for (let i = 0; i < N; i++) {
      const mid = ((i + 0.5) / N) * Math.PI * 2;
      if (open.some((d) => angDiff(d, mid) < doorHalfAngle)) continue; // doorway
      walls.push({ a: ring[i], b: ring[(i + 1) % N], height: H });
    }
    labels.push({ id: z.id, name: z.name, pos: { x: c.x, y: c.y, z: c.z + H + 120 }, site: z.plantable });
  }

  // Zones sit close together, so a room or corridor of one route can cut across another. The
  // simulation's graph is the truth: no wall may stand in a travel link's lane or across an
  // authored sightline, and none may stand inside another zone's room.
  const lanes: Array<{ a: Vec3; b: Vec3; clear: number }> = [];
  for (const l of nav.links) { const a = nav.zone(l.a), b = nav.zone(l.b); if (a && b) lanes.push({ a: a.position, b: b.position, clear: W * 0.95 }); }
  for (const z of nav.zones) for (const o of nav.sightZones(z.id)) { const t = nav.zone(o); if (t && z.id < o) lanes.push({ a: z.position, b: t.position, clear: W * 0.6 }); }
  const kept = walls.filter((w) => {
    for (const z of nav.zones) {
      const mx = (w.a.x + w.b.x) / 2 - z.position.x, my = (w.a.y + w.b.y) / 2 - z.position.y;
      if (Math.hypot(mx, my) < R - 40) return false;
    }
    return !lanes.some((l) => segDist2d(w.a, w.b, l.a, l.b) < l.clear);
  });
  walls.length = 0; walls.push(...kept);

  for (const pz of plantZones) {
    const zone = nav.zone(pz.zoneId);
    if (!zone) continue;
    floors.push({ kind: 'site', pts: pz.polygon.map((p) => ({ x: p.x, y: p.y, z: zone.position.z + 4 })) });
  }

  let min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const z of nav.zones) {
    min = { x: Math.min(min.x, z.position.x - R), y: Math.min(min.y, z.position.y - R), z: Math.min(min.z, z.position.z) };
    max = { x: Math.max(max.x, z.position.x + R), y: Math.max(max.y, z.position.y + R), z: Math.max(max.z, z.position.z + H) };
  }
  return { floors, walls, labels, bounds: { min, max } };
}
