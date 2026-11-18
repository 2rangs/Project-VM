#!/usr/bin/env python3
"""PV-5 unit tests for the 2.5D walkable-grid core. Pure stdlib; run:
    python3 -I tools/map-mesh/nav2d/test_grid.py
Exits non-zero on first failure."""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_grid import (cluster_layers, build_adjacency, dijkstra,
                        connected_components)

def eq(a, b, msg=""):
    assert a == b, f"{msg}: {a!r} != {b!r}"

def approx(a, b, tol=1e-6, msg=""):
    assert abs(a - b) <= tol, f"{msg}: {a} !~ {b}"

# --- cluster_layers ---
def test_cluster_layers():
    eq(cluster_layers([], 0.5), [], "empty")
    # single cluster
    r = cluster_layers([1.0, 1.1, 0.9], 0.5)
    eq(len(r), 1, "one layer")
    approx(r[0][0], 1.0, 1e-9, "mean"); eq(r[0][1], 3, "count")
    # two clusters (ground + catwalk)
    r = cluster_layers([0.0, 0.2, 5.0, 5.1], 0.6)
    eq(len(r), 2, "two layers")
    approx(r[0][0], 0.1, 1e-9); approx(r[1][0], 5.05, 1e-9)
    # merge threshold is gap-based: 0,0.5,1.0 all chain into one at merge=0.6
    eq(len(cluster_layers([0.0, 0.5, 1.0], 0.6)), 1, "chained")
    eq(len(cluster_layers([0.0, 0.5, 1.0], 0.4)), 3, "split")
    print("  cluster_layers OK")

# --- build_adjacency ---
def test_build_adjacency():
    # two cells side by side, same height -> linked both ways
    nbc = {(0, 0): [(0.0, 1)], (1, 0): [(0.0, 2)]}
    adj = build_adjacency(nbc, cs=1.0, step_tol=1.0, vert_penalty=0.0)
    eq(sorted(n for n, _ in adj[1]), [2], "1->2")
    eq(sorted(n for n, _ in adj[2]), [1], "2->1")
    approx(adj[1][0][1], 1.0, 1e-9, "cost=cs")
    # height gap beyond step_tol -> NOT linked
    nbc = {(0, 0): [(0.0, 1)], (1, 0): [(5.0, 2)]}
    adj = build_adjacency(nbc, cs=1.0, step_tol=1.0)
    eq(adj.get(1, []), [], "no link across big gap")
    # within tol -> linked, with vertical penalty in cost
    nbc = {(0, 0): [(0.0, 1)], (1, 0): [(0.8, 2)]}
    adj = build_adjacency(nbc, cs=1.0, step_tol=1.0, vert_penalty=0.5)
    eq(len(adj[1]), 1, "linked within tol")
    approx(adj[1][0][1], 1.0 + 0.8 * 0.5, 1e-9, "cost includes vert penalty")
    # diagonal neighbour cost = sqrt(2)*cs
    nbc = {(0, 0): [(0.0, 1)], (1, 1): [(0.0, 2)]}
    adj = build_adjacency(nbc, cs=2.0, step_tol=1.0, vert_penalty=0.0)
    approx(adj[1][0][1], math.sqrt(2) * 2.0, 1e-9, "diagonal cost")
    print("  build_adjacency OK")

# --- dijkstra ---
def test_dijkstra():
    adj = {1: [(2, 1.0)], 2: [(1, 1.0), (3, 2.0)], 3: [(2, 2.0)]}
    approx(dijkstra(adj, 1, 1), 0.0, 1e-9, "self")
    approx(dijkstra(adj, 1, 3), 3.0, 1e-9, "1->3")
    # unreachable
    adj2 = {1: [(2, 1.0)], 2: [(1, 1.0)], 9: []}
    assert dijkstra(adj2, 1, 9) is None, "unreachable is None"
    # prefers cheaper multi-hop over expensive direct
    adj3 = {1: [(2, 1.0), (3, 10.0)], 2: [(3, 1.0)], 3: []}
    approx(dijkstra(adj3, 1, 3), 2.0, 1e-9, "cheaper path")
    print("  dijkstra OK")

# --- connected_components ---
def test_components():
    adj = {1: [(2, 1.0)], 2: [(1, 1.0)], 3: [(4, 1.0)], 4: [(3, 1.0)], 5: []}
    comps = connected_components(adj, [1, 2, 3, 4, 5])
    sizes = sorted(len(c) for c in comps)
    eq(sizes, [1, 2, 2], "component sizes")
    eq(len(comps[0]), 2, "largest first")
    print("  connected_components OK")

if __name__ == "__main__":
    test_cluster_layers()
    test_build_adjacency()
    test_dijkstra()
    test_components()
    print("ALL nav2d tests passed")
