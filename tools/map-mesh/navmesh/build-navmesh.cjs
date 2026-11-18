#!/usr/bin/env node
/**
 * PROJECT V — PV-5 Map Mesh
 * Build the Ascent NavMesh from the extracted playable mesh using
 * recast-navigation-js (Recast/Detour).
 *
 * Input:  datasets/spatial/ascent/mesh/derived/ascent_playable.bin  (PVMESH01;
 *         float32 world positions in Blender metres + uint32 indices).
 * Output (derivative geometry -> gitignored derived/):
 *         ascent.navmesh.bin   exported Detour navmesh (via exportNavMesh).
 * Output (committable stats):
 *         ascent-navmesh-stats.json  tile/poly/vertex counts, bounds, config.
 *
 * Axis note: Blender is Z-up, Recast/Detour is Y-up. Positions are fed with
 * Y and Z swapped (recast = [blX, blZ, blY]); lengths are unchanged (pure axis
 * relabel). The swap is recorded so the query step can map PV-4 game coords in.
 *
 * Usage:
 *   node build-navmesh.cjs --mesh <in.bin> --out <navmesh.bin> --stats <stats.json>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { init, exportNavMesh } = require('recast-navigation');
const { generateTiledNavMesh } = require('recast-navigation/generators');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function readPVMesh(file) {
  const buf = fs.readFileSync(file);
  const magic = buf.toString('ascii', 0, 8);
  if (magic !== 'PVMESH01') throw new Error('bad magic: ' + magic);
  const nVerts = buf.readUInt32LE(8);
  const nTris = buf.readUInt32LE(12);
  let off = 16;
  const positions = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts * 3; i++) { positions[i] = buf.readFloatLE(off); off += 4; }
  const indices = new Uint32Array(nTris * 3);
  for (let i = 0; i < nTris * 3; i++) { indices[i] = buf.readUInt32LE(off); off += 4; }
  return { nVerts, nTris, positions, indices };
}

async function main() {
  const meshIn = arg('mesh', 'datasets/spatial/ascent/mesh/derived/ascent_playable.bin');
  const navOut = arg('out', 'datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin');
  const statsOut = arg('stats', 'datasets/spatial/ascent/mesh/ascent-navmesh-stats.json');

  const t0 = Date.now();
  const { nVerts, nTris, positions, indices } = readPVMesh(meshIn);
  console.log(`[navmesh] loaded ${nVerts} verts / ${nTris} tris`);

  // Blender Z-up -> Recast Y-up swap (in place).
  const rpos = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) {
    rpos[i * 3 + 0] = positions[i * 3 + 0];  // x
    rpos[i * 3 + 1] = positions[i * 3 + 2];  // Blender Z -> Recast Y (up)
    rpos[i * 3 + 2] = positions[i * 3 + 1];  // Blender Y -> Recast Z
  }

  await init();

  // Agent / voxel config (world units = metres). Tuned for a VALORANT agent.
  // Key params overridable from CLI for tuning connectivity on the messy art mesh.
  const num = (n, d) => { const v = arg(n, undefined); return v === undefined ? d : Number(v); };
  const config = {
    cs: num('cs', 0.2),                       // cell size (m)
    ch: num('ch', 0.2),                       // cell height (m)
    walkableSlopeAngle: num('slope', 45),     // deg
    walkableHeight: num('height', 2.0),       // agent height clearance (m)
    walkableClimb: num('climb', 0.9),         // max step-up / stairs (m)
    walkableRadius: num('radius', 0.3),       // agent radius (m)
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: num('minRegion', 8),
    mergeRegionArea: num('mergeRegion', 40),
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    tileSize: num('tileSize', 64),            // voxels per tile edge -> tiled navmesh
  };

  const result = generateTiledNavMesh(rpos, indices, config, false);
  if (!result.success) {
    throw new Error('navmesh generation failed: ' + (result.error || 'unknown'));
  }
  const navMesh = result.navMesh;
  console.log(`[navmesh] generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Tally tiles / polys / verts.
  const maxTiles = navMesh.getMaxTiles();
  let tilesUsed = 0, polyCount = 0, vertCount = 0;
  let bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < maxTiles; i++) {
    const tile = navMesh.getTile(i);
    const header = tile && tile.header();
    if (!header) continue;
    const pc = header.polyCount();
    if (pc <= 0) continue;
    tilesUsed++;
    polyCount += pc;
    vertCount += header.vertCount();
    // tile bounds are in recast space (y up); bmin(i)/bmax(i) return component i.
    const tbmin = [header.bmin(0), header.bmin(1), header.bmin(2)];
    const tbmax = [header.bmax(0), header.bmax(1), header.bmax(2)];
    for (let k = 0; k < 3; k++) {
      bmin[k] = Math.min(bmin[k], tbmin[k]);
      bmax[k] = Math.max(bmax[k], tbmax[k]);
    }
  }
  // recast(x, y=up, z) -> blender(x, z, y)
  const blMin = [bmin[0], bmin[2], bmin[1]];
  const blMax = [bmax[0], bmax[2], bmax[1]];

  // Export navmesh (derivative; gitignored).
  const exported = exportNavMesh(navMesh);
  fs.mkdirSync(path.dirname(navOut), { recursive: true });
  fs.writeFileSync(navOut, Buffer.from(exported));
  console.log(`[navmesh] exported ${exported.length} bytes -> ${navOut}`);

  const stats = {
    note: 'Ascent NavMesh built with recast-navigation-js (Recast/Detour) from the '
        + 'playable art geometry. Geometry itself not stored here; the exported '
        + 'navmesh .bin is a derivative and stays gitignored (see ascent-mesh.md §9).',
    recastNavigationVersion: (() => {
      try {
        return JSON.parse(fs.readFileSync(
          path.join(__dirname, 'node_modules', 'recast-navigation', 'package.json'), 'utf8')).version;
      } catch (_) { return 'unknown'; }
    })(),
    inputMesh: { verts: nVerts, tris: nTris },
    axis: 'input Blender Z-up swapped to Recast Y-up: recast=[blX, blZ, blY]',
    config,
    output: {
      navmeshFile: path.basename(navOut),
      navmeshBytes: exported.length,
      tilesUsed,
      polyCount,
      vertCount,
      boundsBlenderMetres: { min: blMin.map(v => +v.toFixed(2)), max: blMax.map(v => +v.toFixed(2)) },
    },
    buildSeconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
  fs.writeFileSync(statsOut, JSON.stringify(stats, null, 2));
  console.log(`[navmesh] tiles=${tilesUsed} polys=${polyCount} verts=${vertCount}`);
  console.log(`[navmesh] stats -> ${statsOut}`);
}

main().catch((e) => { console.error('[navmesh] FATAL', e); process.exit(1); });
