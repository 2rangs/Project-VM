#!/usr/bin/env python3
"""
PROJECT V — line of sight between the roadmap nodes of one map.

For every pair of navigation-roadmap nodes within view distance, cast eye-level segments
against the solid, opaque triangles of the map (the same occluders as the zone LoS matrix).
A pair is visible when the eye of either sees the eye or the chest of the other. The result is
one bit per pair — what the engine needs to decide who sees whom from where they really stand.

  datasets/spatial/<map>/<map>.vis.json   { nodes, rangeUnits, bitsBase64 (upper triangle) }

It runs in parts so several processes can share the work:

  $PY -I tools/map-mesh/pipeline/vis_map.py --map ascent --derived $D/ascent --part 0/6   (… 5/6, in parallel)
  $PY -I tools/map-mesh/pipeline/vis_map.py --map ascent --derived $D/ascent --merge 6
"""
import argparse, base64, json, math, os, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import measure_map as MM      # noqa: E402

G = MM.G
V = dict(
    range_m=46.0,      # a little over the perception engine's view distance (45 m)
    eye=1.6,           # eye height above the floor (m), as in the zone LoS matrix
    chest=1.1,         # the body point also tried (m)
)


def pair_index(i, j, n):
    """Index of the unordered pair (i < j) in the upper triangle, row-major."""
    return i * n - i * (i + 1) // 2 + (j - i - 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--derived", required=True)
    ap.add_argument("--part", default="", help="i/n: compute the rows with index % n == i")
    ap.add_argument("--merge", type=int, default=0, help="n: merge the n parts and write <map>.vis.json")
    a = ap.parse_args()
    mp = a.map
    ddir = os.path.join(ROOT, "datasets", "spatial", mp)
    nav = json.load(open(os.path.join(ddir, f"{mp}.nav.json")))
    nodes = np.array(nav["nodes"], dtype=np.float64)[:, :3] / 100.0
    n = len(nodes)

    if a.merge:
        bits = np.zeros(n * (n - 1) // 2, dtype=np.uint8)
        tested = visible = 0
        for k in range(a.merge):
            z = np.load(os.path.join(a.derived, f"vis-part-{k}.npz"))
            bits[z["idx"]] = 1
            tested += int(z["tested"])
            visible += len(z["idx"])
        out = {
            "mapId": mp, "schemaVersion": "1.0.0",
            "note": "Line of sight between navigation-roadmap nodes (indices as in <map>.nav.json), measured by "
                    "exact segment/triangle tests against the map's solid, opaque geometry at eye height. One bit "
                    "per unordered pair (i < j), upper triangle row-major, MSB first; 1 = visible. Pairs beyond "
                    "rangeUnits were not tested and are 0.",
            "provenance": "measured-on-mesh",
            "params": {**V, "occluders": "solid, opaque triangles (foliage, wires, decals, clear glass removed)"},
            "nodes": n, "rangeUnits": int(V["range_m"] * 100),
            "pairsTested": tested, "pairsVisible": visible,
            "bitsBase64": base64.b64encode(np.packbits(bits).tobytes()).decode(),
        }
        path = os.path.join(ddir, f"{mp}.vis.json")
        json.dump(out, open(path, "w"), separators=(",", ":"))
        for k in range(a.merge):
            os.remove(os.path.join(a.derived, f"vis-part-{k}.npz"))
        print(f"[vis] {mp}: nodes={n} pairs tested={tested} visible={visible} ({100 * visible / max(1, tested):.1f} %) "
              f"size={os.path.getsize(path) // 1024} KB", flush=True)
        return

    part, parts = (int(x) for x in a.part.split("/"))
    t0 = time.time()
    raw = json.load(open(os.path.join(ddir, f"valorant-api-{mp}.raw.json")))
    navgraph = json.load(open(os.path.join(ddir, f"{mp}.navgraph.json")))
    apath = os.path.join(ddir, f"{mp}.authoring.json")
    authoring = json.load(open(apath)) if os.path.exists(apath) else {}
    c = MM.prepare(mp, a.derived, raw, authoring, MM.zone_list_from_navgraph(navgraph, raw))
    occl = c.solid_k & ~c.see_k
    tindex = G.TriangleIndex(c.p0[occl], c.p1[occl], c.p2[occl], cs=MM.P["los_cell"])
    eye = nodes + np.array([0.0, 0.0, V["eye"]])
    chest = nodes + np.array([0.0, 0.0, V["chest"]])
    r2 = V["range_m"] ** 2
    idx, tested = [], 0
    for i in range(part, n, parts):
        d2 = ((nodes[i + 1:, 0] - nodes[i, 0]) ** 2 + (nodes[i + 1:, 1] - nodes[i, 1]) ** 2 + (nodes[i + 1:, 2] - nodes[i, 2]) ** 2)
        for off in np.nonzero(d2 <= r2)[0].tolist():
            j = i + 1 + off
            tested += 1
            if (not tindex.occluded(eye[i], eye[j]) or not tindex.occluded(eye[i], chest[j])
                    or not tindex.occluded(eye[j], chest[i])):
                idx.append(pair_index(i, j, n))
    np.savez(os.path.join(a.derived, f"vis-part-{part}.npz"), idx=np.asarray(idx, dtype=np.int64), tested=tested)
    print(f"[vis] {mp} part {part}/{parts}: tested={tested} visible={len(idx)} ({time.time() - t0:.0f} s)", flush=True)


if __name__ == "__main__":
    main()
