#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh
Headless Blender scene inspector for a user-provided VALORANT map .blend.

Run:
  /opt/blender-4.2/blender --background --factory-startup \
    --python tools/map-mesh/blender/inspect-scene.py -- \
    --blend "datasets/spatial/ascent/mesh/raw/Ascent (blender 4.2).blend" \
    --out   /tmp/.../ascent-scene.json

Emits a JSON summary: scene units, collections, object/mesh counts, per-collection
and per-object stats (verts/polys/transform/bbox), material names, and the overall
world-space bounding box. Downloads nothing; reads only the given .blend.
"""
import bpy
import sys
import json
import argparse
from mathutils import Vector


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--blend", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-objects", type=int, default=400,
                   help="cap per-object detail rows in the JSON (counts still global)")
    return p.parse_args(argv)


def vec3(v):
    return [round(float(v[0]), 4), round(float(v[1]), 4), round(float(v[2]), 4)]


def world_bbox(obj):
    """World-space bounding box corners of a mesh/empty object."""
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return {"min": vec3([min(xs), min(ys), min(zs)]),
            "max": vec3([max(xs), max(ys), max(zs)])}


def main():
    args = parse_args()
    print(f"[inspect] opening {args.blend}")
    bpy.ops.wm.open_mainfile(filepath=args.blend)

    scene = bpy.context.scene
    us = scene.unit_settings
    units = {
        "system": us.system,            # 'METRIC' / 'IMPERIAL' / 'NONE'
        "scaleLength": round(us.scale_length, 6),
        "lengthUnit": getattr(us, "length_unit", None),
        "useSeparate": us.use_separate,
    }

    collections = []
    for coll in bpy.data.collections:
        obj_names = [o.name for o in coll.objects]
        collections.append({
            "name": coll.name,
            "directObjects": len(coll.objects),
            "sampleObjects": obj_names[:25],
        })

    # Global tallies across all mesh objects.
    total_objects = len(bpy.data.objects)
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    type_counts = {}
    for o in bpy.data.objects:
        type_counts[o.type] = type_counts.get(o.type, 0) + 1

    total_verts = 0
    total_polys = 0
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3

    obj_rows = []
    # Sort by polygon count desc so the biggest (map geometry) float to the top.
    def poly_count(o):
        return len(o.data.polygons) if o.type == "MESH" and o.data else 0
    mesh_sorted = sorted(mesh_objs, key=poly_count, reverse=True)

    for o in mesh_sorted:
        me = o.data
        nv = len(me.vertices)
        npoly = len(me.polygons)
        total_verts += nv
        total_polys += npoly
        bb = world_bbox(o)
        for i in range(3):
            overall_min[i] = min(overall_min[i], bb["min"][i])
            overall_max[i] = max(overall_max[i], bb["max"][i])
        if len(obj_rows) < args.max_objects:
            obj_rows.append({
                "name": o.name,
                "verts": nv,
                "polys": npoly,
                "location": vec3(o.location),
                "scale": vec3(o.scale),
                "dimensions": vec3(o.dimensions),
                "bbox": bb,
                "materials": [m.name for m in o.data.materials if m][:8],
                "collections": [c.name for c in o.users_collection],
            })

    materials = sorted({m.name for m in bpy.data.materials})

    summary = {
        "blend": args.blend,
        "blenderVersion": bpy.app.version_string,
        "units": units,
        "counts": {
            "objectsTotal": total_objects,
            "meshObjects": len(mesh_objs),
            "collections": len(bpy.data.collections),
            "materials": len(bpy.data.materials),
            "vertsTotal": total_verts,
            "polysTotal": total_polys,
            "objectTypes": type_counts,
        },
        "worldBBox": {
            "min": [round(x, 3) for x in overall_min],
            "max": [round(x, 3) for x in overall_max],
            "sizeUU": [round(overall_max[i] - overall_min[i], 3) for i in range(3)],
        },
        "collectionsDetail": collections,
        "largestMeshObjects": obj_rows,
        "materialsSample": materials[:120],
    }

    with open(args.out, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"[inspect] wrote {args.out}")
    print(f"[inspect] objects={total_objects} meshes={len(mesh_objs)} "
          f"verts={total_verts} polys={total_polys}")
    print(f"[inspect] worldBBox size(uu)={summary['worldBBox']['sizeUU']}")


if __name__ == "__main__":
    main()
