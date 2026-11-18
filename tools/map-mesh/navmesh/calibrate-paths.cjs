#!/usr/bin/env node
/**
 * PROJECT V — PV-5 Map Mesh
 * Calibration: compare NavMesh real path length to PV-4's straight-line lower
 * bound for each zone-pair (edge) of the Ascent callout graph.
 *
 * Method:
 *   1. Load the Detour navmesh (importNavMesh).
 *   2. Load PV-4 zones (game uu) + the fitted affine game<->Blender transform.
 *   3. Map each zone game(x,y) -> Blender(x,y) via the inverse affine, build a
 *      recast query point (Blender Z-up swapped to Recast Y-up), and snap it to
 *      the nearest navmesh polygon (large halfExtents absorb the ~6-9 m
 *      region-level alignment error).
 *   4. For each PV-4 edge, computePath between the snapped endpoints; sum 3D
 *      segment lengths = navmesh path length (metres).
 *   5. Compare to PV-4's straight-line distance (edge.distanceMeters) and to the
 *      snapped straight-line, and report the detour ratio.
 *
 * PV-4 files are READ ONLY; nothing is written back to them. The output is a
 * comparison + replacement-proposal table.
 *
 * Usage:
 *   node calibrate-paths.cjs --navmesh <bin> --navgraph <pv4.json> \
 *     --transform <affine.json> --out <report.json>
 */
'use strict';
const fs = require('fs');
const { init, importNavMesh, NavMeshQuery } = require('recast-navigation');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; }

// Invert 2x2 affine: game = A*bl + t  ->  bl = Ainv*(game - t)
function invAffine(A, t) {
  const [[a, b], [c, d]] = A;
  const det = a * d - b * c;
  const Ai = [[d / det, -b / det], [-c / det, a / det]];
  return (gx, gy) => {
    const ux = gx - t[0], uy = gy - t[1];
    return [Ai[0][0] * ux + Ai[0][1] * uy, Ai[1][0] * ux + Ai[1][1] * uy];
  };
}

function dist3(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function main() {
  const navmeshPath = arg('navmesh', 'datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin');
  const navgraphPath = arg('navgraph');
  const transformPath = arg('transform', 'datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json');
  const outPath = arg('out', 'datasets/spatial/ascent/mesh/ascent-path-calibration.json');
  const UU_PER_M = 100; // documented convention (1 uu = 1 cm); fit gave ~90-100.

  await init();
  const navMesh = importNavMesh(new Uint8Array(fs.readFileSync(navmeshPath))).navMesh;
  const query = new NavMeshQuery(navMesh);

  const nav = JSON.parse(fs.readFileSync(navgraphPath, 'utf8'));
  const tf = JSON.parse(fs.readFileSync(transformPath, 'utf8'));
  const toBl = invAffine(tf.affine.A, tf.affine.t);

  // halfExtents in recast space: wide horizontal (absorb alignment error),
  // tall vertical (whole map height). Recast up-axis is Y.
  const halfExtents = { x: 14, y: 60, z: 14 };

  // --- Identify the largest connected navmesh component by sampling ---
  // findRandomPoint is area-weighted, so most samples land on the biggest
  // component. We seed from several samples and keep the largest mutually
  // reachable cloud = "main component".
  const SAMPLES = 400;
  const cloud = [];
  for (let i = 0; i < SAMPLES; i++) {
    const r = query.findRandomPoint();
    const p = r && (r.randomPoint || r.point);
    if (p) cloud.push({ x: p.x, y: p.y, z: p.z });
  }
  const reachableFrom = (seed, pts) => pts.filter(p => {
    try {
      const pr = query.computePath(seed, p, { halfExtents: { x: 3, y: 30, z: 3 } });
      const path = Array.isArray(pr) ? pr : (pr && pr.path);
      return path && path.length && dist3([path[path.length - 1].x, path[path.length - 1].y, path[path.length - 1].z], [p.x, p.y, p.z]) < 3;
    } catch (_) { return false; }
  });
  let mainComp = [];
  for (let s = 0; s < Math.min(10, cloud.length); s++) {
    const comp = reachableFrom(cloud[s], cloud);
    if (comp.length > mainComp.length) mainComp = comp;
  }
  const mainFrac = cloud.length ? mainComp.length / cloud.length : 0;
  console.log(`[calib] main navmesh component ≈ ${(mainFrac * 100).toFixed(0)}% of area `
    + `(${mainComp.length}/${cloud.length} samples)`);

  // Snap every zone: (a) nearest poly (true snap), and (b) nearest point on the
  // MAIN component (representative used for path routing). repDist = how far the
  // zone's true location is from the main navigable component.
  const snapped = {};
  for (const z of nav.zones) {
    const g = z.position;
    const [blx, bly] = toBl(g.x, g.y);
    const blz = g.z / UU_PER_M;
    const qpt = { x: blx, y: blz, z: bly };

    let rec = null, polyRef = null;
    try {
      const res = query.findNearestPoly(qpt, { halfExtents });
      const ref = res && (res.nearestRef || res.polyRef);
      const p = res && (res.nearestPoint || res.point);
      if (ref && ref !== 0 && p) { rec = [p.x, p.y, p.z]; polyRef = ref; }
    } catch (_) {}

    // nearest main-component sample (horizontal distance in recast x/z plane)
    let rep = null, repDist = null;
    for (const c of mainComp) {
      const d = Math.hypot(c.x - qpt.x, c.z - qpt.z);
      if (repDist == null || d < repDist) { repDist = d; rep = c; }
    }

    snapped[z.id] = {
      name: z.name,
      game: [g.x, g.y, g.z],
      queryRecast: [qpt.x, qpt.y, qpt.z],
      recast: rec,
      onMesh: !!rec,
      snapDist_m: rec ? +dist3([qpt.x, qpt.y, qpt.z], rec).toFixed(2) : null,
      // representative on the main navigable component:
      rep: rep ? [rep.x, rep.y, rep.z] : null,
      repDist_m: repDist != null ? +repDist.toFixed(2) : null,
    };
  }

  const onCount = Object.values(snapped).filter(s => s.onMesh).length;
  console.log(`[calib] zones snapped onto navmesh: ${onCount}/${nav.zones.length}`);

  // Path length per edge, routed between each zone's main-component
  // representative (so pairs on the same navigable surface connect).
  const REP_MAX = 18; // m: beyond this a zone is not credibly on the main component
  const results = [];
  for (const e of nav.edges) {
    const a = snapped[e.from], b = snapped[e.to];
    const row = {
      from: e.from, to: e.to,
      pv4StraightLine_m: e.distanceMeters != null ? e.distanceMeters : null,
      pv4Provenance: e.provenance,
      repDist_from_m: a ? a.repDist_m : null,
      repDist_to_m: b ? b.repDist_m : null,
    };
    if (!a || !b || !a.rep || !b.rep) {
      row.reachable = false;
      row.reason = 'no main-component representative';
      results.push(row);
      continue;
    }
    if (a.repDist_m > REP_MAX || b.repDist_m > REP_MAX) {
      row.reachable = false;
      row.reason = `endpoint off main component (repDist ${a.repDist_m}/${b.repDist_m} m > ${REP_MAX})`;
      results.push(row);
      continue;
    }
    const startPt = { x: a.rep[0], y: a.rep[1], z: a.rep[2] };
    const endPt = { x: b.rep[0], y: b.rep[1], z: b.rep[2] };
    let path = null;
    try {
      const pr = query.computePath(startPt, endPt, { halfExtents });
      path = Array.isArray(pr) ? pr : (pr && pr.path) ? pr.path : null;
    } catch (err) { row.pathErr = err.message; }

    row.repStraightLine_m = +dist3(a.rep, b.rep).toFixed(2);

    if (path && path.length >= 2) {
      let L = 0;
      for (let i = 1; i < path.length; i++) {
        L += dist3([path[i - 1].x, path[i - 1].y, path[i - 1].z],
                   [path[i].x, path[i].y, path[i].z]);
      }
      const endGap = dist3([path[path.length - 1].x, path[path.length - 1].y, path[path.length - 1].z], b.rep);
      row.reachable = endGap < 5.0;
      row.navmeshPath_m = +L.toFixed(2);
      row.navmeshPath_uu = Math.round(L * UU_PER_M);
      row.pathPoints = path.length;
      row.endGap_m = +endGap.toFixed(2);
      if (row.repStraightLine_m > 0.5) {
        row.detourRatio = +(L / row.repStraightLine_m).toFixed(2);
      }
    } else {
      row.reachable = false;
      row.reason = 'no path returned (endpoints on different components)';
    }
    results.push(row);
  }

  const reachable = results.filter(r => r.reachable);
  const ratios = reachable.map(r => r.detourRatio).filter(x => x != null).sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  const mean = ratios.length ? +(ratios.reduce((s, x) => s + x, 0) / ratios.length).toFixed(2) : null;

  const report = {
    note: 'NavMesh path length vs PV-4 straight-line lower bound, per Ascent '
        + 'callout edge. Each PV-4 zone is placed via the region-level affine '
        + 'transform (~6-9 m RMS) and represented by the nearest point on the '
        + 'navmesh MAIN connected component (repDist = how far that is). Paths are '
        + 'routed between representatives; the detour RATIO (path / rep-straight-'
        + 'line) is the robust signal, absolute lengths carry placement + '
        + 'representation uncertainty. Edges whose endpoints are off the main '
        + 'component (repDist > 18 m) or on different components are reported '
        + 'unreachable — a NavMesh-connectivity limitation, not a map fact. '
        + 'PV-4 files were not modified; see "replacementProposal".',
    unitsConvention: `${UU_PER_M} uu per metre`,
    navmesh: { file: navmeshPath.split('/').pop() },
    mainComponentFractionOfArea: +mainFrac.toFixed(2),
    zonesOnMesh: `${onCount}/${nav.zones.length}`,
    edgeSummary: {
      total: results.length,
      reachable: reachable.length,
      unreachable: results.length - reachable.length,
      detourRatio: { count: ratios.length, min: ratios[0] ?? null, median, mean, max: ratios[ratios.length - 1] ?? null },
    },
    zonesSnap: snapped,
    edges: results,
    replacementProposal: reachable
      .filter(r => r.detourRatio != null)
      .map(r => ({
        from: r.from, to: r.to,
        current_pv4_distanceMeters: r.pv4StraightLine_m,
        proposed_navmeshPath_m: r.navmeshPath_m,
        detourRatio: r.detourRatio,
        note: r.detourRatio >= 1.25
          ? 'navmesh detour notably longer than straight-line; prefer navmesh path for travel time'
          : 'near straight-line; PV-4 value is a reasonable lower bound',
      })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[calib] edges reachable ${reachable.length}/${results.length}; `
    + `detour ratio median=${median} mean=${mean} max=${ratios[ratios.length - 1] ?? null}`);
  console.log(`[calib] report -> ${outPath}`);
}

main().catch((e) => { console.error('[calib] FATAL', e); process.exit(1); });
