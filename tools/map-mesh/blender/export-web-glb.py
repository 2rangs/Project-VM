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
  2. paints each object's material colour into a vertex-colour layer and strips materials, UVs
     and textures (no game textures leave the .blend);
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
        col = material_colour(obj)
        for attr in list(me.color_attributes):
            me.color_attributes.remove(attr)
        layer = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
        layer.data.foreach_set("color", [col[0], col[1], col[2], 1.0] * len(me.loops))
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
