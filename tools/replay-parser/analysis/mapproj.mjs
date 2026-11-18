// PROJECT V — PV-6 replay analysis: map identification + coordinate projection.
//
// Validates the PV-4 (Spatial) world->minimap transform against real decoded
// .vrf world positions, identifies the map, and assigns positions to Ascent
// callout zones. PURE functions; the CLI (run-analysis.mjs) feeds them the
// valorant-api transforms and the PV-4 navgraph (read-only, never modified).
//
// TRANSFORM (axis-swapped, the valorant-api convention PV-4 uses):
//   minimapX = gameY * xMultiplier + xScalarToAdd
//   minimapY = gameX * yMultiplier + yScalarToAdd
// Correct map => all real positions land in minimap [0,1].

export const MAPPROJ_VERSION = '1.0.0';

export function projectPoint(gameX, gameY, t) {
  return {
    mx: gameY * t.xMultiplier + t.xScalarToAdd,
    my: gameX * t.yMultiplier + t.yScalarToAdd,
  };
}

const inUnit = (v) => v >= 0 && v <= 1;

/**
 * Identify the map by testing each candidate transform: the map under which the
 * highest fraction of points fall in [0,1] (ties broken by tightest bbox) wins.
 * Returns ranked candidates. NOTE: a spatially small sample can fit many maps'
 * [0,1] box, so containment is CORROBORATING, not conclusive — combine with the
 * decoded map path hint from extract (raw.meta.mapHints).
 *
 * @param {Array<[x,y]>} points   game-world (x,y)
 * @param {Object} transforms     mapName -> {xMultiplier,yMultiplier,xScalarToAdd,yScalarToAdd}
 */
export function identifyMap(points, transforms) {
  const ranked = [];
  for (const [name, t] of Object.entries(transforms)) {
    let inside = 0, minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const [x, y] of points) {
      const { mx, my } = projectPoint(x, y, t);
      if (inUnit(mx) && inUnit(my)) inside++;
      if (mx < minX) minX = mx; if (mx > maxX) maxX = mx;
      if (my < minY) minY = my; if (my > maxY) maxY = my;
    }
    const frac = points.length ? inside / points.length : 0;
    ranked.push({
      map: name,
      fractionInUnit: +frac.toFixed(4),
      minimapBBox: { minX: +minX.toFixed(4), maxX: +maxX.toFixed(4), minY: +minY.toFixed(4), maxY: +maxY.toFixed(4) },
      bboxArea: +((maxX - minX) * (maxY - minY)).toFixed(6),
    });
  }
  // best: most points inside, then smallest (tightest) bbox area among full-containment maps
  ranked.sort((a, b) => b.fractionInUnit - a.fractionInUnit || a.bboxArea - b.bboxArea);
  return ranked;
}

/**
 * Assign each point to the nearest callout zone (by game-world distance).
 * @param {Array<[x,y]>} points   game-world (x,y)
 * @param {Array} zones           [{id,name,callout,x,y,z}] from PV-4 navgraph
 * @returns { assignments: Map-like counts, perPointNearest: [{zoneId, distUU}] }
 */
export function assignCallouts(points, zones) {
  const counts = {};
  const perPoint = [];
  for (const [x, y] of points) {
    let best = null, bestD = Infinity;
    for (const z of zones) {
      if (typeof z.x !== 'number' || typeof z.y !== 'number') continue;
      const d = Math.hypot(z.x - x, z.y - y);
      if (d < bestD) { bestD = d; best = z; }
    }
    if (best) {
      counts[best.id] = (counts[best.id] || 0) + 1;
      perPoint.push({ zoneId: best.id, distUU: +bestD.toFixed(1) });
    }
  }
  return { counts, perPoint };
}

// Straight-line (euclidean, game-world) distance between two callout zones, in
// metres, and the PV-4 graph's predicted run/walk travel time for that distance.
export function straightLineTravel(zoneA, zoneB, unitsPerMeter, runMps, walkMps) {
  const d = Math.hypot(zoneB.x - zoneA.x, zoneB.y - zoneA.y) / unitsPerMeter;
  return {
    metres: +d.toFixed(2),
    runSec: +(d / runMps).toFixed(2),
    walkSec: +(d / walkMps).toFixed(2),
  };
}
