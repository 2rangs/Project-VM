#!/usr/bin/env python3
"""
PROJECT V — navigation roadmap for one map (the runtime data of the navigation engine).

The 2.5D walk grid measured on the map geometry is too close to the geometry to commit, so
the engine navigates on a sparse ROADMAP derived from it:

  nodes   walkable standing points, a few metres apart, placed where wall clearance is
          largest (corridor centres, open floor). Each carries its floor height, its wall
          clearance and the zone whose area it lies in. Every zone anchor is a node.
  edges   straight segments between nearby nodes that were walked cell by cell on the grid
          (every cell the segment touches is a standable, walk-linked cell) AND are clear of
          the solid triangles at body height. Each carries its half-width: how far a body
          may stray sideways and still be on walkable floor.
  drops   one-way edges across a ledge.
  links   authored special traversals (teleporter, zipline) with their own travel time.

Output (numeric only): datasets/spatial/<map>/<map>.nav.json

  $PYTHON_WITH_NUMPY -I tools/map-mesh/pipeline/nav_map.py --map ascent --derived /path/derived/ascent
"""
import argparse, json, math, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import measure_map as MM      # noqa: E402
import route_map as RM        # noqa: E402

G = MM.G
N = dict(
    spacing=2.5,          # minimum distance between roadmap nodes (m)
    link_radius=6.0,      # straight edges are tried between nodes closer than this (m)
    clearance_levels=6,   # wall clearance is tracked up to this many cells (3 m)
    drop_gain=1.3,        # a drop edge is kept when it beats the walkable way by this factor
    body=(0.7, 1.3),      # ray-check heights above the floor (m)
)


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
    grid, zid, rep = c.grid, c.zid, c.rep
    xyz = [tuple(map(float, r)) for r in c.xyz]
    cs = MM.P["cell"]
    clear = RM.clearance_levels(grid, N["clearance_levels"])
    walker = RM.Walker(grid, xyz, clear)
    tindex = G.TriangleIndex(c.p0[c.solid_k], c.p1[c.solid_k], c.p2[c.solid_k], cs=MM.P["los_cell"])

    def seg_ok(u, v):
        p, q = xyz[u], xyz[v]
        return not any(tindex.occluded((p[0], p[1], p[2] + h), (q[0], q[1], q[2] + h)) for h in N["body"])

    anchors = {zid[i]: int(rep[i]) for i in range(len(zid)) if rep[i] >= 0}
    zone_index = {z: i for i, z in enumerate(zid)}
    src = {n: zone_index[z] for z, n in anchors.items()}
    # where a player can get to at all: on foot or by a drop from some zone anchor
    d_all, own_all = G.dijkstra((grid.walk, grid.drop), src, grid.n)
    _, own_walk = G.dijkstra((grid.walk,), src, grid.n)
    reach = np.isfinite(d_all)
    zone_of = np.where(own_walk >= 0, own_walk, own_all)

    # ---------------- nodes: anchors first, then widest-clearance-first with a minimum spacing
    S = N["spacing"]
    hash_ = {}

    def near(u, radius):
        x, y, z = xyz[u]
        kx, ky = int(x // S), int(y // S)
        r = int(math.ceil(radius / S))
        out = []
        for ix in range(kx - r, kx + r + 1):
            for iy in range(ky - r, ky + r + 1):
                for v in hash_.get((ix, iy), ()):
                    q = xyz[v]
                    if (q[0] - x) ** 2 + (q[1] - y) ** 2 <= radius * radius:
                        out.append(v)
        return out

    rm, rm_set = [], set()

    def add_node(u):
        if u in rm_set:
            return
        rm.append(u)
        rm_set.add(u)
        x, y, _ = xyz[u]
        hash_.setdefault((int(x // S), int(y // S)), []).append(u)

    for n in sorted(anchors.values()):
        add_node(n)
    cand = np.nonzero(reach)[0]
    order = cand[np.lexsort((cand, -clear[cand].astype(np.int64)))]
    for u in order.tolist():
        if u in rm_set:
            continue
        z = xyz[u][2]
        if any(abs(xyz[v][2] - z) < 1.5 for v in near(u, S)):
            continue
        add_node(u)
    n_sampled = len(rm)

    # ---------------- edges: straight, grid-walked, ray-clear
    edges = {}          # (a, b) with a < b for walk -> half-width in cells

    def try_edge(u, v):
        key = (u, v) if u < v else (v, u)
        if key in edges:
            return True
        seen = walker.traverse(u, v, 0)
        if seen is None or not seg_ok(u, v):
            return False
        edges[key] = int(min(clear[s] for s in seen))
        return True

    for u in list(rm):
        for v in near(u, N["link_radius"]):
            if v > u:
                try_edge(u, v)
    n_direct = len(edges)

    # ---------------- connectivity repair: wherever two nodes' walk cells touch but no straight
    # edge joins them, add the grid path between them as a chain of bend nodes
    def repair():
        added = 0
        d, own = G.dijkstra((grid.walk,), {u: i for i, u in enumerate(rm)}, grid.n)
        own_l, d_l = own.tolist(), d.tolist()
        best = {}
        for u in range(grid.n):
            ou = own_l[u]
            if ou < 0:
                continue
            for v, w in grid.walk[u]:
                ov = own_l[v]
                if ov > ou:
                    L = d_l[u] + w + d_l[v]
                    if L < best.get((ou, ov), math.inf):
                        best[(ou, ov)] = L
        snapshot = list(rm)
        ones = [1.0] * grid.n
        for (i, j), _ in sorted(best.items(), key=lambda kv: kv[1]):
            u, v = snapshot[i], snapshot[j]
            if ((u, v) if u < v else (v, u)) in edges or try_edge(u, v):
                continue
            path = RM.find_path(grid, (grid.walk,), ones, u, v, xyz)
            if path is None:
                continue
            kept = RM.pull(walker, path, clear, {"lookahead": 40, "sample": 0.2}, seg_ok)
            for p, q in zip(kept[:-1], kept[1:]):
                add_node(p)
                add_node(q)
                key = (p, q) if p < q else (q, p)
                if key not in edges:
                    seen = walker.traverse(p, q, 0) or [p, q]
                    edges[key] = int(min(clear[s] for s in seen))
                    added += 1
        return added

    n_repair = repair()
    n_repair += repair()          # the bend nodes just added may themselves need joining

    # ---------------- roadmap adjacency (metres) for the drop test
    def roadmap_adj(extra=()):
        adj = {u: [] for u in rm}
        for (p, q) in edges:
            L = math.dist(xyz[p], xyz[q])
            adj[p].append((q, L))
            adj[q].append((p, L))
        for p, q, L in extra:
            adj[p].append((q, L))
        return adj

    def rm_dist(adj, s, t, cap):
        import heapq
        best = {s: 0.0}
        pq = [(0.0, s)]
        while pq:
            dd, u = heapq.heappop(pq)
            if u == t:
                return dd
            if dd > best.get(u, math.inf) or dd > cap:
                continue
            for v, w in adj[u]:
                nd = dd + w
                if nd < best.get(v, math.inf):
                    best[v] = nd
                    heapq.heappush(pq, (nd, v))
        return math.inf

    # ---------------- drops: the best ledge between each pair of node cells, kept when it is a real short cut
    d, own = G.dijkstra((grid.walk,), {u: i for i, u in enumerate(rm)}, grid.n)
    own_l, d_l = own.tolist(), d.tolist()
    cand_drops = {}
    for u in range(grid.n):
        ou = own_l[u]
        if ou < 0:
            continue
        for v, w in grid.drop[u]:
            ov = own_l[v]
            if ov >= 0 and ov != ou:
                L = d_l[u] + w + d_l[v]
                if L < cand_drops.get((ou, ov), (math.inf,))[0]:
                    cand_drops[(ou, ov)] = (L, u, v)
    snapshot = list(rm)
    drops = []           # (from grid node, to grid node)
    extra = []
    adj = roadmap_adj()
    ones = [1.0] * grid.n
    for (i, j), (L, lip, land) in sorted(cand_drops.items(), key=lambda kv: kv[1][0]):
        U, V = snapshot[i], snapshot[j]
        if rm_dist(adj, U, V, N["drop_gain"] * L) <= N["drop_gain"] * L:
            continue
        ok = True
        chains = []
        for s_, t_ in ((U, lip), (land, V)):
            if s_ == t_:
                chains.append([s_])
                continue
            path = RM.find_path(grid, (grid.walk,), ones, s_, t_, xyz)
            if path is None:
                ok = False
                break
            chains.append(RM.pull(walker, path, clear, {"lookahead": 40, "sample": 0.2}, seg_ok))
        if not ok:
            continue
        for kept in chains:
            for p in kept:
                add_node(p)
            for p, q in zip(kept[:-1], kept[1:]):
                key = (p, q) if p < q else (q, p)
                if key not in edges:
                    seen = walker.traverse(p, q, 0) or [p, q]
                    edges[key] = int(min(clear[s] for s in seen))
        drops.append((lip, land))
        extra.append((lip, land, math.dist(xyz[lip], xyz[land])))
        adj = roadmap_adj(extra)

    # ---------------- authored special links between zone anchors
    links = []
    for e in nav["edges"]:
        if e.get("kind") in ("teleporter", "zipline", "rope") and e["from"] in anchors and e["to"] in anchors:
            links.append((anchors[e["from"]], anchors[e["to"]], e["kind"], e["runTimeMs"], e["bidirectional"]))

    # ---------------- checks: the roadmap reaches exactly what the grid reaches between zones
    adj = roadmap_adj(extra)
    unreachable = []
    grid_reach = {}
    for za, na in anchors.items():
        dd, _ = G.dijkstra((grid.walk, grid.drop), {na: 0}, grid.n)
        for zb, nb in anchors.items():
            if za == zb:
                continue
            g_ok = bool(np.isfinite(dd[nb]))
            r_ok = rm_dist(adj, na, nb, 1e9) < math.inf
            grid_reach[(za, zb)] = g_ok
            if g_ok != r_ok:
                unreachable.append(f"{za}->{zb} grid={g_ok} roadmap={r_ok}")
    ray_bad = sum(1 for (p, q) in edges if not seg_ok(p, q))

    # ---------------- write
    index = {u: i for i, u in enumerate(rm)}
    uu = lambda v: int(round(v * 100))
    out = {
        "mapId": mp, "schemaVersion": "1.0.0",
        "note": "Navigation roadmap measured on the map geometry (game uu). nodes: [x, y, z(floor), clearance, zoneIndex]. "
                "edges: [a, b, halfWidth] walkable both ways along the straight segment; a body may stray halfWidth "
                "sideways and stay on walkable floor. drops: [from, to] one-way. links: authored special traversals. "
                "Every edge was walked cell by cell on the walk grid and ray-checked against the solid geometry.",
        "provenance": "measured-on-mesh (roadmap); manual-approx (links)",
        "params": {**{k: (list(v) if isinstance(v, tuple) else v) for k, v in N.items()}, "cell": cs},
        "zones": zid,
        "anchors": {z: index[n] for z, n in anchors.items()},
        "zonesWithoutAnchor": [z for z in zid if z not in anchors],
        "nodes": [[uu(xyz[u][0]), uu(xyz[u][1]), uu(xyz[u][2]), uu(float(clear[u]) * cs), int(zone_of[u])] for u in rm],
        "edges": [[index[p], index[q], uu(w * cs)] for (p, q), w in sorted(edges.items(), key=lambda kv: (index[kv[0][0]], index[kv[0][1]]))],
        "drops": [[index[p], index[q]] for p, q in drops],
        "links": [{"from": index[p], "to": index[q], "kind": k, "travelTimeMs": t, "bidirectional": b} for p, q, k, t, b in links],
        "stats": {
            "sampledNodes": n_sampled, "nodes": len(rm), "straightEdges": n_direct, "repairEdges": n_repair,
            "edges": len(edges), "drops": len(drops), "links": len(links),
            "edgesHittingGeometry": ray_bad,
            "zonePairsReachableOnGrid": sum(1 for v in grid_reach.values() if v),
            "zonePairsTotal": len(grid_reach),
            "roadmapDisagreesWithGrid": unreachable,
        },
    }
    path = os.path.join(ddir, f"{mp}.nav.json")
    with open(path, "w") as f:
        f.write(json.dumps(out, separators=(",", ":")).replace('],[', '],\n[').replace('"nodes":', '\n"nodes":')
                .replace('"edges":', '\n"edges":').replace('"drops":', '\n"drops":').replace('"links":', '\n"links":')
                .replace('"stats":', '\n"stats":') + "\n")
    s = out["stats"]
    print(f"[nav] {mp}: nodes={s['nodes']} edges={s['edges']} drops={s['drops']} links={s['links']} "
          f"ray-bad={ray_bad} zone pairs reachable {s['zonePairsReachableOnGrid']}/{s['zonePairsTotal']} "
          f"disagree={len(unreachable)} size={os.path.getsize(path) // 1024} KB ({time.time() - t0:.0f} s)", flush=True)
    for u_ in unreachable[:8]:
        print("[nav]   disagree:", u_)


if __name__ == "__main__":
    main()
