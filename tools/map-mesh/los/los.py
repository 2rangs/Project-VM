#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh (round 2)
Real line-of-sight (LoS) between Ascent callout zones by ray-casting against the
wall occluder mesh. Produces an inter-zone visibility matrix (probability from
seeded multi-sample) and compares it to PV-4's hand-authored sightlines.

Method:
  - Occluders = wall triangles (ascent_walls.bin, world metres, Blender Z-up).
  - Eye points = each zone's grid worldFloor (x,y,z) + eye height (default 1.6 m).
  - For a zone pair, sample K jittered eye points around each zone (seeded) and
    test segment visibility for K sample pairs; visibility probability = fraction
    of segments with no wall intersection.
  - Acceleration: a uniform XY grid buckets wall triangles; a segment tests only
    triangles in the cells its XY projection crosses. Intersection is batched
    Moeller-Trumbore in numpy.

Core functions (moeller_trumbore_batch, segment_cells) are importable and
unit-tested in tools/map-mesh/los/test_los.py.

Usage:
  python3 -I tools/map-mesh/los/los.py \
    --walls datasets/spatial/ascent/mesh/derived/ascent_walls.bin \
    --grid  datasets/spatial/ascent/mesh/ascent-grid-calibration.json \
    --navgraph <PV-4 ascent.navgraph.json> \
    --out datasets/spatial/ascent/mesh/ascent-los-matrix.json
"""
import sys, os, json, math, struct, argparse
import numpy as np


# ----------------------------- core (tested) -----------------------------

def moeller_trumbore_batch(orig, direction, v0, v1, v2, eps=1e-6):
    """Vectorised ray/segment-triangle intersection.
    orig,direction: (3,) ray origin and (unnormalised) direction = q-p so that a
    hit with 0<t<1 lies strictly between p and q.
    v0,v1,v2: (N,3) triangle vertices. Returns (N,) float t (np.inf if no hit)."""
    orig = np.asarray(orig, float); direction = np.asarray(direction, float)
    e1 = v1 - v0
    e2 = v2 - v0
    pvec = np.cross(direction, e2)                # (N,3)
    det = np.einsum('ij,ij->i', e1, pvec)         # (N,)
    out = np.full(v0.shape[0], np.inf)
    mask = np.abs(det) > eps
    if not np.any(mask):
        return out
    inv = np.zeros_like(det); inv[mask] = 1.0 / det[mask]
    tvec = orig - v0                               # (N,3)
    u = np.einsum('ij,ij->i', tvec, pvec) * inv
    qvec = np.cross(tvec, e1)
    v = np.einsum('j,ij->i', direction, qvec) * inv
    t = np.einsum('ij,ij->i', e2, qvec) * inv
    hit = mask & (u >= -eps) & (v >= -eps) & (u + v <= 1 + eps) & (t > eps) & (t < 1 - eps)
    out[hit] = t[hit]
    return out


def segment_cells(ax, ay, bx, by, minx, miny, cs):
    """Integer XY grid cells a 2D segment passes through (supercover-ish DDA)."""
    cells = set()
    n = max(2, int(math.hypot(bx - ax, by - ay) / cs) + 1) * 2
    for i in range(n + 1):
        s = i / n
        x = ax + (bx - ax) * s
        y = ay + (by - ay) * s
        cells.add((int((x - minx) // cs), int((y - miny) // cs)))
    return cells


# ----------------------------- io -----------------------------

def read_pvmesh(path):
    with open(path, "rb") as f:
        buf = f.read()
    assert buf[:8] == b"PVMESH01", "bad magic"
    nV, nT = struct.unpack_from("<II", buf, 8)
    off = 16
    pos = np.array(struct.unpack_from(f"<{nV*3}f", buf, off), float).reshape(nV, 3)
    off += nV * 3 * 4
    idx = np.array(struct.unpack_from(f"<{nT*3}I", buf, off), int).reshape(nT, 3)
    return pos, idx


class WallIndex:
    """Uniform XY grid over wall triangles for segment broadphase."""
    def __init__(self, pos, idx, cs=4.0):
        self.cs = cs
        self.v0 = pos[idx[:, 0]]
        self.v1 = pos[idx[:, 1]]
        self.v2 = pos[idx[:, 2]]
        self.minx = float(pos[:, 0].min())
        self.miny = float(pos[:, 1].min())
        self.buckets = {}
        tri_min = np.minimum(np.minimum(self.v0, self.v1), self.v2)
        tri_max = np.maximum(np.maximum(self.v0, self.v1), self.v2)
        ix0 = ((tri_min[:, 0] - self.minx) // cs).astype(int)
        iy0 = ((tri_min[:, 1] - self.miny) // cs).astype(int)
        ix1 = ((tri_max[:, 0] - self.minx) // cs).astype(int)
        iy1 = ((tri_max[:, 1] - self.miny) // cs).astype(int)
        for t in range(idx.shape[0]):
            for cx in range(ix0[t], ix1[t] + 1):
                for cy in range(iy0[t], iy1[t] + 1):
                    self.buckets.setdefault((cx, cy), []).append(t)

    def candidates(self, p, q):
        cells = segment_cells(p[0], p[1], q[0], q[1], self.minx, self.miny, self.cs)
        out = set()
        for c in cells:
            b = self.buckets.get(c)
            if b:
                out.update(b)
        return np.fromiter(out, dtype=int) if out else np.empty(0, int)

    def occluded(self, p, q):
        cand = self.candidates(p, q)
        if cand.size == 0:
            return False
        d = np.asarray(q, float) - np.asarray(p, float)
        t = moeller_trumbore_batch(p, d, self.v0[cand], self.v1[cand], self.v2[cand])
        return bool(np.isfinite(t).any())


# ----------------------------- main -----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--walls", required=True)
    ap.add_argument("--grid", required=True, help="grid calibration json with zonesSnap.worldFloor")
    ap.add_argument("--navgraph", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--eye-height", type=float, default=1.6)
    ap.add_argument("--samples", type=int, default=5, help="jittered eye points per zone")
    ap.add_argument("--jitter", type=float, default=1.5, help="eye-point jitter radius (m)")
    ap.add_argument("--broadphase-cs", type=float, default=4.0)
    ap.add_argument("--seed", type=int, default=20261118)
    args = ap.parse_args()

    pos, idx = read_pvmesh(args.walls)
    widx = WallIndex(pos, idx, cs=args.broadphase_cs)

    grid = json.load(open(args.grid))
    nav = json.load(open(args.navgraph))
    snaps = grid["zonesSnap"]

    rng = np.random.default_rng(args.seed)
    # eye points per zone: worldFloor + eye height, with K seeded jittered copies
    eyes = {}
    for zid, s in snaps.items():
        wf = s.get("worldFloor")
        if not wf:
            continue
        base = np.array([wf[0], wf[1], wf[2] + args.eye_height])
        pts = [base]
        for _ in range(args.samples - 1):
            off = rng.uniform(-args.jitter, args.jitter, size=2)
            pts.append(np.array([base[0] + off[0], base[1] + off[1], base[2]]))
        eyes[zid] = pts

    zids = [z["id"] for z in nav["zones"] if z["id"] in eyes]

    def visibility(a, b):
        # Test all sample-pair combinations so a single eye point placed near a
        # wall (region-level transform error ~7 m) does not force 0; probability
        # = fraction of unobstructed sample segments.
        pa, pb = eyes[a], eyes[b]
        total = vis = 0
        for ea in pa:
            for eb in pb:
                total += 1
                if not widx.occluded(ea, eb):
                    vis += 1
        return vis / total if total else 0.0

    # full matrix (upper triangle), plus PV-4 sightline comparison
    matrix = {a: {} for a in zids}
    for i, a in enumerate(zids):
        for b in zids[i + 1:]:
            p = round(visibility(a, b), 2)
            matrix[a][b] = p
            matrix.setdefault(b, {})[a] = p
        matrix[a][a] = 1.0

    # PV-4 sightlines (manual-approx) comparison
    pv4 = nav.get("sightlines", [])
    comparison = []
    for sl in pv4:
        # PV-4 sightlines use keys "a"/"b" (manual-approx).
        a, b = sl.get("a", sl.get("from")), sl.get("b", sl.get("to"))
        if a in matrix and b in matrix.get(a, {}):
            comparison.append({
                "a": a, "b": b,
                "pv4": {k: sl[k] for k in sl if k not in ("a", "b")},
                "measuredVisibilityProb": matrix[a][b],
                "agreement": ("measured-visible" if matrix[a][b] >= 0.25 else "measured-blocked")
                             + " vs pv4-sightline-asserted",
            })

    # headline stats
    allvals = [matrix[a][b] for i, a in enumerate(zids) for b in zids[i+1:]]
    report = {
        "note": "Real line-of-sight visibility between Ascent callouts by ray-"
                "casting eye-to-eye against the wall occluder mesh. Probability = "
                "fraction of seeded jittered eye-point pairs with an unobstructed "
                "segment. Eye points are grid worldFloor + eye height; wall "
                "occluders are near-vertical triangles. Placement carries the "
                "region-level transform error (~6-9 m), so treat probabilities as "
                "approximate, strongest as a RELATIVE ordering. PV-4 files unchanged.",
        "params": {"eyeHeight_m": args.eye_height, "samplesPerZone": args.samples,
                   "jitterRadius_m": args.jitter, "broadphaseCell_m": args.broadphase_cs,
                   "seed": args.seed},
        "occluderWallTris": int(idx.shape[0]),
        "zones": zids,
        "visibilityStats": {
            "pairs": len(allvals),
            "fullyVisiblePairs": sum(1 for v in allvals if v >= 0.99),
            "fullyBlockedPairs": sum(1 for v in allvals if v <= 0.01),
            "meanVisibility": round(sum(allvals) / len(allvals), 3) if allvals else None,
        },
        "pv4SightlineComparison": comparison,
        "visibilityMatrix": matrix,
    }
    json.dump(report, open(args.out, "w"), indent=2)
    print(f"[los] walls={idx.shape[0]} zones={len(zids)} pairs={len(allvals)} "
          f"meanVis={report['visibilityStats']['meanVisibility']} "
          f"fullyVisible={report['visibilityStats']['fullyVisiblePairs']} "
          f"fullyBlocked={report['visibilityStats']['fullyBlockedPairs']}")
    print(f"[los] PV-4 sightline comparisons: {len(comparison)}")
    print(f"[los] report -> {args.out}")


if __name__ == "__main__":
    main()
