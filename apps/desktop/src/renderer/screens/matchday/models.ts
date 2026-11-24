// Original, procedurally built 3D models for the team cams: tactical operators, a family of
// weapons, first-person arms, and per-map light presets. Nothing here is taken from, traced from or
// shaped after a game's characters, weapons or skins: the silhouettes are our own, and a player's
// identity comes from our data (team colour, handle). No downloaded model is used.
//
// Conventions (scene metres): +X forward, +Y up, +Z to the figure's right. An operator stands on
// y = 0; a weapon's grip is at its origin with the muzzle along +X.
//
// Draw calls. Each operator is ONE rigidly skinned body mesh plus ONE skinned glow mesh (team
// accent, emissive) over a 13-bone skeleton; its weapon is one body mesh plus one glow mesh. So a
// figure costs 4 draw calls whatever its pose (OPERATOR_DRAW_CALLS). Geometry is built once per
// (role, accent) and per weapon class and shared by every figure that uses it; materials are shared
// per accent. Colours are baked into a vertex-colour attribute, so one body material serves all.
//
// Animation (for CamStage3D — the UI session wires it):
//   const input = animInputFor(round, player, pose, tMs, weaponClass, abilityMs?)   // from the track
//   const st = selectAnimState(input)                                                 // pure, unit-tested
//   poseOperator(op, st, tMs, phase, aimPitch)                                        // 3rd person
//   fpRig.update(weaponClass, st, tMs)                                               // 1st person
// States: idle, walk, run, crouch, crouchWalk (locomotion) × aim, shoot (recoil), reload, plant,
// defuse, throw (actions), and dead (a short ragdoll-lite fall). See docs/MODELS_AND_MAP_MESHES.md.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pose, RoundTimeline } from '../../matchday/timeline.ts';

// ── roles and weapon classes ────────────────────────────────────────────────────────────────

export type Role = 'controller' | 'initiator' | 'sentinel' | 'duelist';
/** Role per roster slot (1-based slot − 1). The engine fields one fixed comp in slot order
 *  (match-runner ASCENT_COMP: a controller, two initiators, a sentinel, a duelist). */
export const ROLE_BY_SLOT: readonly Role[] = ['controller', 'initiator', 'initiator', 'sentinel', 'duelist'];
export const roleForSlot = (slot: number): Role => ROLE_BY_SLOT[(((slot - 1) % ROLE_BY_SLOT.length) + ROLE_BY_SLOT.length) % ROLE_BY_SLOT.length]!;

/** rifle/carbine/lmg: long guns; sniper: heavy scoped; marksman: slim scoped bolt/lever; smg; shotgun: semi-auto; pump: pump-action; sawnoff: short two-barrel sidearm;
 *  pistol; autopistol: machine pistol; handcannon: big revolver-style sidearm. */
export type WeaponClass = 'rifle' | 'carbine' | 'sniper' | 'marksman' | 'smg' | 'shotgun' | 'pump' | 'sawnoff' | 'lmg' | 'pistol' | 'autopistol' | 'handcannon';
export const WEAPON_CLASSES: readonly WeaponClass[] = ['rifle', 'carbine', 'sniper', 'marksman', 'smg', 'shotgun', 'pump', 'sawnoff', 'lmg', 'pistol', 'autopistol', 'handcannon'];
/** Which of our models stands in for a bought weapon (the engine names weapons; the model is generic). */
export function weaponClassOf(name: string | null | undefined): WeaponClass {
  const n = (name ?? '').toLowerCase();
  if (/phantom/.test(n)) return 'carbine';
  if (/guardian|marshal|outlaw/.test(n)) return 'marksman';
  if (/vandal|bulldog|rifle/.test(n)) return 'rifle';
  if (/operator|sniper/.test(n)) return 'sniper';
  if (/spectre|stinger|smg/.test(n)) return 'smg';
  if (/bucky/.test(n)) return 'pump';
  if (/judge|shotgun/.test(n)) return 'shotgun';
  if (/shorty/.test(n)) return 'sawnoff';
  if (/odin|ares|lmg/.test(n)) return 'lmg';
  if (/sheriff|cannon/.test(n)) return 'handcannon';
  if (/frenzy/.test(n)) return 'autopistol';
  if (/classic|ghost|pistol/.test(n)) return 'pistol';
  return 'rifle';
}
export const isSidearm = (c: WeaponClass): boolean => c === 'pistol' || c === 'handcannon' || c === 'autopistol' || c === 'sawnoff';

// ── palette ─────────────────────────────────────────────────────────────────────────────────

type V3 = readonly [number, number, number];
type Paint = 'cloth' | 'pants' | 'trim' | 'metal' | 'armor' | 'glow' | 'fabric' | 'polymer' | 'glove' | 'accent';
/** Legacy material keys (CamStage3D's own view-model hands still use them). */
type MatKey = 'cloth' | 'pants' | 'trim' | 'metal' | 'armor' | 'glow' | 'fabric' | 'polymer';

const CLOTH_BY_ROLE: Record<Role, number> = { controller: 0x4c475c, initiator: 0x5a6249, sentinel: 0x606a74, duelist: 0x4a5b6d };
const PANTS = 0x434a53, TRIM = 0x2a3038, METAL = 0x7c8692, POLYMER = 0x46505b, GLOVE = 0x23272d;

function paintColour(p: Paint, role: Role | 'gun', accent: number): THREE.Color {
  const a = new THREE.Color(accent);
  switch (p) {
    case 'cloth': return new THREE.Color(role === 'gun' ? 0x3a434e : CLOTH_BY_ROLE[role]);
    case 'fabric': return new THREE.Color(role === 'gun' ? 0x353b44 : CLOTH_BY_ROLE[role]).multiplyScalar(0.8);
    case 'pants': return new THREE.Color(PANTS);
    case 'trim': return new THREE.Color(TRIM);
    case 'metal': return new THREE.Color(METAL);
    case 'polymer': return new THREE.Color(POLYMER);
    case 'glove': return new THREE.Color(GLOVE);
    // team colour, unlit parts: armour plates lean to the accent, panels carry it fully
    case 'armor': return a.clone().lerp(new THREE.Color(0x8e98a2), 0.38);
    case 'accent': return a.clone().multiplyScalar(0.85);
    case 'glow': return a;
  }
}

// ── materials ───────────────────────────────────────────────────────────────────────────────

/** The two materials every model uses: vertex-coloured body and the emissive team-accent glow. */
export interface SharedMaterials { readonly body: THREE.MeshStandardMaterial; readonly glow: THREE.MeshStandardMaterial }
export type ModelMaterials = Record<MatKey, THREE.Material> & SharedMaterials;
const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
const matCache = new Map<string, ModelMaterials>();

/** Team-tinted materials (one set per accent colour × role, shared by every figure that uses it). */
export function modelMaterials(accent: number, role: Role | 'gun' = 'gun'): ModelMaterials {
  const key = `${accent}:${role}`;
  const hit = matCache.get(key); if (hit) return hit;
  const a = new THREE.Color(accent);
  const glow = sharedGlow(accent);
  const m: ModelMaterials = {
    body: BODY, glow,
    cloth: new THREE.MeshStandardMaterial({ color: paintColour('cloth', role, accent), roughness: 0.92 }),
    pants: new THREE.MeshStandardMaterial({ color: PANTS, roughness: 0.95 }),
    trim: new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.55, metalness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.35, metalness: 0.65 }),
    armor: new THREE.MeshStandardMaterial({ color: paintColour('armor', role, accent), emissive: a, emissiveIntensity: 0.12, roughness: 0.5, metalness: 0.25 }),
    fabric: new THREE.MeshStandardMaterial({ color: paintColour('fabric', role, accent), roughness: 0.97, side: THREE.DoubleSide }),
    polymer: new THREE.MeshStandardMaterial({ color: POLYMER, roughness: 0.7 }),
  };
  matCache.set(key, m);
  return m;
}
const glowCache = new Map<number, THREE.MeshStandardMaterial>();
function sharedGlow(accent: number): THREE.MeshStandardMaterial {
  let g = glowCache.get(accent);
  if (!g) { const a = new THREE.Color(accent); g = new THREE.MeshStandardMaterial({ color: a, emissive: a, emissiveIntensity: 1.4, roughness: 0.3 }); glowCache.set(accent, g); }
  return g;
}
const accentOfMats = (m: ModelMaterials | number): number => (typeof m === 'number' ? m : m.glow.color.getHex());

// ── geometry kit: primitives placed in a bone's frame, baked to colour (+ skin) attributes ─────

interface Part { geo: THREE.BufferGeometry; paint: Paint; bone: number }

class Kit {
  readonly parts: Part[] = [];
  private bone = -1;
  private readonly at = new THREE.Matrix4();
  /** Following parts belong to `bone`, authored in its local frame; `bindPos` is that frame's origin in the model. */
  on(bone: number, bindPos: V3 = [0, 0, 0]): this { this.bone = bone; this.at.makeTranslation(...bindPos); return this; }
  add(paint: Paint, g: THREE.BufferGeometry, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
    const geo = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(this.at.clone().multiply(m));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    g.dispose();
    this.parts.push({ geo, paint, bone: this.bone });
    return this;
  }
  /** A capsule spanning two points (a limb). */
  limb(paint: Paint, a: V3, b: V3, r: number, seg = 10): this {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - 2 * r * 0.6), 3, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const e = new THREE.Euler().setFromQuaternion(q);
    return this.add(paint, g, [mid.x, mid.y, mid.z], [e.x, e.y, e.z]);
  }
  rbox(paint: Paint, w: number, h: number, d: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], r = 0.015): this {
    return this.add(paint, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), pos, rot);
  }
  cyl(paint: Paint, rTop: number, rBot: number, h: number, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], seg = 12, open = false): this {
    return this.add(paint, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), pos, rot);
  }
  /** A cylinder lying along +X (barrels, scopes). */
  tube(paint: Paint, r: number, x0: number, x1: number, y: number, z = 0, seg = 12): this {
    return this.cyl(paint, r, r, x1 - x0, [(x0 + x1) / 2, y, z], [0, 0, -Math.PI / 2], seg);
  }
  /** A side profile (x, y points, counter-clockwise) extruded across Z with a small bevel. */
  profile(paint: Paint, pts: ReadonlyArray<readonly [number, number]>, depth: number, z = 0): this {
    const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const bevel = Math.min(0.004, depth / 6);
    const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    return this.add(paint, g, [0, 0, z - depth / 2 + bevel]);
  }
  sphere(paint: Paint, r: number, pos: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], phiLen = Math.PI * 2, thetaLen = Math.PI, rot: V3 = [0, 0, 0]): this {
    return this.add(paint, new THREE.SphereGeometry(r, 14, 10, 0, phiLen, 0, thetaLen), pos, rot, scale);
  }
  /** Bake: body (vertex colours) + glow, each with rigid skin attributes when `skinned`. */
  build(role: Role | 'gun', accent: number, skinned: boolean): { body: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const bake = (parts: Part[], colour: boolean): THREE.BufferGeometry | null => {
      if (!parts.length) return null;
      const list = parts.map((p) => {
        const g = p.geo.clone();
        const n = g.getAttribute('position').count;
        if (colour) {
          const c = paintColour(p.paint, role, accent);
          const arr = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
          g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        }
        if (skinned) {
          const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
          for (let i = 0; i < n; i++) { si[i * 4] = Math.max(0, p.bone); sw[i * 4] = 1; }
          g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
          g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
        }
        return g;
      });
      const g = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      if (!g) return null;
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    };
    return { body: bake(this.parts.filter((p) => p.paint !== 'glow'), true), glow: bake(this.parts.filter((p) => p.paint === 'glow'), false) };
  }
}

// ── weapons ─────────────────────────────────────────────────────────────────────────────────

interface WeaponGeo { body: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; muzzle: V3; foregrip: V3; magazine: V3; length: number }
const weaponCache = new Map<WeaponClass, WeaponGeo>();

function weaponGeo(c: WeaponClass): WeaponGeo {
  const hit = weaponCache.get(c); if (hit) return hit;
  const k = new Kit();
  let muzzle: V3 = [0.7, 0.04, 0]; let foregrip: V3 = [0.36, 0.0, 0]; let magazine: V3 = [0.19, -0.09, 0];
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
      if (c === 'lmg') { k.rbox('metal', 0.1, 0.11, 0.07, [0.15, -0.06, 0.012], [0, 0, 0], 0.01); k.rbox('trim', 0.05, 0.08, 0.02, [0.46, -0.04, 0], [0, 0, 0], 0.005); magazine = [0.15, -0.08, 0]; } // box magazine + bipod block
      else if (c === 'shotgun') { k.tube('trim', 0.019, 0.3, 0.5, -0.008); k.rbox('polymer', 0.12, 0.04, 0.05, [0.4, -0.012, 0], [0, 0, 0], 0.01); magazine = [0.4, -0.02, 0]; }
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
      k.profile('trim', [[-0.06, 0.0], [-0.24, -0.06], [-0.36, -0.05], [-0.37, 0.07], [-0.06, 0.072]], 0.042); // thumbhole stock
      k.rbox('polymer', 0.09, 0.035, 0.05, [-0.2, -0.015, 0], [0, 0, 0.3], 0.01);
      grip(0);
      k.rbox('metal', 0.07, 0.07, 0.04, [0.16, -0.04, 0], [0, 0, 0], 0.008);
      k.tube('metal', 0.014, 0.36, 0.86, 0.04); k.tube('trim', 0.024, 0.86, 0.94, 0.04, 0, 6);
      k.tube('trim', 0.026, 0.06, 0.34, 0.125, 0, 16);                                   // scope
      k.tube('trim', 0.034, 0.3, 0.36, 0.125, 0, 16); k.tube('trim', 0.03, 0.04, 0.09, 0.125, 0, 16);
      k.tube('glow', 0.028, 0.36, 0.365, 0.125, 0, 16);
      k.rbox('trim', 0.03, 0.04, 0.03, [0.12, 0.09, 0], [0, 0, 0], 0.004); k.rbox('trim', 0.03, 0.04, 0.03, [0.26, 0.09, 0], [0, 0, 0], 0.004);
      muzzle = [0.94, 0.04, 0]; foregrip = [0.4, 0.0, 0]; magazine = [0.16, -0.06, 0];
      break;
    }
    case 'smg': {
      k.profile('trim', [[-0.05, 0.0], [0.22, 0.0], [0.24, 0.03], [0.22, 0.07], [-0.05, 0.07]], 0.046);
      k.rbox('glow', 0.12, 0.008, 0.048, [0.08, 0.05, 0], [0, 0, 0], 0.003);
      k.profile('polymer', [[0.22, 0.008], [0.34, 0.012], [0.34, 0.058], [0.22, 0.064]], 0.05);
      k.tube('trim', 0.02, 0.34, 0.46, 0.036, 0, 14);
      k.rbox('metal', 0.035, 0.18, 0.03, [0.1, -0.09, 0], [0, 0, 0.08], 0.006);           // straight magazine
      k.limb('metal', [-0.05, 0.05, 0.016], [-0.24, 0.03, 0.016], 0.006, 6); k.limb('metal', [-0.05, 0.02, -0.016], [-0.24, 0.0, -0.016], 0.006, 6);
      k.rbox('polymer', 0.02, 0.07, 0.05, [-0.245, 0.02, 0], [0, 0, 0], 0.005);
      grip(0);
      k.rbox('trim', 0.05, 0.022, 0.026, [0.06, 0.084, 0], [0, 0, 0], 0.005);
      muzzle = [0.46, 0.036, 0]; foregrip = [0.29, -0.005, 0]; magazine = [0.1, -0.13, 0];
      break;
    }
    case 'handcannon': {
      k.profile('metal', [[-0.05, 0.03], [0.2, 0.03], [0.2, 0.075], [-0.05, 0.08]], 0.034);
      k.tube('trim', 0.03, 0.0, 0.06, 0.05, 0, 8);                                        // drum
      k.profile('polymer', [[-0.035, 0.0], [0.07, 0.0], [0.07, 0.032], [-0.045, 0.032], [-0.06, -0.11], [-0.005, -0.115]], 0.034);
      k.rbox('glow', 0.12, 0.006, 0.036, [0.08, 0.076, 0], [0, 0, 0], 0.002);
      muzzle = [0.2, 0.053, 0]; foregrip = [0, -0.06, 0]; magazine = [0.03, 0.05, 0.03];
      break;
    }
    case 'autopistol': {   // machine pistol: long slide with port cuts, compensator, extended straight magazine
      k.profile('metal', [[-0.045, 0.03], [0.19, 0.03], [0.195, 0.05], [0.19, 0.075], [-0.04, 0.077], [-0.05, 0.055]], 0.034);
      for (let i = 0; i < 3; i++) k.rbox('trim', 0.012, 0.03, 0.036, [0.07 + i * 0.03, 0.074, 0], [0, 0, 0.5], 0.002);   // slide ports
      k.rbox('trim', 0.05, 0.03, 0.03, [0.2, 0.062, 0], [0, 0, 0], 0.005);                // compensator
      k.profile('polymer', [[-0.03, 0.0], [0.12, 0.0], [0.12, 0.03], [-0.04, 0.03], [-0.055, -0.1], [-0.005, -0.105]], 0.036);
      k.rbox('metal', 0.034, 0.17, 0.028, [-0.03, -0.17, 0], [0, 0, 0.05], 0.005);        // extended magazine
      k.rbox('glow', 0.1, 0.005, 0.036, [0.06, 0.078, 0], [0, 0, 0], 0.002);
      muzzle = [0.225, 0.058, 0]; foregrip = [0, -0.06, 0]; magazine = [-0.03, -0.17, 0];
      break;
    }
    case 'sawnoff': {      // short two-barrel sidearm
      k.profile('polymer', [[-0.03, 0.0], [0.07, 0.0], [0.07, 0.03], [-0.04, 0.03], [-0.065, -0.1], [-0.01, -0.105]], 0.036);
      k.rbox('metal', 0.1, 0.05, 0.05, [0.04, 0.05, 0], [0, 0, 0], 0.008);                // breech block
      k.tube('trim', 0.015, 0.09, 0.3, 0.05, 0.016, 12); k.tube('trim', 0.015, 0.09, 0.3, 0.05, -0.016, 12); // twin barrels
      k.tube('metal', 0.017, 0.29, 0.3, 0.05, 0.016, 12); k.tube('metal', 0.017, 0.29, 0.3, 0.05, -0.016, 12);
      k.rbox('glow', 0.08, 0.006, 0.05, [0.05, 0.078, 0], [0, 0, 0], 0.002);
      muzzle = [0.3, 0.05, 0]; foregrip = [0, -0.06, 0]; magazine = [0.15, 0.04, 0];
      break;
    }
    case 'pump': {         // pump-action: long barrel, under-barrel tube, sliding forend sleeve
      k.profile('trim', [[-0.07, 0.0], [0.24, 0.0], [0.27, 0.03], [0.25, 0.07], [0.0, 0.08], [-0.07, 0.055]], 0.046);
      k.rbox('glow', 0.12, 0.008, 0.048, [0.1, 0.052, 0], [0, 0, 0], 0.003);
      k.profile('trim', [[-0.07, 0.012], [-0.3, -0.03], [-0.34, 0.01], [-0.33, 0.07], [-0.07, 0.07]], 0.04);   // stock
      k.rbox('polymer', 0.025, 0.1, 0.044, [-0.335, 0.02, 0], [0, 0, 0], 0.006);
      grip(0);
      k.tube('metal', 0.017, 0.24, 0.78, 0.045); k.tube('trim', 0.019, 0.24, 0.7, -0.005);     // barrel + magazine tube
      k.rbox('polymer', 0.16, 0.05, 0.062, [0.44, -0.005, 0], [0, 0, 0], 0.015);               // pump forend
      k.tube('trim', 0.02, 0.78, 0.8, 0.045, 0, 10);
      k.rbox('trim', 0.05, 0.02, 0.03, [0.16, 0.088, 0], [0, 0, 0], 0.004);                    // rear sight
      muzzle = [0.8, 0.045, 0]; foregrip = [0.44, -0.012, 0]; magazine = [0.18, 0.0, 0];
      break;
    }
    case 'marksman': {     // slim scoped rifle with a long thin barrel and a bolt knob
      k.profile('trim', [[-0.06, 0.0], [0.3, 0.0], [0.32, 0.028], [0.3, 0.066], [-0.02, 0.072], [-0.06, 0.05]], 0.042);
      k.rbox('glow', 0.14, 0.007, 0.044, [0.12, 0.05, 0], [0, 0, 0], 0.003);
      k.profile('polymer', [[-0.06, 0.0], [-0.22, -0.045], [-0.34, -0.04], [-0.35, 0.065], [-0.06, 0.068]], 0.038);
      k.rbox('polymer', 0.025, 0.09, 0.04, [-0.345, 0.012, 0], [0, 0, 0], 0.006);
      grip(0);
      k.tube('metal', 0.0105, 0.32, 0.78, 0.04); k.tube('trim', 0.016, 0.78, 0.84, 0.04, 0, 8);
      k.profile('polymer', [[0.3, 0.004], [0.55, 0.012], [0.55, 0.05], [0.3, 0.06]], 0.036);   // slim handguard
      k.tube('trim', 0.02, 0.07, 0.27, 0.11, 0, 14); k.tube('glow', 0.021, 0.27, 0.274, 0.11, 0, 14); // scope
      k.rbox('trim', 0.02, 0.04, 0.024, [0.12, 0.085, 0], [0, 0, 0], 0.003); k.rbox('trim', 0.02, 0.04, 0.024, [0.22, 0.085, 0], [0, 0, 0], 0.003);
      k.tube('metal', 0.007, 0.09, 0.13, 0.065, 0.034, 8); k.rbox('metal', 0.02, 0.02, 0.02, [0.13, 0.065, 0.054], [0, 0, 0], 0.004); // bolt handle
      k.rbox('metal', 0.045, 0.06, 0.03, [0.15, -0.035, 0], [0, 0, 0], 0.006);               // short magazine
      muzzle = [0.84, 0.04, 0]; foregrip = [0.4, 0.0, 0]; magazine = [0.15, -0.05, 0];
      break;
    }
    case 'pistol':
    default: {
      k.profile('metal', [[-0.045, 0.03], [0.15, 0.03], [0.155, 0.05], [0.15, 0.07], [-0.04, 0.072], [-0.05, 0.055]], 0.032); // slide
      k.profile('polymer', [[-0.03, 0.0], [0.11, 0.0], [0.11, 0.03], [-0.04, 0.03], [-0.055, -0.1], [-0.005, -0.105]], 0.034);
      k.rbox('glow', 0.08, 0.005, 0.034, [0.05, 0.072, 0], [0, 0, 0], 0.002);
      muzzle = [0.155, 0.05, 0]; foregrip = [0, -0.06, 0]; magazine = [-0.03, -0.11, 0];
      break;
    }
  }
  // weapon colours do not depend on the team (the glow material carries the accent)
  const built = k.build('gun', 0xffffff, false);
  const geo: WeaponGeo = { body: built.body!, glow: built.glow, muzzle, foregrip, magazine, length: muzzle[0] };
  weaponCache.set(c, geo);
  return geo;
}

/** Local points of a weapon class (grip at origin): muzzle, support-hand grip, magazine. */
export function weaponPoints(c: WeaponClass): { muzzle: V3; foregrip: V3; magazine: V3 } {
  const w = weaponGeo(c); return { muzzle: w.muzzle, foregrip: w.foregrip, magazine: w.magazine };
}

/** A weapon model (grip at origin, muzzle along +X): 2 meshes. `userData.muzzle|foregrip|magazine` are local points. */
export function buildWeapon(c: WeaponClass, mats: ModelMaterials | number): THREE.Group {
  const w = weaponGeo(c);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(w.body, BODY));
  if (w.glow) g.add(new THREE.Mesh(w.glow, sharedGlow(accentOfMats(mats))));
  g.userData = { cls: c, muzzle: w.muzzle, foregrip: w.foregrip, magazine: w.magazine };
  return g;
}

// ── operators: skeleton ───────────────────────────────────────────────────────────────────────

/** Bone indices of the operator skeleton (also the skinIndex values in the geometry). */
export const BONE = {
  root: 0, hips: 1, spine: 2, head: 3,
  thighL: 4, shinL: 5, thighR: 6, shinR: 7,
  upperArmL: 8, foreArmL: 9, upperArmR: 10, foreArmR: 11,
  gunMount: 12,
} as const;
const BONE_PARENT = [-1, 0, 1, 2, 1, 4, 1, 6, 2, 8, 2, 10, 2];
const UPPER_ARM = 0.31, FORE_ARM = 0.31;

/** Joint frames (rest pose; bone-local offsets from the parent). Widths scale per role. */
export const RIG = {
  hips: [0, 0.93, 0] as V3,
  thighL: [0, -0.03, -0.105] as V3, thighR: [0, -0.03, 0.105] as V3,
  knee: [0, -0.44, 0] as V3,
  spine: [0, 0.05, 0] as V3,
  neck: [0.01, 0.6, 0] as V3,
  shoulder: [0, 0.5, 0.22] as V3,
  elbow: [0, -UPPER_ARM, 0] as V3,
  /** Where the gun's grip sits in the spine frame at rest (shouldered); animation moves it. */
  gunMount: [0.2, 0.41, 0.13] as V3,
} as const;

function restOffsets(role: Role): V3[] {
  const w = role === 'sentinel' ? 1.08 : role === 'duelist' ? 0.93 : 1;
  const sh = RIG.shoulder[2] * w;
  return [
    [0, 0, 0], RIG.hips, RIG.spine, RIG.neck,
    [0, RIG.thighL[1], RIG.thighL[2] * w], RIG.knee, [0, RIG.thighR[1], RIG.thighR[2] * w], RIG.knee,
    [0, RIG.shoulder[1], -sh], RIG.elbow, [0, RIG.shoulder[1], sh], RIG.elbow,
    RIG.gunMount,
  ];
}
/** Bind-pose origin of every bone in the model frame (rest rotations are all zero). */
function bindPositions(rest: V3[]): V3[] {
  const out: V3[] = [];
  rest.forEach((r, i) => {
    const p = BONE_PARENT[i]!;
    const o = p < 0 ? [0, 0, 0] : out[p]!;
    out.push([o[0] + r[0], o[1] + r[1], o[2] + r[2]]);
  });
  return out;
}

interface OperatorGeo { body: THREE.BufferGeometry; glow: THREE.BufferGeometry | null; rest: V3[] }
const operatorCache = new Map<string, OperatorGeo>();

function operatorGeo(role: Role, accent: number): OperatorGeo {
  const key = `${role}:${accent}`;
  const hit = operatorCache.get(key); if (hit) return hit;
  const heavy = role === 'sentinel', light = role === 'duelist';
  const w = heavy ? 1.08 : light ? 0.93 : 1;
  const rest = restOffsets(role);
  const bp = bindPositions(rest);
  const k = new Kit();
  const sh = RIG.shoulder[2] * w;

  // hips
  k.on(BONE.hips, bp[BONE.hips])
    .rbox('pants', 0.22, 0.17, 0.32 * w, [0, 0, 0], [0, 0, 0], 0.05)
    .rbox('trim', 0.25, 0.05, 0.35 * w, [0, 0.07, 0], [0, 0, 0], 0.015)                    // belt
    .rbox('trim', 0.07, 0.11, 0.05, [0.02, -0.02, 0.18 * w], [0, 0, 0], 0.012);            // holster (right)
  if (role === 'controller') {
    k.cyl('fabric', 0.2, 0.31, 0.62, [-0.02, -0.26, 0], [0, 0, 0], 16, true);              // long coat skirt
    for (let i = 0; i < 3; i++) k.cyl('glow', 0.022, 0.022, 0.07, [0.12, 0.06, -0.08 + i * 0.08], [0, 0, 0], 8); // canisters
  }
  if (role === 'initiator') k.rbox('trim', 0.08, 0.1, 0.06, [-0.04, -0.03, -0.18], [0, 0, 0], 0.012);

  // legs: thigh from the hip joint down, shin from the knee down, boot on the floor
  for (const [thigh, shin, side] of [[BONE.thighL, BONE.shinL, -1], [BONE.thighR, BONE.shinR, 1]] as const) {
    k.on(thigh, bp[thigh]).limb('pants', [0, 0, 0], [0.01, -0.42, 0], 0.075 * w);
    if (heavy) k.rbox('armor', 0.05, 0.18, 0.12, [0.07, -0.2, 0], [0, 0, 0], 0.02);
    if (role === 'initiator' && side > 0) k.rbox('trim', 0.06, 0.12, 0.11, [0.0, -0.18, 0.06], [0, 0, 0], 0.015); // leg pouch
    if (light) k.rbox('glow', 0.012, 0.16, 0.02, [0.07, -0.2, side * 0.03], [0, 0, 0], 0.004);   // thigh stripe
    k.on(shin, bp[shin]).limb('pants', [0, 0, 0], [0, -0.37, 0], 0.06 * w)
      .rbox('trim', 0.25, 0.1, 0.13, [0.045, -0.42, 0], [0, 0, 0], 0.035)                  // boot
      .rbox('trim', 0.12, 0.1, 0.12, [0.0, -0.33, 0], [0, 0, 0], 0.03);
    if (role !== 'controller') k.rbox('armor', 0.05, 0.1, 0.1, [0.065, -0.01, 0], [0, 0, 0], 0.02); // knee pad
  }

  // torso
  k.on(BONE.spine, bp[BONE.spine])
    .rbox('cloth', 0.22, 0.26, 0.33 * w, [0, 0.13, 0], [0, 0, 0], 0.07)                    // abdomen
    .rbox('cloth', 0.26, 0.3, 0.41 * w, [0, 0.38, 0], [0, 0, 0], 0.08)                     // chest
    .rbox('armor', 0.06, 0.27, 0.33 * w, [0.13, 0.38, 0], [0, 0, 0], 0.025)                // front plate (team)
    .rbox('armor', 0.05, 0.25, 0.31 * w, [-0.13, 0.38, 0], [0, 0, 0], 0.02)                // back plate (team)
    .rbox('accent', 0.01, 0.05, 0.2 * w, [0.165, 0.44, 0], [0, 0, 0], 0.006)               // chest team bar
    .cyl('trim', 0.055, 0.065, 0.1, [0.005, 0.55, 0], [0, 0, 0], 10)                       // collar
    .sphere('cloth', 0.085, [0, 0.5, sh]).sphere('cloth', 0.085, [0, 0.5, -sh]);
  switch (role) {
    case 'duelist':
      k.rbox('glow', 0.065, 0.02, 0.2, [0.15, 0.46, 0], [0, 0, 0.3], 0.006)                 // chest chevrons
        .rbox('glow', 0.065, 0.02, 0.16, [0.15, 0.4, 0], [0, 0, 0.3], 0.006)
        .rbox('cloth', 0.24, 0.08, 0.44, [-0.02, 0.56, 0], [0, 0, -0.25], 0.03)            // flared jacket collar
        .rbox('trim', 0.05, 0.03, 0.05, [-0.04, 0.6, sh * 0.9], [0.4, 0, 0], 0.01)         // shoulder fins
        .rbox('trim', 0.05, 0.03, 0.05, [-0.04, 0.6, -sh * 0.9], [-0.4, 0, 0], 0.01);
      break;
    case 'initiator':
      k.rbox('trim', 0.17, 0.32, 0.29, [-0.22, 0.36, 0], [0, 0, 0], 0.05)                   // recon pack
        .rbox('accent', 0.01, 0.2, 0.05, [-0.31, 0.38, 0], [0, 0, 0], 0.005)
        .cyl('metal', 0.006, 0.006, 0.38, [-0.25, 0.68, -0.1], [0, 0, -0.12], 6)           // antenna mast
        .sphere('glow', 0.014, [-0.27, 0.87, -0.1]);
      break;
    case 'controller':
      k.cyl('fabric', 0.18, 0.21, 0.26, [-0.01, 0.42, 0], [0, 0, 0], 16, true)              // coat over the chest
        .rbox('fabric', 0.24, 0.16, 0.44, [-0.01, 0.52, 0], [0, 0, 0], 0.06)               // high collar
        .rbox('glow', 0.02, 0.2, 0.02, [0.15, 0.36, 0.06], [0, 0, 0], 0.006);
      break;
    case 'sentinel':
      k.rbox('trim', 0.07, 0.08, 0.08, [0.17, 0.27, -0.09], [0, 0, 0], 0.012)               // chest-rig pouches
        .rbox('trim', 0.07, 0.08, 0.08, [0.17, 0.27, 0.01], [0, 0, 0], 0.012)
        .rbox('trim', 0.18, 0.26, 0.32, [-0.22, 0.34, 0], [0, 0, 0], 0.03)                 // tool case
        .rbox('glow', 0.02, 0.18, 0.02, [-0.31, 0.36, -0.1], [0, 0, 0], 0.006);
      break;
  }

  // arms: upper arm from the shoulder down, forearm from the elbow down, gloved hand at the wrist
  for (const [up, fore, side] of [[BONE.upperArmL, BONE.foreArmL, -1], [BONE.upperArmR, BONE.foreArmR, 1]] as const) {
    k.on(up, bp[up]).limb('cloth', [0, 0, 0], [0, -UPPER_ARM, 0], 0.055 * w)
      .cyl('armor', 0.064 * w, 0.064 * w, 0.075, [0, -0.1, 0], [0, 0, 0], 12);             // team armband
    if (heavy) k.rbox('armor', 0.2, 0.1, 0.18, [0, 0.03, side * 0.03], [side * 0.25, 0, 0], 0.03); // pauldron
    if (role === 'initiator' && side > 0) k.sphere('armor', 0.06, [0, 0.02, 0.04], [1, 0.7, 1]).sphere('glow', 0.024, [0.05, 0.02, 0.06]); // sensor pod
    if (light) k.rbox('accent', 0.03, 0.08, 0.02, [0.0, -0.05, side * 0.055], [0, 0, 0], 0.006);
    k.on(fore, bp[fore]).limb('cloth', [0, 0, 0], [0, -FORE_ARM + 0.03, 0], 0.047 * w)
      .cyl('glow', 0.05 * w, 0.05 * w, 0.022, [0, -FORE_ARM + 0.05, 0], [0, 0, 0], 12)     // accent cuff
      .rbox('glove', 0.075, 0.1, 0.085, [0.01, -FORE_ARM - 0.03, 0], [0, 0, 0], 0.03);     // glove
  }

  // head: helmet + a wide visor that shows where the player looks; per-role crest / hood / face plate
  k.on(BONE.head, bp[BONE.head])
    .sphere(heavy ? 'armor' : 'pants', 0.12, [0, 0.11, 0], [1.02, 1.05, 0.96])
    .rbox('glow', 0.05, 0.055, 0.21, [0.105, 0.11, 0], [0, 0, 0], 0.02)                    // visor (forward)
    .rbox('trim', 0.12, 0.05, 0.27, [0.0, 0.04, 0], [0, 0, 0], 0.02)                       // jaw guard
    .rbox('trim', 0.05, 0.035, 0.08, [0.12, 0.05, 0], [0, 0, 0], 0.012);                   // breather (points forward too)
  switch (role) {
    case 'duelist':
      k.rbox('armor', 0.22, 0.025, 0.03, [-0.03, 0.24, 0], [0, 0, -0.35], 0.008);          // swept crest
      break;
    case 'initiator':
      k.cyl('trim', 0.04, 0.04, 0.03, [0, 0.11, 0.14], [Math.PI / 2, 0, 0], 12)            // earpiece
        .cyl('metal', 0.004, 0.004, 0.12, [-0.02, 0.2, 0.14], [0, 0, -0.3], 5)
        .sphere('glow', 0.016, [0.09, 0.2, 0.07]);                                          // helmet lamp
      break;
    case 'controller':
      k.sphere('fabric', 0.165, [-0.025, 0.12, 0], [1.05, 1.1, 1.05], Math.PI * 2, Math.PI * 0.62, [0, 0, 0.25]); // hood
      break;
    case 'sentinel':
      k.rbox('armor', 0.06, 0.15, 0.23, [0.115, 0.08, 0], [0, 0, 0], 0.025)                 // face plate
        .rbox('glow', 0.02, 0.024, 0.2, [0.148, 0.11, 0], [0, 0, 0], 0.006);                // visor slit
      break;
  }

  const built = k.build(role, accent, true);
  const geo: OperatorGeo = { body: built.body!, glow: built.glow, rest };
  operatorCache.set(key, geo);
  return geo;
}

/** Draw calls of one operator (body + glow) and of one held weapon (body + glow). */
export const OPERATOR_DRAW_CALLS = 2;
export const WEAPON_DRAW_CALLS = 2;

/** A posable operator. Joints are bones of one skinned mesh; `gunMount` carries the weapon. */
export interface Operator {
  readonly role: Role;
  readonly root: THREE.Group;
  readonly bones: readonly THREE.Bone[];
  readonly skeleton: THREE.Skeleton;
  readonly meshes: readonly THREE.SkinnedMesh[];
  readonly hips: THREE.Bone;
  readonly spine: THREE.Bone;
  readonly head: THREE.Bone;
  readonly thighL: THREE.Bone; readonly thighR: THREE.Bone;
  readonly shinL: THREE.Bone; readonly shinR: THREE.Bone;
  readonly upperArmL: THREE.Bone; readonly upperArmR: THREE.Bone;
  readonly foreArmL: THREE.Bone; readonly foreArmR: THREE.Bone;
  readonly gunMount: THREE.Bone;
  /** Rest offsets per bone (for resetting a pose). */
  readonly rest: readonly V3[];
  /** Weapon class carried (set by setOperatorWeapon; the arms reach for its grips). */
  weaponCls: WeaponClass;
  weapon: THREE.Group | null;
}

export function buildOperator(role: Role, accent: number): Operator {
  const geo = operatorGeo(role, accent);
  const root = new THREE.Group();
  const bones = geo.rest.map((r, i) => { const b = new THREE.Bone(); b.name = Object.keys(BONE)[i]!; b.position.set(...r); return b; });
  bones.forEach((b, i) => { const p = BONE_PARENT[i]!; (p < 0 ? root : bones[p]!).add(b); });
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes: THREE.SkinnedMesh[] = [];
  const sphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.0); // covers every pose incl. lying down
  for (const [g, m] of [[geo.body, BODY], [geo.glow, sharedGlow(accent)]] as const) {
    if (!g) continue;
    const sm = new THREE.SkinnedMesh(g, m);
    sm.boundingSphere = sphere.clone();
    sm.bind(skeleton);
    root.add(sm); meshes.push(sm);
  }
  const op: Operator = {
    role, root, bones, skeleton, meshes, rest: geo.rest,
    hips: bones[BONE.hips]!, spine: bones[BONE.spine]!, head: bones[BONE.head]!,
    thighL: bones[BONE.thighL]!, thighR: bones[BONE.thighR]!, shinL: bones[BONE.shinL]!, shinR: bones[BONE.shinR]!,
    upperArmL: bones[BONE.upperArmL]!, upperArmR: bones[BONE.upperArmR]!, foreArmL: bones[BONE.foreArmL]!, foreArmR: bones[BONE.foreArmR]!,
    gunMount: bones[BONE.gunMount]!, weaponCls: 'rifle', weapon: null,
  };
  return op;
}

/** Hang this weapon class on the operator's gun mount (reuses the model when the class is unchanged). */
export function setOperatorWeapon(op: Operator, cls: WeaponClass, accent: number): THREE.Group {
  if (op.weapon && op.weaponCls === cls) return op.weapon;
  if (op.weapon) op.gunMount.remove(op.weapon);
  op.weapon = buildWeapon(cls, accent); op.weaponCls = cls;
  op.gunMount.add(op.weapon);
  return op.weapon;
}

/** Draw calls this operator costs now (visible meshes, weapon included). */
export function drawCallsOf(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
}

// ── animation state from the track ───────────────────────────────────────────────────────────

export type Locomotion = 'idle' | 'walk' | 'run' | 'crouch' | 'crouchWalk';
export type Action = 'none' | 'aim' | 'peek' | 'shoot' | 'reload' | 'plant' | 'defuse' | 'throw';
export type AnimStateName = Locomotion | Exclude<Action, 'none'> | 'dead';

export interface AnimState {
  /** The dominant state (dead > action > locomotion), for labels and tests. */
  readonly name: AnimStateName;
  readonly locomotion: Locomotion;
  readonly action: Action;
  /** 0..1 through a timed action (reload, plant, defuse, throw); 0 otherwise. */
  readonly actionT: number;
  /** Recoil right now, 0..1 (decays after each shot). */
  readonly kick: number;
  readonly flash: boolean;
  /** 0..1 through the death fall (1 = lying still); 0 while alive. */
  readonly deadT: number;
  /** Stride rate relative to a run (0 standing). */
  readonly gait: number;
  /** Where the player looks relative to where the body points: wrapped to (−π, π], radians, + = to the left (game x/y, counter-clockwise). 0 without aim data. */
  readonly aimYawRel: number;
  /** Look pitch, radians, + up. */
  readonly aimPitch: number;
  /** Sideways share of the movement relative to the aim, −1 (right) .. 1 (left); 0 when not moving or no aim data. */
  readonly strafe: number;
  /** Slow, aim-led movement (slicing an angle): walking with the gaze well off the travel direction. */
  readonly slice: boolean;
}

/** What the track says about one player at one instant (all times in round ms). */
export interface AnimInput {
  readonly tMs: number;
  readonly alive: boolean;
  readonly deathMs?: number | null;
  readonly moving?: boolean;
  readonly moveMode?: 'run' | 'walk' | null;
  /** Speed between consecutive track samples (uu/s); beats `moving`/`moveMode` when given. */
  readonly speedUUps?: number | null;
  /** The engine has no crouch flag today; a future one plugs in here. */
  readonly crouched?: boolean;
  /** Times this player fired (see shotTimesFor). */
  readonly shotsMs?: readonly number[];
  /** This player's spike plant / defuse windows. */
  readonly plant?: { readonly startMs: number; readonly endMs: number } | null;
  readonly defuse?: { readonly startMs: number; readonly endMs: number } | null;
  /** Times this player used an ability (replay `abilityUse` events). */
  readonly abilityMs?: readonly number[];
  /** Times this player starts a peek (leans out of cover toward the gaze, 800 ms). Without it a peek is inferred in the lead-up to a shot. */
  readonly peekMs?: readonly number[];
  readonly weapon?: WeaponClass;
  /** Movement heading (world x/y, radians). Defaults to the body direction the caller places the figure with. */
  readonly headingRad?: number | null;
  /** Continuous aim / gaze from the track when present (world x/y yaw, radians; pitch + up). Absent → the figure looks along its heading. */
  readonly aimYawRad?: number | null;
  readonly aimPitchRad?: number | null;
  /** Travel direction when it differs from `headingRad` (e.g. finite differences of the track), for strafe detection. */
  readonly travelRad?: number | null;
}

/** Timing of the animation layer (ms; speeds in uu/s). Our own numbers, not a game's. */
export const ANIM = {
  runSpeedUU: 675, walkSpeedUU: 340, standStillUU: 40,
  burstShots: 3, burstEveryMs: 110,
  shotKickMs: 90, flashMs: 45, shootHoldMs: 160,
  aimLeadMs: 450, aimHoldMs: 1000,
  reloadDelayMs: 1100,
  reloadMs: { rifle: 2200, carbine: 2100, sniper: 3000, marksman: 2600, smg: 2000, shotgun: 2400, pump: 2800, sawnoff: 1600, lmg: 3600, pistol: 1500, autopistol: 1500, handcannon: 1800 } as Record<WeaponClass, number>,
  throwMs: 650, fallMs: 650, peekMs: 800,
  walkStrideMs: 900, runStrideMs: 620,
} as const;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrapPi = (a: number): number => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; else if (x <= -Math.PI) x += 2 * Math.PI; return x; };

const kneel = (a: Action): boolean => a === 'plant' || a === 'defuse';

export function selectAnimState(i: AnimInput): AnimState {
  const t = i.tMs;
  const deadAt = i.deathMs ?? null;
  if (!i.alive || (deadAt != null && t >= deadAt)) {
    const deadT = deadAt == null ? 1 : clamp01((t - deadAt) / ANIM.fallMs);
    return { name: 'dead', locomotion: 'idle', action: 'none', actionT: 0, kick: 0, flash: false, deadT, gait: 0, aimYawRel: 0, aimPitch: 0, strafe: 0, slice: false };
  }
  // locomotion
  let gait = 0;
  if (i.speedUUps != null && Number.isFinite(i.speedUUps)) {
    gait = i.speedUUps < ANIM.standStillUU ? 0 : Math.min(1.3, i.speedUUps / ANIM.runSpeedUU);
  } else if (i.moving) gait = i.moveMode === 'walk' ? ANIM.walkSpeedUU / ANIM.runSpeedUU : 1;
  const walkRun = (ANIM.walkSpeedUU + ANIM.runSpeedUU) / 2 / ANIM.runSpeedUU;
  let locomotion: Locomotion = gait === 0 ? 'idle' : gait < walkRun ? 'walk' : 'run';
  if (i.crouched) locomotion = gait === 0 ? 'crouch' : 'crouchWalk';

  // shots around now
  let last = -Infinity, next = Infinity;
  for (const s of i.shotsMs ?? []) { if (s <= t) { if (s > last) last = s; } else if (s < next) next = s; }
  const since = t - last;
  const kick = Number.isFinite(since) ? Math.exp(-since / ANIM.shotKickMs) : 0;
  const flash = since >= 0 && since < ANIM.flashMs;

  let action: Action = 'none', actionT = 0;
  const win = (w: { startMs: number; endMs: number } | null | undefined): number | null =>
    w && t >= w.startMs && t < w.endMs ? clamp01((t - w.startMs) / Math.max(1, w.endMs - w.startMs)) : null;
  const pT = win(i.plant), dT = win(i.defuse);
  let throwT: number | null = null;
  for (const a of i.abilityMs ?? []) if (t >= a && t < a + ANIM.throwMs) throwT = clamp01((t - a) / ANIM.throwMs);
  let peekT: number | null = null;
  for (const pk of i.peekMs ?? []) if (t >= pk && t < pk + ANIM.peekMs) peekT = clamp01((t - pk) / ANIM.peekMs);
  if (peekT == null && i.peekMs == null && next - t < ANIM.aimLeadMs * 2 && next - t >= ANIM.aimLeadMs) peekT = clamp01(1 - (next - t - ANIM.aimLeadMs) / ANIM.aimLeadMs); // inferred
  const reloadMs = ANIM.reloadMs[i.weapon ?? 'rifle'];
  const reloadT = Number.isFinite(last) && since >= ANIM.reloadDelayMs && since < ANIM.reloadDelayMs + reloadMs
    ? clamp01((since - ANIM.reloadDelayMs) / reloadMs) : null;

  if (pT != null) { action = 'plant'; actionT = pT; locomotion = 'crouch'; }
  else if (dT != null) { action = 'defuse'; actionT = dT; locomotion = 'crouch'; }
  else if (throwT != null) { action = 'throw'; actionT = throwT; }
  else if (since >= 0 && since < ANIM.shootHoldMs) action = 'shoot';
  else if (next - t < ANIM.aimLeadMs) action = 'aim';
  else if (peekT != null) { action = 'peek'; actionT = peekT; }
  else if (reloadT != null) { action = 'reload'; actionT = reloadT; }
  else if (since < ANIM.aimHoldMs) action = 'aim';

  const name: AnimStateName = action === 'none' ? locomotion : action;
  // gaze: independent of the walking direction when the track carries it
  const heading = i.headingRad ?? null;
  const aimYawRel = i.aimYawRad != null && heading != null ? wrapPi(i.aimYawRad - heading) : 0;
  const aimPitch = Number.isFinite(i.aimPitchRad ?? NaN) ? Math.max(-1.2, Math.min(1.2, i.aimPitchRad!)) : 0;
  const travel = i.travelRad ?? heading;
  const off = i.aimYawRad != null && travel != null ? wrapPi(travel - i.aimYawRad) : 0; // travel direction relative to the gaze
  const strafe = gait > 0 && i.aimYawRad != null && travel != null ? -Math.sin(off) : 0;
  const slice = gait > 0 && gait < walkRun * 1.05 && Math.abs(off) > 0.5 && !kneel(action);
  return { name, locomotion, action, actionT, kick: action === 'shoot' || action === 'aim' ? kick : 0, flash: action === 'shoot' && flash, deadT: 0, gait, aimYawRel, aimPitch, strafe, slice };
}

/** Shot times of a player from the public kill feed: a short burst before each kill they took part in. */
export function shotTimesFor(kills: ReadonlyArray<{ tMs: number; killerId: string | null; victimId: string }>, playerId: string): number[] {
  const out: number[] = [];
  for (const k of kills) {
    if (k.killerId !== playerId && k.victimId !== playerId) continue;
    for (let n = 0; n < ANIM.burstShots; n++) out.push(k.tMs - n * ANIM.burstEveryMs - (k.victimId === playerId ? 60 : 0));
  }
  return out.sort((a, b) => a - b);
}

/**
 * Build the animation input for one player of a round at `tMs` from what the live view already
 * has: the RoundTimeline (kills, plant, defuse) and the player's Pose. `abilityMs` are the times of
 * this player's `abilityUse` replay events, when the caller has them.
 */
export function animInputFor(
  round: Pick<RoundTimeline, 'kills' | 'plant' | 'defuse'>,
  player: { readonly id: string; readonly deathMs: number | null },
  pose: Pick<Pose, 'alive' | 'moving' | 'moveMode'>,
  tMs: number,
  weapon: WeaponClass = 'rifle',
  abilityMs: readonly number[] = [],
  speedUUps: number | null = null,
): AnimInput {
  const mine = (a: RoundTimeline['plant']) => (a && a.playerId === player.id ? { startMs: a.startMs, endMs: a.tMs } : null);
  return {
    tMs, alive: pose.alive, deathMs: player.deathMs, moving: pose.moving, moveMode: pose.moveMode, speedUUps,
    shotsMs: shotTimesFor(round.kills, player.id), plant: mine(round.plant), defuse: mine(round.defuse), abilityMs, weapon,
  };
}

// ── posing ───────────────────────────────────────────────────────────────────────────────────

const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const ease = (x: number): number => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Piecewise-linear keyframes over 0..1: [[t, value], …]. */
function keys(t: number, k: ReadonlyArray<readonly [number, number]>): number {
  if (t <= k[0]![0]) return k[0]![1];
  for (let i = 1; i < k.length; i++) if (t <= k[i]![0]) { const [t0, a] = k[i - 1]!, [t1, b] = k[i]!; return lerp(a, b, ease((t - t0) / Math.max(1e-6, t1 - t0))); }
  return k[k.length - 1]![1];
}

/**
 * Two-bone arm IK in the spine frame: the wrist reaches `target` (clamped to the arm's reach), the
 * elbow bends toward `pole`. Bones are capsules along their local −Y, so twist is irrelevant.
 */
export function solveArm(upper: THREE.Bone, fore: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3): void {
  const S = upper.position;
  const d = _v1.copy(target).sub(S);
  let L = d.length();
  const dir = L > 1e-6 ? d.multiplyScalar(1 / L) : _v1.set(0, -1, 0);
  L = Math.min(UPPER_ARM + FORE_ARM - 1e-3, Math.max(Math.abs(UPPER_ARM - FORE_ARM) + 1e-3, L));
  const cosA = (UPPER_ARM * UPPER_ARM + L * L - FORE_ARM * FORE_ARM) / (2 * UPPER_ARM * L);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const p = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1).addScaledVector(dir, -dir.z);
  p.normalize();
  const elbow = _e.copy(S).addScaledVector(dir, UPPER_ARM * cosA).addScaledVector(p, UPPER_ARM * sinA);
  const wrist = _v3.copy(S).addScaledVector(dir, L);
  upper.quaternion.setFromUnitVectors(DOWN, _v2.copy(elbow).sub(S).normalize());
  _q.copy(upper.quaternion).invert();
  fore.quaternion.setFromUnitVectors(DOWN, wrist.sub(elbow).normalize().applyQuaternion(_q));
}

const POLE_L = new THREE.Vector3(-0.25, -1, -0.55), POLE_R = new THREE.Vector3(-0.25, -1, 0.65);
const _tR = new THREE.Vector3(), _tL = new THREE.Vector3(), _pt = new THREE.Vector3();

/** A weapon-local point → spine frame, through the gun mount's current local transform. */
function gunPoint(op: Operator, p: V3, out: THREE.Vector3): THREE.Vector3 {
  op.gunMount.updateMatrix();
  return out.set(...p).applyMatrix4(_m.copy(op.gunMount.matrix));
}

/**
 * Pose an operator for an animation state. `phase` desynchronises figures (e.g. slot × 1.3);
 * `aimPitch` (radians, + up) tilts head and gun toward what the player looks at.
 */
export function poseOperator(op: Operator, st: AnimState, tMs: number, phase = 0, aimPitch = st.aimPitch): void {
  // reset to rest
  op.bones.forEach((b, i) => { b.position.set(...op.rest[i]!); b.quaternion.identity(); });
  op.root.rotation.set(0, 0, 0); op.root.position.set(0, 0, 0);
  if (op.weapon) op.weapon.visible = true;
  const side = isSidearm(op.weaponCls);
  const hipY = op.rest[BONE.hips]![1];

  // ── legs / hips (locomotion; plant & defuse kneel)
  const kneel = st.action === 'plant' || st.action === 'defuse';
  if (st.name === 'dead') {
    // nothing here — the fall below
  } else if (kneel) {
    op.hips.position.y = 0.56;
    op.thighL.rotation.z = 1.3; op.shinL.rotation.z = -1.3;
    op.thighR.rotation.z = -0.1; op.shinR.rotation.z = -1.45;
    op.spine.rotation.z = -0.38;
  } else if (st.locomotion === 'crouch' || st.locomotion === 'crouchWalk') {
    const p = tMs / (ANIM.walkStrideMs * 1.2) * Math.PI * 2 + phase;
    const sw = st.locomotion === 'crouchWalk' ? Math.sin(p) * 0.22 : 0;
    op.hips.position.y = 0.62 + (st.locomotion === 'crouchWalk' ? Math.abs(Math.cos(p)) * 0.02 : 0);
    op.thighL.rotation.z = 1.2 + sw; op.thighR.rotation.z = 1.05 - sw;
    op.shinL.rotation.z = -1.9 - sw * 0.5; op.shinR.rotation.z = -1.75 + sw * 0.5;
    op.spine.rotation.z = -0.22;
  } else if (st.locomotion === 'walk' || st.locomotion === 'run') {
    const run = st.locomotion === 'run';
    const stride = (run ? ANIM.runStrideMs : ANIM.walkStrideMs) / Math.max(0.35, run ? st.gait : st.gait / (ANIM.walkSpeedUU / ANIM.runSpeedUU));
    const p = (tMs / stride) * Math.PI * 2 + phase;
    const amp = run ? 0.55 : 0.32, knee = run ? 1.05 : 0.6;
    const sw = Math.sin(p) * amp;
    op.thighL.rotation.z = sw; op.thighR.rotation.z = -sw;
    op.shinL.rotation.z = -Math.max(0, -Math.sin(p)) * knee - 0.05;
    op.shinR.rotation.z = -Math.max(0, Math.sin(p)) * knee - 0.05;
    op.hips.position.y = hipY - (run ? 0.03 : 0.015) + Math.abs(Math.cos(p)) * (run ? 0.045 : 0.025);
    op.hips.rotation.y = Math.sin(p) * (run ? 0.08 : 0.05);
    op.spine.rotation.z = run ? -0.13 : -0.05;
    if (Math.abs(st.strafe) > 0.25) {
      // side-stepping: legs part sideways (hip roll) instead of swinging forward, torso leans into the move
      const sgn = Math.sign(st.strafe), k = Math.min(1, Math.abs(st.strafe));
      op.thighL.rotation.z *= 1 - 0.6 * k; op.thighR.rotation.z *= 1 - 0.6 * k;
      op.thighL.rotation.x = -sgn * k * (0.25 + 0.25 * Math.max(0, Math.sin(p)));
      op.thighR.rotation.x = -sgn * k * (0.25 + 0.25 * Math.max(0, -Math.sin(p)));
      op.spine.rotation.x = -sgn * 0.08 * k;
    }
    if (st.slice) op.hips.position.y -= 0.03;                    // lowered, knees soft while slicing
  } else {
    const b = Math.sin(tMs / 1400 + phase) * 0.008;
    op.thighL.rotation.z = 0.06; op.thighR.rotation.z = -0.04;
    op.shinL.rotation.z = -0.08; op.shinR.rotation.z = -0.04;
    op.hips.position.y = hipY - 0.015 + b;
    op.spine.rotation.z = -0.03;
  }

  // ── upper body: blade the torso (support shoulder forward) and place the gun
  const aiming = st.action === 'aim' || st.action === 'shoot' || st.action === 'peek';
  const blade = side ? 0.15 : aiming ? 0.5 : 0.3;
  // Gaze off the walking direction: past ±FOOT_LIMIT the whole figure turns its feet, the rest is shared
  // by torso (60 %, ≤ 0.9 rad) and head; the gun hangs off the spine so it follows the aim.
  const rel = st.aimYawRel;
  const FOOT_LIMIT = 1.5;
  const excess = rel - Math.max(-FOOT_LIMIT, Math.min(FOOT_LIMIT, rel));
  const within = rel - excess;
  const torsoYaw = Math.max(-0.9, Math.min(0.9, within * 0.6));
  const headYaw = within - torsoYaw;
  op.root.rotation.y = -excess;                                  // game yaw is counter-clockwise, scene rotation.y the other way
  op.spine.rotation.y += -blade - torsoYaw;
  op.head.rotation.y = blade - headYaw;                          // look where the body points, plus the gaze
  const gm = op.gunMount;
  if (aiming) {
    const k = st.kick;
    if (side) gm.position.set(0.36 - k * 0.05, 0.47 + k * 0.02, 0.02);
    else gm.position.set(0.2 - k * 0.04, 0.42, 0.13);
    gm.rotation.set(0, blade, aimPitch * 0.85 + k * (side ? 0.3 : 0.16));
    op.head.rotation.z = aimPitch * 0.9 - 0.04;
  } else {
    // low ready: muzzle down and in
    if (side) { gm.position.set(0.24, 0.3, 0.06); gm.rotation.set(0, blade, -0.6); }
    else { gm.position.set(0.18, 0.32, 0.1); gm.rotation.set(0, blade + 0.2, -0.5); }
    op.head.rotation.z = aimPitch * 0.6;
  }

  // default hand targets: trigger hand on the grip, support hand on the foregrip (or cupping a sidearm)
  const pts = weaponPoints(op.weaponCls);
  gunPoint(op, [0.0, -0.03, 0], _tR);
  if (side) gunPoint(op, [-0.01, -0.06, -0.05], _tL); else gunPoint(op, [pts.foregrip[0], pts.foregrip[1] - 0.03, -0.01], _tL);

  switch (st.action) {
    case 'peek': {
      // lean out toward the gaze (right shoulder by default), step sideways, gun already up
      const lean = ease(Math.min(1, st.actionT * 1.6)) * (1 - 0.3 * Math.max(0, st.actionT - 0.7) / 0.3);
      const sgn = st.aimYawRel > 0.15 ? -1 : 1;      // game yaw is counter-clockwise: a left look (+) leans to the figure's left (−Z)
      op.hips.position.z += sgn * 0.17 * lean;
      op.spine.rotation.x = -sgn * 0.3 * lean;
      op.thighL.rotation.x = sgn * 0.2 * lean; op.thighR.rotation.x = sgn * 0.2 * lean;
      break;
    }
    case 'reload': {
      const t = st.actionT;
      gm.position.set(0.22, 0.33, 0.04);
      gm.rotation.set(keys(t, [[0, 0], [0.15, 0.7], [0.8, 0.7], [1, 0]]), blade, keys(t, [[0, -0.3], [0.15, 0.05], [0.85, 0.05], [1, -0.3]]));
      gunPoint(op, [0.0, -0.03, 0], _tR);
      const mag = gunPoint(op, side ? [pts.magazine[0], pts.magazine[1] - 0.02, 0] : [pts.magazine[0], pts.magazine[1] - 0.03, 0], _pt);
      const fg = gunPoint(op, side ? [-0.01, -0.06, -0.05] : [pts.foregrip[0], pts.foregrip[1] - 0.03, -0.01], _v3);
      const belt = _e.set(0.08, 0.02, -0.16);
      // to the magazine, pull it down to the belt, bring a fresh one up, seat it, back to the grip
      const a = keys(t, [[0, 0], [0.15, 1], [0.3, 1], [0.45, 2], [0.6, 1], [0.75, 1], [0.9, 0], [1, 0]]);
      if (a <= 1) _tL.copy(fg).lerp(mag, a); else _tL.copy(mag).lerp(belt, a - 1);
      break;
    }
    case 'plant':
    case 'defuse': {
      // gun slung down the right side; both hands work at the ground in front of the knee
      gm.position.set(-0.02, 0.22, 0.24); gm.rotation.set(0.2, 0.2, -1.35);
      const w = st.action === 'plant' ? Math.sin(tMs / 160) * 0.02 : Math.sin(tMs / 90) * 0.012;
      _tL.set(0.46, -0.12 + w, -0.07); _tR.set(0.46, -0.1 - w, 0.08);
      break;
    }
    case 'throw': {
      const t = st.actionT;
      // support hand winds back over the shoulder and throws forward; the gun drops to low ready in the trigger hand
      const back = _v3.set(-0.12, 0.72, -0.28), fwd = _e.set(0.6, 0.55, -0.12);
      const fg = _pt.copy(_tL);
      if (t < 0.4) _tL.copy(fg).lerp(back, ease(t / 0.4));
      else if (t < 0.6) _tL.copy(back).lerp(fwd, ease((t - 0.4) / 0.2));
      else _tL.copy(fwd).lerp(fg, ease((t - 0.6) / 0.4));
      op.spine.rotation.y += t < 0.4 ? -0.25 * ease(t / 0.4) : t < 0.6 ? lerp(-0.25, 0.3, (t - 0.4) / 0.2) : 0.3 * (1 - ease((t - 0.6) / 0.4));
      break;
    }
  }

  if (st.name === 'dead') {
    // ragdoll-lite: topple about the feet (back / left / right by phase), bounce once, go limp
    const t = st.deadT;
    const fall = t < 0.8 ? (t / 0.8) ** 2 : 1 - 0.06 * Math.sin(((t - 0.8) / 0.2) * Math.PI);
    const dir = Math.abs(Math.floor(phase * 7)) % 3;
    if (dir === 0) op.root.rotation.z = (Math.PI / 2) * fall;          // backwards
    else op.root.rotation.x = (dir === 1 ? -1 : 1) * (Math.PI / 2) * fall; // to a side
    op.root.position.y = 0.14 * fall;
    op.hips.position.y = hipY - 0.1 * fall;
    op.thighL.rotation.z = 0.5 * fall; op.thighR.rotation.z = 0.2 * fall;
    op.shinL.rotation.z = -0.9 * fall; op.shinR.rotation.z = -0.3 * fall;
    op.head.rotation.z = 0.5 * fall; op.head.rotation.x = 0.3 * fall;
    gm.position.set(0.3, 0.1 - 0.4 * fall, 0.4 + 0.3 * fall); gm.rotation.set(1.2 * fall, 0.4, -0.3 - 1.0 * fall);
    _tL.set(lerp(0.2, -0.1, fall), lerp(0.35, 0.2, fall), lerp(-0.2, -0.65, fall));
    _tR.set(lerp(0.2, 0.15, fall), lerp(0.35, 0.05, fall), lerp(0.2, 0.62, fall));
  }

  solveArm(op.upperArmL, op.foreArmL, _tL, POLE_L);
  solveArm(op.upperArmR, op.foreArmR, _tR, POLE_R);
}

/** Back-compat wrapper (old API): walk/run cycle while moving, idle sway otherwise. */
export function animateOperator(op: Operator, moving: boolean, tMs: number, phase: number): void {
  poseOperator(op, selectAnimState({ tMs, alive: true, moving, moveMode: 'run' }), tMs, phase);
}

// ── first person: arms per weapon class, posed by the same animation state ──────────────────

/** One arm for the view model: glove at the origin, forearm running along −X toward the elbow. 1 draw call. */
function viewArmGeo(role: Role, accent: number): THREE.BufferGeometry {
  const k = new Kit().on(0);
  k.rbox('glove', 0.11, 0.075, 0.085, [0.0, 0.0, 0], [0, 0, 0], 0.03)
    .rbox('glove', 0.05, 0.03, 0.08, [0.06, 0.01, 0], [0, 0, 0.3], 0.012)                  // fingers
    .limb('accent', [-0.05, 0, 0], [-0.09, 0, 0], 0.047, 12)                                 // team cuff
    .limb('cloth', [-0.09, 0, 0], [-0.42, 0, 0], 0.05, 12)
    .rbox('trim', 0.12, 0.02, 0.06, [-0.2, 0.048, 0], [0, 0, 0], 0.008);                    // sleeve strap
  return k.build(role, accent, false).body!;
}

/**
 * First-person view model: our own gloved arms holding the team's weapon class, drawn in its own
 * small scene on top of each monitor (drop-in for CamStage3D's ViewModel: same `scene`/`camera`).
 * `update(cls, state, tMs)` follows the same AnimState as the third-person figure: bob/sway while
 * moving, kick + flash on shots, a magazine reload, kneeling plant/defuse with our own device in
 * hand, an ability throw with the support hand. Hidden while dead.
 * Draw calls: gun 2 + arms 2 + flash 1 (+ device 2 during plant/defuse, orb 1 during a throw).
 */
export class FirstPersonRig {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  private readonly rig = new THREE.Group();
  private readonly hold = new THREE.Group();
  private readonly gunPivot = new THREE.Group();
  private readonly guns = new Map<WeaponClass, THREE.Group>();
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly flash: THREE.Mesh;
  private readonly device: THREE.Group;
  private readonly orb: THREE.Mesh;
  private cls: WeaponClass | null = null;
  private readonly accent: number;

  constructor(accent: number, role: Role = 'duelist') {
    this.accent = accent;
    this.scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x3a3128, 1.4));
    const key = new THREE.DirectionalLight(0xffe7cc, 1.6); key.position.set(-1, 2, 1); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6); rim.position.set(1, 0.5, -1); this.scene.add(rim);
    this.hold.rotation.y = Math.PI / 2;                      // weapons are modelled along +X; the view looks down −Z
    const arm = viewArmGeo(role, accent);
    this.armL = new THREE.Mesh(arm, BODY); this.armR = new THREE.Mesh(arm, BODY);
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    // our own spike device / defuse tool: a hexagonal puck with a glowing core
    const dk = new Kit().on(-1);
    dk.cyl('trim', 0.07, 0.08, 0.06, [0, 0, 0], [0, 0, 0], 6).cyl('metal', 0.03, 0.03, 0.02, [0, 0.04, 0], [0, 0, 0], 6).cyl('glow', 0.05, 0.05, 0.012, [0, 0.032, 0], [0, 0, 0], 6);
    const dg = dk.build('gun', accent, false);
    this.device = new THREE.Group();
    this.device.add(new THREE.Mesh(dg.body!, BODY)); if (dg.glow) this.device.add(new THREE.Mesh(dg.glow, sharedGlow(accent)));
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 1), sharedGlow(accent));
    this.gunPivot.add(this.flash);
    this.hold.add(this.gunPivot, this.armL, this.armR, this.device, this.orb);
    this.rig.add(this.hold);
    this.scene.add(this.rig);
    this.setWeapon('rifle');
  }

  private setWeapon(cls: WeaponClass): void {
    if (cls === this.cls) return;
    for (const g of this.guns.values()) g.visible = false;
    let g = this.guns.get(cls);
    if (!g) { g = buildWeapon(cls, this.accent); this.gunPivot.add(g); this.guns.set(cls, g); }
    g.visible = true;
    this.cls = cls;
  }

  /** Place an arm: glove at `wrist`, forearm toward `elbow` (hold frame). */
  private static placeArm(arm: THREE.Mesh, wrist: THREE.Vector3, elbow: THREE.Vector3): void {
    arm.position.copy(wrist);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(-1, 0, 0), _v1.copy(elbow).sub(wrist).normalize());
  }

  update(cls: WeaponClass, st: AnimState, tMs: number): void {
    this.setWeapon(cls);
    this.scene.visible = st.name !== 'dead';
    if (!this.scene.visible) return;
    const side = isSidearm(cls);
    const pts = weaponPoints(cls);
    const moving = st.locomotion !== 'idle' && st.locomotion !== 'crouch';
    const run = st.locomotion === 'run';
    const f = run ? 150 : 210, ampX = run ? 0.012 : 0.007, ampY = run ? 0.018 : 0.01;
    const bobX = moving ? Math.cos(tMs / f) * ampX : 0;
    const bobY = moving ? Math.abs(Math.sin(tMs / f)) * ampY : Math.sin(tMs / 1300) * 0.002;
    const aiming = st.action === 'aim' || st.action === 'shoot' || st.action === 'peek';
    const back = cls === 'sniper' ? -0.62 : side ? -0.38 : -0.5;
    const k = st.kick;
    const x = (side ? 0.12 : aiming ? 0.11 : 0.17) + bobX;
    const y = (side ? -0.15 : aiming ? -0.165 : -0.2) - bobY + k * 0.012;
    this.rig.position.set(x, y, back + k * 0.05);
    this.rig.rotation.set(k * 0.09, run ? -0.12 : -0.06, run ? 0.08 : 0);

    // gun pivot (roll / drop) — the trigger arm rides with it, the support arm is placed on its own
    let drop = 0, roll = 0, pitch = 0;
    this.device.visible = false; this.orb.visible = false;
    const t = st.actionT;
    if (st.action === 'reload') { roll = keys(t, [[0, 0], [0.15, 0.55], [0.85, 0.55], [1, 0]]); pitch = keys(t, [[0, 0], [0.15, 0.12], [0.85, 0.12], [1, 0]]); drop = 0.03 * Math.sin(t * Math.PI); }
    if (st.action === 'plant' || st.action === 'defuse') { drop = 0.42; pitch = -0.5; }
    if (st.action === 'throw') drop = 0.1 * Math.sin(t * Math.PI);
    this.gunPivot.position.set(0, -drop, 0);
    this.gunPivot.rotation.set(roll, 0, pitch);
    this.gunPivot.updateMatrix();
    const P = (p: V3, out: THREE.Vector3): THREE.Vector3 => out.set(...p).applyMatrix4(this.gunPivot.matrix);

    const wristR = P([-0.005, -0.035, 0.03], _tR), elbowR = P([-0.3, -0.22, 0.16], _v2);
    const fg: V3 = side ? [-0.02, -0.06, -0.04] : [pts.foregrip[0], pts.foregrip[1] + 0.025, -0.035];
    const wristL = P(fg, _tL), elbowL = _v3.set(fg[0] - 0.32, -0.24, -0.22);
    if (st.action === 'reload') {
      const mag = P([pts.magazine[0], pts.magazine[1] - 0.02, -0.02], _pt);
      const a = keys(t, [[0, 0], [0.15, 1], [0.3, 1], [0.45, 2], [0.6, 1], [0.75, 1], [0.9, 0], [1, 0]]);
      if (a <= 1) wristL.lerp(mag, a); else wristL.copy(mag).lerp(_e.set(mag.x - 0.1, mag.y - 0.3, mag.z - 0.1), a - 1);
      elbowL.set(wristL.x - 0.3, wristL.y - 0.2, -0.24);
    } else if (st.action === 'plant' || st.action === 'defuse') {
      const w = Math.sin(tMs / (st.action === 'plant' ? 160 : 90)) * 0.012;
      wristL.set(0.3, -0.2 + w, -0.07); elbowL.set(-0.05, -0.38, -0.22);
      wristR.set(0.3, -0.21 - w, 0.08); elbowR.set(-0.05, -0.38, 0.22);
      this.device.visible = true; this.device.position.set(0.36, -0.2, 0); this.device.rotation.set(0, tMs / 2000, 0);
    } else if (st.action === 'throw') {
      const rest = _e.copy(wristL);
      const up = _pt.set(-0.05, 0.08, -0.22), fwd = _v1.set(0.5, 0.02, -0.06);
      if (t < 0.4) wristL.copy(rest).lerp(up, ease(t / 0.4));
      else if (t < 0.6) wristL.copy(up).lerp(fwd, ease((t - 0.4) / 0.2));
      else wristL.copy(fwd).lerp(rest, ease((t - 0.6) / 0.4));
      elbowL.set(wristL.x - 0.3, wristL.y - 0.2, -0.26);
      this.orb.visible = t < 0.55; this.orb.position.copy(wristL).add(_v1.set(0.05, 0.03, 0));
    }
    FirstPersonRig.placeArm(this.armR, wristR, elbowR);
    FirstPersonRig.placeArm(this.armL, wristL, elbowL);
    this.armL.visible = !side || st.action !== 'none';

    this.flash.visible = st.flash;
    this.flash.position.set(pts.muzzle[0] + 0.02, pts.muzzle[1], 0);
    this.flash.scale.setScalar(0.8 + ((tMs * 7) % 5) / 6);
  }
}

// ── props: the spike and ability placeholders ────────────────────────────────────────────────

export interface SpikeProp { readonly group: THREE.Group; readonly light: THREE.PointLight }
/**
 * Our own spike device: a hex-sided charge with a ribbed collar, a pulsing core and four team-coloured
 * vents. 0.4 m tall, origin on the floor. `pulseSpike` drives the core (fast in the last 10 s).
 * 3 draw calls (body, glow core, glow vents).
 */
export function buildSpike(accent: number): SpikeProp {
  const k = new Kit().on(-1);
  k.cyl('trim', 0.2, 0.24, 0.12, [0, 0.06, 0], [0, 0, 0], 6)
    .cyl('metal', 0.16, 0.2, 0.1, [0, 0.17, 0], [0, 0, 0], 6)
    .cyl('trim', 0.18, 0.18, 0.03, [0, 0.235, 0], [0, 0, 0], 6)
    .cyl('polymer', 0.1, 0.13, 0.1, [0, 0.3, 0], [0, 0, 0], 6)
    .cyl('glow', 0.07, 0.07, 0.05, [0, 0.365, 0], [0, 0, 0], 6);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; k.rbox('glow', 0.02, 0.06, 0.012, [Math.cos(a) * 0.17, 0.17, Math.sin(a) * 0.17], [0, -a, 0], 0.003); }
  const built = k.build('gun', accent, false);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(built.body!, BODY));
  if (built.glow) group.add(new THREE.Mesh(built.glow, new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4, roughness: 0.3 })));
  const light = new THREE.PointLight(accent, 0, 14); light.position.y = 0.45; group.add(light);
  group.userData.core = group.children[1];
  return { group, light };
}
/** Blink the spike: slow ~1.1 s period, 0.45 s in the last 10 s. */
export function pulseSpike(sp: SpikeProp, remainingMs: number | null, tMs: number): void {
  const period = (remainingMs ?? 99_999) < 10_000 ? 450 : 1100;
  const ph = (tMs % period) / period;
  sp.light.intensity = 6 + 22 * (1 - ph);
  const core = sp.group.userData.core as THREE.Mesh | undefined;
  if (core) (core.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + 2.2 * (1 - ph);
}

export type AbilityKind = 'smoke' | 'wall' | 'area' | 'flash' | 'orb';
/** Which placeholder stands for an ability (engine ids/names are catalog strings; we classify by keyword). */
export function abilityKindOf(abilityId: string | null | undefined): AbilityKind {
  const n = (abilityId ?? '').toLowerCase();
  if (/smoke|cloud|sky|dark.?cover|eclipse|cove|mist|dome|veil|nebula/.test(n)) return 'smoke';
  if (/wall|barrier|fortif|prism|bladestorm.*wall|curtain|screen/.test(n)) return 'wall';
  if (/molly|incend|snake|nano|hot.?hand|blaze|burn|fire|toxic|poison|acid|lingering|inferno|shock|mine|trap|cage/.test(n)) return 'area';
  if (/flash|blind|dazzle|strobe|flare/.test(n)) return 'flash';
  return 'orb';
}
/** Lifetime of the placeholder in match ms (the engine has no expiry event). */
export const ABILITY_LIFE_MS: Readonly<Record<AbilityKind, number>> = { smoke: 14_000, wall: 8_000, area: 6_500, flash: 450, orb: 1_600 };

const abilityMat = (colour: number, opacity: number, emissive = 0.4, depthWrite = false): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: emissive, transparent: true, opacity, depthWrite, roughness: 0.9, side: THREE.DoubleSide });
const abilityGeo: { [K in AbilityKind]?: THREE.BufferGeometry } = {};

/**
 * One placeholder: smoke = soft grey-blue sphere (4 m), wall = translucent slab with a bright top edge,
 * area = a glowing ground disc with a rim (molly-style zone, 4.5 m), flash = a bright burst, orb = a small
 * team-coloured projectile / device. Geometry shared per kind; own materials so fades are per instance.
 */
export function buildAbilityProp(kind: AbilityKind, accent: number): THREE.Group {
  const g = new THREE.Group();
  const geo = (key: AbilityKind, make: () => THREE.BufferGeometry): THREE.BufferGeometry => (abilityGeo[key] ??= make());
  switch (kind) {
    case 'smoke': {
      const m = new THREE.Mesh(geo('smoke', () => new THREE.IcosahedronGeometry(4, 2)), abilityMat(0xb8c4d0, 0.82, 0.05, true));
      m.position.y = 3.2; m.scale.y = 0.85; g.add(m); break;
    }
    case 'wall': {
      const m = new THREE.Mesh(geo('wall', () => new THREE.BoxGeometry(0.3, 4, 9)), abilityMat(accent, 0.38, 0.6));
      m.position.y = 2; g.add(m);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 9.04), abilityMat(accent, 0.95, 2.0)); edge.position.y = 4; g.add(edge); break;
    }
    case 'area': {
      const disc = new THREE.Mesh(geo('area', () => new THREE.CircleGeometry(4.5, 28)), abilityMat(0xff7a2e, 0.42, 0.9));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.06; g.add(disc);
      const rim = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.5, 28), abilityMat(0xffb060, 0.9, 1.6));
      rim.rotation.x = -Math.PI / 2; rim.position.y = 0.07; g.add(rim); break;
    }
    case 'flash': {
      g.add(new THREE.Mesh(geo('flash', () => new THREE.IcosahedronGeometry(0.5, 1)), abilityMat(0xffffff, 0.95, 3.0))); break;
    }
    default: {
      g.add(new THREE.Mesh(geo('orb', () => new THREE.IcosahedronGeometry(0.16, 1)), abilityMat(accent, 0.95, 2.0)));
    }
  }
  g.userData.kind = kind;
  return g;
}
/** Grow / fade a placeholder by its age (ms since it appeared). Returns false once it is over. */
export function updateAbilityProp(g: THREE.Group, ageMs: number): boolean {
  const kind = g.userData.kind as AbilityKind;
  const life = ABILITY_LIFE_MS[kind];
  if (ageMs < 0 || ageMs >= life) { g.visible = false; return false; }
  g.visible = true;
  const grow = Math.min(1, ageMs / (kind === 'smoke' ? 600 : kind === 'wall' ? 400 : kind === 'flash' ? 120 : 250));
  const fade = Math.min(1, (life - ageMs) / Math.min(1200, life * 0.3));
  g.scale.setScalar(kind === 'smoke' || kind === 'area' || kind === 'flash' ? 0.2 + 0.8 * grow : 1);
  if (kind === 'wall') g.scale.y = grow;
  if (kind === 'orb') g.position.y = Math.max(g.userData.baseY ?? 0, 0) + 0.2 * Math.sin(ageMs / 160);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const mat = m.material as THREE.MeshStandardMaterial; mat.userData.base ??= mat.opacity; mat.opacity = (mat.userData.base as number) * fade; } });
  return true;
}

// ── per-map light presets ─────────────────────────────────────────────────────────────────────

/** Light for one map's mesh: a sky/ground hemisphere, one sun (casts the static shadow), haze. */
export interface MapLighting {
  readonly sky: number; readonly ground: number; readonly hemi: number;
  readonly sunColor: number; readonly sun: number;
  /** Sun direction: azimuth from scene +X toward +Z, elevation above the horizon (degrees). */
  readonly azimuthDeg: number; readonly elevationDeg: number;
  readonly fog: number; readonly fogNear: number; readonly fogFar: number;
  /** Clear colour behind the mesh (the sky). */
  readonly clear: number;
  readonly exposure: number;
}
/** Our own moods per map (time of day / climate), tuned on the vertex-coloured meshes. */
export const MAP_LIGHTING: Readonly<Record<string, MapLighting>> = {
  ascent:   { sky: 0xcfe3f5, ground: 0x6e5a44, hemi: 1.15, sunColor: 0xffe2bf, sun: 2.4, azimuthDeg: 148, elevationDeg: 48, fog: 0xa9c3d6, fogNear: 35, fogFar: 160, clear: 0xa9c3d6, exposure: 1.0 },
  bind:     { sky: 0xf2dcbc, ground: 0x7a5a3a, hemi: 1.05, sunColor: 0xffd9a6, sun: 2.7, azimuthDeg: 120, elevationDeg: 58, fog: 0xd8c4a4, fogNear: 40, fogFar: 170, clear: 0xd9c6a8, exposure: 1.0 },
  haven:    { sky: 0xd8e6ee, ground: 0x6c5c48, hemi: 1.15, sunColor: 0xfff0d6, sun: 2.3, azimuthDeg: 200, elevationDeg: 55, fog: 0xbfd2dc, fogNear: 40, fogFar: 170, clear: 0xbcd0dc, exposure: 1.0 },
  split:    { sky: 0xc9d6ea, ground: 0x4c4a52, hemi: 1.2, sunColor: 0xffd0b0, sun: 2.0, azimuthDeg: 30, elevationDeg: 34, fog: 0x9fb0c8, fogNear: 30, fogFar: 140, clear: 0x9dafc8, exposure: 1.0 },
  icebox:   { sky: 0xe6f1ff, ground: 0x8a97a6, hemi: 1.35, sunColor: 0xf4f8ff, sun: 2.2, azimuthDeg: 250, elevationDeg: 28, fog: 0xd6e4f2, fogNear: 30, fogFar: 140, clear: 0xd4e3f2, exposure: 0.95 },
  breeze:   { sky: 0xc6ecff, ground: 0x8a7a5c, hemi: 1.15, sunColor: 0xfff4dc, sun: 2.8, azimuthDeg: 95, elevationDeg: 66, fog: 0xa6d8ef, fogNear: 50, fogFar: 200, clear: 0x9fd6f0, exposure: 1.0 },
  fracture: { sky: 0xf0d2b0, ground: 0x6e4f36, hemi: 1.0, sunColor: 0xffc890, sun: 2.5, azimuthDeg: 300, elevationDeg: 30, fog: 0xd8b996, fogNear: 35, fogFar: 160, clear: 0xd6b894, exposure: 1.0 },
  pearl:    { sky: 0xb8e2e6, ground: 0x3c5a5c, hemi: 1.3, sunColor: 0xd8f6ff, sun: 1.7, azimuthDeg: 180, elevationDeg: 72, fog: 0x7fb5bd, fogNear: 25, fogFar: 120, clear: 0x78afb8, exposure: 1.05 },
  lotus:    { sky: 0xd6ead6, ground: 0x5a5a40, hemi: 1.15, sunColor: 0xffe8c4, sun: 2.3, azimuthDeg: 60, elevationDeg: 44, fog: 0xb4cdb8, fogNear: 35, fogFar: 150, clear: 0xb0cab4, exposure: 1.0 },
  sunset:   { sky: 0xffd2b0, ground: 0x6a4a44, hemi: 1.05, sunColor: 0xffb070, sun: 2.6, azimuthDeg: 280, elevationDeg: 16, fog: 0xe8b8a0, fogNear: 35, fogFar: 160, clear: 0xf0b898, exposure: 1.0 },
  abyss:    { sky: 0xc4d0e6, ground: 0x30343e, hemi: 1.25, sunColor: 0xe6ecff, sun: 2.0, azimuthDeg: 215, elevationDeg: 52, fog: 0x8d9ab4, fogNear: 30, fogFar: 130, clear: 0x8a98b4, exposure: 1.0 },
};
export const lightingFor = (mapId: string): MapLighting => MAP_LIGHTING[mapId.toLowerCase()] ?? MAP_LIGHTING.ascent!;

/**
 * Apply a map's preset to the cams' lights (what CamStage3D.lightForMap does for Ascent today):
 * hemisphere, a sun whose static shadow camera covers the whole mesh, and haze. Returns the clear colour.
 */
export function applyMapLighting(
  target: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; scene: THREE.Scene },
  root: THREE.Object3D, mapId: string, shadowMapSize = 4096,
): number {
  const L = lightingFor(mapId);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.z) / 2 + 4;
  const { hemi, sun, scene } = target;
  hemi.color.set(L.sky); hemi.groundColor.set(L.ground); hemi.intensity = L.hemi;
  sun.color.set(L.sunColor); sun.intensity = L.sun * L.exposure;
  const az = THREE.MathUtils.degToRad(L.azimuthDeg), el = THREE.MathUtils.degToRad(L.elevationDeg);
  const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  sun.position.copy(c).addScaledVector(dir, r * 1.6);
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  sun.castShadow = true;
  const cam = sun.shadow.camera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = r * 4;
  cam.updateProjectionMatrix();
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
  return L.clear;
}
