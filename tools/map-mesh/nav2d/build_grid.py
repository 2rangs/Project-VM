#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh (round 2)
2.5D walkable grid for Ascent: a height-layered occupancy grid built from the
floor triangles, connected across cells within a stair-height tolerance. This is
the robust alternative to Recast for this art mesh (Recast fragmented into a
~27%-connected navmesh); the grid bridges stairs/ramps naturally because
adjacent cells whose floor height differs by <= stepTol are linked.

Pure Python + stdlib (no numpy dependency for portability of the core; math only).
Core functions (cluster_layers, build_adjacency, dijkstra) are importable and
unit-tested in tools/map-mesh/nav2d/test_grid.py.

Input:  a PVMESH01 binary of FLOOR triangles (world metres, Blender Z-up).
Output (committable aggregate JSON; no geometry):
  - grid stats (cells, layers, components, largest-component fraction)
  - zone snaps (each PV-4 zone -> nearest grid node, snap distance)
  - per-edge path lengths vs PV-4 straight-line
  - optional full pairwise zone distance matrix

Usage:
  python3 -I tools/map-mesh/nav2d/build_grid.py \
    --mesh datasets/spatial/ascent/mesh/derived/ascent_floor_all.bin \
    --navgraph <PV-4 ascent.navgraph.json> \
    --transform datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json \
    --out datasets/spatial/ascent/mesh/ascent-grid-calibration.json \
    [--cs 1.0 --layer-merge 0.6 --step-tol 1.4]
"""
import sys, os, json, math, struct, argparse, heapq


# ----------------------------- core (tested) -----------------------------

def cluster_layers(zs, merge):
    """Cluster a sorted-or-unsorted list of heights into layers.
    Two heights in the same layer if within `merge` of the running layer mean.
    Returns list of (meanHeight, count), ascending."""
    if not zs:
        return []
    zs = sorted(zs)
    layers = []
    cur = [zs[0]]
    for z in zs[1:]:
        if z - cur[-1] <= merge:
            cur.append(z)
        else:
            layers.append((sum(cur) / len(cur), len(cur)))
            cur = [z]
    layers.append((sum(cur) / len(cur), len(cur)))
    return layers


# 8-neighbour offsets with horizontal step cost (in cells)
_NEIGHBORS = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
              (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)),
              (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2))]


def build_adjacency(nodes_by_cell, cs, step_tol, vert_penalty=0.5):
    """nodes_by_cell: {(ix,iy): [(height, nodeId), ...]}.
    Returns adjacency {nodeId: [(nbrId, cost_m), ...]}.
    Link two nodes in neighbouring cells iff |dh| <= step_tol."""
    adj = {}
    for (ix, iy), layers in nodes_by_cell.items():
        for h, nid in layers:
            adj.setdefault(nid, [])
            for dx, dy, hc in _NEIGHBORS:
                nb = nodes_by_cell.get((ix + dx, iy + dy))
                if not nb:
                    continue
                for h2, nid2 in nb:
                    dh = abs(h - h2)
                    if dh <= step_tol:
                        cost = hc * cs + dh * vert_penalty
                        adj[nid].append((nid2, cost))
    return adj


def dijkstra(adj, src, dst):
    """Shortest path cost from src to dst over adjacency; None if unreachable."""
    if src == dst:
        return 0.0
    dist = {src: 0.0}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            return d
        if d > dist.get(u, math.inf):
            continue
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return None


def connected_components(adj, node_ids):
    """Union-find components over an (assumed symmetric-enough) adjacency."""
    parent = {n: n for n in node_ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, nbrs in adj.items():
        for v, _ in nbrs:
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
    comp = {}
    for n in node_ids:
        comp.setdefault(find(n), []).append(n)
    return sorted(comp.values(), key=len, reverse=True)


# ----------------------------- io / transform -----------------------------

def read_pvmesh(path):
    with open(path, "rb") as f:
        buf = f.read()
    assert buf[:8] == b"PVMESH01", "bad magic"
    nV, nT = struct.unpack_from("<II", buf, 8)
    off = 16
    pos = struct.unpack_from(f"<{nV*3}f", buf, off); off += nV * 3 * 4
    idx = struct.unpack_from(f"<{nT*3}I", buf, off)
    return nV, nT, pos, idx


def inv_affine(A, t):
    (a, b), (c, d) = A
    det = a * d - b * c
    ai = ((d / det, -b / det), (-c / det, a / det))
    return lambda gx, gy: (ai[0][0] * (gx - t[0]) + ai[0][1] * (gy - t[1]),
                           ai[1][0] * (gx - t[0]) + ai[1][1] * (gy - t[1]))


# ----------------------------- main -----------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mesh", required=True)
    ap.add_argument("--navgraph", required=True)
    ap.add_argument("--transform", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--grid-out", default="", help="optional derived grid dump (gitignored)")
    ap.add_argument("--cs", type=float, default=1.0, help="cell size (m)")
    ap.add_argument("--layer-merge", type=float, default=0.6, help="height merge within a cell (m)")
    ap.add_argument("--step-tol", type=float, default=1.4, help="max walkable height step between cells (m)")
    ap.add_argument("--full-matrix", action="store_true", help="also emit all-pairs zone distances")
    a = ap.parse_args()
    UU_PER_M = 100.0

    nV, nT, pos, idx = read_pvmesh(a.mesh)
    # Accumulate height samples per cell from triangle vertices + centroid.
    minx = min(pos[i*3] for i in range(nV))
    miny = min(pos[i*3+1] for i in range(nV))
    cs = a.cs
    cell_z = {}  # (ix,iy) -> list[z]

    def add(x, y, z):
        key = (int((x - minx) // cs), int((y - miny) // cs))
        cell_z.setdefault(key, []).append(z)

    for t in range(nT):
        i0, i1, i2 = idx[t*3], idx[t*3+1], idx[t*3+2]
        p0 = (pos[i0*3], pos[i0*3+1], pos[i0*3+2])
        p1 = (pos[i1*3], pos[i1*3+1], pos[i1*3+2])
        p2 = (pos[i2*3], pos[i2*3+1], pos[i2*3+2])
        add(p0[0], p0[1], p0[2]); add(p1[0], p1[1], p1[2]); add(p2[0], p2[1], p2[2])
        add((p0[0]+p1[0]+p2[0])/3, (p0[1]+p1[1]+p2[1])/3, (p0[2]+p1[2]+p2[2])/3)

    # Build nodes: per cell, cluster heights into layers.
    nodes_by_cell = {}
    node_meta = {}  # nodeId -> (ix,iy,height)
    nid = 0
    for (ix, iy), zs in cell_z.items():
        layers = cluster_layers(zs, a.layer_merge)
        lst = []
        for h, cnt in layers:
            lst.append((h, nid))
            node_meta[nid] = (ix, iy, h)
            nid += 1
        nodes_by_cell[(ix, iy)] = lst

    adj = build_adjacency(nodes_by_cell, cs, a.step_tol)
    comps = connected_components(adj, list(node_meta.keys()))
    big = set(comps[0]) if comps else set()
    total_nodes = len(node_meta)

    # Zones -> nearest node (prefer same height band), snap distance.
    nav = json.load(open(a.navgraph))
    tf = json.load(open(a.transform))
    to_bl = inv_affine(tf["affine"]["A"], tf["affine"]["t"])

    def node_world(n):
        ix, iy, h = node_meta[n]
        return (minx + (ix + 0.5) * cs, miny + (iy + 0.5) * cs, h)

    zone_node = {}
    snaps = {}
    for z in nav["zones"]:
        g = z["position"]
        bx, by = to_bl(g["x"], g["y"])
        bz = g["z"] / UU_PER_M
        best = None
        for n, (ix, iy, h) in node_meta.items():
            wx, wy, wh = minx + (ix+0.5)*cs, miny + (iy+0.5)*cs, h
            dh = abs(wh - bz)
            d = math.hypot(wx - bx, wy - by) + 0.5 * dh   # bias toward right height
            if best is None or d < best[0]:
                best = (d, n, math.hypot(wx - bx, wy - by))
        zone_node[z["id"]] = best[1]
        snaps[z["id"]] = {
            "name": z["name"],
            "game": [g["x"], g["y"], g["z"]],
            "blenderXY": [round(bx, 2), round(by, 2)],
            "node": best[1],
            "snapDist_m": round(best[2], 2),
            "onMainComponent": best[1] in big,
        }

    zones_on_big = sum(1 for s in snaps.values() if s["onMainComponent"])

    # Per-edge path length.
    edges = []
    measurable = 0
    ratios = []
    for e in nav["edges"]:
        a_id, b_id = e["from"], e["to"]
        na, nb = zone_node.get(a_id), zone_node.get(b_id)
        row = {"from": a_id, "to": b_id,
               "pv4StraightLine_m": e.get("distanceMeters"),
               "pv4RunTimeMs": e.get("runTimeMs"),
               "snapDist_from_m": snaps[a_id]["snapDist_m"],
               "snapDist_to_m": snaps[b_id]["snapDist_m"]}
        cost = dijkstra(adj, na, nb) if (na is not None and nb is not None) else None
        if cost is None:
            row["reachable"] = False
        else:
            wa, wb = node_world(na), node_world(nb)
            straight = math.hypot(wa[0]-wb[0], wa[1]-wb[1], wa[2]-wb[2])
            row["reachable"] = True
            row["gridPath_m"] = round(cost, 2)
            row["gridStraightLine_m"] = round(straight, 2)
            if straight > 0.5:
                row["detourRatio"] = round(cost / straight, 2)
                ratios.append(cost / straight)
            # run time at 6.75 m/s (PV-4 movement model)
            row["gridRunTimeMs"] = round(cost / 6.75 * 1000)
            measurable += 1
        edges.append(row)

    ratios.sort()
    report = {
        "note": "2.5D walkable-grid calibration for Ascent. Floor triangles are "
                "rasterised into a height-layered occupancy grid; neighbouring "
                "cells link when their floor height differs by <= step-tol, which "
                "bridges stairs/ramps. Zones placed via the region-level affine "
                "(~6-9 m RMS) then snapped to the nearest grid node. Path lengths "
                "are grid-geodesic (8-neighbour). PV-4 files unchanged.",
        "unitsConvention": f"{UU_PER_M} uu per metre",
        "params": {"cellSize_m": cs, "layerMerge_m": a.layer_merge, "stepTol_m": a.step_tol},
        "grid": {
            "cells": len(nodes_by_cell),
            "nodes": total_nodes,
            "components": len(comps),
            "largestComponentNodes": len(big),
            "largestComponentFraction": round(len(big)/total_nodes, 3) if total_nodes else 0,
        },
        "zonesOnMainComponent": f"{zones_on_big}/{len(nav['zones'])}",
        "edgeSummary": {
            "total": len(edges),
            "measurable": measurable,
            "detourRatio": {
                "count": len(ratios),
                "min": round(ratios[0], 2) if ratios else None,
                "median": round(ratios[len(ratios)//2], 2) if ratios else None,
                "mean": round(sum(ratios)/len(ratios), 2) if ratios else None,
                "max": round(ratios[-1], 2) if ratios else None,
            },
        },
        "zonesSnap": snaps,
        "edges": edges,
    }

    if a.full_matrix:
        ids = [z["id"] for z in nav["zones"]]
        matrix = {}
        for i in ids:
            matrix[i] = {}
            for j in ids:
                if i == j:
                    matrix[i][j] = 0.0
                    continue
                c = dijkstra(adj, zone_node[i], zone_node[j])
                matrix[i][j] = round(c, 1) if c is not None else None
        report["pairwiseGridDistance_m"] = matrix

    json.dump(report, open(a.out, "w"), indent=2)
    print(f"[grid] cells={len(nodes_by_cell)} nodes={total_nodes} "
          f"components={len(comps)} largest={len(big)} ({report['grid']['largestComponentFraction']*100:.0f}%)")
    print(f"[grid] zones on main component: {zones_on_big}/{len(nav['zones'])}; "
          f"edges measurable {measurable}/{len(edges)}")
    print(f"[grid] report -> {a.out}")


if __name__ == "__main__":
    main()
