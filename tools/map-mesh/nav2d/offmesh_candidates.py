#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh (round 2)
Auto-detect level-transition "off-mesh connection" candidates for Ascent: places
where the walkable surface splits into separate connected components but a short
stair / ramp / drop would reconnect them. These serve both the 2.5D grid (as
bridge edges) and a Detour navmesh (as off-mesh connections).

Detection: build the 2.5D grid (build_grid core), find its connected components,
then for every node on a NON-main component look for the nearest node on a larger
component within `--radius` horizontally and `--max-gap` vertically. Each such
pair is a candidate bridge, emitted with world endpoints, horizontal/vertical
gap, the components it joins, and `provenance:"auto-detected"`.

A separate manual-correction file (`offmesh-manual.json`) can override/add links
with `provenance:"manual"`; it is applied on top of the auto list.

The predicate `is_bridge_candidate` is unit-tested in test_grid.py.

Usage:
  python3 -I tools/map-mesh/nav2d/offmesh_candidates.py \
    --mesh datasets/spatial/ascent/mesh/derived/ascent_floor_all.bin \
    --navgraph <PV-4 ascent.navgraph.json> \
    --transform datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json \
    --out datasets/spatial/ascent/mesh/offmesh-candidates.json
"""
import sys, os, json, math, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_grid import (read_pvmesh, cluster_layers, build_adjacency,
                        connected_components, dijkstra, inv_affine)


def is_bridge_candidate(dxy, dz, radius, max_gap):
    """A node pair bridges components iff close horizontally and within a
    climbable/droppable vertical gap. Pure predicate for testing."""
    return dxy <= radius and dz <= max_gap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--navgraph", required=True)
    ap.add_argument("--transform", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--manual", default="datasets/spatial/ascent/mesh/offmesh-manual.json")
    ap.add_argument("--cs", type=float, default=1.2)
    ap.add_argument("--layer-merge", type=float, default=0.8)
    ap.add_argument("--step-tol", type=float, default=3.0)
    ap.add_argument("--radius", type=float, default=4.0, help="max horizontal gap for a bridge (m)")
    ap.add_argument("--max-gap", type=float, default=4.5, help="max vertical gap for a bridge (m)")
    ap.add_argument("--min-comp", type=int, default=4, help="ignore tiny components below this node count")
    args = ap.parse_args()
    UU_PER_M = 100.0

    nV, nT, pos, idx = read_pvmesh(args.mesh)
    minx = min(pos[i*3] for i in range(nV))
    miny = min(pos[i*3+1] for i in range(nV))
    cs = args.cs
    cell_z = {}

    def add(x, y, z):
        cell_z.setdefault((int((x-minx)//cs), int((y-miny)//cs)), []).append(z)
    for t in range(nT):
        i0, i1, i2 = idx[t*3], idx[t*3+1], idx[t*3+2]
        p0 = (pos[i0*3], pos[i0*3+1], pos[i0*3+2])
        p1 = (pos[i1*3], pos[i1*3+1], pos[i1*3+2])
        p2 = (pos[i2*3], pos[i2*3+1], pos[i2*3+2])
        add(*p0); add(*p1); add(*p2)
        add((p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3)

    nodes_by_cell = {}
    node_meta = {}
    nid = 0
    for (ix, iy), zs in cell_z.items():
        lst = []
        for h, _ in cluster_layers(zs, args.layer_merge):
            lst.append((h, nid)); node_meta[nid] = (ix, iy, h); nid += 1
        nodes_by_cell[(ix, iy)] = lst

    adj = build_adjacency(nodes_by_cell, cs, args.step_tol)
    comps = connected_components(adj, list(node_meta.keys()))
    comp_of = {}
    for ci, c in enumerate(comps):
        for n in c:
            comp_of[n] = ci
    main_ci = 0

    def nw(n):
        ix, iy, h = node_meta[n]
        return (minx+(ix+0.5)*cs, miny+(iy+0.5)*cs, h)

    # Zones -> nearest node (to report which zones each candidate rescues).
    nav = json.load(open(args.navgraph)); tf = json.load(open(args.transform))
    to_bl = inv_affine(tf["affine"]["A"], tf["affine"]["t"])
    zone_node, zone_comp = {}, {}
    for z in nav["zones"]:
        g = z["position"]; bx, by = to_bl(g["x"], g["y"]); bz = g["z"]/UU_PER_M
        best = None
        for n, (ix, iy, h) in node_meta.items():
            wx, wy = minx+(ix+0.5)*cs, miny+(iy+0.5)*cs
            d = math.hypot(wx-bx, wy-by) + 0.5*abs(h-bz)
            if best is None or d < best[0]:
                best = (d, n)
        zone_node[z["id"]] = best[1]; zone_comp[z["id"]] = comp_of[best[1]]

    off_components = sorted({zone_comp[z["id"]] for z in nav["zones"]
                             if zone_comp[z["id"]] != main_ci})

    # For each node on a non-main component of interest, find the nearest node on
    # a strictly larger component within radius/max-gap.
    main_nodes = [n for n in node_meta if comp_of[n] == main_ci]
    # bucket main nodes by cell for a quick spatial lookup
    from collections import defaultdict
    main_by_cell = defaultdict(list)
    for n in main_nodes:
        ix, iy, _ = node_meta[n]; main_by_cell[(ix, iy)].append(n)

    rc = int(math.ceil(args.radius / cs))
    candidates = []
    seen = set()
    for z in nav["zones"]:
        ci = zone_comp[z["id"]]
        if ci == main_ci or len(comps[ci]) < args.min_comp:
            continue
        for n in comps[ci]:
            ix, iy, h = node_meta[n]
            nx_, ny_, nz_ = nw(n)
            best = None
            for dx in range(-rc, rc+1):
                for dy in range(-rc, rc+1):
                    for m in main_by_cell.get((ix+dx, iy+dy), ()):
                        mx, my, mz = nw(m)
                        dxy = math.hypot(mx-nx_, my-ny_); dz = abs(mz-nz_)
                        if is_bridge_candidate(dxy, dz, args.radius, args.max_gap):
                            if best is None or dxy < best[0]:
                                best = (dxy, dz, m, (mx, my, mz))
            if best:
                key = (round(nx_, 1), round(ny_, 1), round(best[3][0], 1), round(best[3][1], 1))
                if key in seen:
                    continue
                seen.add(key)
                candidates.append({
                    "fromComponent": ci, "toComponent": main_ci,
                    "rescuesZoneNear": z["id"],
                    "endpointA_world": [round(nx_, 2), round(ny_, 2), round(nz_, 2)],
                    "endpointB_world": [round(best[3][0], 2), round(best[3][1], 2), round(best[3][2], 2)],
                    "horizontalGap_m": round(best[0], 2),
                    "verticalGap_m": round(best[1], 2),
                    "kind": "drop" if best[1] > args.step_tol else "step",
                    "bidirectional": best[1] <= args.step_tol,
                    "provenance": "auto-detected",
                })

    # keep the closest candidate per rescued zone
    by_zone = {}
    for c in candidates:
        z = c["rescuesZoneNear"]
        if z not in by_zone or c["horizontalGap_m"] < by_zone[z]["horizontalGap_m"]:
            by_zone[z] = c
    chosen = sorted(by_zone.values(), key=lambda c: c["horizontalGap_m"])

    # apply manual overrides if present
    manual = []
    if os.path.exists(args.manual):
        try:
            manual = json.load(open(args.manual)).get("connections", [])
        except Exception:
            manual = []

    report = {
        "note": "Auto-detected off-mesh connection candidates for Ascent: short "
                "bridges that would rejoin disconnected walkable components "
                "(stairs/ramps/drops). Endpoints are world metres (Blender Z-up). "
                "Use as Detour off-mesh connections or as grid bridge edges. "
                "Manual corrections live in offmesh-manual.json (provenance:manual) "
                "and override/extend this list. PV-4 files unchanged.",
        "params": {"cellSize_m": cs, "stepTol_m": args.step_tol,
                   "radius_m": args.radius, "maxGap_m": args.max_gap},
        "componentCount": len(comps),
        "zoneComponents": {z["id"]: zone_comp[z["id"]] for z in nav["zones"]},
        "offMainComponents": off_components,
        "autoCandidates": chosen,
        "manualConnections": manual,
    }
    json.dump(report, open(args.out, "w"), indent=2)
    print(f"[offmesh] components={len(comps)} off-main zone-components={off_components}")
    print(f"[offmesh] auto candidates (one per rescued zone): {len(chosen)}")
    for c in chosen:
        print(f"    rescue {c['rescuesZoneNear']}: hGap={c['horizontalGap_m']}m "
              f"vGap={c['verticalGap_m']}m kind={c['kind']}")
    print(f"[offmesh] report -> {args.out}")


if __name__ == "__main__":
    main()
