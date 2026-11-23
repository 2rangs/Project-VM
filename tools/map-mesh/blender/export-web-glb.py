#!/usr/bin/env python3
"""
PROJECT V — web-sized map mesh for the desktop app's 3D team cams.

Turns a user-provided VALORANT map .blend into ONE small GLB that the desktop app can load
directly (apps/desktop: CamStage3D.setMapGlb). The output is a derivative of third-party map
geometry: write it OUTSIDE the repo (or to the gitignored apps/desktop/assets/maps/) and never
commit it.

Run (headless, Blender 4.2 LTS):
  Blender --background --factory-startup --python tools/map-mesh/blender/export-web-glb.py -- \
    --blend /path/to/maps/raw/Ascent.blend --map ascent \
    --navgraph apps/desktop/src/data/sim/ascent.navgraph.json \
    --out /path/to/maps/glb/ascent.glb --report /path/to/maps/glb/ascent.report.json \
    [--link apps/desktop/assets/maps/ascent.glb] [--target-tris 600000]

What it does
  1. drops what a first-person tactical view does not need: vista/skybox collections, foliage and
     clutter (same name regex family as extract-collision.py), and tiny props;
  2. paints a vertex-colour layer from each material's albedo (`<material>_DF`) texture: every
     face corner gets the colour of a 64 px box-filtered copy of that texture at its UV — so tiles,
     trims and painted walls keep their tone — then strips materials, UVs and textures (no texture
     image leaves the .blend; materials without an albedo get a flat base / hashed stone colour);
  3. joins everything per source collection (a handful of draw calls) and decimates to a budget;
  4. CALIBRATES the Blender→game frame against the navgraph instead of trusting a hand fit:
     tries the 8 axis flips/swaps of "1 Blender metre = 100 uu", keeps the one that puts the most
     zone heights on a floor (solving the vertical offset), then refines a horizontal offset on
     a grid. The scores and per-zone residuals go to --report;
  5. bakes that transform so the GLB is already in the app's scene frame
       scene(x, y-up, z) = (game.x, game.z, game.y) × 0.01   [metres]
     and exports positions + vertex colours only.
"""
import bpy
import sys
import os
import re
import json
import math
import argparse
import hashlib
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

DROP_NAME = (r"foliage|tree|grass|bush|vine|ivy|leaf|plant|shrub|hedge|flower|rubble|papers|wires|"
             r"trash|decal|bird|cloud|fog|godray|lightcard|flag|banner|cable|rope|particle|fx_|vfx")
DROP_COLLECTION = r"vista|sky"


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--map", required=True, help="map id, e.g. ascent (used in names/report)")
    p.add_argument("--navgraph", default="", help="navgraph JSON with zone positions (game uu) for calibration")
    p.add_argument("--out", required=True)
    p.add_argument("--report", default="")
    p.add_argument("--link", default="", help="also symlink the GLB here (e.g. apps/desktop/assets/maps/<map>.glb)")
    p.add_argument("--target-tris", type=int, default=600000)
    p.add_argument("--min-size", type=float, default=0.9, help="drop objects whose largest dimension is below this (Blender units = metres)")
    p.add_argument("--uu-per-unit", type=float, default=100.0, help="game units per Blender unit (the .blend is in metres)")
    p.add_argument("--search-offset", type=float, default=1500.0, help="search a horizontal offset of up to ± this many uu (0 = none)")
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


def main():
    a = parse_args()
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    scene = bpy.context.scene
    drop_rx = re.compile(a.drop_name_regex, re.I)
    coll_rx = re.compile(a.drop_collection_regex, re.I)
    stats = {"map": a.map, "source": os.path.basename(a.blend), "dropped": {"byName": 0, "byCollection": 0, "tiny": 0, "empty": 0}}

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
        if drop_rx.search(obj.name) or drop_rx.search(obj.data.name):
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

    # --- decimate to the budget ---
    ratio = min(1.0, a.target_tris / max(1, kept_tris))
    stats["decimateRatio"] = round(ratio, 4)
    for o in joined:
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True); view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if ratio < 0.98:
            mod = o.modifiers.new("web", "DECIMATE")
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)
    stats["outTris"] = sum(tri_count(o) for o in joined)

    # --- calibrate Blender → game against the navgraph ---
    depsgraph = bpy.context.evaluated_depsgraph_get()
    trees = [BVHTree.FromObject(o, depsgraph) for o in joined]
    top = max((o.matrix_world @ Vector(c)).z for o in joined for c in o.bound_box) + 0.5
    bottom = min((o.matrix_world @ Vector(c)).z for o in joined for c in o.bound_box) - 0.5
    U = a.uu_per_unit

    def floors_at(x, y):
        """Every upward-facing surface height (game uu, before dz) under Blender (x, y), top to bottom."""
        hits = []
        for tree in trees:
            z = top
            for _ in range(24):
                loc, nor, idx, dist = tree.ray_cast(Vector((x, y, z)), Vector((0, 0, -1)), z - bottom)
                if loc is None:
                    break
                if nor is not None and abs(nor.z) > 0.5:
                    hits.append(loc.z * U)
                z = loc.z - 0.01
        return sorted(hits, reverse=True)

    calib = {"uuPerUnit": U, "candidates": [], "chosen": None, "dz": 0.0, "zones": []}
    zones = []
    if a.navgraph and os.path.exists(a.navgraph):
        nav = json.load(open(a.navgraph))
        zones = [(z["id"], z["position"]["x"], z["position"]["y"], z["position"]["z"]) for z in nav["zones"] if "position" in z]

    # game.xy = U * S @ blender.xy + t  for S in the 8 signed permutations
    def to_blender(c, t, gx, gy):
        swap, sx, sy = c
        ux, uy = (gx - t[0]) * sx / U, (gy - t[1]) * sy / U
        return (uy, ux) if swap else (ux, uy)

    def evaluate(c, t):
        per = [floors_at(*to_blender(c, t, gx, gy)) for _, gx, gy, _ in zones]
        covered = sum(1 for h in per if h)
        offsets = sorted(gz - h for (_, _, _, gz), hs in zip(zones, per) for h in hs)
        dz, score = 0.0, 0
        for cand_dz in offsets:  # the dz that puts the most zone heights within 60 uu of some floor
            sc = sum(1 for (_, _, _, gz), hs in zip(zones, per) if any(abs(h + cand_dz - gz) < 60 for h in hs))
            if sc > score:
                dz, score = cand_dz, sc
        return score, covered, dz, per

    best = None
    for swap in (False, True):
        for sx in (1, -1):
            for sy in (1, -1):
                c = (swap, sx, sy)
                score, covered, dz, per = evaluate(c, (0.0, 0.0)) if zones else (0, 0, 0.0, [])
                calib["candidates"].append({"swap": swap, "sx": sx, "sy": sy, "zonesOverGeometry": covered, "zonesOnAFloor": score, "dz": round(dz, 1)})
                if best is None or (score, covered) > (best[0], best[1]):
                    best = (score, covered, c, dz, per, (0.0, 0.0))
    if zones:
        c = best[2]
        if a.search_offset > 0:
            step = 100.0
            n = int(a.search_offset // step)
            for ix in range(-n, n + 1):
                for iy in range(-n, n + 1):
                    if ix == 0 and iy == 0:
                        continue
                    t = (ix * step, iy * step)
                    score, covered, dz, per = evaluate(c, t)
                    # prefer more zones on a floor, then the smaller offset
                    if (score, -math.hypot(*t)) > (best[0], -math.hypot(*best[5])):
                        best = (score, covered, c, dz, per, t)
        score, covered, c, dz, per, t = best
        calib["chosen"] = {"swap": c[0], "sx": c[1], "sy": c[2], "offsetUU": [t[0], t[1]], "zonesOnAFloor": score, "zonesOverGeometry": covered}
        calib["dz"] = round(dz, 1)
        calib["zonesTotal"] = len(zones)
        for (zid, gx, gy, gz), hs in zip(zones, per):
            near = min((abs(h + dz - gz), h + dz) for h in hs) if hs else None
            calib["zones"].append({"id": zid, "floorsUnder": len(hs), "zoneZ": gz, "nearestFloorZ": None if near is None else round(near[1], 1), "residualUU": None if near is None else round(near[0], 1)})
    else:
        c, dz, t = (False, 1, -1), 0.0, (0.0, 0.0)
        calib["chosen"] = {"swap": False, "sx": 1, "sy": -1, "offsetUU": [0, 0], "note": "no navgraph given — assumed UE→Blender convention (y flipped)"}
    stats["calibration"] = calib

    # --- bake: Blender → game → pre-export frame B' = (gx, −gy, gz) × 0.01 (the exporter makes it y-up) ---
    swap, sx, sy = c
    S = (Matrix(((0, sx * U, 0, t[0]), (sy * U, 0, 0, t[1]), (0, 0, U, dz), (0, 0, 0, 1))) if swap
         else Matrix(((sx * U, 0, 0, t[0]), (0, sy * U, 0, t[1]), (0, 0, U, dz), (0, 0, 0, 1))))
    pre = Matrix(((0.01, 0, 0, 0), (0, -0.01, 0, 0), (0, 0, 0.01, 0), (0, 0, 0, 1)))
    M = pre @ S
    for o in joined:
        o.data.transform(M)
        o.data.update()
        o.matrix_world = Matrix.Identity(4)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
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
    stats["outBytes"] = os.path.getsize(a.out)
    stats["outObjects"] = len(joined)
    if a.link:
        os.makedirs(os.path.dirname(os.path.abspath(a.link)), exist_ok=True)
        if os.path.lexists(a.link):
            os.remove(a.link)
        os.symlink(os.path.abspath(a.out), a.link)
        stats["link"] = a.link
    if a.report:
        json.dump(stats, open(a.report, "w"), indent=1)
    print("EXPORT-WEB-GLB", json.dumps({k: v for k, v in stats.items() if k != "calibration"}))
    print("CALIBRATION", json.dumps({k: v for k, v in calib.items() if k != "zones"}))


main()
