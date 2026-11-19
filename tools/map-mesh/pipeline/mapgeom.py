#!/usr/bin/env python3
"""
PROJECT V — map-mesh pipeline core (map-agnostic).

Geometry primitives shared by measure_map.py:
  * triangle surface sampling (barycentric lattice)
  * solid voxel occupancy (what a body / a ray can not pass)
  * 2.5D walk grid: floor layers per XY cell, headroom-filtered, linked by
    walkable slope, plus one-way drop links
  * multi-source Dijkstra (geodesic Voronoi) over the grid
  * exact segment/triangle line of sight with a uniform-grid broadphase

Everything works in the GAME frame expressed in metres (game uu / 100), so no
Blender-specific handedness leaks past the transform step. Needs numpy only.
The pure functions here are unit-tested in test_mapgeom.py.
"""
import heapq
import math
import numpy as np


# ----------------------------------------------------------------------------
# transform candidates: Blender (x,y,z) -> game metres
# ----------------------------------------------------------------------------

def candidate_transforms():
    """All axis-aligned candidates: scale in {1, 0.1, 0.01} Blender units per uu,
    8 signed XY permutations. Each is (label, fn(blender Nx3)->game-metres Nx3, spec)."""
    out = []
    for upu in (0.01, 0.1, 1.0):                 # Blender units per game uu
        for swap in (False, True):
            for sx in (1, -1):
                for sy in (1, -1):
                    spec = {"blenderUnitsPerUU": upu, "swapXY": swap, "signX": sx, "signY": sy}
                    out.append(spec)
    return out


def apply_transform(spec, v):
    """Blender world coords (N,3) -> game metres (N,3)."""
    k = 1.0 / (spec["blenderUnitsPerUU"] * 100.0)       # Blender units -> game metres
    x, y = (v[:, 1], v[:, 0]) if spec["swapXY"] else (v[:, 0], v[:, 1])
    out = np.empty_like(v, dtype=np.float64)
    out[:, 0] = spec["signX"] * x * k
    out[:, 1] = spec["signY"] * y * k
    out[:, 2] = v[:, 2] * k
    return out


def blender_to_game_uu(spec, p):
    """Single Blender point -> game uu (the documented forward transform)."""
    g = apply_transform(spec, np.asarray([p], dtype=np.float64))[0] * 100.0
    return [float(g[0]), float(g[1]), float(g[2])]


def game_uu_to_blender(spec, g):
    """Inverse of blender_to_game_uu."""
    k = spec["blenderUnitsPerUU"]
    a, b = g[0] * k * spec["signX"], g[1] * k * spec["signY"]
    x, y = (b, a) if spec["swapXY"] else (a, b)
    return [float(x), float(y), float(g[2] * k)]


# ----------------------------------------------------------------------------
# surface sampling
# ----------------------------------------------------------------------------

def sample_triangles(p0, p1, p2, spacing, chunk_points=3_000_000):
    """Yield (points (K,3), tri_index (K,)) covering every triangle with a barycentric
    lattice whose in-plane spacing is <= `spacing` (n = ceil(longest edge / spacing))."""
    e = np.maximum(np.linalg.norm(p1 - p0, axis=1),
                   np.maximum(np.linalg.norm(p2 - p1, axis=1), np.linalg.norm(p0 - p2, axis=1)))
    n = np.maximum(1, np.ceil(e / spacing).astype(np.int64))
    for nv in np.unique(n):
        idx = np.nonzero(n == nv)[0]
        # lattice (i,j) with i+j<=nv -> weights; include the centroid for nv==1 so tiny
        # triangles still contribute an interior sample.
        ii, jj = np.meshgrid(np.arange(nv + 1), np.arange(nv + 1), indexing="ij")
        keep = (ii + jj) <= nv
        a = (ii[keep] / nv).astype(np.float64)
        b = (jj[keep] / nv).astype(np.float64)
        if nv == 1:
            a = np.append(a, 1 / 3)
            b = np.append(b, 1 / 3)
        per = len(a)
        step = max(1, chunk_points // per)
        for s in range(0, len(idx), step):
            sub = idx[s:s + step]
            q0, q1, q2 = p0[sub], p1[sub], p2[sub]
            pts = (q0[:, None, :] * (1 - a - b)[None, :, None]
                   + q1[:, None, :] * a[None, :, None]
                   + q2[:, None, :] * b[None, :, None])
            yield pts.reshape(-1, 3), np.repeat(sub, per)


# ----------------------------------------------------------------------------
# voxel occupancy
# ----------------------------------------------------------------------------

class VoxelGrid:
    """Dense boolean occupancy with cell (cs, cs, vz) anchored at `origin`."""

    def __init__(self, origin, size, cs, vz):
        self.origin = np.asarray(origin, dtype=np.float64)
        self.cs, self.vz = cs, vz
        self.nx = int(math.ceil(size[0] / cs)) + 1
        self.ny = int(math.ceil(size[1] / cs)) + 1
        self.nz = int(math.ceil(size[2] / vz)) + 1
        self.occ = np.zeros((self.nx, self.ny, self.nz), dtype=bool)
        self._csum = None

    def add_points(self, pts):
        ix = np.floor((pts[:, 0] - self.origin[0]) / self.cs).astype(np.int64)
        iy = np.floor((pts[:, 1] - self.origin[1]) / self.cs).astype(np.int64)
        iz = np.floor((pts[:, 2] - self.origin[2]) / self.vz).astype(np.int64)
        ok = (ix >= 0) & (ix < self.nx) & (iy >= 0) & (iy < self.ny) & (iz >= 0) & (iz < self.nz)
        self.occ[ix[ok], iy[ok], iz[ok]] = True
        self._csum = None

    def _cs(self):
        if self._csum is None:
            c = np.zeros((self.nx, self.ny, self.nz + 1), dtype=np.int16)
            np.cumsum(self.occ, axis=2, out=c[:, :, 1:], dtype=np.int16)
            self._csum = c
        return self._csum

    def column_occupied(self, ix, iy, zlo, zhi):
        """For arrays of columns, is any voxel occupied with centre-range [zlo, zhi)?"""
        c = self._cs()
        k0 = np.clip(np.floor((zlo - self.origin[2]) / self.vz).astype(np.int64), 0, self.nz)
        k1 = np.clip(np.ceil((zhi - self.origin[2]) / self.vz).astype(np.int64), 0, self.nz)
        k1 = np.maximum(k1, k0)
        return (c[ix, iy, k1] - c[ix, iy, k0]) > 0


# ----------------------------------------------------------------------------
# walk grid
# ----------------------------------------------------------------------------

_ORTH = [(1, 0), (-1, 0), (0, 1), (0, -1)]
_DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]


def cluster_cell_layers(cellkey, z, gap):
    """Group samples into (cell, layer): sort by (cell, z); a new layer starts when the
    cell changes or the height jumps by more than `gap`. Returns (cellkey, height) per
    layer where height is the layer's MEAN sample height."""
    order = np.lexsort((z, cellkey))
    ck, zz = cellkey[order], z[order]
    new = np.ones(len(ck), dtype=bool)
    new[1:] = (ck[1:] != ck[:-1]) | ((zz[1:] - zz[:-1]) > gap)
    starts = np.nonzero(new)[0]
    counts = np.diff(np.append(starts, len(ck)))
    h = np.add.reduceat(zz, starts) / counts
    return ck[starts], h


class WalkGrid:
    """Nodes = standable floor layers per XY cell. Links: symmetric walk links where the
    height change fits a walkable slope, and directed drop links for bigger steps down."""

    def __init__(self, origin, cs, nx, ny):
        self.origin = np.asarray(origin, dtype=np.float64)
        self.cs, self.nx, self.ny = cs, nx, ny
        self.ix = self.iy = self.h = None
        self.walk = None      # list of lists: [(nbr, cost)]
        self.drop = None

    def set_nodes(self, ix, iy, h):
        order = np.lexsort((h, iy, ix))
        self.ix, self.iy, self.h = ix[order], iy[order], h[order]
        self.n = len(self.h)
        key = self.ix.astype(np.int64) * self.ny + self.iy
        new = np.ones(self.n, dtype=bool)
        new[1:] = key[1:] != key[:-1]
        starts = np.nonzero(new)[0]
        counts = np.diff(np.append(starts, self.n))
        self.lmax = int(counts.max()) if self.n else 0
        cell_first = np.full(self.nx * self.ny, -1, dtype=np.int64)
        cell_count = np.zeros(self.nx * self.ny, dtype=np.int64)
        cell_first[key[starts]] = starts
        cell_count[key[starts]] = counts
        self._cell_first, self._cell_count = cell_first, cell_count

    def node_xyz(self, i):
        return (self.origin[0] + (self.ix[i] + 0.5) * self.cs,
                self.origin[1] + (self.iy[i] + 0.5) * self.cs,
                self.h[i])

    def xyz(self):
        return np.stack([self.origin[0] + (self.ix + 0.5) * self.cs,
                         self.origin[1] + (self.iy + 0.5) * self.cs, self.h], axis=1)

    def _pairs(self, dx, dy):
        """All (i, j) with j in the cell offset (dx,dy) from i (every layer combination)."""
        jx, jy = self.ix + dx, self.iy + dy
        ok = (jx >= 0) & (jx < self.nx) & (jy >= 0) & (jy < self.ny)
        key = np.where(ok, jx.astype(np.int64) * self.ny + jy, 0)
        first = np.where(ok, self._cell_first[key], -1)
        count = np.where(ok, self._cell_count[key], 0)
        I, J = [], []
        for k in range(self.lmax):
            m = count > k
            if not m.any():
                break
            I.append(np.nonzero(m)[0])
            J.append(first[m] + k)
        if not I:
            return np.zeros(0, np.int64), np.zeros(0, np.int64)
        return np.concatenate(I), np.concatenate(J)

    def build_links(self, max_slope, max_drop, column_free=None):
        """max_slope: |dh| <= max_slope * horizontal distance is walkable both ways.
        max_drop: a bigger step DOWN up to this is a one-way drop (orthogonal moves only).
        column_free(i, j) -> bool array: nothing solid above j up to i's head height."""
        cs = self.cs
        walk = [[] for _ in range(self.n)]
        drop = [[] for _ in range(self.n)]
        has_orth = {}
        n_walk = n_drop = 0
        for (dx, dy) in _ORTH:
            I, J = self._pairs(dx, dy)
            dh = self.h[J] - self.h[I]
            w = np.abs(dh) <= max_slope * cs
            flag = np.zeros(self.n, dtype=bool)
            flag[I[w]] = True
            has_orth[(dx, dy)] = flag
            cost = np.sqrt(cs * cs + dh[w] ** 2)
            for i, j, c in zip(I[w].tolist(), J[w].tolist(), cost.tolist()):
                walk[i].append((j, c))
            n_walk += int(w.sum())
            d = (dh < -max_slope * cs) & (dh >= -max_drop)
            if column_free is not None and d.any():
                di = np.nonzero(d)[0]
                free = column_free(I[di], J[di])
                d[di[~free]] = False
            # A drop is a fall, costed as its horizontal run plus a short landing allowance.
            for i, j, fall in zip(I[d].tolist(), J[d].tolist(), (-dh[d]).tolist()):
                drop[i].append((j, cs + 0.25 * fall))
            n_drop += int(d.sum())
        dist = cs * math.sqrt(2.0)
        for (dx, dy) in _DIAG:
            I, J = self._pairs(dx, dy)
            dh = self.h[J] - self.h[I]
            # no corner cutting: both orthogonal steps must themselves be walkable
            w = (np.abs(dh) <= max_slope * dist) & has_orth[(dx, 0)][I] & has_orth[(0, dy)][I]
            cost = np.sqrt(dist * dist + dh[w] ** 2)
            for i, j, c in zip(I[w].tolist(), J[w].tolist(), cost.tolist()):
                walk[i].append((j, c))
            n_walk += int(w.sum())
        self.walk, self.drop = walk, drop
        return n_walk, n_drop

    def components(self):
        """Undirected walk components. Returns (label per node, sizes sorted desc by label id)."""
        label = np.full(self.n, -1, dtype=np.int64)
        sizes = []
        for s in range(self.n):
            if label[s] != -1:
                continue
            c = len(sizes)
            label[s] = c
            stack = [s]
            cnt = 0
            while stack:
                u = stack.pop()
                cnt += 1
                for v, _ in self.walk[u]:
                    if label[v] == -1:
                        label[v] = c
                        stack.append(v)
            sizes.append(cnt)
        return label, np.asarray(sizes)


def dijkstra(adj_lists, sources, n, stop_after=None):
    """Multi-source Dijkstra. adj_lists: sequence of adjacency (list of [(v, w)]) to union.
    sources: {node: label}. Returns (dist array, owner-label array)."""
    dist = np.full(n, np.inf)
    owner = np.full(n, -1, dtype=np.int64)
    pq = []
    for node, lab in sources.items():
        dist[node] = 0.0
        owner[node] = lab
        pq.append((0.0, node))
    heapq.heapify(pq)
    d_local = dist.tolist()
    o_local = owner.tolist()
    while pq:
        d, u = heapq.heappop(pq)
        if d > d_local[u]:
            continue
        if stop_after is not None and d > stop_after:
            break
        ou = o_local[u]
        for adj in adj_lists:
            for v, w in adj[u]:
                nd = d + w
                if nd < d_local[v]:
                    d_local[v] = nd
                    o_local[v] = ou
                    heapq.heappush(pq, (nd, v))
    return np.asarray(d_local), np.asarray(o_local, dtype=np.int64)


# ----------------------------------------------------------------------------
# line of sight
# ----------------------------------------------------------------------------

class TriangleIndex:
    """Uniform XY grid over occluder triangles (vectorised build of los.py's WallIndex)."""

    def __init__(self, p0, p1, p2, cs=2.0):
        self.cs = cs
        self.v0, self.v1, self.v2 = p0, p1, p2
        lo = np.minimum(np.minimum(p0, p1), p2)
        hi = np.maximum(np.maximum(p0, p1), p2)
        self.zlo, self.zhi = lo[:, 2], hi[:, 2]
        self.minx, self.miny = float(lo[:, 0].min()), float(lo[:, 1].min())
        ix0 = np.floor((lo[:, 0] - self.minx) / cs).astype(np.int64)
        iy0 = np.floor((lo[:, 1] - self.miny) / cs).astype(np.int64)
        ix1 = np.floor((hi[:, 0] - self.minx) / cs).astype(np.int64)
        iy1 = np.floor((hi[:, 1] - self.miny) / cs).astype(np.int64)
        self.ny = int(iy1.max()) + 1
        nxs, nys = ix1 - ix0 + 1, iy1 - iy0 + 1
        tri_parts, key_parts = [], []
        for sx in np.unique(nxs):
            mx = nxs == sx
            for sy in np.unique(nys[mx]):
                idx = np.nonzero(mx & (nys == sy))[0]
                ox, oy = np.meshgrid(np.arange(sx), np.arange(sy), indexing="ij")
                kx = ix0[idx][:, None] + ox.ravel()[None, :]
                ky = iy0[idx][:, None] + oy.ravel()[None, :]
                key_parts.append((kx * self.ny + ky).ravel())
                tri_parts.append(np.repeat(idx, sx * sy))
        keys = np.concatenate(key_parts)
        tris = np.concatenate(tri_parts)
        order = np.argsort(keys, kind="stable")
        self._keys = keys[order]
        self._tris = tris[order]
        self._ukeys, self._starts = np.unique(self._keys, return_index=True)
        self._ends = np.append(self._starts[1:], len(self._keys))

    def candidates(self, p, q):
        from los import segment_cells        # reuse the tested supercover walk
        cells = segment_cells(p[0], p[1], q[0], q[1], self.minx, self.miny, self.cs)
        keys = np.fromiter((cx * self.ny + cy for cx, cy in cells if cx >= 0 and cy >= 0),
                           dtype=np.int64)
        if keys.size == 0:
            return keys
        pos = np.searchsorted(self._ukeys, keys)
        pos[pos >= len(self._ukeys)] = 0
        hit = self._ukeys[pos] == keys
        if not hit.any():
            return np.zeros(0, np.int64)
        parts = [self._tris[self._starts[k]:self._ends[k]] for k in pos[hit]]
        cand = np.unique(np.concatenate(parts))
        zmin, zmax = min(p[2], q[2]), max(p[2], q[2])
        return cand[(self.zhi[cand] >= zmin) & (self.zlo[cand] <= zmax)]

    def occluded(self, p, q):
        from los import moeller_trumbore_batch
        cand = self.candidates(p, q)
        if cand.size == 0:
            return False
        d = np.asarray(q, float) - np.asarray(p, float)
        t = moeller_trumbore_batch(np.asarray(p, float), d,
                                   self.v0[cand], self.v1[cand], self.v2[cand], eps=1e-9)
        return bool(np.isfinite(t).any())
