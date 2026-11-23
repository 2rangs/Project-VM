// Original, procedurally built 3D models for the team cams: tactical operators and a family of
// weapons. Nothing here is taken from, traced from or shaped after a game's characters or weapons —
// the silhouettes are our own, and a player's identity comes from our data (team colour, handle).
//
// Conventions (scene metres): +X forward, +Y up, Z lateral. An operator stands on y = 0; a weapon's
// grip is at its origin with the muzzle along +X. Geometry is merged per material and per joint and
// cached per role / weapon class, so ten figures cost a few dozen draw calls and share buffers.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── roles and weapon classes ────────────────────────────────────────────────────────────────

export type Role = 'controller' | 'initiator' | 'sentinel' | 'duelist';
/** Role per roster slot (1-based slot − 1). The engine fields one fixed comp in slot order
 *  (match-runner ASCENT_COMP: a controller, two initiators, a sentinel, a duelist). */
export const ROLE_BY_SLOT: readonly Role[] = ['controller', 'initiator', 'initiator', 'sentinel', 'duelist'];
export const roleForSlot = (slot: number): Role => ROLE_BY_SLOT[(slot - 1 + ROLE_BY_SLOT.length) % ROLE_BY_SLOT.length]!;

export type WeaponClass = 'rifle' | 'carbine' | 'sniper' | 'smg' | 'shotgun' | 'lmg' | 'pistol' | 'handcannon';
/** Which of our models stands in for a bought weapon (the engine names weapons; the model is generic). */
export function weaponClassOf(name: string | null | undefined): WeaponClass {
  const n = (name ?? '').toLowerCase();
  if (/phantom|guardian/.test(n)) return 'carbine';
  if (/vandal|bulldog|rifle/.test(n)) return 'rifle';
  if (/operator|marshal|outlaw|sniper/.test(n)) return 'sniper';
  if (/spectre|stinger|smg/.test(n)) return 'smg';
  if (/judge|bucky|shotgun/.test(n)) return 'shotgun';
  if (/odin|ares|lmg/.test(n)) return 'lmg';
  if (/sheriff|cannon/.test(n)) return 'handcannon';
  if (/classic|ghost|frenzy|shorty|pistol/.test(n)) return 'pistol';
  return 'rifle';
}
export const isSidearm = (c: WeaponClass): boolean => c === 'pistol' || c === 'handcannon';

// ── geometry kit: primitives placed in a local frame, merged per material ─────────────────

type V3 = readonly [number, number, number];
type MatKey = 'cloth' | 'pants' | 'trim' | 'metal' | 'armor' | 'glow' | 'fabric' | 'polymer';

class Kit {
  private readonly parts = new Map<MatKey, THREE.BufferGeometry[]>();
  add(mat: MatKey, g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    const geo = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    g.dispose();
    const list = this.parts.get(mat) ?? []; list.push(geo); this.parts.set(mat, list);
    return this;
  }
  /** A capsule spanning two points (a limb). */
  limb(mat: MatKey, a: V3, b: V3, r: number): this {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r * 0.6), 4, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(mat, g, [mid.x, mid.y, mid.z], [e.x, e.y, e.z]);
  }
  rbox(mat: MatKey, w: number, h: number, d: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], r = 0.015): this {
    return this.add(mat, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), pos, rot);
  }
  cyl(mat: MatKey, rTop: number, rBot: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 12, open = false): this {
    return this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), pos, rot);
  }
  /** A cylinder lying along +X (barrels, scopes). */
  tube(mat: MatKey, r: number, x0: number, x1: number, y: number, z = 0, seg = 12): this {
    return this.cyl(mat, r, r, x1 - x0, [(x0 + x1) / 2, y, z], [0, 0, -Math.PI / 2], seg);
  }
  /** A side profile (x, y points, counter-clockwise) extruded across Z with a small bevel. */
  profile(mat: MatKey, pts: ReadonlyArray<readonly [number, number]>, depth: number, z = 0): this {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const bevel = Math.min(0.004, depth / 6);
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    return this.add(mat, g, [0, 0, z - depth / 2 + bevel]);
  }
  sphere(mat: MatKey, r: number, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], phiLen = Math.PI * 2, thetaLen = Math.PI, rot: V3 = [0, 0, 0]): this {
    return this.add(mat, new THREE.SphereGeometry(r, 16, 12, 0, phiLen, 0, thetaLen), pos, rot, scale);
  }
  merged(): Map<MatKey, THREE.BufferGeometry> {
    const out = new Map<MatKey, THREE.BufferGeometry>();
    for (const [k, list] of this.parts) {
      const g = mergeGeometries(list, false);
      if (g) { g.computeBoundingSphere(); out.set(k, g); }
      for (const p of list) p.dispose();
    }
    return out;
  }
}

// ── materials ───────────────────────────────────────────────────────────────────────────────

export type ModelMaterials = Record<MatKey, THREE.Material>;
const CLOTH_BY_ROLE: Record<Role, number> = { controller: 0x4c475c, initiator: 0x5a6249, sentinel: 0x606a74, duelist: 0x4a5b6d };
const matCache = new Map<string, ModelMaterials>();

/** Team-tinted materials (one set per accent colour × role, shared by every figure that uses it). */
export function modelMaterials(accent: number, role: Role | 'gun' = 'gun'): ModelMaterials {
  const key = `${accent}:${role}`;
  const hit = matCache.get(key); if (hit) return hit;
  const a = new THREE.Color(accent);
  const armor = a.clone().lerp(new THREE.Color(0x8e98a2), 0.38);
  const m: ModelMaterials = {
    cloth: new THREE.MeshStandardMaterial({ color: role === 'gun' ? 0x3a434e : CLOTH_BY_ROLE[role], roughness: 0.92 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2c333b, roughness: 0.55, metalness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c8692, roughness: 0.35, metalness: 0.65 }),
    armor: new THREE.MeshStandardMaterial({ color: armor, emissive: a, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.25 }),
    glow: new THREE.MeshStandardMaterial({ color: a, emissive: a, emissiveIntensity: 1.4, roughness: 0.3 }),
    fabric: new THREE.MeshStandardMaterial({ color: role === 'gun' ? 0x353b44 : new THREE.Color(CLOTH_BY_ROLE[role]).multiplyScalar(0.82), roughness: 0.97, side: THREE.DoubleSide }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x46505b, roughness: 0.7 }),
  };
  matCache.set(key, m);
  return m;
}

function meshesOf(geos: Map<MatKey, THREE.BufferGeometry>, mats: ModelMaterials): THREE.Mesh[] {
  return [...geos].map(([k, g]) => new THREE.Mesh(g, mats[k]));
}

// ── weapons ─────────────────────────────────────────────────────────────────────────────────

interface WeaponGeo { geos: Map<MatKey, THREE.BufferGeometry>; muzzle: V3; foregrip: V3 }
const weaponCache = new Map<WeaponClass, WeaponGeo>();

function weaponGeo(c: WeaponClass): WeaponGeo {
  const hit = weaponCache.get(c); if (hit) return hit;
  const k = new Kit();
  let muzzle: V3 = [0.7, 0.04, 0]; let foregrip: V3 = [0.36, 0.0, 0];
  const grip = (x = 0): void => { k.profile('polymer', [[x - 0.012, 0.005], [x + 0.04, 0.005], [x + 0.022, -0.105], [x - 0.032, -0.1]], 0.034); };
  switch (c) {
    case 'rifle':
    case 'carbine':
    case 'lmg':
    case 'shotgun': {
      const long = c === 'carbine' ? 0.04 : 0;
      // receiver: a stepped wedge, our own silhouette
      k.profile('trim', [[-0.07, 0.0], [0.27, 0.0], [0.3, 0.025], [0.29, 0.068], [0.04, 0.078], [-0.03, 0.07], [-0.07, 0.048]], 0.046);
      k.rbox('glow', 0.16, 0.008, 0.048, [0.12, 0.05, 0], [0, 0, 0], 0.003);            // team accent stripe
      k.profile('polymer', [[0.27, 0.006], [0.52 + long, 0.014], [0.52 + long, 0.058], [0.29, 0.066]], 0.052); // handguard
      for (let i = 0; i < 3; i++) k.rbox('trim', 0.03, 0.012, 0.054, [0.33 + i * 0.06, 0.036, 0], [0, 0, 0], 0.004); // vents
      k.profile('trim', [[-0.07, 0.012], [-0.3, -0.018], [-0.33, 0.012], [-0.32, 0.068], [-0.07, 0.07]], 0.04); // stock
      k.rbox('polymer', 0.025, 0.09, 0.044, [-0.325, 0.025, 0], [0, 0, 0], 0.006);       // butt pad
      grip(0);
      if (c === 'lmg') k.rbox('metal', 0.1, 0.11, 0.07, [0.15, -0.06, 0.012], [0, 0, 0], 0.01); // box magazine
      else if (c === 'shotgun') { k.tube('trim', 0.019, 0.3, 0.5, -0.008); k.rbox('polymer', 0.12, 0.04, 0.05, [0.4, -0.012, 0], [0, 0, 0], 0.01); }
      else k.profile('metal', [[0.15, 0.002], [0.205, 0.002], [0.235, -0.165], [0.18, -0.175]], 0.034); // curved magazine
      const bx = 0.52 + long;
      if (c === 'carbine') { k.tube('metal', 0.012, bx, bx + 0.06, 0.04); k.tube('trim', 0.022, bx + 0.06, bx + 0.22, 0.04, 0, 14); muzzle = [bx + 0.22, 0.04, 0]; }
      else if (c === 'shotgun') { k.tube('metal', 0.016, bx, bx + 0.16, 0.04); muzzle = [bx + 0.16, 0.04, 0]; }
      else { k.tube('metal', 0.011, bx, bx + 0.2, 0.04); k.tube('trim', 0.018, bx + 0.2, bx + 0.25, 0.04); muzzle = [bx + 0.25, 0.04, 0]; }
      k.rbox('trim', 0.1, 0.034, 0.034, [0.13, 0.1, 0], [0, 0, 0], 0.008);              // optic body
      k.tube('glow', 0.012, 0.18, 0.186, 0.1);                                           // lens
      k.rbox('trim', 0.03, 0.02, 0.03, [0.1, 0.08, 0], [0, 0, 0], 0.004);
      foregrip = [0.42 + long, -0.005, 0];
      break;
    }
    case 'sniper': {
      k.profile('trim', [[-0.06, 0.0], [0.34, 0.0], [0.36, 0.03], [0.34, 0.07], [-0.02, 0.075], [-0.06, 0.05]], 0.05);
      k.rbox('glow', 0.2, 0.008, 0.052, [0.15, 0.052, 0], [0, 0, 0], 0.003);
      // thumbhole stock
      k.profile('trim', [[-0.06, 0.0], [-0.24, -0.06], [-0.36, -0.05], [-0.37, 0.07], [-0.06, 0.072]], 0.042);
      k.rbox('polymer', 0.09, 0.035, 0.05, [-0.2, -0.015, 0], [0, 0, 0.3], 0.01);
      grip(0);
      k.rbox('metal', 0.07, 0.07, 0.04, [0.16, -0.04, 0], [0, 0, 0], 0.008);
      k.tube('metal', 0.014, 0.36, 0.86, 0.04); k.tube('trim', 0.024, 0.86, 0.94, 0.04, 0, 6);
      k.tube('trim', 0.026, 0.06, 0.34, 0.125, 0, 16);                                   // scope
      k.tube('trim', 0.034, 0.3, 0.36, 0.125, 0, 16); k.tube('trim', 0.03, 0.04, 0.09, 0.125, 0, 16);
      k.tube('glow', 0.028, 0.36, 0.365, 0.125, 0, 16);
      k.rbox('trim', 0.03, 0.04, 0.03, [0.12, 0.09, 0], [0, 0, 0], 0.004); k.rbox('trim', 0.03, 0.04, 0.03, [0.26, 0.09, 0], [0, 0, 0], 0.004);
      muzzle = [0.94, 0.04, 0]; foregrip = [0.4, 0.0, 0];
      break;
    }
    case 'smg': {
      k.profile('trim', [[-0.05, 0.0], [0.22, 0.0], [0.24, 0.03], [0.22, 0.07], [-0.05, 0.07]], 0.046);
      k.rbox('glow', 0.12, 0.008, 0.048, [0.08, 0.05, 0], [0, 0, 0], 0.003);
      k.profile('polymer', [[0.22, 0.008], [0.34, 0.012], [0.34, 0.058], [0.22, 0.064]], 0.05);
      k.tube('trim', 0.02, 0.34, 0.46, 0.036, 0, 14);
      k.rbox('metal', 0.035, 0.18, 0.03, [0.1, -0.09, 0], [0, 0, 0.08], 0.006);           // straight magazine
      k.limb('metal', [-0.05, 0.05, 0.016], [-0.24, 0.03, 0.016], 0.006); k.limb('metal', [-0.05, 0.02, -0.016], [-0.24, 0.0, -0.016], 0.006);
      k.rbox('polymer', 0.02, 0.07, 0.05, [-0.245, 0.02, 0], [0, 0, 0], 0.005);
      grip(0);
      k.rbox('trim', 0.05, 0.022, 0.026, [0.06, 0.084, 0], [0, 0, 0], 0.005);
      muzzle = [0.46, 0.036, 0]; foregrip = [0.29, -0.005, 0];
      break;
    }
    case 'handcannon': {
      k.profile('metal', [[-0.05, 0.03], [0.2, 0.03], [0.2, 0.075], [-0.05, 0.08]], 0.034);
      k.tube('trim', 0.03, 0.0, 0.06, 0.05, 0, 8);                                        // drum
      k.profile('polymer', [[-0.035, 0.0], [0.07, 0.0], [0.07, 0.032], [-0.045, 0.032], [-0.06, -0.11], [-0.005, -0.115]], 0.034);
      k.rbox('glow', 0.12, 0.006, 0.036, [0.08, 0.076, 0], [0, 0, 0], 0.002);
      muzzle = [0.2, 0.053, 0]; foregrip = [0, -0.06, 0];
      break;
    }
    case 'pistol':
    default: {
      k.profile('metal', [[-0.045, 0.03], [0.15, 0.03], [0.155, 0.05], [0.15, 0.07], [-0.04, 0.072], [-0.05, 0.055]], 0.032); // slide
      k.profile('polymer', [[-0.03, 0.0], [0.11, 0.0], [0.11, 0.03], [-0.04, 0.03], [-0.055, -0.1], [-0.005, -0.105]], 0.034);
      k.rbox('glow', 0.08, 0.005, 0.034, [0.05, 0.072, 0], [0, 0, 0], 0.002);
      muzzle = [0.155, 0.05, 0]; foregrip = [0, -0.06, 0];
      break;
    }
  }
  const geo = { geos: k.merged(), muzzle, foregrip };
  weaponCache.set(c, geo);
  return geo;
}

/** A weapon model (grip at origin, muzzle along +X). `userData.muzzle` / `userData.foregrip` are local points. */
export function buildWeapon(c: WeaponClass, mats: ModelMaterials): THREE.Group {
  const w = weaponGeo(c);
  const g = new THREE.Group();
  for (const m of meshesOf(w.geos, mats)) g.add(m);
  g.userData = { cls: c, muzzle: w.muzzle, foregrip: w.foregrip };
  return g;
}

// ── operators ───────────────────────────────────────────────────────────────────────────────

/** Joint frames, shared by every role (so animation code needs no per-role numbers). */
export const RIG = {
  hips: [0, 0.93, 0] as V3,
  thighL: [0, -0.03, 0.105] as V3, thighR: [0, -0.03, -0.105] as V3,
  knee: [0, -0.44, 0] as V3,
  spine: [0, 0.05, 0] as V3,
  neck: [0.01, 0.6, 0] as V3,
  /** Where the long gun's grip sits in the spine frame; the hands are modelled around it. */
  gunMount: [0.24, 0.31, -0.03] as V3,
} as const;

interface OperatorGeo { hips: Map<MatKey, THREE.BufferGeometry>; thigh: Map<MatKey, THREE.BufferGeometry>; shin: Map<MatKey, THREE.BufferGeometry>; spine: Map<MatKey, THREE.BufferGeometry>; head: Map<MatKey, THREE.BufferGeometry> }
const operatorCache = new Map<Role, OperatorGeo>();

function operatorGeo(role: Role): OperatorGeo {
  const hit = operatorCache.get(role); if (hit) return hit;
  const heavy = role === 'sentinel', light = role === 'duelist';
  const w = heavy ? 1.08 : light ? 0.93 : 1;

  // hips
  const hips = new Kit().rbox('pants', 0.22, 0.17, 0.32 * w, [0, 0, 0], [0, 0, 0], 0.05)
    .rbox('trim', 0.25, 0.05, 0.35 * w, [0, 0.07, 0], [0, 0, 0], 0.015)                  // belt
    .rbox('trim', 0.07, 0.11, 0.05, [0.02, -0.02, -0.18 * w], [0, 0, 0], 0.012);         // holster
  if (role === 'controller') {
    hips.cyl('fabric', 0.2, 0.3, 0.6, [-0.02, -0.25, 0], [0, 0, 0], 16, true);            // long coat skirt
    for (let i = 0; i < 3; i++) hips.cyl('glow', 0.022, 0.022, 0.07, [0.12, 0.06, -0.08 + i * 0.08], [0, 0, 0], 8); // canisters
  }
  if (role === 'initiator') hips.rbox('trim', 0.08, 0.1, 0.06, [-0.04, -0.03, 0.18], [0, 0, 0], 0.012);

  // legs (thigh from the hip joint down, shin from the knee down, boot on the floor)
  const thigh = new Kit().limb('pants', [0, 0, 0], [0.01, -0.42, 0], 0.075 * w);
  if (heavy) thigh.rbox('armor', 0.05, 0.18, 0.12, [0.07, -0.2, 0], [0, 0, 0], 0.02);
  if (role === 'initiator') thigh.rbox('trim', 0.06, 0.12, 0.11, [0.0, -0.18, 0.06], [0, 0, 0], 0.015); // leg pouch
  const shin = new Kit().limb('pants', [0, 0, 0], [0, -0.37, 0], 0.06 * w)
    .rbox('trim', 0.25, 0.1, 0.13, [0.045, -0.42, 0], [0, 0, 0], 0.035)                 // boot
    .rbox('trim', 0.12, 0.1, 0.12, [0.0, -0.33, 0], [0, 0, 0], 0.03);
  if (role !== 'controller') shin.rbox('armor', 0.05, 0.1, 0.1, [0.065, -0.01, 0], [0, 0, 0], 0.02); // knee pad

  // torso, arms posed around the gun mount
  const s = new Kit()
    .rbox('cloth', 0.22, 0.26, 0.33 * w, [0, 0.13, 0], [0, 0, 0], 0.07)                   // abdomen
    .rbox('cloth', 0.26, 0.3, 0.41 * w, [0, 0.38, 0], [0, 0, 0], 0.08)                    // chest
    .rbox('armor', 0.06, 0.27, 0.33 * w, [0.13, 0.38, 0], [0, 0, 0], 0.025)               // front plate
    .rbox('armor', 0.05, 0.25, 0.31 * w, [-0.13, 0.38, 0], [0, 0, 0], 0.02)               // back plate
    .cyl('trim', 0.055, 0.065, 0.1, [0.005, 0.55, 0], [0, 0, 0], 10);                   // collar
  const sh = 0.22 * w;
  s.sphere('cloth', 0.085, [0, 0.48, sh]).sphere('cloth', 0.085, [0, 0.48, -sh]);
  // trigger arm (−Z side) and support arm (+Z side)
  const [gx, gy, gz] = RIG.gunMount;
  s.limb('cloth', [0, 0.48, -sh], [0.12, 0.3, -sh + 0.02], 0.052).limb('cloth', [0.12, 0.3, -sh + 0.02], [gx - 0.01, gy + 0.0, gz - 0.03], 0.045)
    .rbox('trim', 0.09, 0.08, 0.08, [gx, gy - 0.01, gz - 0.02], [0, 0, 0], 0.025);
  s.limb('cloth', [0, 0.48, sh], [0.2, 0.34, sh - 0.03], 0.052).limb('cloth', [0.2, 0.34, sh - 0.03], [gx + 0.37, gy + 0.0, gz + 0.03], 0.045)
    .rbox('trim', 0.09, 0.08, 0.08, [gx + 0.38, gy, gz + 0.02], [0, 0, 0], 0.025);
  s.rbox('glow', 0.03, 0.035, 0.09, [gx + 0.3, gy + 0.005, gz + 0.04], [0, 0, 0], 0.01); // accent cuff
  switch (role) {
    case 'duelist':
      s.rbox('glow', 0.065, 0.02, 0.2, [0.15, 0.46, 0], [0, 0, 0.3], 0.006)               // chest chevrons
        .rbox('glow', 0.065, 0.02, 0.16, [0.15, 0.4, 0], [0, 0, 0.3], 0.006)
        .rbox('cloth', 0.24, 0.07, 0.42, [-0.01, 0.53, 0], [0, 0, 0], 0.03);             // jacket collar
      break;
    case 'initiator':
      s.rbox('trim', 0.17, 0.32, 0.29, [-0.22, 0.36, 0], [0, 0, 0], 0.05)                 // recon pack
        .cyl('metal', 0.006, 0.006, 0.38, [-0.25, 0.68, 0.1], [0, 0, -0.12], 6)           // antenna
        .sphere('glow', 0.012, [-0.27, 0.87, 0.1])
        .sphere('armor', 0.06, [0.0, 0.56, sh + 0.02], [1, 0.7, 1])                       // shoulder sensor pod
        .sphere('glow', 0.025, [0.05, 0.56, sh + 0.03]);
      break;
    case 'controller':
      s.cyl('fabric', 0.18, 0.21, 0.26, [-0.01, 0.42, 0], [0, 0, 0], 16, true)            // coat over the chest
        .rbox('fabric', 0.24, 0.16, 0.44, [-0.01, 0.52, 0], [0, 0, 0], 0.06)             // high collar
        .rbox('glow', 0.02, 0.2, 0.02, [0.15, 0.36, -0.06], [0, 0, 0], 0.006);
      break;
    case 'sentinel':
      s.rbox('armor', 0.2, 0.1, 0.18, [0, 0.56, sh + 0.02], [0.25, 0, 0], 0.03)           // pauldrons
        .rbox('armor', 0.2, 0.1, 0.18, [0, 0.56, -sh - 0.02], [-0.25, 0, 0], 0.03)
        .rbox('trim', 0.07, 0.08, 0.08, [0.17, 0.27, 0.09], [0, 0, 0], 0.012)             // chest-rig pouches
        .rbox('trim', 0.07, 0.08, 0.08, [0.17, 0.27, -0.01], [0, 0, 0], 0.012)
        .rbox('trim', 0.18, 0.26, 0.32, [-0.22, 0.34, 0], [0, 0, 0], 0.03)                // tool case
        .rbox('glow', 0.02, 0.18, 0.02, [-0.31, 0.36, 0.1], [0, 0, 0], 0.006);
      break;
  }

  // head: helmet + visor, per-role crest / hood / face plate
  const h = new Kit()
    .sphere(heavy ? 'armor' : 'pants', 0.12, [0, 0.11, 0], [1.02, 1.05, 0.96])
    .rbox('glow', 0.05, 0.06, 0.2, [0.105, 0.1, 0], [0, 0, 0], 0.02)
    .rbox('trim', 0.12, 0.05, 0.27, [0.0, 0.04, 0], [0, 0, 0], 0.02);                   // jaw guard
  switch (role) {
    case 'duelist':
      h.rbox('armor', 0.2, 0.025, 0.03, [-0.02, 0.24, 0], [0, 0, -0.35], 0.008)            // swept crest
        .rbox('glow', 0.055, 0.035, 0.22, [0.11, 0.115, 0], [0, 0, 0], 0.012);
      break;
    case 'initiator':
      h.cyl('trim', 0.04, 0.04, 0.03, [0, 0.11, 0.14], [Math.PI / 2, 0, 0], 12)           // earpiece
        .cyl('metal', 0.004, 0.004, 0.12, [-0.02, 0.2, 0.14], [0, 0, -0.3], 5)
        .sphere('glow', 0.016, [0.09, 0.2, -0.07]);                                        // helmet lamp
      break;
    case 'controller':
      h.sphere('fabric', 0.165, [-0.025, 0.12, 0], [1.05, 1.1, 1.05], Math.PI * 2, Math.PI * 0.62, [0, 0, 0.25]); // hood
      break;
    case 'sentinel':
      h.rbox('armor', 0.06, 0.15, 0.23, [0.115, 0.08, 0], [0, 0, 0], 0.025)               // face plate
        .rbox('glow', 0.02, 0.022, 0.19, [0.148, 0.11, 0], [0, 0, 0], 0.006);              // visor slit
      break;
  }

  const geo = { hips: hips.merged(), thigh: thigh.merged(), shin: shin.merged(), spine: s.merged(), head: h.merged() };
  operatorCache.set(role, geo);
  return geo;
}

/** A posable operator. `rig` exposes the joints the walk cycle drives; `gun` hangs off the spine. */
export interface Operator {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly spine: THREE.Group;
  readonly head: THREE.Group;
  readonly thighL: THREE.Group; readonly thighR: THREE.Group;
  readonly shinL: THREE.Group; readonly shinR: THREE.Group;
  readonly gunMount: THREE.Group;
}

export function buildOperator(role: Role, accent: number): Operator {
  const geo = operatorGeo(role);
  const mats = modelMaterials(accent, role);
  const joint = (parent: THREE.Object3D, at: V3, geos?: Map<MatKey, THREE.BufferGeometry>): THREE.Group => {
    const g = new THREE.Group(); g.position.set(...at); parent.add(g);
    if (geos) for (const m of meshesOf(geos, mats)) g.add(m);
    return g;
  };
  const root = new THREE.Group();
  const hips = joint(root, RIG.hips, geo.hips);
  const thighL = joint(hips, RIG.thighL, geo.thigh), thighR = joint(hips, RIG.thighR, geo.thigh);
  const shinL = joint(thighL, RIG.knee, geo.shin), shinR = joint(thighR, RIG.knee, geo.shin);
  const spine = joint(hips, RIG.spine, geo.spine);
  const head = joint(spine, RIG.neck, geo.head);
  const gunMount = joint(spine, RIG.gunMount);
  return { root, hips, spine, head, thighL, thighR, shinL, shinR, gunMount };
}

/**
 * Walk cycle on an operator (match time, so it pauses with playback): thighs swing, knees bend on
 * the back-swing, the body bobs and counter-rotates a little; standing is a relaxed idle sway.
 */
export function animateOperator(op: Operator, moving: boolean, tMs: number, phase: number): void {
  if (moving) {
    const p = tMs / 115 + phase;
    const sw = Math.sin(p) * 0.42;
    op.thighL.rotation.z = sw; op.thighR.rotation.z = -sw;
    op.shinL.rotation.z = -Math.max(0, -Math.sin(p)) * 0.7 - 0.05;
    op.shinR.rotation.z = -Math.max(0, Math.sin(p)) * 0.7 - 0.05;
    op.hips.position.y = RIG.hips[1] - 0.02 + Math.abs(Math.cos(p)) * 0.035;
    op.spine.rotation.y = Math.sin(p) * 0.06;
    op.spine.rotation.z = -0.08; // lean into the move
  } else {
    const b = Math.sin(tMs / 1400 + phase) * 0.008;
    op.thighL.rotation.z = 0.04; op.thighR.rotation.z = -0.02;
    op.shinL.rotation.z = -0.06; op.shinR.rotation.z = -0.03;
    op.hips.position.y = RIG.hips[1] - 0.015 + b;
    op.spine.rotation.y = 0; op.spine.rotation.z = -0.03;
  }
}
