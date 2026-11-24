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
import { HeadingSmoother } from '../../matchday/heading.ts';
import {
  ABILITY_LIFE_MS, FirstPersonRig, abilityKindOf, animInputFor, applyMapLighting, buildAbilityProp, buildOperator, buildSpike, poseOperator, pulseSpike,
  roleForSlot, selectAnimState, setOperatorWeapon, updateAbilityProp, weaponClassOf,
  type AbilityKind, type AnimState, type Operator, type Role, type WeaponClass,
} from './models.ts';
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
  private weaponCls: WeaponClass | null = null;

  constructor(private readonly color: number, private readonly enemy: boolean, role: Role) {
    this.op = buildOperator(role, color);
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
    setOperatorWeapon(this.op, cls, this.color);
    this.weaponCls = cls;
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

  /** Pose from the animation state (idle/walk/run/crouch, aim/peek/shoot, reload, plant/defuse, throw, death); `tMs` is match time, so it pauses with playback. */
  animate(st: AnimState, tMs: number, phase: number): void {
    poseOperator(this.op, st, tMs, phase);
    if (this.marker) this.marker.rotation.y = tMs / 400;
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
  private readonly spikeProp = buildSpike(C.enemy);
  private readonly spike: THREE.Group = this.spikeProp.group;
  private mapId = 'ascent';
  private readonly abilityProps = new Map<string, { g: THREE.Group; seen: number }>();
  private abilitySweep = 0;
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
  private readonly fp = new FirstPersonRig(C.ally);
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
    this.spike.visible = false;
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
    this.spike.visible = true;
    const warm = (['smoke', 'wall', 'area', 'flash', 'orb'] as const).map((k) => { const g = buildAbilityProp(k, C.ally); g.position.copy(this.camera.position); this.scene.add(g); return g; });
    renderer.render(this.scene, this.camera);
    for (const g of warm) { this.scene.remove(g); g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); }); }
    this.spike.visible = false;
    renderer.render(this.fp.scene, this.fp.camera);
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
    this.clear = applyMapLighting({ hemi: this.hemi, sun: this.sun, scene: this.scene }, root, this.mapId);
    if (this.renderer) this.renderer.shadowMap.needsUpdate = true;
  }

  /** Which map's light preset (models.ts MAP_LIGHTING) the loaded mesh gets; call before setMapScene / setMapGlb. */
  setMapId(mapId: string): void { this.mapId = mapId.toLowerCase(); }

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
    const foe = frame.team === 'A' ? 'B' : 'A';
    const gunOf = (team: 'A' | 'B', slot: number): WeaponClass => weaponClassOf(buys?.[team]?.players?.[slot - 1]?.weapon ?? buys?.[team]?.weapon);
    const round = frame.round;
    const abilityBy = new Map<string, number[]>();
    for (const a of round.abilities ?? []) { const l = abilityBy.get(a.playerId); if (l) l.push(a.tMs); else abilityBy.set(a.playerId, [a.tMs]); }
    const states = new Map<string, { st: AnimState; cls: WeaponClass }>();
    const allyBy = new Map<string, Figure>();
    for (const u of frame.units) {
      const fig = this.allies[u.slot - 1]; if (!fig) continue;
      const s = toScene(u.pose.pos);
      const yaw = this.heading.get(u.id, u.facingRad, t);
      fig.place(s.x, this.groundY(u.pose.pos), s.z, Math.cos(yaw), Math.sin(yaw));
      fig.setLabel(opts.nameOf(u.id));
      const cls = gunOf(frame.team, u.slot);
      fig.setWeapon(cls);
      const pr = round.players.find((p) => p.id === u.id);
      const st = selectAnimState({ ...animInputFor(round, { id: u.id, deathMs: pr?.deathMs ?? null }, u.pose, t, cls, abilityBy.get(u.id)), headingRad: yaw });
      fig.animate(st, t, u.slot * 1.3);
      states.set(u.id, { st, cls });
      allyBy.set(u.id, fig);
    }
    const enemyBy = new Map<string, { fig: Figure; seenBy: readonly string[] }>();
    for (const e of frame.seen) {
      const fig = this.enemies[e.slot - 1]; if (!fig) continue;
      fig.setLabel(opts.nameOf(e.id));
      const cls = gunOf(foe, e.slot);
      fig.setWeapon(cls);
      fig.animate(selectAnimState(animInputFor(round, { id: e.id, deathMs: null }, { alive: true, moving: false, moveMode: null }, t, cls, abilityBy.get(e.id))), t, e.slot);
      enemyBy.set(e.id, { fig, seenBy: e.seenBy });
    }
    const { plant } = frame.round;
    const sp = frame.situation.spike;
    const spikeOn = !!plant?.pos && (sp.phase === 'planted' || sp.phase === 'defusing');
    this.spike.visible = spikeOn;
    if (spikeOn) {
      const s = toScene(plant!.pos!);
      this.spike.position.set(s.x, this.groundY(plant!.pos!), s.z);
      pulseSpike(this.spikeProp, sp.remainingMs ?? null, t);
    }
    this.updateAbilities(frame, t);

    renderer.setScissorTest(true);
    for (const view of views) {
      const me = frame.units.find((u) => u.id === view.followId);
      if (!me || !me.pose.alive) continue; // dead: the monitor shows "signal lost" (DOM), nothing is rendered
      const eye = firstPersonPose(me.pose.pos, this.heading.get(me.id, me.facingRad, t), this.groundY(me.pose.pos));
      for (const [id, fig] of allyBy) {
        const u = frame.units.find((x) => x.id === id)!;
        // players of one zone share its centre in the engine: a teammate inside arm's reach would fill the lens
        const near = Math.hypot(fig.group.position.x - eye.position.x, fig.group.position.z - eye.position.z) < 2.4;
        // a fallen player stays on the floor for a few seconds (death animation, then the body)
        const pr = frame.round.players.find((p) => p.id === id);
        const down = !u.pose.alive && pr?.deathMs != null && t - pr.deathMs < 6000;
        fig.group.visible = id !== me.id && (u.pose.alive || down) && !near;
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
      const mine = states.get(me.id);
      this.fp.update(mine?.cls ?? 'rifle', mine?.st ?? selectAnimState({ tMs: t, alive: true, moving: me.pose.moving, moveMode: me.pose.moveMode }), t);
      this.fp.camera.aspect = view.w / view.h;
      this.fp.camera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(this.fp.scene, this.fp.camera);
      this.perf.views += 1;
    }
    this.sample(performance.now() - now, renderer);
    return true;
  }

  /**
   * Placeholders for abilities in use: one pooled group per use, shown for its lifetime (ABILITY_LIFE_MS) at the
   * position the engine reported. Our own team's are always drawn; an enemy's only while that player is in view,
   * so utility never gives away what the team has not seen.
   */
  private updateAbilities(frame: Frame, t: number): void {
    const uses = frame.round.abilities ?? [];
    const sweep = ++this.abilitySweep;
    const visibleEnemy = new Set(frame.seen.map((e) => e.id));
    uses.forEach((a, i) => {
      const kind: AbilityKind = abilityKindOf(a.abilityId);
      const age = t - a.tMs;
      if (age < 0 || age >= ABILITY_LIFE_MS[kind] || !a.pos) return;
      const ours = frame.units.some((u) => u.id === a.playerId);
      if (!ours && !visibleEnemy.has(a.playerId)) return;
      const key = `${frame.round.roundNum}:${i}`;
      let rec = this.abilityProps.get(key);
      if (!rec) {
        const g = buildAbilityProp(kind, ours ? C.ally : C.enemy);
        const caster = frame.units.find((u) => u.id === a.playerId);
        const s = toScene(a.pos);
        g.position.set(s.x, this.groundY(a.pos) + (kind === 'orb' || kind === 'flash' ? 1.2 : 0), s.z);
        g.userData.baseY = g.position.y;
        if (caster) g.rotation.y = Math.atan2(-Math.sin(caster.facingRad), Math.cos(caster.facingRad));
        this.scene.add(g);
        rec = { g, seen: sweep }; this.abilityProps.set(key, rec);
      }
      rec.seen = sweep;
      updateAbilityProp(rec.g, age);
    });
    for (const [key, rec] of this.abilityProps) {
      if (rec.seen !== sweep) { // out of its lifetime or scrubbed away: drop it
        this.scene.remove(rec.g);
        rec.g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) (m.material as THREE.Material).dispose(); });
        this.abilityProps.delete(key);
      }
    }
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
