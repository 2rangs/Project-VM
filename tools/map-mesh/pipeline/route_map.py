#!/usr/bin/env python3
"""
PROJECT V — walkable route (polyline) for every navgraph edge of a map.

For each edge of datasets/spatial/<map>/<map>.navgraph.json this finds a path over the
2.5D walk grid from one zone's anchor to the other's, pulls it tight into a short polyline
and re-validates every segment against the grid (each step moves between walk-linked,
standable cells — so no wall, prop or gap is crossed). Output, numeric only:

  datasets/spatial/<map>/mesh/<map>-routes.json   zone anchors + per-edge polylines (game uu)
  <derived>/walkable.json                         (outside the repo) the walkable-cell mask,
                                                  used by the optional track-position test

Edges with no walkable route keep the straight segment and are listed as such. The grid
itself is never committed — only the polylines.

  $PYTHON_WITH_NUMPY -I tools/map-mesh/pipeline/route_map.py --map ascent --derived /path/derived/ascent
"""
import argparse, base64, heapq, json, math, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import measure_map as MM      # noqa: E402

R = dict(
    clearance_levels=3,                  # cells of wall distance that are tracked
    clearance_cost=[2.6, 1.7, 1.25, 1.0],  # step-cost multiplier at clearance 0,1,2,>=3 cells
    lookahead=120,                       # string-pull window (path cells)
    sample=0.2,                          # segment validation step (m)
    height_tol=0.3,                      # keep a waypoint where the floor leaves the chord by this (m)
    symmetric_within=1.10,               # one polyline for both directions if the walk-only path is within 10 %
    no_special_route={"teleporter", "zipline", "rope"},
)


def clearance_levels(grid, levels):
    """0 for cells on the edge of the walkable area (fewer than 8 walk links), then +1 per cell inward."""
    n = grid.n
    clear = np.full(n, levels, dtype=np.int8)
    frontier = [u for u in range(n) if len(grid.walk[u]) < 8]
    for u in frontier:
        clear[u] = 0
    for lvl in range(1, levels):
        nxt = []
        for u in frontier:
            for v, _ in grid.walk[u]:
                if clear[v] > lvl:
                    clear[v] = lvl
                    nxt.append(v)
        frontier = nxt
    return clear


def find_path(grid, adj_lists, cost_mult, src, dst, xyz):
    """A* over the grid; step cost = length x clearance multiplier of the cell entered."""
    if src == dst:
        return [src]
    tx, ty, _ = xyz[dst]
    g = {src: 0.0}
    came = {}
    pq = [(0.0, src)]
    done = set()
    while pq:
        _, u = heapq.heappop(pq)
        if u in done:
            continue
        if u == dst:
            path = [u]
            while u in came:
                u = came[u]
                path.append(u)
            return path[::-1]
        done.add(u)
        gu = g[u]
        for adj in adj_lists:
            for v, w in adj[u]:
                nd = gu + w * cost_mult[v]
                if nd < g.get(v, math.inf):
                    g[v] = nd
                    came[v] = u
                    x, y, _ = xyz[v]
                    # horizontal distance only: admissible even across a drop (costed below its height)
                    heapq.heappush(pq, (nd + math.hypot(x - tx, y - ty), v))
    return None


def cells_on_segment(ax, ay, bx, by, ox, oy, cs):
    """Every grid cell the 2D segment passes through, in order (exact DDA). A segment through a
    cell corner steps diagonally (the walk grid only links diagonals whose two orthogonal
    neighbours are walkable too)."""
    x0, y0, x1, y1 = (ax - ox) / cs, (ay - oy) / cs, (bx - ox) / cs, (by - oy) / cs
    ix, iy, ex, ey = int(math.floor(x0)), int(math.floor(y0)), int(math.floor(x1)), int(math.floor(y1))
    dx, dy = x1 - x0, y1 - y0
    sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    tx = ((ix + (1 if dx > 0 else 0)) - x0) / dx if dx != 0 else math.inf
    ty = ((iy + (1 if dy > 0 else 0)) - y0) / dy if dy != 0 else math.inf
    ddx = abs(1.0 / dx) if dx != 0 else math.inf
    ddy = abs(1.0 / dy) if dy != 0 else math.inf
    cells = [(ix, iy)]
    limit = abs(ex - ix) + abs(ey - iy) + 2
    while (ix, iy) != (ex, ey) and len(cells) <= limit:
        if abs(tx - ty) < 1e-9:
            ix += sx; iy += sy; tx += ddx; ty += ddy
        elif tx < ty:
            ix += sx; tx += ddx
        else:
            iy += sy; ty += ddy
        cells.append((ix, iy))
    return cells


class Walker:
    """Walks a straight segment cell by cell, only ever stepping between walk-linked cells."""

    def __init__(self, grid, xyz, clear):
        self.grid, self.xyz, self.clear = grid, xyz, clear
        self.cell = {}
        for i in range(grid.n):
            self.cell.setdefault((int(grid.ix[i]), int(grid.iy[i])), []).append(i)
        self._nbr = {}

    def nbr(self, u):
        s = self._nbr.get(u)
        if s is None:
            s = self._nbr[u] = {v for v, _ in self.grid.walk[u]}
        return s

    def traverse(self, a, b, min_clear, step=None):
        """Cells crossed going straight from node a to node b — EVERY cell the segment touches
        (exact grid traversal, not sampling) — or None if any of them is not a walk-linked,
        standable cell with the required wall clearance."""
        if b in self.nbr(a):                   # one walk link: valid by definition
            return [a, b] if self.clear[b] >= min_clear else None
        o, cs = self.grid.origin, self.grid.cs
        cur = a
        seen = [a]
        for key in cells_on_segment(self.xyz[a][0], self.xyz[a][1], self.xyz[b][0], self.xyz[b][1], o[0], o[1], cs)[1:]:
            nb = self.nbr(cur)
            cand = [v for v in self.cell.get(key, ()) if v in nb]
            if not cand:
                return None
            if b in cand:                      # stacked floors in the goal's cell: take the goal
                cur = b
            else:
                cur = cand[0] if len(cand) == 1 else min(cand, key=lambda v: abs(self.xyz[v][2] - self.xyz[cur][2]))
            if self.clear[cur] < min_clear:
                return None
            seen.append(cur)
        return seen if cur == b else None


def pull(walker, path, clear, cfg):
    """Greedy string-pull of one walk-only run of grid nodes. Returns the kept nodes."""
    path = [int(u) for u in path]
    out = [path[0]]
    i = 0
    n = len(path)
    while i < n - 1:
        best = i + 1
        hi = min(n - 1, i + cfg["lookahead"])
        for j in range(hi, i + 1, -1):
            need = min(1, int(min(clear[path[i:j + 1]])))
            if walker.traverse(path[i], path[j], need, cfg["sample"]) is not None:
                best = j
                break
        out.append(path[best])
        i = best
    return out


def add_height_points(walker, nodes, xyz, tol, step):
    """Between two kept nodes the route is a straight 3D segment; where the floor it crosses
    leaves that chord by more than `tol` (stairs, ramps, kerbs) keep the worst cell too."""
    out = [nodes[0]]

    def split(a, b, depth):
        seen = walker.traverse(a, b, 0, step) if depth < 6 else None
        if seen and len(seen) > 2:
            ax, ay, az = xyz[a]
            bx, by, bz = xyz[b]
            d = math.hypot(bx - ax, by - ay) or 1.0
            worst, wdev = None, tol
            for u in seen[1:-1]:
                x, y, z = xyz[u]
                t = math.hypot(x - ax, y - ay) / d
                dev = abs(z - (az + (bz - az) * t))
                if dev > wdev:
                    worst, wdev = u, dev
            if worst is not None:
                split(a, worst, depth + 1)
                split(worst, b, depth + 1)
                return
        out.append(b)

    for a, b in zip(nodes[:-1], nodes[1:]):
        split(a, b, 0)
    return out


def polyline(grid, walker, path, clear, xyz, cfg):
    """Grid path -> short validated polyline. Drop links are never pulled across: both ends
    of a drop stay as waypoints. Returns (nodes, drops, all_segments_validated)."""
    runs, cur, drops = [], [path[0]], 0
    for u, v in zip(path[:-1], path[1:]):
        if v in walker.nbr(u):
            cur.append(v)
        else:
            runs.append(cur)
            cur = [v]
            drops += 1
    runs.append(cur)
    nodes = []
    ok = True
    def valid(ns):
        return all(walker.traverse(a, b, 0, cfg["sample"]) is not None for a, b in zip(ns[:-1], ns[1:]))

    for run in runs:
        if len(run) > 1:
            pulled = pull(walker, run, clear, cfg)
            kept = add_height_points(walker, pulled, xyz, cfg["height_tol"], cfg["sample"])
            if not valid(kept):
                kept = pulled            # the height refinement is optional; the pulled line is not
            if not valid(kept):
                kept = [int(u) for u in run]   # last resort: the raw grid path (always valid)
            ok = ok and valid(kept)
        else:
            kept = [int(u) for u in run]
        nodes.extend(kept)
    return nodes, drops, ok


def length_m(points):
    return sum(math.dist(a, b) for a, b in zip(points[:-1], points[1:]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--derived", required=True)
    a = ap.parse_args()
    t0 = time.time()
    mp = a.map
    ddir = os.path.join(ROOT, "datasets", "spatial", mp)
    raw = json.load(open(os.path.join(ddir, f"valorant-api-{mp}.raw.json")))
    nav = json.load(open(os.path.join(ddir, f"{mp}.navgraph.json")))
    apath = os.path.join(ddir, f"{mp}.authoring.json")
    authoring = json.load(open(apath)) if os.path.exists(apath) else {}
    c = MM.prepare(mp, a.derived, raw, authoring, MM.zone_list_from_navgraph(nav, raw))
    grid, xyz_np, rep, zid = c.grid, c.xyz, c.rep, c.zid
    xyz = [tuple(map(float, r)) for r in xyz_np]
    clear = clearance_levels(grid, R["clearance_levels"])
    mult = [R["clearance_cost"][int(k)] for k in clear]
    walker = Walker(grid, xyz, clear)
    node_of = {zid[i]: int(rep[i]) for i in range(len(zid)) if rep[i] >= 0}

    def uu(u):
        x, y, z = xyz[u]
        return [round(x * 100), round(y * 100), round(z * 100)]

    def route(src, dst, adj_lists):
        path = find_path(grid, adj_lists, mult, src, dst, xyz)
        if path is None:
            return None
        nodes, drops, ok = polyline(grid, walker, path, clear, xyz, R)
        pts = [xyz[u] for u in nodes]
        return {"waypoints": [uu(u) for u in nodes], "lengthMeters": round(length_m(pts), 2),
                "drops": drops, "validated": bool(ok),
                "minClearanceCells": int(min(clear[u] for u in path)),
                "gridPathMeters": round(length_m([xyz[u] for u in path]), 2)}

    anchors = {z: {"x": uu(n)[0], "y": uu(n)[1], "z": uu(n)[2]} for z, n in node_of.items()}
    out_edges, n_route, n_flag = [], 0, 0
    WALK, BOTH = (grid.walk,), (grid.walk, grid.drop)
    for e in nav["edges"]:
        f, t, kind = e["from"], e["to"], e.get("kind", "walk")
        row = {"from": f, "to": t, "bidirectional": e["bidirectional"], "kind": kind}
        straight = None
        if f in node_of and t in node_of:
            straight = round(math.dist(xyz[node_of[f]], xyz[node_of[t]]), 2)
            row["straightMeters"] = straight
        same_cell = f in node_of and t in node_of and node_of[f] == node_of[t]
        if kind in R["no_special_route"] or f not in node_of or t not in node_of or same_cell:
            row["status"] = "straight"
            row["reason"] = ("special traversal (no walking route applies)" if kind in R["no_special_route"]
                             else "both zones snap to the same walkable cell (callouts stacked on different floors)" if same_cell
                             else "a zone has no walkable anchor")
            n_flag += 1
            out_edges.append(row)
            continue
        fwd = route(node_of[f], node_of[t], BOTH)
        rev = route(node_of[t], node_of[f], BOTH) if e["bidirectional"] else None
        sym = route(node_of[f], node_of[t], WALK) if e["bidirectional"] else None
        if fwd is None or (e["bidirectional"] and rev is None):
            row["status"] = "straight"
            row["reason"] = "no walkable route on the grid" + ("" if fwd is None else " in the reverse direction")
            n_flag += 1
            out_edges.append(row)
            continue
        if e["bidirectional"] and sym is not None and \
                sym["lengthMeters"] <= R["symmetric_within"] * min(fwd["lengthMeters"], rev["lengthMeters"]):
            row["route"] = sym                       # walked both ways (reverse the waypoints)
        else:
            row["route"] = fwd
            if e["bidirectional"]:
                row["routeReverse"] = rev            # the way back differs (a drop is one-way)
        row["status"] = "route"
        if not all(r["validated"] for r in (row["route"], row.get("routeReverse")) if r):
            row["status"] = "straight"
            row["reason"] = "polyline failed re-validation against the grid"
            row.pop("route", None)
            row.pop("routeReverse", None)
            n_flag += 1
        else:
            n_route += 1
        out_edges.append(row)

    report = {
        "note": "Walkable polylines for the navgraph edges, measured on the 2.5D walk grid of the map "
                "geometry (game uu, z = floor height). Every segment was re-walked cell by cell: each "
                "step moves between walk-linked, standable cells. 'route' is used in both directions "
                "(reversed) unless 'routeReverse' is present. status 'straight' = no walkable route; the "
                "edge keeps its straight segment and is flagged in the navgraph.",
        "params": {**MM.P, **{k: (sorted(v) if isinstance(v, set) else v) for k, v in R.items()}},
        "provenance": "measured-on-mesh",
        "summary": {"edges": len(out_edges), "withWalkableRoute": n_route, "flaggedStraight": n_flag},
        "zoneAnchors": anchors,
        "zonesWithoutAnchor": [z for z in zid if z not in node_of],
        "edges": out_edges,
    }
    json.dump(report, open(os.path.join(ddir, "mesh", f"{mp}-routes.json"), "w"), indent=1)

    # walkable-cell mask for the optional track test (outside the repo)
    # every standable cell (any floor level, any component: a route may cross a small ledge on a drop)
    mask = np.zeros((c.vox.nx, c.vox.ny), dtype=np.uint8)
    mask[grid.ix, grid.iy] = 1
    json.dump({"map": mp, "originGameMeters": [float(c.lo[0]), float(c.lo[1])], "cellMeters": MM.P["cell"],
               "nx": int(c.vox.nx), "ny": int(c.vox.ny),
               "bitsBase64": base64.b64encode(np.packbits(mask.ravel()).tobytes()).decode()},
              open(os.path.join(a.derived, "walkable.json"), "w"))
    print(f"[routes] {mp}: {n_route}/{len(out_edges)} edges with a walkable route, {n_flag} flagged straight "
          f"({time.time() - t0:.0f} s)", flush=True)
    for r in out_edges:
        if r["status"] != "route":
            print(f"[routes]   straight: {r['from']} -> {r['to']} ({r['kind']}): {r['reason']}")


if __name__ == "__main__":
    main()
