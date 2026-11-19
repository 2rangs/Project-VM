#!/usr/bin/env python3
"""
PROJECT V — map-mesh, map-agnostic extraction (generalises extract-collision.py).

Reads a user-provided VALORANT map .blend and writes ONE compact world-space
triangle soup that every later stage (transform fit, walk grid, line of sight)
filters by itself, so Blender has to open each scene only once.

Output directory (must be OUTSIDE the repo — the mesh reproduces Riot geometry):
  mesh.npz       verts float32 (N,3) world Blender units, Z-up
                 tris  uint32  (M,3)
                 nz    float32 (M,)   world-space unit-normal z (winding-corrected)
                 obj   uint32  (M,)   index into objects.json["objects"]
                 mat   uint16  (M,)   index into objects.json["materials"]
  objects.json   object names, their collection, material names (names only)
  extract-stats.json  committable numeric summary (counts, bboxes) — no geometry

Collections are kept/dropped by regex on the COLLECTION name. Defaults drop the
out-of-bounds skybox ("Vista"), alternate game-mode dressings (Haven "_NPEV2"
tutorial copy, Icebox "Snowball" holiday dressing), audio/lighting helpers.

Run:
  $BLENDER --background --factory-startup --python tools/map-mesh/blender/extract-map.py -- \
    --blend /path/Bind.blend --out-dir /path/derived/bind
"""
import bpy, sys, json, argparse, re, os, time
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out-dir", required=True)
ap.add_argument("--exclude-collection-regex",
                default=r"Vista|Skybox|_NPEV2|Snowball|Audio|Lighting",
                help="collections whose name matches are dropped entirely")
ap.add_argument("--include-hidden", action="store_true",
                help="also take objects hidden in viewport/render (default: skip)")
a = ap.parse_args(argv)
t0 = time.time()

bpy.ops.wm.open_mainfile(filepath=a.blend)
os.makedirs(a.out_dir, exist_ok=True)
excl = re.compile(a.exclude_collection_regex, re.I)
depsgraph = bpy.context.evaluated_depsgraph_get()

materials = []          # global material-name table
mat_index = {}
objects = []            # [{name, collection}]
V, T, NZ, OBJ, MAT = [], [], [], [], []
vbase = 0
coll_stats = {}
skipped_hidden = 0
skipped_excluded = 0


def mat_id(name):
    i = mat_index.get(name)
    if i is None:
        i = len(materials)
        mat_index[name] = i
        materials.append(name)
    return i


for ob in bpy.data.objects:
    if ob.type != "MESH" or ob.data is None:
        continue
    colls = [c.name for c in ob.users_collection]
    if not colls or any(excl.search(c) for c in colls):
        skipped_excluded += 1
        continue
    if not a.include_hidden and (ob.hide_viewport or ob.hide_render):
        skipped_hidden += 1
        continue
    ev = ob.evaluated_get(depsgraph)
    me = ev.to_mesh()
    nv = len(me.vertices)
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    if nv == 0 or nt == 0:
        ev.to_mesh_clear()
        continue
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(nv, 3).astype(np.float64)
    M = np.array(ob.matrix_world, dtype=np.float64)
    wco = co @ M[:3, :3].T + M[:3, 3]
    tri = np.empty(nt * 3, dtype=np.int32)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(nt, 3)
    mi = np.empty(nt, dtype=np.int32)
    me.loop_triangles.foreach_get("material_index", mi)
    slots = [(s.material.name if s.material else "<none>") for s in ob.material_slots] or ["<none>"]
    slot_to_global = np.array([mat_id(n) for n in slots], dtype=np.uint16)
    mi = np.clip(mi, 0, len(slots) - 1)
    ev.to_mesh_clear()

    # Geometric world-space normal from the (already transformed) winding. A mirrored
    # object matrix (det < 0) keeps the winding of the source mesh, so the geometric
    # normal already comes out in world space with the right handedness flipped — fix it.
    p0, p1, p2 = wco[tri[:, 0]], wco[tri[:, 1]], wco[tri[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    ln = np.linalg.norm(n, axis=1)
    ok = ln > 1e-12
    nz = np.zeros(nt, dtype=np.float32)
    nz[ok] = (n[ok, 2] / ln[ok]).astype(np.float32)
    if np.linalg.det(M[:3, :3]) < 0:
        nz = -nz

    oi = len(objects)
    objects.append({"name": ob.name, "collection": colls[0]})
    V.append(wco.astype(np.float32))
    T.append((tri[ok] + vbase).astype(np.uint32))
    NZ.append(nz[ok])
    OBJ.append(np.full(int(ok.sum()), oi, dtype=np.uint32))
    MAT.append(slot_to_global[mi[ok]])
    vbase += nv

    cs = coll_stats.setdefault(colls[0], {"objects": 0, "tris": 0,
                                          "min": [1e30] * 3, "max": [-1e30] * 3})
    cs["objects"] += 1
    cs["tris"] += int(ok.sum())
    mn, mx = wco.min(0), wco.max(0)
    for k in range(3):
        cs["min"][k] = min(cs["min"][k], float(mn[k]))
        cs["max"][k] = max(cs["max"][k], float(mx[k]))

verts = np.concatenate(V) if V else np.zeros((0, 3), np.float32)
tris = np.concatenate(T) if T else np.zeros((0, 3), np.uint32)
nz = np.concatenate(NZ) if NZ else np.zeros(0, np.float32)
obj = np.concatenate(OBJ) if OBJ else np.zeros(0, np.uint32)
mat = np.concatenate(MAT) if MAT else np.zeros(0, np.uint16)

np.savez(os.path.join(a.out_dir, "mesh.npz"), verts=verts, tris=tris, nz=nz, obj=obj, mat=mat)
with open(os.path.join(a.out_dir, "objects.json"), "w") as f:
    json.dump({"objects": objects, "materials": materials}, f)

us = bpy.context.scene.unit_settings
for cs in coll_stats.values():
    cs["min"] = [round(x, 2) for x in cs["min"]]
    cs["max"] = [round(x, 2) for x in cs["max"]]
stats = {
    "note": "World-space measurements of the playable art geometry. Counts and bounding "
            "boxes only — the geometry itself is never committed.",
    "blendFile": os.path.basename(a.blend),
    "blendBytes": os.path.getsize(a.blend),
    "blenderVersion": bpy.app.version_string,
    "sceneUnits": {"system": us.system, "scaleLength": us.scale_length},
    "excludeCollectionRegex": a.exclude_collection_regex,
    "allCollections": {c.name: len(c.objects) for c in bpy.data.collections},
    "keptCollections": coll_stats,
    "objectsKept": len(objects),
    "objectsSkippedExcludedCollection": skipped_excluded,
    "objectsSkippedHidden": skipped_hidden,
    "verts": int(verts.shape[0]),
    "tris": int(tris.shape[0]),
    "triangleClass": {
        "floor(nz>=cos45)": int((nz >= 0.7071).sum()),
        "wall(|nz|<=cos70)": int((np.abs(nz) <= 0.342).sum()),
        "other": int(((nz < 0.7071) & (np.abs(nz) > 0.342)).sum()),
    },
    "bboxBlenderUnits": {"min": [round(float(x), 2) for x in verts.min(0)],
                         "max": [round(float(x), 2) for x in verts.max(0)]} if len(verts) else None,
    "materials": len(materials),
    "seconds": round(time.time() - t0, 1),
}
with open(os.path.join(a.out_dir, "extract-stats.json"), "w") as f:
    json.dump(stats, f, indent=2)
print(f"[extract-map] {os.path.basename(a.blend)}: objects={len(objects)} verts={verts.shape[0]} "
      f"tris={tris.shape[0]} hidden-skipped={skipped_hidden} excluded={skipped_excluded} "
      f"({stats['seconds']} s)")
