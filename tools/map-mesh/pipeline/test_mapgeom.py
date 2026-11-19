#!/usr/bin/env python3
"""Unit tests for mapgeom.py (needs numpy):  $PYTHON_WITH_NUMPY -I tools/map-mesh/pipeline/test_mapgeom.py"""
import os, sys, unittest
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "los"))
import mapgeom as G


def grid_from(cells, cs=0.5):
    ix = np.array([c[0] for c in cells]); iy = np.array([c[1] for c in cells]); h = np.array([c[2] for c in cells], float)
    g = G.WalkGrid((0, 0, 0), cs, 20, 20)
    g.set_nodes(ix, iy, h)
    return g


class T(unittest.TestCase):
    def test_transform_round_trip(self):
        spec = {"blenderUnitsPerUU": 0.01, "swapXY": False, "signX": 1, "signY": -1}
        g = G.blender_to_game_uu(spec, [12.5, -40.0, 3.0])
        self.assertEqual(g, [1250.0, 4000.0, 300.0])
        self.assertTrue(np.allclose(G.game_uu_to_blender(spec, g), [12.5, -40.0, 3.0]))
        self.assertEqual(len(G.candidate_transforms()), 24)

    def test_sampling_covers_triangle(self):
        p0 = np.array([[0.0, 0, 0]]); p1 = np.array([[2.0, 0, 0]]); p2 = np.array([[0.0, 2, 0]])
        pts = np.concatenate([p for p, _ in G.sample_triangles(p0, p1, p2, 0.2)])
        self.assertGreater(len(pts), 50)
        self.assertTrue((pts[:, 0] + pts[:, 1] <= 2 + 1e-9).all() and (pts >= -1e-9).all())

    def test_layers(self):
        key = np.array([5, 5, 5, 5, 7]); z = np.array([0.0, 0.1, 3.0, 3.2, 1.0])
        ck, h = G.cluster_cell_layers(key, z, 0.35)
        self.assertEqual(ck.tolist(), [5, 5, 7])
        self.assertTrue(np.allclose(h, [0.05, 3.1, 1.0]))

    def test_voxel_column(self):
        v = G.VoxelGrid((0, 0, 0), (5, 5, 5), 0.5, 0.25)
        v.add_points(np.array([[1.1, 1.1, 1.0]]))
        ix = np.array([2, 2]); iy = np.array([2, 2])
        self.assertEqual(v.column_occupied(ix, iy, np.array([0.5, 1.5]), np.array([1.5, 2.5])).tolist(), [True, False])

    def test_walk_step_and_drop(self):
        # flat run 0..2, a 0.5 m step up at x=3 (walkable both ways), a 3 m ledge at x=4 (drop only)
        g = grid_from([(0, 0, 0.0), (1, 0, 0.0), (2, 0, 0.0), (3, 0, 0.5), (4, 0, -2.5)])
        n_walk, n_drop = g.build_links(1.2, 5.0)
        self.assertEqual(n_walk, 6)
        self.assertEqual(n_drop, 1)
        d, _ = G.dijkstra((g.walk,), {0: 0}, g.n)
        self.assertTrue(np.isinf(d[4]))                       # cannot WALK down the ledge
        d, _ = G.dijkstra((g.walk, g.drop), {0: 0}, g.n)
        self.assertTrue(np.isfinite(d[4]))                    # but can drop
        d, _ = G.dijkstra((g.walk, g.drop), {4: 0}, g.n)
        self.assertTrue(np.isinf(d[0]))                       # and not climb back
        label, sizes = g.components()
        self.assertEqual(sorted(sizes.tolist()), [1, 4])

    def test_no_corner_cutting(self):
        g = grid_from([(0, 0, 0.0), (1, 1, 0.0)])            # diagonal neighbours, no orthogonal support
        n_walk, _ = g.build_links(1.2, 5.0)
        self.assertEqual(n_walk, 0)

    def test_voronoi_owner(self):
        g = grid_from([(i, 0, 0.0) for i in range(7)])
        g.build_links(1.2, 5.0)
        _, owner = G.dijkstra((g.walk,), {0: 10, 6: 20}, g.n)
        self.assertEqual(owner.tolist()[:3], [10, 10, 10])
        self.assertEqual(owner.tolist()[4:], [20, 20, 20])

    def test_line_of_sight_wall(self):
        # a 2 m wall at x=1 between y=-1..1; rays across it are blocked, over it are not
        p0 = np.array([[1.0, -1, 0], [1.0, -1, 0]]); p1 = np.array([[1.0, 1, 0], [1.0, 1, 2]]); p2 = np.array([[1.0, 1, 2], [1.0, -1, 2]])
        idx = G.TriangleIndex(p0, p1, p2, cs=2.0)
        self.assertTrue(idx.occluded((0, 0, 1.0), (2, 0, 1.0)))
        self.assertFalse(idx.occluded((0, 0, 3.0), (2, 0, 3.0)))
        self.assertFalse(idx.occluded((0, 3, 1.0), (2, 3, 1.0)))


if __name__ == "__main__":
    unittest.main()
