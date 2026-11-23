#!/usr/bin/env python3
"""
PROJECT V — schematic top-down PNG of a map's zone graph (docs/research/maps/<map>.png).

Draws zones, travel edges and sightlines of datasets/spatial/<map>/<map>.navgraph.json in
minimap orientation, over a flat grey silhouette of the walkable cells the mesh stage found
(<derived>/footprint.npz, optional). It is a picture of the GRAPH — no game art is drawn.

  $PYTHON_WITH_NUMPY -I tools/map-mesh/pipeline/render_map.py --map bind --derived /path/derived/bind
"""
import argparse, json, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
from pngdraw import Canvas  # noqa: E402

EDGE_STYLE = {
    "walk": ((40, 70, 150), None), "drop": ((230, 120, 0), None), "teleporter": ((150, 40, 170), (10, 6)),
    "zipline": ((0, 140, 70), (10, 6)), "rope": ((0, 140, 70), (4, 4)), "approx-link": ((210, 30, 30), (6, 6)),
}
ZONE_COLOR = {"site": (210, 30, 30), "spawn": (20, 20, 20)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--derived", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--size", type=int, default=1400)
    ap.add_argument("--no-sightlines", action="store_true")
    a = ap.parse_args()
    d = os.path.join(ROOT, "datasets", "spatial", a.map)
    nav = json.load(open(os.path.join(d, f"{a.map}.navgraph.json")))
    t = json.load(open(os.path.join(d, "coordinate-system.json")))["transform"]

    def mm(gx, gy):                      # game uu -> minimap [0,1] (axis-swapped, as the engine does)
        return gy * t["xMultiplier"] + t["xScalarToAdd"], gx * t["yMultiplier"] + t["yScalarToAdd"]

    # a zone is drawn where a player stands in it: its walkable anchor (else the callout)
    zp = {z["id"]: mm(z.get("anchor", z["position"])["x"], z.get("anchor", z["position"])["y"]) for z in nav["zones"]}
    fp = None
    fpath = os.path.join(a.derived, "footprint.npz") if a.derived else ""
    if fpath and os.path.exists(fpath):
        f = np.load(fpath)
        ix, iy = np.nonzero(f["mask"])
        gx = (f["origin"][0] + (ix + 0.5) * float(f["cell"])) * 100.0
        gy = (f["origin"][1] + (iy + 0.5) * float(f["cell"])) * 100.0
        fp = (gy * t["xMultiplier"] + t["xScalarToAdd"], gx * t["yMultiplier"] + t["yScalarToAdd"], float(f["cell"]))

    xs = [p[0] for p in zp.values()] + ([fp[0].min(), fp[0].max()] if fp else [])
    ys = [p[1] for p in zp.values()] + ([fp[1].min(), fp[1].max()] if fp else [])
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad, top = 70, 90
    sc = (a.size - 2 * pad) / max(x1 - x0, y1 - y0)
    W = int((x1 - x0) * sc) + 2 * pad
    H = int((y1 - y0) * sc) + 2 * pad + top
    c = Canvas(W, H, (255, 255, 255))
    X = lambda v: (v - x0) * sc + pad
    Y = lambda v: (v - y0) * sc + pad + top

    if fp:
        px = max(1, int(np.ceil(fp[2] * 100.0 * abs(t["xMultiplier"]) * sc)))
        c.cells(X(fp[0]).astype(int), Y(fp[1]).astype(int), px, (226, 228, 232))
    for s in ([] if a.no_sightlines else nav["sightlines"]):
        (ax, ay), (bx, by) = zp[s["a"]], zp[s["b"]]
        c.line(X(ax), Y(ay), X(bx), Y(by), (0, 160, 170) if s["smokeable"] else (0, 110, 60), 1.0, alpha=0.55)
    def draw_route(route, color, one_way):
        pts = [mm(w[0], w[1]) for w in route["waypoints"]]
        for (px0, py0), (px1, py1) in zip(pts[:-1], pts[1:]):
            c.line(X(px0), Y(py0), X(px1), Y(py1), color, 3.0)
        for (px0, py0) in pts[1:-1]:
            c.disc(X(px0), Y(py0), 2.5, (255, 255, 255))
        if one_way and len(pts) >= 2:
            k = len(pts) // 2
            (px0, py0), (px1, py1) = pts[k - 1], pts[k]
            c.arrow(X(px0), Y(py0), (X(px0) + X(px1)) / 2, (Y(py0) + Y(py1)) / 2, color, 3.0, head=12)

    for e in nav["edges"]:
        (ax, ay), (bx, by) = zp[e["from"]], zp[e["to"]]
        kind = e.get("kind", "walk")
        color, dash = EDGE_STYLE.get(kind, EDGE_STYLE["walk"])
        if e.get("route"):
            # the measured walkable polyline; a different way back (one-way drop) in orange
            if e.get("routeReverse"):
                draw_route(e["routeReverse"], EDGE_STYLE["drop"][0], True)
            draw_route(e["route"], color, not e["bidirectional"] or bool(e.get("routeReverse")))
            continue
        # no walkable route: a flagged straight segment
        if kind == "walk":
            color, dash = EDGE_STYLE["approx-link"]
        c.line(X(ax), Y(ay), X(bx), Y(by), color, 3.0, dash=dash)
        if not e["bidirectional"]:
            c.arrow(X(ax), Y(ay), (X(ax) + X(bx)) / 2, (Y(ay) + Y(by)) / 2, color, 3.0, head=12)
    for z in nav["zones"]:
        px_, py_ = X(zp[z["id"]][0]), Y(zp[z["id"]][1])
        c.disc(px_, py_, 9 if z["zoneType"] == "site" else 6, ZONE_COLOR.get(z["zoneType"], (40, 70, 150)))
        c.ring(px_, py_, 9 if z["zoneType"] == "site" else 6, (255, 255, 255), 1.5)
    for z in nav["zones"]:
        px_, py_ = X(zp[z["id"]][0]), Y(zp[z["id"]][1])
        c.text(px_ + 10, py_ - 12, z["id"], (0, 0, 0), 2, halo=(255, 255, 255))

    kinds = {}
    for e in nav["edges"]:
        k = e.get("kind", "walk")
        if not e.get("route") and k == "walk":
            k = "approx-link"
        kinds[k] = kinds.get(k, 0) + 1
    if any(e.get("routeReverse") for e in nav["edges"]):
        kinds["drop"] = kinds.get("drop", 0) + 1
    routed = sum(1 for e in nav["edges"] if e.get("route"))
    sites = nav.get("sites") or sorted(z["superRegion"] for z in nav["zones"] if z["zoneType"] == "site")
    c.text(20, 14, f"{a.map}  zones {len(nav['zones'])}  edges {len(nav['edges'])} ({routed} walkable routes)  sightlines {len(nav['sightlines'])}  sites {'/'.join(sites)}", (0, 0, 0), 3)
    c.text(20, 46, "graph schematic, minimap orientation. grey = walkable cells found on the mesh. edges = measured walkable polylines.", (90, 90, 90), 2)
    lx = 20
    for label, (color, dash) in [("walk", EDGE_STYLE["walk"]), ("drop (one-way)", EDGE_STYLE["drop"]),
                                 ("teleporter", EDGE_STYLE["teleporter"]), ("zipline", EDGE_STYLE["zipline"]),
                                 ("straight (no route)", EDGE_STYLE["approx-link"]), ("sightline", ((0, 160, 170), None))]:
        key = {"straight": "approx-link"}.get(label.split(" ")[0], label.split(" ")[0])
        if key in ("teleporter", "zipline", "approx-link", "drop") and not kinds.get(key):
            continue
        c.line(lx, 76, lx + 36, 76, color, 1.0 if key == "sightline" else 3.0, dash=dash)
        c.text(lx + 42, 69, label, (60, 60, 60), 2)
        lx += 42 + c.text_size(label, 2)[0] + 24
    out = a.out or os.path.join(ROOT, "docs", "research", "maps", f"{a.map}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    c.save(out)
    print(f"[render] {out} {W}x{H}")


if __name__ == "__main__":
    main()
