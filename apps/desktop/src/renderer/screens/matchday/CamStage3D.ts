// three.js stage for the team cams: real first-person 3D views, one per player of our team.
//
// ONE WebGLRenderer / one canvas covers the whole wall; each monitor is a scissored viewport of
// it with its own camera pose (no per-monitor WebGL context, no render targets). The scene is
// built once — the map (real GLB when installed, navgraph blockout otherwise), ten pooled
// player figures, sound beacons and the spike — and per monitor only visibility flags and the
// camera change. Rendering is capped at CAMS_FPS; the 2D map and the HUD keep their own pace.
//
// What a monitor may show is decided by the Frame (matchday/frame.ts): teammates always, an
// enemy figure only while THAT player sees it, a sound beacon only if THAT player heard it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { NavModel, Vec3 } from '../../matchday/nav.ts';
import type { Frame } from '../../matchday/frame.ts';
import { EYE_HEIGHT_M, firstPersonPose, toScene, type Blockout } from '../../matchday/world3d.ts';
import { C, FONT } from '../../matchday/theme.ts';

export const CAMS_FPS = 30;

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

class Figure {
  readonly group = new THREE.Group();
  private label: THREE.Sprite | null = null;
  private labelText = '';
  constructor(private readonly color: number, enemy: boolean) {
    // An enemy is drawn only while the engine says this player sees it. The engine's sightlines
    // are zone-to-zone, so on the real mesh a "seen" enemy can stand behind a wall: enemy figures
    // therefore ignore depth (a spotted-contact highlight) instead of silently disappearing.
    const through = enemy ? { depthTest: false, depthWrite: false, fog: false } : {};
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: enemy ? 0.75 : 0.45, roughness: 0.6, ...through });
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b131b, roughness: 0.4, ...through });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.85, 4, 10), mat);
    body.position.y = 0.72;
    const head = new THREE.Mesh(enemy ? new THREE.OctahedronGeometry(0.24) : new THREE.SphereGeometry(0.21, 14, 10), mat);
    head.position.y = 1.58;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.3), dark);
    visor.position.set(0.19, 1.6, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.07), dark);
    gun.position.set(0.5, 1.18, 0.2);
    this.group.add(body, head, visor, gun);
    if (enemy) this.group.traverse((o) => { o.renderOrder = 10; });
    this.group.visible = false;
  }
  setLabel(text: string): void {
    if (text === this.labelText) return;
    if (this.label) { this.group.remove(this.label); (this.label.material.map as THREE.Texture).dispose(); this.label.material.dispose(); }
    this.label = textSprite(text.toUpperCase(), `#${this.color.toString(16).padStart(6, '0')}`);
    this.label.position.y = 2.15;
    this.group.add(this.label);
    this.labelText = text;
  }
  /** Stand on the ground at a scene position, facing a scene-space yaw (direction cos/sin on x/z). */
  place(x: number, groundY: number, z: number, dirX: number, dirZ: number): void {
    this.group.position.set(x, groundY, z);
    this.group.rotation.y = Math.atan2(-dirZ, dirX);
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
  private lastSig = '';
  private samples: number[] = [];
  private host: HTMLElement | null = null;
  readonly perf: CamPerf = { lastMs: 0, avgMs: 0, maxMs: 0, renders: 0, triangles: 0, calls: 0, map: 'blockout', views: 0 };

  constructor(private readonly nav: NavModel, blockout: Blockout) {
    this.scene.fog = new THREE.Fog(BG, 18, 110);
    this.scene.add(new THREE.HemisphereLight(0xdcecff, 0x1a242e, 1.25));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
    sun.position.set(40, 80, 20);
    this.scene.add(sun, this.mapGroup, this.labelGroup);
    this.buildBlockout(blockout);
    for (let i = 0; i < 5; i++) {
      this.allies.push(new Figure(C.ally, false));
      this.enemies.push(new Figure(C.enemy, true));
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
   * Swap the blockout for a real map mesh (a GLB already in scene coordinates — see
   * tools/map-mesh/blender/export-web-glb.py). Returns false and keeps the blockout on failure.
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
        m.material = new THREE.MeshStandardMaterial({ color: src?.color ?? new THREE.Color(0x8a8f96), roughness: 0.95, metalness: 0, side: THREE.DoubleSide, vertexColors: !!m.geometry.getAttribute('color') });
        m.geometry.computeVertexNormals();
        (m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(m.geometry);
        m.raycast = acceleratedRaycast;
        m.matrixAutoUpdate = false; m.updateMatrix();
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      });
      root.updateMatrixWorld(true);
      this.mapGroup.visible = false;
      this.glb = root;
      this.scene.add(root);
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

  render(frame: Frame | null, views: readonly CamView[], opts: CamOptions): void {
    const renderer = this.renderer; const host = this.host;
    if (!renderer || !host) return;
    const now = performance.now();
    const sig = `${frame?.tMs ?? -1}|${views.map((v) => `${v.key}:${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.w)},${Math.round(v.h)}:${v.followId}`).join('|')}|${this.perf.map}`;
    if (sig === this.lastSig) return;
    if (now - this.lastRender < 1000 / CAMS_FPS - 1) return;
    this.lastRender = now; this.lastSig = sig;

    const hostH = host.clientHeight;
    renderer.info.reset();
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.perf.views = 0;
    if (!frame) { this.sample(performance.now() - now, renderer); return; }

    // scene state shared by all monitors
    const t = frame.tMs;
    for (const f of [...this.allies, ...this.enemies]) f.group.visible = false;
    const allyBy = new Map<string, Figure>();
    for (const u of frame.units) {
      const fig = this.allies[u.slot - 1]; if (!fig) continue;
      const s = toScene(u.pose.pos);
      fig.place(s.x, this.groundY(u.pose.pos), s.z, Math.cos(u.facingRad), Math.sin(u.facingRad));
      fig.setLabel(opts.nameOf(u.id));
      allyBy.set(u.id, fig);
    }
    const enemyBy = new Map<string, { fig: Figure; seenBy: readonly string[] }>();
    for (const e of frame.seen) {
      const fig = this.enemies[e.slot - 1]; if (!fig) continue;
      fig.setLabel(opts.nameOf(e.id));
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
      const eye = firstPersonPose(me.pose.pos, me.facingRad, this.groundY(me.pose.pos));
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
      renderer.setClearColor(BG, 1);
      renderer.clear();
      renderer.render(this.scene, this.camera);
      this.perf.views += 1;
    }
    this.sample(performance.now() - now, renderer);
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
