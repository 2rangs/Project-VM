// Renderer-side half of test/perf.maps.mjs: mirrors the team-cams renderer (same renderer flags, static
// sun shadow, vertex-coloured mesh with a BVH, five monitors with first-person rigs, ten skinned
// operators) on ANY map's GLB, since the app itself only runs Ascent today.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import {
  FirstPersonRig, WEAPON_CLASSES, applyMapLighting, buildOperator, poseOperator, roleForSlot, selectAnimState,
  setOperatorWeapon, drawCallsOf, type AnimInput,
} from '../../src/renderer/screens/matchday/models.ts';

declare global { interface Window { __perf?: unknown; __perfError?: string } }
const q = new URLSearchParams(location.search);
const map = q.get('map') ?? 'ascent';
const frames = Number(q.get('frames') ?? 360);

/** ?mode=figures: a lineup of every role / pose on a flat floor, for looking at the models (no map). */
async function figures(): Promise<unknown> {
  const W = 1800, H = 700;
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas); document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setSize(W, H); renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fb4c4);
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x4a4036, 1.6)); const sun = new THREE.DirectionalLight(0xffe7cc, 2.2); sun.position.set(-3, 6, 4); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 20), new THREE.MeshStandardMaterial({ color: 0x59606a })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  const poses: Partial<AnimInput>[] = [{ headingRad: 0, aimYawRad: 0, shotsMs: [10_000] }, { moving: true, moveMode: 'run' }, { crouched: true, shotsMs: [9_800] }, { plant: { startMs: 9_000, endMs: 13_000 } }, { abilityMs: [9_800] }, { shotsMs: [8_500], tMs: 11_700 }, { deathMs: 9_900, tMs: 10_700 }, { speedUUps: 330, headingRad: 0, travelRad: 0, aimYawRad: 1.0 }];
  const roles = ['controller', 'initiator', 'sentinel', 'duelist'] as const;
  const accent = 0x3fd0ff;
  poses.forEach((pz, c) => roles.forEach((role, r) => {
    const op = buildOperator(role, r % 2 ? 0xff4655 : accent); setOperatorWeapon(op, WEAPON_CLASSES[(c + r) % WEAPON_CLASSES.length]!, r % 2 ? 0xff4655 : accent);
    poseOperator(op, selectAnimState({ tMs: 10_000, alive: true, weapon: op.weaponCls, ...pz }), pz.tMs ?? 10_000, r * 1.3);
    op.root.position.set(c * 1.9 - 6.6, 0, r * 1.5 - 2.25); op.root.rotation.y += Math.PI * 0.35; scene.add(op.root);
  }));
  const cam = new THREE.PerspectiveCamera(32, W / H, 0.1, 100); cam.position.set(-4, 5.2, 14.5); cam.lookAt(-0.5, 0.7, 0); renderer.render(scene, cam);
  return { figures: poses.length * roles.length };
}
async function run(): Promise<unknown> {
  if (q.get('mode') === 'figures') return figures();
  const t0 = performance.now();
  const [glbBuf, nav] = await Promise.all([
    fetch(`/glb/${map}.glb`).then((r) => { if (!r.ok) throw new Error(`no ${map}.glb`); return r.arrayBuffer(); }),
    fetch(`/nav/${map}.nav.json`).then((r) => r.json()),
  ]);
  const tFetch = performance.now() - t0;
  const gltf = await new GLTFLoader().parseAsync(glbBuf, '');
  const root = gltf.scene;
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, vertexColors: !!m.geometry.getAttribute('color'), flatShading: true });
    m.castShadow = true; m.receiveShadow = true;
    m.geometry.computeVertexNormals();
    (m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(m.geometry);
    m.raycast = acceleratedRaycast;
    m.matrixAutoUpdate = false; m.updateMatrix();
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  });
  root.updateMatrixWorld(true);
  const tParse = performance.now() - t0 - tFetch;

  const W = 1600, H = 900;
  const canvas = document.createElement('canvas'); document.body.appendChild(canvas); document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.autoClear = false; renderer.info.autoReset = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  scene.add(hemi, sun, sun.target, root);
  const clear = applyMapLighting({ hemi, sun, scene }, root, map);

  // ten operators on roadmap nodes (seeded), five per team, mid-stride / aiming / etc.
  const nodes: number[][] = nav.nodes;
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ray = new THREE.Raycaster(); (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  const pickNode = () => nodes[Math.floor(rnd() * nodes.length)]!;
  const ground = (x: number, y: number, z: number) => { ray.set(new THREE.Vector3(x, y + 1.2, z), new THREE.Vector3(0, -1, 0)); ray.far = 5; return ray.intersectObject(root, true)[0]?.point.y ?? y; };
  const ops: { op: ReturnType<typeof buildOperator>; input: AnimInput; phase: number; cls: (typeof WEAPON_CLASSES)[number] }[] = [];
  const group = new THREE.Group(); scene.add(group);
  const states: Partial<AnimInput>[] = [{}, { moving: true, moveMode: 'run' }, { moving: true, moveMode: 'walk' }, { shotsMs: [10_000] }, { crouched: true }, { plant: { startMs: 9_000, endMs: 13_000 } }, { abilityMs: [9_800] }, { shotsMs: [8_000] }, { moving: true, moveMode: 'run' }, { deathMs: 9_900 }];
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) {
    const n = pickNode(); const x = n[0]! * 0.01, z = n[1]! * 0.01, y = n[2]! * 0.01;
    spots.push(new THREE.Vector3(x, ground(x, y, z), z));
    const accent = i < 5 ? 0x3fd0ff : 0xff4655;
    const op = buildOperator(roleForSlot((i % 5) + 1), accent);
    const cls = WEAPON_CLASSES[i % WEAPON_CLASSES.length]!;
    setOperatorWeapon(op, cls, accent);
    op.root.position.copy(spots[i]!); op.root.rotation.y = rnd() * 6.28;
    group.add(op.root);
    ops.push({ op, input: { tMs: 10_000, alive: true, weapon: cls, ...states[i] }, phase: i * 1.3, cls });
  }
  // five monitors (1600×900 split 3+2), each a first-person camera standing on one ally and looking at a neighbour
  const cams = [0, 1, 2, 3, 4].map((i) => ({ cam: new THREE.PerspectiveCamera(72, 1, 0.08, 400), fp: new FirstPersonRig(0x3fd0ff), who: i }));
  const cell = (i: number) => { const col = i % 3, row = Math.floor(i / 3); const w = i < 3 ? W / 3 : W / 2, h = H / 2; return { x: (i < 3 ? col * w : (i - 3) * w), y: row * h, w, h }; };

  renderer.shadowMap.needsUpdate = true;
  const tc = performance.now();
  await renderer.compileAsync(scene, cams[0]!.cam).catch(() => undefined);
  const render = (t: number) => {
    renderer.info.reset();
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 0); renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H); renderer.clear();
    ops.forEach((o, i) => { const st = selectAnimState({ ...o.input, tMs: t }); poseOperator(o.op, st, t, o.phase, 0.05); o.op.root.visible = i >= 5 || t < 1e9; });
    cams.forEach((c, i) => {
      const me = ops[c.who]!.op.root.position;
      const look = ops[(c.who + 5) % 10]!.op.root.position;
      c.cam.position.set(me.x, me.y + 1.6, me.z);
      c.cam.lookAt(look.x, me.y + 1.5, look.z);
      const v = cell(i);
      c.cam.aspect = v.w / v.h; c.cam.updateProjectionMatrix();
      renderer.setViewport(v.x, H - (v.y + v.h), v.w, v.h); renderer.setScissor(v.x, H - (v.y + v.h), v.w, v.h);
      renderer.setClearColor(clear, 1); renderer.clear();
      renderer.render(scene, c.cam);
      c.fp.update(WEAPON_CLASSES[c.who % WEAPON_CLASSES.length]!, selectAnimState({ ...ops[c.who]!.input, tMs: t }), t);
      c.fp.camera.aspect = v.w / v.h; c.fp.camera.updateProjectionMatrix();
      renderer.clearDepth(); renderer.render(c.fp.scene, c.fp.camera);
    });
  };
  render(10_000); renderer.getContext().finish();
  const tCompile = performance.now() - tc;

  const cpu: number[] = [], gaps: number[] = [];
  await new Promise<void>((res) => {
    let last = performance.now(), n = 0;
    const f = (now: number) => {
      gaps.push(now - last); last = now;
      const a = performance.now(); render(10_000 + n * 16.7); cpu.push(performance.now() - a);
      if (++n < frames) requestAnimationFrame(f); else res();
    };
    requestAnimationFrame(f);
  });
  const gl = renderer.getContext(); gl.finish();
  gaps.shift();
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const pc = (a: number[], p: number) => sorted(a)[Math.min(a.length - 1, Math.floor(p * a.length))]!;
  const span = gaps.reduce((s, x) => s + x, 0);
  return {
    map, meshTris: Math.round(tris), glbBytes: glbBuf.byteLength, fetchMs: Math.round(tFetch), parseBvhMs: Math.round(tParse), compileFirstFrameMs: Math.round(tCompile),
    fps: Math.round((gaps.length / (span / 1000)) * 10) / 10, frameP50: +pc(gaps, 0.5).toFixed(1), frameP95: +pc(gaps, 0.95).toFixed(1), frameMax: +Math.max(...gaps).toFixed(1),
    cpuP50: +pc(cpu, 0.5).toFixed(2), cpuP95: +pc(cpu, 0.95).toFixed(2),
    drawCalls: renderer.info.render.calls, trianglesRendered: renderer.info.render.triangles,
    operatorDrawCalls: drawCallsOf(group), views: 5,
  };
}
run().then((r) => { window.__perf = r; }, (e) => { window.__perfError = String(e?.stack ?? e); });
