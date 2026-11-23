#!/usr/bin/env python3
"""
PROJECT V — measure one map's geometry-derived relations (map-agnostic).

Input  (outside the repo): <derived>/mesh.npz + objects.json from blender/extract-map.py
Input  (in the repo):      datasets/spatial/<map>/valorant-api-<map>.raw.json
Output (in the repo, numeric only):
  datasets/spatial/<map>/mesh/<map>-blender-to-game-transform.json
  datasets/spatial/<map>/mesh/<map>-grid.json           zone snaps, travel distances, adjacency
  datasets/spatial/<map>/mesh/<map>-los-matrix.json     zone-to-zone visibility fractions
  datasets/spatial/<map>/mesh/<map>-extract-stats.json  copy of the extraction stats
Output (outside the repo): <derived>/footprint.npz      walkable-cell bitmap for the schematic PNG

Run with any Python that has numpy (Blender bundles one):
  $BLENDER_PYTHON -I tools/map-mesh/pipeline/measure_map.py --map bind \
      --derived /path/derived/bind
"""
import argparse, json, math, os, re, shutil, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "los"))
sys.path.insert(0, os.path.join(ROOT, "tools", "map-processor"))
import mapgeom as G          # noqa: E402
import mapzones              # noqa: E402

# Art that neither stops a body nor a line of sight, matched on OBJECT names (CamelCase tokens) ...
_VEG_OBJECT = (r"Foliage|Wires?(?![a-z])|Ivy|Plants?(?!er)|Flowers?(?!s?hop|bed)|Bush|Leaf|Leaves|Leafs|"
               r"Vines?(?![a-z])|Fern|Cables?(?![a-z])|LightShaft|GodRay|Glow|Smoke|Volumes?|Blockers?|"
               r"Sky(?!light)|Canopy|Clothesline|Netting|Petals")
_FLAT_OBJECT = r"Grass|Decals?|Cards(?!board)|Vignette|CautionTape"
# ... and on MATERIAL names (catches leaf cards on otherwise solid trees). Category prefixes are
# anchored: "Dirt_M1_GravelSmallGrass_MI" is ground, "Grass_M0_Cards_MI" is not.
_VEG_MATERIAL = (r"^(Foliage|Plant|Flowers?|Fern|Petals|Vines?|CloudCard|Hologram)_|"
                 r"Leaf|Leaves|Canopy|Foliage|LightBlocker|Smoke|BendingRope")
_FLAT_MATERIAL = r"^(Grass|Decal|Glass_Decal|Card|Graffiti|CautionTape|Floater)_|HayCard"
# Blocks neither body nor sight:
NON_SOLID_OBJECT = _VEG_OBJECT + "|" + _FLAT_OBJECT
NON_SOLID_MATERIAL = _VEG_MATERIAL + "|" + _FLAT_MATERIAL
# Never a floor to stand on (the flat ground dressings above still count as ground):
NOT_FLOOR_OBJECT = _VEG_OBJECT
NOT_FLOOR_MATERIAL = _VEG_MATERIAL
# Stops a body but not a line of sight (clear glass). "Opaque" glass stays an occluder.
SEE_THROUGH_MATERIAL = r"Glass(?!.*Opaque)|Transparent|PickleJarTrans|Chainlink"

P = dict(
    cell=0.5,            # walk-grid cell (m)
    voxel_z=0.25,        # occupancy voxel height (m)
    sample=0.2,          # surface sampling lattice (m)
    floor_nz=0.64,       # walkable slope: normal within ~50 deg of up
    layer_gap=0.35,      # height gap that separates two floor layers in one cell (m)
    body_lo=0.5,         # a solid between body_lo..body_hi above the floor blocks the cell
    body_hi=1.5,
    max_slope=1.2,       # |dh| <= 1.2 * run  (~50 deg; also a 0.6 m step over one 0.5 m cell)
    max_drop=5.0,        # one-way drop links up to this height (m)
    min_component=40,    # ignore walk components smaller than this many cells (10 m^2)
    snap_radius=6.0,     # a callout further than this from any walkable cell is "off mesh"
    zone_radius=9.0,     # a zone's own area: its Voronoi cell within this walk distance (m)
    eye=1.6,             # eye height above the floor (m) — same as tools/map-mesh/los/los.py
    los_samples=12,      # eye points per zone
    los_cell=2.0,        # ray broadphase cell (m)
    margin=45.0,         # keep geometry within the callout bbox + this margin (m)
    seed=20261119,
)


def log(*a):
    print("[measure]", *a, flush=True)


def zone_list_from_api(raw, authoring):
    """[(zone id, callout position in game metres)] straight from the valorant-api callouts."""
    zones = mapzones.zones_from_api(raw, authoring.get("zoneOverrides"))
    co = {mapzones.zone_id(c["superRegionName"], c["regionName"]):
          np.array([c["location"]["x"], c["location"]["y"], c["location"]["z"]]) / 100.0
          for c in raw["callouts"]}
    return [(z["id"], co[z["id"]]) for z in zones]


def zone_list_from_navgraph(nav, raw):
    """[(zone id, callout position in game metres)] for an existing navgraph: ids from the
    navgraph, positions from the matching raw callout (nearest x,y), so Ascent's hand-authored
    ids and its rounded z values do not disturb the snapping."""
    cs = np.array([[c["location"]["x"], c["location"]["y"], c["location"]["z"]] for c in raw["callouts"]])
    out = []
    for z in nav["zones"]:
        d = np.hypot(cs[:, 0] - z["position"]["x"], cs[:, 1] - z["position"]["y"])
        out.append((z["id"], cs[int(np.argmin(d))] / 100.0))
    return out


def prepare(mp, derived, raw, authoring, zone_list, debug=False):
    """Everything up to the zone representatives: filtered geometry in game metres, voxel
    occupancy, the walk grid with its components, and each zone snapped onto it."""
    from types import SimpleNamespace
    a = SimpleNamespace(derived=derived, debug=debug)
    zid = [z[0] for z in zone_list]
    Z = len(zid)
    cz = np.array([z[1] for z in zone_list])                        # zone callouts, game metres
    callout_uu = np.array([[c["location"]["x"], c["location"]["y"], c["location"]["z"]]
                           for c in raw["callouts"]], dtype=np.float64)

    # ------------------------------------------------------------------ load
    npz = np.load(os.path.join(derived, "mesh.npz"))
    verts_bl, tris, nz, obj, mat = npz["verts"], npz["tris"], npz["nz"], npz["obj"], npz["mat"]
    meta = json.load(open(os.path.join(a.derived, "objects.json")))
    onames = [o["name"] for o in meta["objects"]]
    mnames = meta["materials"]
    extra_obj = authoring.get("geometry", {}).get("dropObjectRegex")
    rx_o = re.compile(NON_SOLID_OBJECT + (("|" + extra_obj) if extra_obj else ""))
    rx_m = re.compile(NON_SOLID_MATERIAL)
    rx_s = re.compile(SEE_THROUGH_MATERIAL)
    o_drop = np.array([bool(rx_o.search(n)) for n in onames])
    m_drop = np.array([bool(rx_m.search(n)) for n in mnames])
    m_see = np.array([bool(rx_s.search(n)) for n in mnames])
    solid = ~(o_drop[obj] | m_drop[mat])
    rx_fo = re.compile(NOT_FLOOR_OBJECT + (("|" + extra_obj) if extra_obj else ""))
    rx_fm = re.compile(NOT_FLOOR_MATERIAL)
    floor_ok = ~(np.array([bool(rx_fo.search(n)) for n in onames])[obj]
                 | np.array([bool(rx_fm.search(n)) for n in mnames])[mat])
    see_through = m_see[mat]
    log(f"{mp}: tris={len(tris)} non-solid dropped={int((~solid).sum())} see-through={int((solid & see_through).sum())}")

    # ------------------------------------------------------------------ transform
    # Discrete candidate search, scored by how many callouts stand on a floor surface and
    # how well the callout height agrees with that floor.
    fl = np.nonzero(floor_ok & (nz >= P["floor_nz"]))[0]
    fcen_bl = (verts_bl[tris[fl, 0]] + verts_bl[tris[fl, 1]] + verts_bl[tris[fl, 2]]) / 3.0
    sub = fcen_bl[:: max(1, len(fcen_bl) // 400_000)]

    def callout_floor_stats(pts, shift=(0.0, 0.0), r=1.5):
        on, dz = 0, []
        for c in callout_uu / 100.0:
            d2 = (pts[:, 0] - (c[0] + shift[0])) ** 2 + (pts[:, 1] - (c[1] + shift[1])) ** 2
            near = d2 < r * r
            if near.any():
                on += 1
                dz.append(pts[near, 2] - c[2])
            else:
                dz.append(None)
        return on, dz

    cand_rows = []
    for spec in G.candidate_transforms():
        g = G.apply_transform(spec, sub)
        on, dz = callout_floor_stats(g)
        near = [float(np.abs(d).min()) for d in dz if d is not None]
        cand_rows.append({**spec, "calloutsOnFloor": on,
                          "medianAbsDz_m": round(float(np.median(near)), 4) if near else None,
                          "within0.05m": int(sum(1 for x in near if x < 0.05))})
    cand_rows.sort(key=lambda r: (-r["calloutsOnFloor"], -r["within0.05m"],
                                  r["medianAbsDz_m"] if r["medianAbsDz_m"] is not None else 1e9))
    best = {k: cand_rows[0][k] for k in ("blenderUnitsPerUU", "swapXY", "signX", "signY")}
    log("transform:", best, "onFloor", cand_rows[0]["calloutsOnFloor"], "/", len(callout_uu),
        "runner-up onFloor", cand_rows[1]["calloutsOnFloor"])

    verts = G.apply_transform(best, verts_bl.astype(np.float64))      # game metres from here on
    del verts_bl

    # ------------------------------------------------------------------ crop
    lo = cz.min(0) - np.array([P["margin"], P["margin"], 25.0])
    hi = cz.max(0) + np.array([P["margin"], P["margin"], 30.0])
    p0, p1, p2 = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    tmin = np.minimum(np.minimum(p0, p1), p2)
    tmax = np.maximum(np.maximum(p0, p1), p2)
    inside = np.all(tmin >= lo, axis=1) & np.all(tmax <= hi, axis=1)
    keep = (solid | floor_ok) & inside
    p0, p1, p2, nzk, see_k = p0[keep], p1[keep], p2[keep], nz[keep], see_through[keep]
    solid_k = solid[keep]
    floor_k = floor_ok[keep] & (nzk >= P["floor_nz"])
    log(f"cropped to callout bbox + margin: {int(solid_k.sum())} solid tris, {int(floor_k.sum())} floor tris")

    # ------------------------------------------------------------------ voxels + floor samples
    vox = G.VoxelGrid(lo, hi - lo, P["cell"], P["voxel_z"])
    fkeys, fz = [], []
    nsamp = 0
    for pts, ti in G.sample_triangles(p0, p1, p2, P["sample"]):
        nsamp += len(pts)
        sm = solid_k[ti]
        if sm.any():
            vox.add_points(pts[sm])
        f = floor_k[ti]
        if f.any():
            q = pts[f]
            ix = np.floor((q[:, 0] - lo[0]) / P["cell"]).astype(np.int64)
            iy = np.floor((q[:, 1] - lo[1]) / P["cell"]).astype(np.int64)
            ok = (ix >= 0) & (ix < vox.nx) & (iy >= 0) & (iy < vox.ny)
            fkeys.append(ix[ok] * vox.ny + iy[ok])
            fz.append(q[ok, 2])
    fkeys, fz = np.concatenate(fkeys), np.concatenate(fz)
    log(f"surface samples={nsamp} floor samples={len(fz)} voxels occupied={int(vox.occ.sum())}")

    ck, h = G.cluster_cell_layers(fkeys, fz, P["layer_gap"])
    ix, iy = ck // vox.ny, ck % vox.ny
    blocked = vox.column_occupied(ix, iy, h + P["body_lo"], h + P["body_hi"])
    n_layers = len(h)
    blk = (ix[blocked], iy[blocked], h[blocked])
    ix, iy, h = ix[~blocked], iy[~blocked], h[~blocked]
    grid = G.WalkGrid(lo, P["cell"], vox.nx, vox.ny)
    grid.set_nodes(ix, iy, h)

    def column_free(I, J):
        # dropping from I onto J: nothing solid above J's body up to I's head
        return ~vox.column_occupied(grid.ix[J], grid.iy[J], grid.h[J] + P["body_lo"], grid.h[I] + P["body_hi"])

    n_walk, n_drop = grid.build_links(P["max_slope"], P["max_drop"], column_free)
    label, sizes = grid.components()
    main_label = int(np.argmax(sizes))
    log(f"floor layers={n_layers} standable nodes={grid.n} walk links={n_walk} drop links={n_drop} "
        f"components={len(sizes)} largest={int(sizes.max())}")

    if a.debug:
        np.savez_compressed(os.path.join(a.derived, "grid-debug.npz"), ix=grid.ix, iy=grid.iy, h=grid.h,
                            label=label, sizes=sizes, bix=blk[0], biy=blk[1], bh=blk[2], origin=lo, cell=P["cell"])

    # ------------------------------------------------------------------ transform evidence
    xyz = grid.xyz()
    big = sizes[label] >= P["min_component"]
    # nearest standable floor layer to each callout (any component), for the residual report
    resid = []
    for i, c in enumerate(cz):
        d2 = (xyz[:, 0] - c[0]) ** 2 + (xyz[:, 1] - c[1]) ** 2
        near = np.nonzero(d2 < 1.5 ** 2)[0]
        if near.size:
            k = near[np.argmin(np.abs(xyz[near, 2] - c[2]))]
            resid.append(float(xyz[k, 2] - c[2]))
        else:
            resid.append(None)
    have = np.array([r for r in resid if r is not None])
    z_offset = float(np.median(have)) if have.size else 0.0
    z_mad = float(np.median(np.abs(have - z_offset))) if have.size else 99.0
    z_informative = z_mad < 0.6
    # sensitivity: how fast does the callout/floor agreement fall apart if the map is shifted?
    sens = []
    for dist in (0.0, 1.0, 2.0, 4.0, 8.0):
        rows = []
        for ang in ((0,) if dist == 0 else (0, 90, 180, 270)):
            sh = (dist * math.cos(math.radians(ang)), dist * math.sin(math.radians(ang)))
            on = exact = 0
            for c in cz:
                d2 = (xyz[:, 0] - (c[0] + sh[0])) ** 2 + (xyz[:, 1] - (c[1] + sh[1])) ** 2
                near = d2 < 1.0
                if near.any():
                    on += 1
                    if np.abs(xyz[near, 2] - c[2] - z_offset).min() < 0.3:
                        exact += 1
            rows.append((on, exact))
        sens.append({"shift_m": dist,
                     "calloutsOverWalkableFloor": round(float(np.mean([r[0] for r in rows])), 1),
                     "calloutsAtFloorHeight(±0.3m)": round(float(np.mean([r[1] for r in rows])), 1)})

    # ------------------------------------------------------------------ zone representatives
    # A map's authoring file may name the floor point a zone stands on ("zoneAnchors": {zone id:
    # {x, y, z in game uu, basis}}) where the callout itself is not on that floor — a label placed
    # on top of a structure, or inside a building's footprint. The zone is then snapped from that
    # point, and its height counts even on a map whose callout heights are not usable. Everything
    # else (the crop, the transform evidence, the callout residuals) still uses the raw callout.
    anchor_ov = authoring.get("zoneAnchors", {})
    unknown = sorted(set(anchor_ov) - set(zid))
    if unknown:
        raise ValueError(f"{mp}: zoneAnchors names unknown zone(s) {unknown}")
    rep = np.full(Z, -1, dtype=np.int64)
    snaps = {}
    for i, c in enumerate(cz):
        ov = anchor_ov.get(zid[i])
        src = np.array([ov["x"], ov["y"], ov["z"]], dtype=np.float64) / 100.0 if ov else c
        dxy = np.hypot(xyz[:, 0] - src[0], xyz[:, 1] - src[1])
        cand = np.nonzero(big & (dxy <= P["snap_radius"]))[0]
        if cand.size == 0:
            snaps[zid[i]] = {"onMesh": False, "note": f"no walkable cell within {P['snap_radius']} m of the callout"}
            continue
        score = dxy[cand].copy()
        if ov:
            score += 0.7 * np.abs(xyz[cand, 2] - src[2])
        elif z_informative:
            score += 0.7 * np.abs(xyz[cand, 2] - (c[2] + z_offset))
        score += np.where(label[cand] == main_label, 0.0, 3.0)
        k = int(cand[np.argmin(score)])
        rep[i] = k
        snaps[zid[i]] = {
            "onMesh": True,
            "snapDistXY_m": round(float(dxy[k]), 2),
            "floorZ_uu": round(float(xyz[k, 2]) * 100.0, 1),
            "calloutZ_uu": round(float(c[2]) * 100.0, 1),
            "repGame_uu": [round(float(xyz[k, 0]) * 100.0, 1), round(float(xyz[k, 1]) * 100.0, 1),
                           round(float(xyz[k, 2]) * 100.0, 1)],
            "component": int(label[k]),
            "onMainComponent": bool(label[k] == main_label),
        }
        if ov:
            snaps[zid[i]].update({
                "anchorAuthored": True,
                "authoredAnchor_uu": [ov["x"], ov["y"], ov["z"]],
                "calloutToAnchorXY_m": round(float(np.hypot(xyz[k, 0] - c[0], xyz[k, 1] - c[1])), 2),
            })
    placed = [i for i in range(Z) if rep[i] >= 0]

    return SimpleNamespace(**{k: v for k, v in locals().items() if k not in ("a", "SimpleNamespace")})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--derived", required=True)
    ap.add_argument("--out-dir", default="", help="default datasets/spatial/<map>/mesh; use a scratch dir for the Ascent control run")
    ap.add_argument("--raw", default="", help="default datasets/spatial/<map>/valorant-api-<map>.raw.json")
    ap.add_argument("--authoring", default="", help="default datasets/spatial/<map>/<map>.authoring.json")
    ap.add_argument("--debug", action="store_true", help="also dump <derived>/grid-debug.npz (nodes, components, blocked layers)")
    ap.add_argument("--no-los", action="store_true", help="stop after the grid stage")
    a = ap.parse_args()
    t0 = time.time()
    mp = a.map
    ddir = os.path.join(ROOT, "datasets", "spatial", mp)
    out_dir = a.out_dir or os.path.join(ddir, "mesh")
    os.makedirs(out_dir, exist_ok=True)
    raw = json.load(open(a.raw or os.path.join(ddir, f"valorant-api-{mp}.raw.json")))
    apath = a.authoring or os.path.join(ddir, f"{mp}.authoring.json")
    authoring = json.load(open(apath)) if os.path.exists(apath) else {}
    c = prepare(mp, a.derived, raw, authoring, zone_list_from_api(raw, authoring), debug=a.debug)
    (zid, Z, cz, callout_uu, grid, vox, xyz, label, sizes, main_label, rep, snaps, placed, lo, n_layers, n_walk, n_drop,
     resid, have, z_offset, z_mad, z_informative, sens, cand_rows, best, p0, p1, p2, solid_k, see_k) = (
        c.zid, c.Z, c.cz, c.callout_uu, c.grid, c.vox, c.xyz, c.label, c.sizes, c.main_label, c.rep, c.snaps, c.placed, c.lo,
        c.n_layers, c.n_walk, c.n_drop, c.resid, c.have, c.z_offset, c.z_mad, c.z_informative, c.sens, c.cand_rows, c.best,
        c.p0, c.p1, c.p2, c.solid_k, c.see_k)

    # ------------------------------------------------------------------ geodesic Voronoi (walk only)
    both = (grid.walk,)
    dist_own, owner = G.dijkstra(both, {int(rep[i]): i for i in placed}, grid.n)
    # walk adjacency: boundary crossings between two zones' cells
    INF = float("inf")
    walk_touch = {}
    drop_touch = {}
    own_l, d_l = owner.tolist(), dist_own.tolist()
    for u in range(grid.n):
        ou = own_l[u]
        if ou < 0:
            continue
        for v, w in grid.walk[u]:
            ov = own_l[v]
            if ov >= 0 and ov != ou:
                key = (ou, ov) if ou < ov else (ov, ou)
                L = d_l[u] + w + d_l[v]
                if L < walk_touch.get(key, INF):
                    walk_touch[key] = L
        for v, w in grid.drop[u]:
            ov = own_l[v]
            if ov >= 0 and ov != ou:
                L = d_l[u] + w + d_l[v]
                if L < drop_touch.get((ou, ov), INF):
                    drop_touch[(ou, ov)] = L

    # all-pairs: walk-only (symmetric) and walk+drop (directed)
    walk_d = np.full((Z, Z), np.inf)
    dir_d = np.full((Z, Z), np.inf)
    for i in placed:
        d, _ = G.dijkstra((grid.walk,), {int(rep[i]): 0}, grid.n)
        walk_d[i, placed] = d[rep[placed]]
        d, _ = G.dijkstra((grid.walk, grid.drop), {int(rep[i]): 0}, grid.n)
        dir_d[i, placed] = d[rep[placed]]
    log(f"zones placed {len(placed)}/{Z}; walk-adjacent pairs={len(walk_touch)} drop-adjacent={len(drop_touch)}")

    def mat_json(M):
        return {zid[i]: {zid[j]: (round(float(M[i, j]), 1) if np.isfinite(M[i, j]) else None)
                         for j in range(Z)} for i in range(Z)}

    main_nodes = int(sizes[main_label])
    big_nodes = int(sizes[sizes >= P["min_component"]].sum())
    zones_main = sum(1 for i in placed if label[rep[i]] == main_label)
    grid_report = {
        "note": "2.5D walk grid measured on the map's art geometry (no collision layer exists in the "
                "source scene). Distances are 8-neighbour grid geodesics in metres: they overestimate a "
                "true straight walk by up to ~8 % (octile metric), the same bias as Ascent's "
                "pv5-measured-edges. A zone's 'cell' is the set of walkable grid cells closer (on foot) "
                "to its callout than to any other callout.",
        "params": P,
        "grid": {
            "floorLayers": n_layers, "standableNodes": int(grid.n),
            "walkLinks": int(n_walk), "dropLinks": int(n_drop),
            "components": int(len(sizes)),
            "componentsOver10m2": int((sizes >= P["min_component"]).sum()),
            "mainComponentNodes": main_nodes,
            "mainComponentArea_m2": round(main_nodes * P["cell"] ** 2),
            "mainComponentShareOfStandable": round(main_nodes / max(1, grid.n), 3),
            "mainComponentShareOfComponentsOver10m2": round(main_nodes / max(1, big_nodes), 3),
        },
        "zonesPlaced": len(placed), "zonesTotal": Z, "zonesOnMainWalkComponent": zones_main,
        "zoneSnaps": snaps,
        "walkAdjacency": [{"a": zid[a_], "b": zid[b_], "pathWithinTheTwoCells_m": round(L, 1)}
                          for (a_, b_), L in sorted(walk_touch.items(), key=lambda kv: kv[1])],
        "dropAdjacency": [{"from": zid[a_], "to": zid[b_], "pathWithinTheTwoCells_m": round(L, 1)}
                          for (a_, b_), L in sorted(drop_touch.items(), key=lambda kv: kv[1])],
        "walkDistance_m": mat_json(walk_d),
        "walkAndDropDistance_m": mat_json(dir_d),
    }
    json.dump(grid_report, open(os.path.join(out_dir, f"{mp}-grid.json"), "w"), indent=1)

    tf_report = {
        "note": "Blender scene -> game coordinates. The scene is a plain export of the game level: "
                "uniform scale and a Y flip, no rotation, no offset. The candidate was chosen from all "
                "axis-aligned candidates by how many valorant-api callouts stand on a walkable floor "
                "and how closely the callout height matches that floor.",
        "forward": "gameX_uu = signX * blender{x|y} / blenderUnitsPerUU ; gameY_uu = signY * blender{y|x} / blenderUnitsPerUU ; gameZ_uu = blenderZ / blenderUnitsPerUU",
        "chosen": best,
        "calloutCount": int(len(callout_uu)),
        "calloutsOnWalkableFloorWithin1.5m": int(have.size),
        "calloutHeightVsFloor": {
            "medianOffset_m": round(z_offset, 3),
            "medianAbsDeviationAroundOffset_m": round(z_mad, 4),
            "calloutHeightIsFloorHeight": bool(z_informative and abs(z_offset) < 0.05 and z_mad < 0.05),
            "calloutHeightUsableForLayerChoice": bool(z_informative),
            "perCallout_m": {zid[i]: (round(resid[i], 3) if resid[i] is not None else None) for i in range(Z)},
        },
        "shiftSensitivity": sens,
        "topCandidates": cand_rows[:4],
        "provenance": "measured-on-mesh",
    }
    json.dump(tf_report, open(os.path.join(out_dir, f"{mp}-blender-to-game-transform.json"), "w"), indent=1)

    # ------------------------------------------------------------------ footprint (outside the repo)
    main_mask = np.zeros((vox.nx, vox.ny), dtype=np.uint8)
    reach = owner >= 0
    main_mask[grid.ix[reach], grid.iy[reach]] = 1
    np.savez_compressed(os.path.join(a.derived, "footprint.npz"), mask=main_mask, origin=lo[:2],
                        cell=P["cell"], owner_ix=grid.ix[reach], owner_iy=grid.iy[reach], owner=owner[reach])

    if a.no_los:
        log("grid stage only (--no-los)")
        return

    # ------------------------------------------------------------------ line of sight
    rng = np.random.default_rng(P["seed"])
    eyes = {}
    for i in placed:
        mine = np.nonzero((owner == i) & (dist_own <= P["zone_radius"]))[0]
        if mine.size > P["los_samples"] - 1:
            mine = rng.choice(mine, size=P["los_samples"] - 1, replace=False)
        ids = np.concatenate([[rep[i]], mine])
        e = xyz[ids].copy()
        e[:, 2] += P["eye"]
        eyes[i] = e
    occl = solid_k & ~see_k
    tindex = G.TriangleIndex(p0[occl], p1[occl], p2[occl], cs=P["los_cell"])
    log(f"LoS occluder tris={int(occl.sum())}; rays ~{len(placed) * (len(placed) - 1) // 2 * P['los_samples'] ** 2}")
    vis = np.full((Z, Z), np.nan)
    eucl = np.full((Z, Z), np.nan)
    for ai, i in enumerate(placed):
        vis[i, i] = 1.0
        for j in placed[ai + 1:]:
            ea, eb = eyes[i], eyes[j]
            tot = seen = 0
            for pa in ea:
                for pb in eb:
                    tot += 1
                    if not tindex.occluded(pa, pb):
                        seen += 1
            vis[i, j] = vis[j, i] = seen / tot
            eucl[i, j] = eucl[j, i] = float(np.linalg.norm(xyz[rep[i]] - xyz[rep[j]]))
    los_report = {
        "note": "Zone-to-zone line of sight by exact segment/triangle tests against every solid, "
                "opaque triangle of the map (foliage, wires, decals and clear glass removed). "
                "visibility = fraction of eye-point pairs (zone A x zone B) with an unobstructed "
                "segment. Eye points: the zone's callout cell plus seeded samples of its own walkable "
                "area within zoneRadius, at eye height. Symmetric by construction.",
        "params": {k: P[k] for k in ("eye", "los_samples", "zone_radius", "los_cell", "seed")},
        "occluderTriangles": int(occl.sum()),
        "eyePointsPerZone": {zid[i]: int(len(eyes[i])) for i in placed},
        "visibility": {zid[i]: {zid[j]: (round(float(vis[i, j]), 3) if np.isfinite(vis[i, j]) else None)
                                for j in range(Z) if j != i} for i in range(Z)},
        "straightLine_m": {zid[i]: {zid[j]: (round(float(eucl[i, j]), 1) if np.isfinite(eucl[i, j]) else None)
                                    for j in range(Z) if j != i} for i in range(Z)},
        "provenance": "measured-on-mesh",
    }
    json.dump(los_report, open(os.path.join(out_dir, f"{mp}-los-matrix.json"), "w"), indent=1)
    src_stats = os.path.join(a.derived, "extract-stats.json")
    if os.path.exists(src_stats):
        shutil.copyfile(src_stats, os.path.join(out_dir, f"{mp}-extract-stats.json"))
    log(f"done {mp} in {time.time() - t0:.0f} s; zones on main walk component {zones_main}/{Z}")


if __name__ == "__main__":
    main()
