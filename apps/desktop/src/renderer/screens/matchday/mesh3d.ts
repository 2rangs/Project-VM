// The only three.js-using half of the match-asset preload, split out so it loads lazily (with the
// rest of the 3D team-cam code) and never weighs on the tactical-2D / loading path. assets.ts
// dynamic-imports this when, and only when, a real map mesh is actually wanted (3D quality on).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Parse a GLB that is already in scene coordinates and make it ready to render and ray-cast. */
export async function prepareMeshBytes(bytes: Uint8Array): Promise<{ root: THREE.Object3D; triangles: number }> {
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
