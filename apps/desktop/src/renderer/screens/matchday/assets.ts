// Match assets, prepared while the game loads — not when a view first needs them.
//
// preloadMatchAssets() is started together with the match simulation / session start and the
// loading screen waits for it, so by the time the live view opens:
//   · the optional real map mesh for the team cams is read, parsed and has its ray-cast index
//     built (CamStage3D only attaches it and uploads it once),
//   · the minimap image is resolved and decoded (the tactical map shows it at once).
// Switching to the team cams therefore never starts a load of its own. When no mesh is installed
// (assets/maps/<map>.glb is optional and never in git) the state is 'absent' and the cams use the
// navgraph blockout; a mesh that cannot be parsed is 'failed' and the blockout is used with a note.
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { Assets } from 'pixi.js';
import { valorantApiMinimap } from '@pv/replay-viewer';
import { bridge } from '../../platform.ts';

export type MeshState = 'idle' | 'loading' | 'ready' | 'absent' | 'failed';

interface Store { mesh: MeshState; root: THREE.Object3D | null; triangles: number; minimapUrl: string | null; minimapOk: boolean | null }
const store: Store = { mesh: 'idle', root: null, triangles: 0, minimapUrl: null, minimapOk: null };
const listeners = new Set<() => void>();
let snapshot = { mesh: store.mesh, minimapOk: store.minimapOk };
const emit = () => { snapshot = { mesh: store.mesh, minimapOk: store.minimapOk }; for (const l of listeners) l(); };
let pending: Promise<void> | null = null;

/** Parse a GLB that is already in scene coordinates and make it ready to render and ray-cast. */
async function prepareMesh(bytes: Uint8Array): Promise<{ root: THREE.Object3D; triangles: number }> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const root = gltf.scene;
  let triangles = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    m.material = new THREE.MeshStandardMaterial({ color: src?.color ?? new THREE.Color(0x8a8f96), roughness: 0.95, metalness: 0, side: THREE.DoubleSide, vertexColors: !!m.geometry.getAttribute('color') });
    m.geometry.computeVertexNormals();
    (m.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = new MeshBVH(m.geometry);
    m.raycast = acceleratedRaycast;
    m.matrixAutoUpdate = false; m.updateMatrix();
    triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  });
  root.updateMatrixWorld(true);
  return { root, triangles };
}

async function loadMesh(mapId: string): Promise<void> {
  if (store.mesh === 'ready' || store.mesh === 'absent') return;
  store.mesh = 'loading'; emit();
  try {
    const bytes = await bridge.loadMapMesh(mapId);
    if (!bytes) { store.mesh = 'absent'; emit(); return; }
    const { root, triangles } = await prepareMesh(bytes);
    store.root = root; store.triangles = triangles; store.mesh = 'ready';
    console.info(`[assets] map mesh ready: ${Math.round(triangles).toLocaleString()} triangles`);
  } catch (e) {
    console.warn('[assets] map mesh failed to load — the team cams use the blockout', e);
    store.mesh = 'failed';
  }
  emit();
}

async function loadMinimap(): Promise<void> {
  if (store.minimapOk) return;
  try {
    const url = await valorantApiMinimap('Ascent');
    if (!url) { store.minimapOk = false; emit(); return; }
    await Assets.load({ src: url, loadParser: 'loadTextures' }); // cached: MatchStage.setMap(url) resolves instantly
    store.minimapUrl = url; store.minimapOk = true;
  } catch { store.minimapOk = false; }
  emit();
}

/**
 * Start (or join) the preparation of everything the live view needs. Never rejects; resolves once
 * both parts have settled or after `maxWaitMs`, so a loading screen that awaits it cannot hang.
 */
export function preloadMatchAssets(mapId = 'ascent', maxWaitMs = 20000): Promise<void> {
  if (!pending) pending = Promise.all([loadMesh(mapId), loadMinimap()]).then(() => undefined, () => undefined).finally(() => { pending = null; });
  return Promise.race([pending, new Promise<void>((res) => setTimeout(res, maxWaitMs))]);
}

export const preparedMesh = (): THREE.Object3D | null => store.root;
export const preparedMinimapUrl = (): string | null => store.minimapUrl;

/** Asset state for React (mesh + minimap), updated as the preload settles. */
export function useMatchAssets(): { mesh: MeshState; minimapOk: boolean | null } {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => snapshot, () => snapshot);
}
