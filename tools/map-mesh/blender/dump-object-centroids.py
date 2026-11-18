#!/usr/bin/env python3
"""PV-5 (round 3): dump every mesh object's world-space centroid + bbox + name,
so anchor selection for the coordinate fit can be iterated in Python without
re-running Blender. Vista (skybox) objects are excluded.
Run: blender --background --factory-startup --python dump-object-centroids.py -- --blend X --out Y
"""
import bpy, sys, json, argparse
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args(argv)

bpy.ops.wm.open_mainfile(filepath=a.blend)
dg = bpy.context.evaluated_depsgraph_get()

def excluded(o):
    return any(c.name.startswith("Ascent_Art_Vista") for c in o.users_collection)

rows = []
for o in bpy.data.objects:
    if o.type != "MESH" or excluded(o):
        continue
    eo = o.evaluated_get(dg)
    me = eo.to_mesh()
    n = len(me.vertices)
    if n == 0:
        eo.to_mesh_clear(); continue
    mw = o.matrix_world
    sx = sy = sz = 0.0
    mnx = mny = mnz = 1e30
    mxx = mxy = mxz = -1e30
    for v in me.vertices:
        w = mw @ v.co
        sx += w.x; sy += w.y; sz += w.z
        mnx = min(mnx, w.x); mny = min(mny, w.y); mnz = min(mnz, w.z)
        mxx = max(mxx, w.x); mxy = max(mxy, w.y); mxz = max(mxz, w.z)
    eo.to_mesh_clear()
    rows.append({
        "name": o.name,
        "coll": (o.users_collection[0].name if o.users_collection else ""),
        "c": [round(sx/n, 2), round(sy/n, 2), round(sz/n, 2)],
        "bbmin": [round(mnx, 1), round(mny, 1), round(mnz, 1)],
        "bbmax": [round(mxx, 1), round(mxy, 1), round(mxz, 1)],
        "verts": n,
    })

json.dump({"count": len(rows), "objects": rows}, open(a.out, "w"))
print(f"[dump] {len(rows)} mesh objects -> {a.out}")
