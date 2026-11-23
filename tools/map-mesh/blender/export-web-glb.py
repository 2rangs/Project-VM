#!/usr/bin/env python3
"""
PROJECT V — web-sized map mesh for the desktop app's 3D team cams.

Turns a user-provided map .blend into ONE small GLB that the desktop app can load directly
(apps/desktop: assets.ts preloads it, CamStage3D attaches it). The output is a derivative of
third-party map geometry: write it OUTSIDE the repo (~/ProjectV-assets/maps/glb/) and never commit
it. Only this script, its report format and the docs live in git.

Run one map (headless, Blender 4.2 LTS; through heavy-run.sh on the shared Mac):
  Blender --background --factory-startup --python tools/map-mesh/blender/export-web-glb.py -- \
    --blend ~/ProjectV-assets/maps/raw/Haven.blend --map haven --spatial datasets/spatial \
    --out ~/ProjectV-assets/maps/glb/haven.glb --report ~/ProjectV-assets/maps/glb/haven.report.json \
    --preview-dir ~/ProjectV-assets/maps/glb
  (tools/map-mesh/blender/export-all-maps.sh runs all eleven, one at a time.)

What it does
  1. drops what a first-person tactical view does not need: vista/skybox/alternate (_NPEV2)
     collections, foliage and clutter (same name regex family as extract-collision.py), tiny props;
  2. paints a vertex-colour layer from each material's albedo (`<material>_DF`) texture: every
     face corner gets the colour of a 64 px box-filtered copy of that texture at its UV — tiles,
     trims and painted walls keep their tone — then strips materials, UVs and textures (no texture
     image leaves the .blend; materials without an albedo get a flat base / hashed stone colour);
  3. joins everything per source collection (a handful of draw calls) and decimates to the budget
     (--target-tris, default 390 k so the GLB stays under ~20 MB);
  4. CALIBRATES the Blender→game frame: the 8 axis flips/swaps of "1 Blender metre = 100 uu" are
     scored by how many navgraph zone centres stand on a floor; the measured transform of the
     maps pipeline (datasets/spatial/<map>/mesh/<map>-blender-to-game-transform.json) is used
     as the prior and kept unless another candidate is clearly better; then a horizontal offset
     and vertical offset are refined against the navigation roadmap nodes (<map>.nav.json);
  5. VERIFIES the exported (decimated) mesh in game units: every roadmap node is dropped onto the
     mesh floor (vertical error; horizontal distance to the nearest floor at the node's height when
     none is under it), and sampled node pairs from the sight table (<map>.vis.json) are re-tested
     against the mesh (eye→eye / eye→chest segments, as vis_map.py measures them);
  6. bakes the transform so the GLB is already in the app's scene frame
       scene(x, y-up, z) = (game.x, game.z, game.y) × 0.01   [metres]
     and exports positions + vertex colours only;
  7. optionally renders two Workbench previews (top-down, oblique) next to the GLB.
Everything measured goes to --report (JSON); EXPORT-WEB-GLB / CALIBRATION / VERIFY lines to stdout.
"""
import bpy
import sys
import os
import re
import json
import math
import base64
import random
import argparse
import hashlib
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

DROP_NAME = (r"foliage|tree|grass|bush|vine|ivy|leaf|plant|shrub|hedge|flower|rubble|papers|wires|"
             r"trash|decal|bird|cloud|fog|godray|lightcard|flag|banner|cable|rope|particle|fx_|vfx")
# Same family as the maps pipeline (extract stats: "Vista|Skybox|_NPEV2|Snowball|Audio|Lighting"):
# _NPEV2 collections are alternate copies of the playable art and would double the geometry.
# Structural pieces are never dropped by name: Haven's `Floor_8_BirdHouseA` is a walkable floor.
KEEP_NAME = r"^(floor|shell|wall|doorway|stair|ramp|roof|ceiling|pillar|column)"
DROP_COLLECTION = r"vista|sky|_npev2|snowball|audio|lighting"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--map", required=True, help="map id, e.g. ascent (used in names/report)")
    p.add_argument("--spatial", default="", help="datasets/spatial root: navgraph, nav roadmap, sight table and transform prior are read from <root>/<map>/")
    p.add_argument("--navgraph", default="", help="navgraph JSON (overrides --spatial)")
    p.add_argument("--out", required=True)
    p.add_argument("--report", default="")
    p.add_argument("--preview-dir", default="", help="write <map>-preview-top.png / <map>-preview-oblique.png here")
    p.add_argument("--link", default="", help="also symlink the GLB here (e.g. apps/desktop/assets/maps/<map>.glb)")
    p.add_argument("--target-tris", type=int, default=390000)
    p.add_argument("--max-bytes", type=int, default=20_000_000, help="re-decimate once if the GLB comes out larger")
    p.add_argument("--min-size", type=float, default=0.9, help="drop objects whose largest dimension is below this (Blender units = metres)")
    p.add_argument("--uu-per-unit", type=float, default=100.0, help="game units per Blender unit (the .blend is in metres)")
    p.add_argument("--search-offset", type=float, default=200.0, help="refine a horizontal offset of up to ± this many uu around the prior (0 = none)")
    p.add_argument("--sight-pairs", type=int, default=300, help="sight-table pairs sampled per class (visible / blocked)")
    p.add_argument("--drop-name-regex", default=DROP_NAME)
    p.add_argument("--drop-collection-regex", default=DROP_COLLECTION)
    return p.parse_args(argv)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def material_colour(obj):
    """A flat colour for an object: its first material's base colour, else a hashed stone tone."""
    for slot in obj.material_slots:
        m = slot.material
        if not m:
            continue
        col = None
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    inp = n.inputs.get("Base Color")
                    if inp is not None and not inp.is_linked:
                        col = tuple(inp.default_value[:3])
                    break
        if col is None:
            col = tuple(m.diffuse_color[:3])
        if max(col) - min(col) > 0.04 or max(col) < 0.75:  # a real colour, not the default white/grey
            return col
        h = hashlib.md5(m.name.encode()).digest()
        base = 0.42 + (h[0] / 255.0) * 0.26
        return (base * (1.0 + (h[1] / 255.0 - 0.5) * 0.10), base * (0.97 + (h[2] / 255.0 - 0.5) * 0.06), base * (0.90 + (h[3] / 255.0 - 0.5) * 0.10))
    return (0.5, 0.49, 0.46)


ALBEDO_PX = 64  # albedo textures are box-filtered down to this before sampling (colour, not detail)
_albedo_cache = {}


def albedo_image(mat):
    """The material's own albedo texture (`*_DF`, not the shared `Albedo_DF` placeholder), or None."""
    if not mat or not mat.node_tree:
        return None
    best = None
    for n in mat.node_tree.nodes:
        im = getattr(n, "image", None) if n.type == "TEX_IMAGE" else None
        if im is None:
            continue
        stem = os.path.splitext(im.name)[0]
        if re.search(r"_DF$", stem) and not stem.startswith("Albedo_DF"):
            return im
        if best is None and re.search(r"(_D|_BaseColor|_Albedo)$", stem, re.I):
            best = im
    return best


def albedo_array(im):
    """ALBEDO_PX² box-filtered sRGB colours of an image (rows bottom-up, as Blender stores them)."""
    key = im.name
    if key in _albedo_cache:
        return _albedo_cache[key]
    arr = None
    try:
        w, h = im.size[0], im.size[1]
        if w > 0 and h > 0:
            px = np.empty(w * h * 4, dtype=np.float32)
            im.pixels.foreach_get(px)
            img = px.reshape(h, w, 4)[:, :, :3]
            fy, fx = max(1, h // ALBEDO_PX), max(1, w // ALBEDO_PX)
            hh, ww = (h // fy) * fy, (w // fx) * fx
            arr = img[:hh, :ww].reshape(hh // fy, fy, ww // fx, fx, 3).mean(axis=(1, 3))
    except Exception as e:  # unreadable image: fall back to the flat colour
        print(f"albedo: {im.name} unreadable ({e})")
    _albedo_cache[key] = arr
    return arr


def paint_from_albedo(obj, layer):
    """Per face corner: the albedo colour at its UV (flat material colour where there is none)."""
    me = obj.data
    nl = len(me.loops)
    if nl == 0:
        return
    loop_mat = np.zeros(nl, dtype=np.int32)
    if len(me.polygons):
        starts = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_start", starts)
        totals = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_total", totals)
        mats = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("material_index", mats)
        loop_mat = np.repeat(mats, totals)
    uv = None
    if me.uv_layers:
        uv = np.empty(nl * 2, dtype=np.float32)
        me.uv_layers[0].data.foreach_get("uv", uv)
        uv = uv.reshape(nl, 2)
    out = np.empty((nl, 4), dtype=np.float32); out[:, 3] = 1.0
    slots = obj.material_slots
    for mi in np.unique(loop_mat):
        sel = loop_mat == mi
        mat = slots[mi].material if mi < len(slots) else None
        im = albedo_image(mat)
        arr = albedo_array(im) if im is not None else None
        if arr is None or uv is None:
            out[sel, :3] = srgb(flat_colour(mat))
            continue
        ah, aw = arr.shape[0], arr.shape[1]
        u = uv[sel, 0] % 1.0; v = uv[sel, 1] % 1.0
        xi = np.minimum((u * aw).astype(np.int32), aw - 1)
        yi = np.minimum((v * ah).astype(np.int32), ah - 1)
        out[sel, :3] = arr[yi, xi]
    layer.data.foreach_set("color_srgb", out.ravel())


def srgb(c):
    """Linear → sRGB for a flat colour, so every corner is written in one colour space."""
    return tuple((12.92 * x) if x <= 0.0031308 else (1.055 * (x ** (1 / 2.4)) - 0.055) for x in c)


def flat_colour(mat):
    """A flat (linear) colour for a material without an albedo texture."""
    class _O:  # material_colour() reads obj.material_slots
        material_slots = [type("S", (), {"material": mat})()] if mat else []
    return material_colour(_O)



# ── geometry queries on one combined BVH ─────────────────────────────────────────────────────

def combined_bvh(objs):
    """One BVH over every triangle of `objs` (their mesh data is already in world space)."""
    verts, tris, base = [], [], 0
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        n, nt = len(me.vertices), len(me.loop_triangles)
        co = np.empty(n * 3, dtype=np.float64); me.vertices.foreach_get("co", co)
        tv = np.empty(nt * 3, dtype=np.int64); me.loop_triangles.foreach_get("vertices", tv)
        verts.append(co.reshape(n, 3)); tris.append(tv.reshape(nt, 3) + base); base += n
    V = np.concatenate(verts); T = np.concatenate(tris)
    return BVHTree.FromPolygons(V.tolist(), T.tolist(), all_triangles=True)


def floor_near(bvh, x, y, z, above=1.0, below=2.0):
    """Height of the floor (|normal.z| > 0.5) nearest to z under (x, y), searched in [z − below, z + above]; None if none."""
    start = z + above
    best = None
    cur = start
    for _ in range(8):
        loc, nor, _i, _d = bvh.ray_cast(Vector((x, y, cur)), Vector((0, 0, -1)), cur - (z - below))
        if loc is None:
            break
        if nor is not None and abs(nor.z) > 0.5 and (best is None or abs(loc.z - z) < abs(best - z)):
            best = loc.z
        if loc.z < z - below:
            break
        cur = loc.z - 0.005
    return best


def blocked(bvh, a, b):
    d = b - a
    L = d.length
    if L < 1e-4:
        return False
    loc, _n, _i, _d = bvh.ray_cast(a, d / L, L - 1e-3)
    return loc is not None


def pct(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(math.floor(q * len(s))))]


# ── spatial data ───────────────────────────────────────────────────────────────────────────────

def load_spatial(a):
    d = os.path.join(a.spatial, a.map) if a.spatial else ""
    nav_path = a.navgraph or (os.path.join(d, f"{a.map}.navgraph.json") if d else "")
    out = {"zones": [], "nodes": [], "vis": None, "prior": None, "paths": {}}
    if nav_path and os.path.exists(nav_path):
        nav = json.load(open(nav_path))
        out["zones"] = [(z["id"], z["position"]["x"], z["position"]["y"], z["position"]["z"]) for z in nav["zones"] if "position" in z]
        out["paths"]["navgraph"] = os.path.relpath(nav_path)
    if d:
        rp = os.path.join(d, f"{a.map}.nav.json")
        if os.path.exists(rp):
            out["nodes"] = [tuple(float(v) for v in n[:3]) for n in json.load(open(rp))["nodes"]]
            out["paths"]["roadmap"] = os.path.relpath(rp)
        vp = os.path.join(d, f"{a.map}.vis.json")
        if os.path.exists(vp):
            out["vis"] = json.load(open(vp))
            out["paths"]["sight"] = os.path.relpath(vp)
        tp = os.path.join(d, "mesh", f"{a.map}-blender-to-game-transform.json")
        if os.path.exists(tp):
            ch = json.load(open(tp)).get("chosen")
            if ch:
                out["prior"] = {"swap": bool(ch["swapXY"]), "sx": int(ch["signX"]), "sy": int(ch["signY"]), "uuPerUnit": 1.0 / float(ch["blenderUnitsPerUU"])}
                out["paths"]["transformPrior"] = os.path.relpath(tp)
    return out


# ── calibration (Blender frame) ──────────────────────────────────────────────────────────────

def calibrate(a, bvh, sp, zmin, zmax):
    U = sp["prior"]["uuPerUnit"] if sp["prior"] else a.uu_per_unit
    zones, nodes = sp["zones"], sp["nodes"]

    def to_blender(c, t, gx, gy):
        swap, sx, sy = c
        ux, uy = (gx - t[0]) * sx / U, (gy - t[1]) * sy / U
        return (uy, ux) if swap else (ux, uy)

    def floors_at(x, y):
        hits, z = [], zmax
        for _ in range(32):
            loc, nor, _i, _d = bvh.ray_cast(Vector((x, y, z)), Vector((0, 0, -1)), z - zmin)
            if loc is None:
                break
            if nor is not None and abs(nor.z) > 0.5:
                hits.append(loc.z * U)
            z = loc.z - 0.01
        return hits

    def zone_score(c, t):
        per = [floors_at(*to_blender(c, t, gx, gy)) for _, gx, gy, _ in zones]
        covered = sum(1 for h in per if h)
        offs = sorted(gz - h for (_, _, _, gz), hs in zip(zones, per) for h in hs)
        dz, score = 0.0, 0
        for cand in offs:
            sc = sum(1 for (_, _, _, gz), hs in zip(zones, per) if any(abs(h + cand - gz) < 60 for h in hs))
            if sc > score or (sc == score and abs(cand) < abs(dz)):
                dz, score = cand, sc
        return score, covered, dz

    calib = {"uuPerUnit": U, "prior": sp["prior"], "candidates": [], "chosen": None}
    cands = {}
    for swap in (False, True):
        for sx in (1, -1):
            for sy in (1, -1):
                c = (swap, sx, sy)
                score, covered, dz = zone_score(c, (0.0, 0.0)) if zones else (0, 0, 0.0)
                cands[c] = (score, covered, dz)
                calib["candidates"].append({"swap": swap, "sx": sx, "sy": sy, "zonesOverGeometry": covered, "zonesOnAFloor": score, "dz": round(dz, 1)})
    best_c = max(cands, key=lambda k: (cands[k][0], cands[k][1]))
    if sp["prior"]:
        pc = (sp["prior"]["swap"], sp["prior"]["sx"], sp["prior"]["sy"])
        c = pc if cands[pc][0] + 3 > cands[best_c][0] else best_c
        calib["priorAgrees"] = c == pc and (best_c == pc or cands[best_c][0] == cands[pc][0])
    else:
        c = best_c
    dz = cands[c][2] if zones else 0.0

    # refine the offset against the roadmap nodes (a fixed sample), then solve dz as their median residual
    rng = random.Random(7)
    sample = nodes if len(nodes) <= 300 else rng.sample(nodes, 300)

    def node_residuals(t, dz_):
        res = []
        for gx, gy, gz in sample:
            bx, by = to_blender(c, t, gx, gy)
            h = floor_near(bvh, bx, by, (gz - dz_) / U)
            res.append(None if h is None else (h * U + dz_ - gz))
        return res

    def node_score(t, dz_):
        r = node_residuals(t, dz_)
        return sum(60.0 if x is None else min(60.0, abs(x)) for x in r) / max(1, len(r)) + 0.001 * math.hypot(*t)

    t = (0.0, 0.0)
    if sample and a.search_offset > 0:
        best = (node_score(t, dz), t)
        for step, span, centre in ((50.0, a.search_offset, (0.0, 0.0)), (10.0, 40.0, None)):
            cx, cy = centre if centre is not None else best[1]
            n = int(span // step)
            for ix in range(-n, n + 1):
                for iy in range(-n, n + 1):
                    tt = (cx + ix * step, cy + iy * step)
                    s = node_score(tt, dz)
                    if s < best[0]:
                        best = (s, tt)
        t = best[1]
    if sample:
        r = [x for x in node_residuals(t, dz) if x is not None and abs(x) < 60]
        if r:
            dz -= float(np.median(r))
    calib["chosen"] = {"swap": c[0], "sx": c[1], "sy": c[2], "offsetUU": [t[0], t[1]], "dzUU": round(dz, 1),
                       "zonesOnAFloor": cands[c][0], "zonesTotal": len(zones), "nodesSampled": len(sample)}
    return calib, c, t, dz, U


# ── verification (exported frame: B' = game × 0.01 with y flipped, z up) ─────────────────────

def verify(a, bvh, sp):
    """Measure the exported mesh against the roadmap (floor) and the sight table (walls), in game uu."""
    G = lambda gx, gy, gz: (gx * 0.01, -gy * 0.01, gz * 0.01)
    out = {}
    nodes = sp["nodes"] or [(gx, gy, gz) for _, gx, gy, gz in sp["zones"]]
    out["floorReference"] = "roadmap nodes" if sp["nodes"] else "zone centres"
    vert, horiz, on, none_under, far = [], [], 0, 0, 0
    worst = []
    for i, (gx, gy, gz) in enumerate(nodes):
        x, y, z = G(gx, gy, gz)
        h = floor_near(bvh, x, y, z, above=1.0, below=2.0)
        v = None if h is None else abs(h - z) * 100.0
        if v is not None and v <= 50:
            vert.append(v)
        else:
            none_under += h is None
            far += h is not None
        if v is not None and v <= 15:
            on += 1; horiz.append(0.0); continue
        # nearest floor at the node's height (±15 uu) on rings around it
        found = None
        for r in range(10, 301, 10):
            for k in range(16):
                ang = 2 * math.pi * k / 16
                hx, hy = x + r * 0.01 * math.cos(ang), y + r * 0.01 * math.sin(ang)
                hh = floor_near(bvh, hx, hy, z, above=0.3, below=0.3)
                if hh is not None and abs(hh - z) * 100 <= 15:
                    found = float(r); break
            if found is not None:
                break
        horiz.append(300.0 if found is None else found)
        worst.append({"node": i, "game": [round(gx), round(gy), round(gz)], "verticalUU": None if v is None else round(v, 1), "horizontalUU": found})
    out["nodes"] = len(nodes)
    out["nodesOnFloorWithin15uu"] = on
    out["nodesNoFloorUnder"] = none_under
    out["nodesFloorBeyond50uu"] = far
    out["verticalUU"] = {"n": len(vert), "median": pct(vert, 0.5), "p95": pct(vert, 0.95), "max": max(vert) if vert else None}
    out["horizontalUU"] = {"n": len(horiz), "p95": pct(horiz, 0.95), "max": max(horiz) if horiz else None, "capUU": 300}
    worst.sort(key=lambda w: -(w["horizontalUU"] or 999))
    out["worstNodes"] = worst[:12]

    vis = sp["vis"]
    if vis and sp["nodes"] and vis.get("nodes") == len(sp["nodes"]):
        n = vis["nodes"]
        bits = np.unpackbits(np.frombuffer(base64.b64decode(vis["bitsBase64"]), dtype=np.uint8))
        eye, chest, rng_uu = vis["params"].get("eye", 1.6), vis["params"].get("chest", 1.1), vis["rangeUnits"]
        rng = random.Random(11)
        want = {True: a.sight_pairs, False: a.sight_pairs}
        got = {True: [], False: []}
        tries = 0
        while (len(got[True]) < want[True] or len(got[False]) < want[False]) and tries < 400000:
            tries += 1
            i, j = rng.randrange(n), rng.randrange(n)
            if i == j:
                continue
            if i > j:
                i, j = j, i
            pi_, pj = nodes[i], nodes[j]
            if math.dist(pi_, pj) > rng_uu:
                continue
            seen = bool(bits[i * n - i * (i + 1) // 2 + (j - i - 1)])
            if len(got[seen]) < want[seen]:
                got[seen].append((i, j))
        res = {}
        mismatches = []
        for seen, pairs in got.items():
            agree = 0
            for i, j in pairs:
                (xi, yi, zi), (xj, yj, zj) = G(*nodes[i]), G(*nodes[j])
                ei, ej = Vector((xi, yi, zi + eye)), Vector((xj, yj, zj + eye))
                ci, cj = Vector((xi, yi, zi + chest)), Vector((xj, yj, zj + chest))
                ours = (not blocked(bvh, ei, ej)) or (not blocked(bvh, ei, cj)) or (not blocked(bvh, ej, ci))
                if ours == seen:
                    agree += 1
                elif len(mismatches) < 10:
                    mismatches.append({"i": i, "j": j, "table": "visible" if seen else "blocked", "mesh": "visible" if ours else "blocked"})
            res["visiblePairs" if seen else "blockedPairs"] = {"sampled": len(pairs), "meshAgrees": agree, "rate": round(agree / max(1, len(pairs)), 3)}
        res["examples"] = mismatches
        out["sight"] = res
    return out


# ── preview renders (Workbench, vertex colours) ───────────────────────────────────────────────

def render_previews(a, objs):
    scene = bpy.context.scene
    keep = set(objs)
    for o in scene.objects:
        o.hide_render = o not in keep
    for o in objs:
        me = o.data
        if me.color_attributes:
            me.color_attributes.active_color = me.color_attributes[0]
            me.color_attributes.render_color_index = 0
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"; sh.color_type = "VERTEX"; sh.show_cavity = True; sh.cavity_type = "BOTH"
    sh.show_shadows = True; sh.shadow_intensity = 0.35
    scene.display.light_direction = (0.45, -0.35, 0.82)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("pv")
    scene.world.color = (0.62, 0.72, 0.82)
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    lo = Vector((min((o.matrix_world @ Vector(c))[k] for o in objs for c in o.bound_box) for k in range(3)))
    hi = Vector((max((o.matrix_world @ Vector(c))[k] for o in objs for c in o.bound_box) for k in range(3)))
    ctr, size = (lo + hi) / 2, hi - lo
    R = max(size.x, size.y) / 2
    cam_data = bpy.data.cameras.new("pv-preview"); cam = bpy.data.objects.new("pv-preview", cam_data)
    scene.collection.objects.link(cam); scene.camera = cam
    cam_data.clip_end = 4 * R + size.z * 4; cam_data.clip_start = 0.1
    written = []

    def shoot(name, w, h):
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = w, h, 100
        path = os.path.join(a.preview_dir, f"{a.map}-preview-{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

    cam_data.type = "ORTHO"; cam_data.ortho_scale = 2 * R * 1.04
    cam.location = (ctr.x, ctr.y, hi.z + 10); cam.rotation_euler = (0, 0, 0)
    shoot("top", 1400, 1400)
    cam_data.type = "PERSP"; cam_data.lens = 22
    eye = Vector((ctr.x - 0.95 * R, ctr.y - 0.95 * R, hi.z + 0.55 * R))
    cam.location = eye; cam.rotation_euler = (ctr - eye).to_track_quat("-Z", "Y").to_euler()
    shoot("oblique", 1600, 900)
    return written


# ── main ───────────────────────────────────────────────────────────────────────────────────────

def main():
    import time
    t_start = time.time()
    a = parse_args()
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    scene = bpy.context.scene
    drop_rx = re.compile(a.drop_name_regex, re.I)
    coll_rx = re.compile(a.drop_collection_regex, re.I)
    keep_rx = re.compile(KEEP_NAME, re.I)
    stats = {"map": a.map, "source": os.path.basename(a.blend), "budget": {"targetTris": a.target_tris, "maxBytes": a.max_bytes},
             "dropped": {"byName": 0, "byCollection": 0, "tiny": 0, "empty": 0}}
    sp = load_spatial(a)
    stats["inputs"] = sp["paths"]

    groups = {}
    src_tris = 0
    for obj in list(scene.objects):
        if obj.type != "MESH":
            continue
        n = tri_count(obj)
        src_tris += n
        colls = [c.name for c in obj.users_collection]
        if n == 0:
            stats["dropped"]["empty"] += 1; continue
        if any(coll_rx.search(c) for c in colls):
            stats["dropped"]["byCollection"] += 1; continue
        if not keep_rx.search(obj.name) and (drop_rx.search(obj.name) or drop_rx.search(obj.data.name)):
            stats["dropped"]["byName"] += 1; continue
        if max(obj.dimensions) < a.min_size:
            stats["dropped"]["tiny"] += 1; continue
        groups.setdefault(colls[0] if colls else "misc", []).append(obj)
    stats["sourceObjects"] = len([o for o in scene.objects if o.type == "MESH"])
    stats["sourceTris"] = src_tris

    # --- vertex colours from materials, one user per mesh so joins are independent ---
    kept = [o for objs in groups.values() for o in objs]
    for obj in kept:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        me = obj.data
        for attr in list(me.color_attributes):
            me.color_attributes.remove(attr)
        layer = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
        paint_from_albedo(obj, layer)
        me.materials.clear()
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        for mod in list(obj.modifiers):
            obj.modifiers.remove(mod)

    # --- join per collection ---
    joined = []
    view_layer = bpy.context.view_layer
    for name, objs in sorted(groups.items()):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.hide_set(False); o.hide_viewport = False; o.select_set(True)
        view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = view_layer.objects.active
        j.name = f"{a.map}_{name}"
        joined.append(j)
    kept_tris = sum(tri_count(o) for o in joined)
    stats["keptTrisBeforeDecimate"] = kept_tris

    def decimate(ratio):
        for o in joined:
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True); view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            if ratio < 0.98:
                mod = o.modifiers.new("web", "DECIMATE")
                mod.ratio = ratio
                bpy.ops.object.modifier_apply(modifier=mod.name)

    ratio = min(1.0, a.target_tris / max(1, kept_tris))
    stats["decimateRatio"] = round(ratio, 4)
    decimate(ratio)

    # --- calibrate Blender → game ---
    t_cal = time.time()
    bvh = combined_bvh(joined)
    zmax = max((o.matrix_world @ Vector(c)).z for o in joined for c in o.bound_box) + 0.5
    zmin = min((o.matrix_world @ Vector(c)).z for o in joined for c in o.bound_box) - 0.5
    calib, c, t, dz, U = calibrate(a, bvh, sp, zmin, zmax)
    stats["calibration"] = calib
    stats["seconds"] = {"calibrate": round(time.time() - t_cal, 1)}

    # --- bake: Blender → game → pre-export frame B' = (gx, −gy, gz) × 0.01 (the exporter makes it y-up) ---
    swap, sx, sy = c
    S = (Matrix(((0, sx * U, 0, t[0]), (sy * U, 0, 0, t[1]), (0, 0, U, dz), (0, 0, 0, 1))) if swap
         else Matrix(((sx * U, 0, 0, t[0]), (0, sy * U, 0, t[1]), (0, 0, U, dz), (0, 0, 0, 1))))
    pre = Matrix(((0.01, 0, 0, 0), (0, -0.01, 0, 0), (0, 0, 0.01, 0), (0, 0, 0, 1)))
    M = pre @ S
    for o in joined:
        o.data.transform(M)
        if M.determinant() < 0:
            o.data.flip_normals()  # a mirror keeps faces facing outwards
        o.data.update()
        o.matrix_world = Matrix.Identity(4)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)

    def export():
        bpy.ops.object.select_all(action="DESELECT")
        for o in joined:
            o.select_set(True)
        view_layer.objects.active = joined[0]
        bpy.ops.export_scene.gltf(
            filepath=a.out, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
            export_normals=False, export_texcoords=False, export_materials="NONE", export_vertex_color="ACTIVE",
            export_all_vertex_colors=False, export_animations=False, export_skins=False, export_morph=False,
            export_cameras=False, export_lights=False, export_extras=False,
        )
        return os.path.getsize(a.out)

    out_bytes = export()
    if out_bytes > a.max_bytes:
        extra = (a.max_bytes * 0.95) / out_bytes
        stats["redecimate"] = {"firstBytes": out_bytes, "ratio": round(extra, 4)}
        decimate(extra)
        out_bytes = export()
    stats["outTris"] = sum(tri_count(o) for o in joined)
    stats["outBytes"] = out_bytes
    stats["outObjects"] = len(joined)
    stats["drawCalls"] = len(joined)

    # --- verify the exported geometry ---
    t_ver = time.time()
    stats["verify"] = verify(a, combined_bvh(joined), sp)
    stats["seconds"]["verify"] = round(time.time() - t_ver, 1)

    if a.link:
        os.makedirs(os.path.dirname(os.path.abspath(a.link)), exist_ok=True)
        if os.path.lexists(a.link):
            os.remove(a.link)
        os.symlink(os.path.abspath(a.out), a.link)
        stats["link"] = a.link
    if a.preview_dir:
        try:
            stats["previews"] = render_previews(a, joined)
        except Exception as e:  # previews are a convenience; never fail the export for them
            stats["previews"] = f"failed: {e}"
    stats["seconds"]["total"] = round(time.time() - t_start, 1)
    if a.report:
        json.dump(stats, open(a.report, "w"), indent=1)
    print("EXPORT-WEB-GLB", json.dumps({k: v for k, v in stats.items() if k not in ("calibration", "verify")}))
    print("CALIBRATION", json.dumps(calib["chosen"]), "priorAgrees=", calib.get("priorAgrees"))
    v = stats["verify"]
    print("VERIFY", json.dumps({k: v[k] for k in v if k not in ("worstNodes",)}))


main()
