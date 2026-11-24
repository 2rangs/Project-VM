// three.js stage for the team cams: real first-person 3D views, one per player of our team.
//
// ONE WebGLRenderer / one canvas covers the whole wall; each monitor is a scissored viewport of
// it with its own camera pose (no per-monitor WebGL context, no render targets). The scene is
// built once — the map (real GLB when installed, navgraph blockout otherwise), ten pooled
// player figures, sound beacons and the spike — and per monitor only visibility flags and the
// camera change. Rendering follows the display (every animation frame, capped at CAMS_FPS).
//
// What a monitor may show is decided by the Frame (matchday/frame.ts): teammates always, an
// enemy figure only while THAT player sees it, a sound beacon only if THAT player heard it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { NavModel, Vec3 } from '../../matchday/nav.ts';
import type { Frame } from '../../matchday/frame.ts';
import { EYE_HEIGHT_M, firstPersonPose, toScene, type Blockout } from '../../matchday/world3d.ts';
import { firingAt } from '../../matchday/monitor.ts';
import { HeadingSmoother } from '../../matchday/heading.ts';
import { animateOperator, buildOperator, buildWeapon, isSidearm, modelMaterials, roleForSlot, weaponClassOf, type ModelMaterials, type Operator, type Role, type WeaponClass } from './models.ts';
import { C, FONT } from '../../matchday/theme.ts';

/** Upper bound on 3D wall renders per second: the display's own rate up to a 144 Hz panel. */
export const CAMS_FPS = 144;
/** Outdoor sky / haze for the real map mesh (the blockout keeps the dark tactical look). */
const SKY = 0xa9c3d6;



export interface CamView {
  readonly key: string;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly followId: string;
}
export interface CamOptions { readonly nameOf: (id: string) => string }
export interface CamPerf {
  /** CPU time of the last wall render (all monitors), ms. */
  lastMs: number;
  /** Rolling mean / max over the last 120 wall renders, ms. */
  avgMs: number; maxMs: number;
  renders: number;
  /** Triangles and draw calls submitted for the last wall render. */
  triangles: number; calls: number;
  map: 'blockout' | 'glb';
  views: number;
}

const BG = 0x0b131b;

function textSprite(text: string, color: string, px = 44): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 ${px}px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.width = w; canvas.height = px + 20;
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = '#0b131b'; ctx.strokeText(text, 12, canvas.height / 2);
  ctx.fillStyle = color; ctx.fillText(text, 12, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set((canvas.width / canvas.height) * 0.55, 0.55, 1);
  return sprite;
}

// ── figures and the first-person view model ────────────────────────────────────────────────
// Original models (./models.ts): role-shaped tactical operators and our own weapon family. The
// identity of a player comes from our data (team colour, handle label), not from a model.

class Figure {
  readonly group = new THREE.Group();
  private readonly op: Operator;
  private readonly marker: THREE.Mesh | null = null;
  private label: THREE.Sprite | null = null;
  private labelText = '';
  private weapon: THREE.Group | null = null;
  private weaponCls: WeaponClass | null = null;
  private readonly gunMats: ModelMaterials;

  constructor(private readonly color: number, private readonly enemy: boolean, role: Role) {
    this.op = buildOperator(role, color);
    this.gunMats = modelMaterials(color);
    this.group.add(this.op.root);
    this.setWeapon('rifle');
    if (enemy) {
      // The engine's sightlines are zone-to-zone, so on the real mesh an enemy it counts as seen
      // can stand behind a wall. The body obeys depth; this spotted-contact marker never hides.
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false }));
      m.position.y = 2.25; m.scale.set(0.8, 1.2, 0.8); m.renderOrder = 10;
      this.marker = m;
      this.group.add(m);
    }
    this.group.visible = false;
  }

  /** Carry the model for this weapon class (long guns in both hands, sidearms in the trigger hand). */
  setWeapon(cls: WeaponClass): void {
    if (cls === this.weaponCls) return;
    if (this.weapon) this.op.gunMount.remove(this.weapon);
    const w = buildWeapon(cls, this.gunMats);
    if (isSidearm(cls)) w.position.set(0.02, 0.0, 0.0);
    this.op.gunMount.add(w);
    this.weapon = w; this.weaponCls = cls;
  }

  setLabel(text: string): void {
    if (text === this.labelText) return;
    if (this.label) { this.group.remove(this.label); (this.label.material.map as THREE.Texture).dispose(); this.label.material.dispose(); }
    this.label = textSprite(text.toUpperCase(), `#${this.color.toString(16).padStart(6, '0')}`);
    this.label.position.y = this.enemy ? 2.75 : 2.1;
    if (this.enemy) { this.label.material.depthTest = false; this.label.renderOrder = 11; }
    this.group.add(this.label);
    this.labelText = text;
  }

  /** Stand on the ground at a scene position, facing a scene-space direction (x/z). */
  place(x: number, groundY: number, z: number, dirX: number, dirZ: number): void {
    this.group.position.set(x, groundY, z);
    this.group.rotation.y = Math.atan2(-dirZ, dirX);
  }

  /** Walk cycle while moving, idle sway while standing; `tMs` is match time, so it pauses with playback. */
  animate(moving: boolean, tMs: number, phase: number): void {
    animateOperator(this.op, moving, tMs, phase);
    if (this.marker) this.marker.rotation.y = tMs / 400;
  }
}

/** A capsule between two points (view-model space). */
function capsuleBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, a.distanceTo(b) - r), 4, 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/**
 * A gloved hand at `wrist` with its sleeved forearm running back to `elbow` (the weapon's hold
 * frame: +X forward, +Y up, +Z to the viewer's right; the camera sits behind and above the grip).
 */
function viewArm(mats: ModelMaterials, wrist: readonly [number, number, number], elbow: readonly [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const w = new THREE.Vector3(...wrist), e = new THREE.Vector3(...elbow);
  const dir = e.clone().sub(w).normalize();
  const cuffAt = w.clone().addScaledVector(dir, 0.06);
  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.042, 14, 10), mats.trim);
  glove.position.copy(w); glove.scale.set(1.25, 0.8, 1);
  const cuff = capsuleBetween(cuffAt, cuffAt.clone().addScaledVector(dir, 0.03), 0.046, mats.glow);
  const sleeve = capsuleBetween(cuffAt.clone().addScaledVector(dir, 0.03), e, 0.05, mats.cloth);
  g.add(glove, cuff, sleeve);
  return g;
}

/**
 * First-person view model: our own gloved hands holding the team's weapon class, drawn in its own
 * tiny scene on top of each monitor. Bobs while the player moves and kicks while they fire.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10);
  private readonly rig = new THREE.Group();
  private readonly hold = new THREE.Group();
  private readonly guns = new Map<WeaponClass, THREE.Group>();
  private readonly flash: THREE.Mesh;
  private readonly arms = new Map<WeaponClass, THREE.Group>();
  private readonly mats: ModelMaterials;
  private cls: WeaponClass | null = null;

  constructor(accent: number) {
    this.scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x3a3128, 1.4));
    const key = new THREE.DirectionalLight(0xffe7cc, 1.6); key.position.set(-1, 2, 1); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 0.6); rim.position.set(1, 0.5, -1); this.scene.add(rim);
    this.mats = modelMaterials(accent, 'duelist');
    // weapons are modelled along +X; the view looks down −Z
    this.hold.rotation.y = Math.PI / 2;
    this.flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    this.hold.add(this.flash);
    this.rig.add(this.hold);
    this.scene.add(this.rig);
    this.setWeapon('rifle');
  }

  private setWeapon(cls: WeaponClass): void {
    if (cls === this.cls) return;
    for (const g of this.guns.values()) g.visible = false;
    let g = this.guns.get(cls);
    if (!g) { g = buildWeapon(cls, modelMaterials(this.accentOf())); this.hold.add(g); this.guns.set(cls, g); }
    g.visible = true;
    for (const a of this.arms.values()) a.visible = false;
    let arms = this.arms.get(cls);
    if (!arms) {
      const fg = g.userData.foregrip as [number, number, number];
      arms = new THREE.Group();
      arms.add(viewArm(this.mats, [-0.005, -0.035, 0.03], [-0.3, -0.22, 0.16]));           // trigger hand on the grip
      if (!isSidearm(cls)) arms.add(viewArm(this.mats, [fg[0], fg[1] + 0.025, -0.035], [fg[0] - 0.32, -0.24, -0.22])); // support hand on the handguard
      this.hold.add(arms); this.arms.set(cls, arms);
    }
    arms.visible = true;
    this.cls = cls;
  }
  private accentOf(): number { return (this.mats.glow as THREE.MeshStandardMaterial).color.getHex(); }

  /** `kick` 0..1 = recoil right now; `flash` = muzzle flash visible. */
  update(cls: WeaponClass, moving: boolean, tMs: number, kick: number, flash: boolean): void {
    this.setWeapon(cls);
    const side = isSidearm(cls);
    const bobX = moving ? Math.cos(tMs / 190) * 0.008 : 0;
    const bobY = moving ? Math.abs(Math.sin(tMs / 190)) * 0.012 : Math.sin(tMs / 1300) * 0.002;
    const back = cls === 'sniper' ? -0.62 : side ? -0.38 : -0.5;
    this.rig.position.set((side ? 0.12 : 0.17) + bobX, (side ? -0.15 : -0.2) - bobY + kick * 0.012, back + kick * 0.05);
    this.rig.rotation.set(kick * 0.09, -0.06, 0);
    const mz = this.guns.get(cls)!.userData.muzzle as [number, number, number];
    this.flash.visible = flash;
    this.flash.position.set(mz[0] + 0.02, mz[1], 0);
    this.flash.scale.setScalar(0.8 + ((tMs * 7) % 5) / 6);
  }
}

export class CamStage3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 400);
  private readonly mapGroup = new THREE.Group();
  private readonly labelGroup = new THREE.Group();
  private readonly allies: Figure[] = [];
  private readonly enemies: Figure[] = [];
  private readonly beacons: THREE.Mesh[] = [];
  private readonly spike: THREE.Mesh;
  private readonly spikeLight: THREE.PointLight;
  private glb: THREE.Object3D | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly groundCache = new Map<string, number>();
  private lastRender = 0;
  private readonly heading = new HeadingSmoother();
  private readonly sun = new THREE.DirectionalLight(0xffe2bf, 2.4);
  private readonly hemi = new THREE.HemisphereLight(0xdcecff, 0x1a242e, 1.25);
  private clear = BG;
  private lastSig = '';
  private blank = false; // the canvas is already cleared (no monitors to draw)
  private samples: number[] = [];
  private host: HTMLElement | null = null;
  private readonly viewModel = new ViewModel(C.ally);
  readonly perf: CamPerf = { lastMs: 0, avgMs: 0, maxMs: 0, renders: 0, triangles: 0, calls: 0, map: 'blockout', views: 0 };

  constructor(private readonly nav: NavModel, blockout: Blockout) {
    this.scene.fog = new THREE.Fog(BG, 18, 110);
    this.sun.intensity = 1.1; this.sun.color.set(0xfff2dd);
    this.sun.position.set(40, 80, 20);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.mapGroup, this.labelGroup);
    this.buildBlockout(blockout);
    for (let i = 0; i < 5; i++) {
      this.allies.push(new Figure(C.ally, false, roleForSlot(i + 1)));
      this.enemies.push(new Figure(C.enemy, true, roleForSlot(i + 1)));
      this.scene.add(this.allies[i].group, this.enemies[i].group);
    }
    const beaconMat = new THREE.MeshBasicMaterial({ color: C.sound, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 7, 20, 1, true), beaconMat.clone());
      b.visible = false; this.beacons.push(b); this.scene.add(b);
    }
    this.spike = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: C.enemy, emissiveIntensity: 1.4 }));
    this.spike.visible = false;
    this.spikeLight = new THREE.PointLight(C.enemy, 0, 14);
    this.spike.add(this.spikeLight);
    this.scene.add(this.spike);
  }

  init(mount: HTMLElement): void {
    this.host = mount;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio || 1));
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    renderer.autoClear = false;
    renderer.info.autoReset = false; // count triangles/calls across all monitors of one wall render
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // The map and the sun never move: the shadow map is drawn once when the mesh loads, not per frame.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    mount.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  resize(w: number, h: number): void { if (this.renderer && w > 0 && h > 0) { this.renderer.setSize(w, h); this.lastSig = ''; } }

  destroy(): void {
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
  }

  // ── map ────────────────────────────────────────────────────────────────────────────────

  private buildBlockout(b: Blockout): void {
    const tri: Record<string, number[]> = { room: [], corridor: [], site: [] };
    for (const f of b.floors) {
      const p = f.pts.map(toScene);
      for (let i = 1; i < p.length - 1; i++) tri[f.kind].push(p[0].x, p[0].y, p[0].z, p[i + 1].x, p[i + 1].y, p[i + 1].z, p[i].x, p[i].y, p[i].z);
    }
    const mesh = (pos: number[], mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };
    this.mapGroup.add(
      mesh(tri.room, new THREE.MeshStandardMaterial({ color: 0x33485a, roughness: 0.95, side: THREE.DoubleSide })),
      mesh(tri.corridor, new THREE.MeshStandardMaterial({ color: 0x283a49, roughness: 0.95, side: THREE.DoubleSide })),
      mesh(tri.site, new THREE.MeshBasicMaterial({ color: C.sound, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })),
    );
    const wallPos: number[] = []; const edge: number[] = [];
    for (const w of b.walls) {
      const a = toScene(w.a), c = toScene(w.b); const h = w.height * 0.01;
      wallPos.push(a.x, a.y, a.z, c.x, c.y, c.z, c.x, c.y + h, c.z, a.x, a.y, a.z, c.x, c.y + h, c.z, a.x, a.y + h, a.z);
      edge.push(a.x, a.y + h, a.z, c.x, c.y + h, c.z, a.x, a.y, a.z, c.x, c.y, c.z);
    }
    this.mapGroup.add(mesh(wallPos, new THREE.MeshStandardMaterial({ color: 0x4a6072, roughness: 0.9, side: THREE.DoubleSide })));
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
    this.mapGroup.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.55 })));
    const min = toScene(b.bounds.min), max = toScene(b.bounds.max);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(max.x - min.x + 80, max.z - min.z + 80), new THREE.MeshStandardMaterial({ color: 0x101a23, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((min.x + max.x) / 2, min.y - 0.6, (min.z + max.z) / 2);
    this.mapGroup.add(ground);
    for (const l of b.labels) {
      const s = textSprite(l.name.toUpperCase(), l.site ? '#f2d95c' : '#ece8e1', 56);
      s.scale.multiplyScalar(2.6);
      const p = toScene(l.pos); s.position.set(p.x, p.y, p.z);
      this.labelGroup.add(s);
    }
  }

  /**
   * Swap the blockout for the real map mesh prepared by `assets.ts` (parsed, in scene coordinates,
   * ray-cast index built). Attaching is cheap; `warmUp` then uploads it and compiles the shaders.
   */
  async setMapGlb(data: ArrayBuffer): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().parseAsync(data, '');
      const root = gltf.scene;
      let tris = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        // Colour comes from the vertex colours the export painted from each material's albedo.
        // Flat shading keeps walls, steps and edges crisp on the decimated mesh.
        m.material = new THREE.MeshStandardMaterial({ color: src?.color ?? new THREE.Color(0x8a8f96), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, vertexColors: !!m.geometry.getAttribute('color'), flatShading: true });
        m.castShadow = true; m.receiveShadow = true;
        m.geometry.computeVertexNormals(); // the GLB carries no normals; shadow bias and lighting need them
        (m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(m.geometry);
        m.raycast = acceleratedRaycast;
        m.matrixAutoUpdate = false; m.updateMatrix();
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      });
      root.updateMatrixWorld(true);
      this.lightForMap(root);
      // Compile the lit, shadowed map shaders before the mesh is shown (parallel compile where the
      // driver supports it), so the first frame with the real map does not stall playback.
      this.scene.add(root);
      root.visible = true;
      if (this.renderer) await this.renderer.compileAsync(this.scene, this.camera).catch(() => { /* compile on first draw */ });
      this.mapGroup.visible = false;
      this.glb = root;
      this.groundCache.clear();
      this.perf.map = 'glb';
      this.lastSig = '';
      console.info(`[cams] map mesh loaded: ${Math.round(tris).toLocaleString()} triangles`);
      return true;
    } catch (e) {
      console.warn('[cams] map mesh failed to load, using the blockout', e);
      return false;
    }
  }

  /** Attach a map mesh already prepared by assets.ts (preloaded during the game load). */
  setMapScene(root: THREE.Object3D): void {
    if (this.glb === root) return;
    if (this.glb) this.scene.remove(this.glb);
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.lightForMap(root);
    this.mapGroup.visible = false;
    this.glb = root;
    this.scene.add(root);
    this.groundCache.clear();
    this.perf.map = 'glb';
    this.lastSig = '';
  }

  /**
   * Upload geometry and compile shaders now (one render into a 1 × 1 viewport), so the first real
   * frame after switching to the cams is not the one that pays for it.
   */
  warmUp(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    for (const f of [...this.allies, ...this.enemies]) f.group.visible = true;
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1);
    this.camera.aspect = 1; this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    renderer.render(this.viewModel.scene, this.viewModel.camera);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    for (const f of [...this.allies, ...this.enemies]) f.group.visible = false;
    this.lastSig = '';
  }

  /**
   * Daylight for the real map: sky-blue hemisphere over a warm bounce, a low warm sun whose static
   * shadow map covers the whole mesh (drawn once — see init), and a haze the colour of the sky.
   */
  private lightForMap(root: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()); const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.z) / 2 + 4;
    this.hemi.color.set(0xcfe3f5); this.hemi.groundColor.set(0x6e5a44); this.hemi.intensity = 1.15;
    this.sun.color.set(0xffe2bf); this.sun.intensity = 2.4;
    this.sun.position.set(c.x - r * 0.55, c.y + r * 0.9, c.z + r * 0.35);
    this.sun.target.position.copy(c); this.sun.target.updateMatrixWorld();
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = r * 4;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.scene.fog = new THREE.Fog(SKY, 35, 160);
    this.clear = SKY;
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
  }

  /** Floor height (scene metres) under a game position: the navgraph height on the blockout, a downward ray on the real mesh. */
  private groundY(pos: Vec3): number {
    const s = toScene(pos);
    if (!this.glb) return s.y;
    const key = `${Math.round(s.x * 2)},${Math.round(s.z * 2)},${Math.round(s.y / 2)}`;
    const hit = this.groundCache.get(key);
    if (hit !== undefined) return hit;
    this.ray.set(new THREE.Vector3(s.x, s.y + 2.2, s.z), new THREE.Vector3(0, -1, 0));
    this.ray.far = 9;
    (this.ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const y = this.ray.intersectObject(this.glb, true)[0]?.point.y ?? s.y;
    this.groundCache.set(key, y);
    return y;
  }

  // ── frame ──────────────────────────────────────────────────────────────────────────────

  /**
   * Draw one wall frame. Returns true when the canvas is up to date for these inputs (rendered, or
   * nothing to draw / unchanged), false when the frame rate cap made it skip and the caller should
   * offer the same frame again.
   */
  render(frame: Frame | null, views: readonly CamView[], opts: CamOptions): boolean {
    const renderer = this.renderer; const host = this.host;
    if (!renderer || !host) return true;
    if (views.length === 0) {
      // tactical map mode: no monitors — clear the canvas once instead of 30 times a second
      if (!this.blank) { renderer.setScissorTest(false); renderer.setClearColor(0x000000, 0); renderer.clear(); this.blank = true; this.lastSig = ''; }
      return true;
    }
    this.blank = false;
    const now = performance.now();
    const sig = `${frame?.tMs ?? -1}|${views.map((v) => `${v.key}:${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.w)},${Math.round(v.h)}:${v.followId}`).join('|')}|${this.perf.map}`;
    if (sig === this.lastSig) return true;
    if (now - this.lastRender < 1000 / CAMS_FPS - 1) return false;
    this.lastRender = now; this.lastSig = sig;

    const hostH = host.clientHeight;
    renderer.info.reset();
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.perf.views = 0;
    if (!frame) { this.sample(performance.now() - now, renderer); return true; }

    // scene state shared by all monitors
    const t = frame.tMs;
    for (const f of [...this.allies, ...this.enemies]) f.group.visible = false;
    const buys = frame.round.summary?.buys;
    const ourGun = weaponClassOf(buys?.[frame.team]?.weapon);
    const theirGun = weaponClassOf(buys?.[frame.team === 'A' ? 'B' : 'A']?.weapon);
    const allyBy = new Map<string, Figure>();
    for (const u of frame.units) {
      const fig = this.allies[u.slot - 1]; if (!fig) continue;
      const s = toScene(u.pose.pos);
      const yaw = this.heading.get(u.id, u.facingRad, t);
      fig.place(s.x, this.groundY(u.pose.pos), s.z, Math.cos(yaw), Math.sin(yaw));
      fig.setLabel(opts.nameOf(u.id));
      fig.setWeapon(ourGun);
      fig.animate(u.pose.moving, t, u.slot * 1.3);
      allyBy.set(u.id, fig);
    }
    const enemyBy = new Map<string, { fig: Figure; seenBy: readonly string[] }>();
    for (const e of frame.seen) {
      const fig = this.enemies[e.slot - 1]; if (!fig) continue;
      fig.setLabel(opts.nameOf(e.id));
      fig.setWeapon(theirGun);
      fig.animate(false, t, e.slot);
      enemyBy.set(e.id, { fig, seenBy: e.seenBy });
    }
    const { plant } = frame.round;
    const sp = frame.situation.spike;
    const spikeOn = !!plant?.pos && (sp.phase === 'planted' || sp.phase === 'defusing');
    this.spike.visible = spikeOn;
    if (spikeOn) {
      const s = toScene(plant!.pos!);
      this.spike.position.set(s.x, this.groundY(plant!.pos!) + 0.21, s.z);
      const period = (sp.remainingMs ?? 0) < 10000 ? 450 : 1100;
      this.spikeLight.intensity = 6 + 22 * (1 - (t % period) / period);
    }

    renderer.setScissorTest(true);
    for (const view of views) {
      const me = frame.units.find((u) => u.id === view.followId);
      if (!me || !me.pose.alive) continue; // dead: the monitor shows "signal lost" (DOM), nothing is rendered
      const eye = firstPersonPose(me.pose.pos, this.heading.get(me.id, me.facingRad, t), this.groundY(me.pose.pos));
      for (const [id, fig] of allyBy) {
        const u = frame.units.find((x) => x.id === id)!;
        // players of one zone share its centre in the engine: a teammate inside arm's reach would fill the lens
        const near = Math.hypot(fig.group.position.x - eye.position.x, fig.group.position.z - eye.position.z) < 2.4;
        fig.group.visible = id !== me.id && u.pose.alive && !near;
      }
      for (const [id, e] of enemyBy) {
        e.fig.group.visible = e.seenBy.includes(me.id);
        if (!e.fig.group.visible) continue;
        const fe = frame.seen.find((x) => x.id === id)!;
        const s = toScene(fe.pos);
        e.fig.place(s.x, this.groundY(fe.pos), s.z, eye.position.x - s.x, eye.position.z - s.z); // facing the viewer
      }
      let bi = 0;
      for (const b of this.beacons) b.visible = false;
      for (const snd of me.view.sounds) {
        if (snd.kind !== 'footstep' && snd.ageMs > 3000) continue;
        const z = this.nav.zone(snd.zone); const b = this.beacons[bi++];
        if (!z || !b) continue;
        const s = toScene(z.position);
        const ph = (t % 900) / 900;
        b.position.set(s.x, this.groundY(z.position) + 3.5, s.z);
        b.scale.set(0.6 + ph * 0.9, 1, 0.6 + ph * 0.9);
        (b.material as THREE.MeshBasicMaterial).opacity = 0.34 * (1 - ph * 0.7);
        b.visible = true;
      }

      this.camera.aspect = view.w / view.h;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(eye.position.x, eye.position.y, eye.position.z);
      this.camera.lookAt(eye.target.x, eye.target.y, eye.target.z);
      const y = hostH - (view.y + view.h);
      renderer.setViewport(view.x, y, view.w, view.h);
      renderer.setScissor(view.x, y, view.w, view.h);
      renderer.setClearColor(this.clear, 1);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      // first-person view model on top (own depth range)
      const firing = firingAt(frame.round.kills, me.id, t);
      this.viewModel.update(ourGun, me.pose.moving, t, firing.kick, firing.flash);
      this.viewModel.camera.aspect = view.w / view.h;
      this.viewModel.camera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(this.viewModel.scene, this.viewModel.camera);
      this.perf.views += 1;
    }
    this.sample(performance.now() - now, renderer);
    return true;
  }

  private sample(ms: number, renderer: THREE.WebGLRenderer): void {
    const p = this.perf;
    p.lastMs = ms; p.renders += 1;
    this.samples.push(ms); if (this.samples.length > 120) this.samples.shift();
    p.avgMs = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    p.maxMs = Math.max(...this.samples);
    p.triangles = renderer.info.render.triangles; p.calls = renderer.info.render.calls;
  }
}

export { EYE_HEIGHT_M };
