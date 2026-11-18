#!/usr/bin/env python3
"""PV-5 unit tests for the LoS raycast core. Run:
    python3 -I tools/map-mesh/los/test_los.py
Exits non-zero on first failure."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from los import moeller_trumbore_batch, segment_cells, WallIndex


def test_mt_hit():
    # A unit triangle in the z=0 plane spanning the XY origin area.
    v0 = np.array([[-1.0, -1.0, 0.0]])
    v1 = np.array([[3.0, -1.0, 0.0]])
    v2 = np.array([[-1.0, 3.0, 0.0]])
    # Segment from z=+1 to z=-1 through (0,0,0): must hit at t=0.5.
    p = np.array([0.0, 0.0, 1.0]); d = np.array([0.0, 0.0, -2.0])
    t = moeller_trumbore_batch(p, d, v0, v1, v2)
    assert np.isfinite(t[0]) and abs(t[0] - 0.5) < 1e-6, f"expected hit t=0.5, got {t}"
    print("  mt hit OK")


def test_mt_miss_beside():
    v0 = np.array([[-1.0, -1.0, 0.0]])
    v1 = np.array([[3.0, -1.0, 0.0]])
    v2 = np.array([[-1.0, 3.0, 0.0]])
    # Segment passes far to the side (x=10) -> no hit.
    p = np.array([10.0, 10.0, 1.0]); d = np.array([0.0, 0.0, -2.0])
    t = moeller_trumbore_batch(p, d, v0, v1, v2)
    assert not np.isfinite(t[0]), f"expected miss, got {t}"
    print("  mt miss-beside OK")


def test_mt_miss_short_segment():
    # Triangle at z=0; segment entirely above it (z from 2 to 1) -> t would be >1.
    v0 = np.array([[-1.0, -1.0, 0.0]])
    v1 = np.array([[3.0, -1.0, 0.0]])
    v2 = np.array([[-1.0, 3.0, 0.0]])
    p = np.array([0.0, 0.0, 2.0]); d = np.array([0.0, 0.0, -1.0])  # reaches z=1 only
    t = moeller_trumbore_batch(p, d, v0, v1, v2)
    assert not np.isfinite(t[0]), f"segment stops before triangle, got {t}"
    print("  mt miss-short OK")


def test_segment_cells():
    cells = segment_cells(0.0, 0.0, 10.0, 0.0, minx=0.0, miny=0.0, cs=1.0)
    # horizontal segment at y=0 should include cells (0,0)..(10,0)
    xs = sorted(c[0] for c in cells if c[1] == 0)
    assert xs[0] == 0 and xs[-1] == 10, f"endpoints covered: {xs}"
    print("  segment_cells OK")


def test_wall_index_occlusion():
    # One vertical wall quad (two tris) at x=0, spanning y,z; blocks a ray
    # crossing x=0 between two points on either side.
    pos = np.array([
        [0.0, -5.0, -5.0], [0.0, 5.0, -5.0], [0.0, 5.0, 5.0], [0.0, -5.0, 5.0],
    ])
    idx = np.array([[0, 1, 2], [0, 2, 3]])
    w = WallIndex(pos, idx, cs=4.0)
    assert w.occluded(np.array([-3.0, 0.0, 0.0]), np.array([3.0, 0.0, 0.0])), "wall should block"
    # a ray that stays on one side (both x<0) is not blocked
    assert not w.occluded(np.array([-3.0, 0.0, 0.0]), np.array([-1.0, 0.0, 0.0])), "same side clear"
    print("  WallIndex occlusion OK")


if __name__ == "__main__":
    test_mt_hit()
    test_mt_miss_beside()
    test_mt_miss_short_segment()
    test_segment_cells()
    test_wall_index_occlusion()
    print("ALL los tests passed")
