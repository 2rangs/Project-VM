#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh
Extract a collision/navmesh input mesh from the Ascent art .blend, in world
space (Unreal units), excluding the out-of-bounds Vista skybox collections.

Outputs (paths given on CLI; the mesh is a DERIVATIVE of user-provided art and
must stay out of git):
  --mesh-out  <file.bin>  compact binary: magic, nVerts, nTris, then
                          float32[nVerts*3] world positions (x,y,z uu),
                          then uint32[nTris*3] triangle indices.
  --stats-out <file.json> committable stats: per-collection world centroid +
                          bbox, floor/wall/steep triangle counts, playable bbox.
                          Contains only measurements, not geometry.

Walkable classification uses the world-space triangle normal:
  floor  : nz >= cos(walkableSlopeDeg)      (default 45°)
  wall   : |nz| <= cos(70°)                  (near-vertical)
  steep  : everything between

Run:
  /opt/blender-4.2/blender --background --factory-startup \
    --python tools/map-mesh/blender/extract-collision.py -- \
    --blend "<ascent.blend>" --mesh-out /tmp/ascent_playable.bin \
    --stats-out datasets/spatial/ascent/mesh/ascent-extract-stats.json
"""
import bpy, bmesh, sys, json, math, struct, argparse, re
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--mesh-out", required=True)
ap.add_argument("--stats-out", required=True)
ap.add_argument("--walkable-slope-deg", type=float, default=45.0)
ap.add_argument("--exclude-prefix", default="Ascent_Art_Vista",
                help="collections whose name starts with this are excluded")
ap.add_argument("--floor-only", action="store_true",
                help="emit only up-facing (walkable-slope) triangles -> cleaner "
                     "walkable surface for Recast (walls dropped)")
ap.add_argument("--walls-only", action="store_true",
                help="emit only near-vertical (wall) triangles -> occluder mesh "
                     "for line-of-sight raycasting")
ap.add_argument("--zmin", type=float, default=-1e30,
                help="drop triangles whose centroid world z (m) is below this")
ap.add_argument("--zmax", type=float, default=1e30,
                help="drop triangles whose centroid world z (m) is above this "
                     "(isolates the ground band from catwalks/rooftops)")
ap.add_argument("--drop-name-regex", default="",
                help="skip objects whose name matches this regex (e.g. foliage)")
a = ap.parse_args(argv)

bpy.ops.wm.open_mainfile(filepath=a.blend)
depsgraph = bpy.context.evaluated_depsgraph_get()

def excluded(obj):
    for c in obj.users_collection:
        if c.name.startswith(a.exclude_prefix):
            return True
    return False

# Which collection to attribute an object to (first non-Vista collection).
def primary_coll(obj):
    for c in obj.users_collection:
        if not c.name.startswith(a.exclude_prefix):
            return c.name
    return obj.users_collection[0].name if obj.users_collection else "<none>"

cos_walk = math.cos(math.radians(a.walkable_slope_deg))
cos_wall = math.cos(math.radians(70.0))

verts = []          # flat [x,y,z, ...]
tris = []           # flat [i,j,k, ...]
floor_ct = wall_ct = steep_ct = 0

# per-collection accumulation: [sumx,sumy,sumz,count, minx,miny,minz, maxx,maxy,maxz]
from collections import defaultdict
coll_acc = defaultdict(lambda: [0.0,0.0,0.0,0, 1e30,1e30,1e30, -1e30,-1e30,-1e30])

pmin = [1e30,1e30,1e30]
pmax = [-1e30,-1e30,-1e30]

drop_rx = re.compile(a.drop_name_regex, re.I) if a.drop_name_regex else None
need_centroid_z = (a.zmin > -1e29) or (a.zmax < 1e29)

n_obj = 0
for obj in bpy.data.objects:
    if obj.type != "MESH" or excluded(obj):
        continue
    if drop_rx and drop_rx.search(obj.name):
        continue
    n_obj += 1
    cname = primary_coll(obj)
    acc = coll_acc[cname]
    # Evaluate modifiers and triangulate into a temp mesh in world space.
    eval_obj = obj.evaluated_get(depsgraph)
    me = eval_obj.to_mesh()
    mw = obj.matrix_world
    base = len(verts)//3
    # world vertices
    for v in me.vertices:
        wco = mw @ v.co
        verts.extend((wco.x, wco.y, wco.z))
        acc[0]+=wco.x; acc[1]+=wco.y; acc[2]+=wco.z; acc[3]+=1
        if wco.x<acc[4]:acc[4]=wco.x
        if wco.y<acc[5]:acc[5]=wco.y
        if wco.z<acc[6]:acc[6]=wco.z
        if wco.x>acc[7]:acc[7]=wco.x
        if wco.y>acc[8]:acc[8]=wco.y
        if wco.z>acc[9]:acc[9]=wco.z
        if wco.x<pmin[0]:pmin[0]=wco.x
        if wco.y<pmin[1]:pmin[1]=wco.y
        if wco.z<pmin[2]:pmin[2]=wco.z
        if wco.x>pmax[0]:pmax[0]=wco.x
        if wco.y>pmax[1]:pmax[1]=wco.y
        if wco.z>pmax[2]:pmax[2]=wco.z
    # triangulate faces
    me.calc_loop_triangles()
    nmat = mw.to_3x3().inverted_safe().transposed()
    for lt in me.loop_triangles:
        i0,i1,i2 = lt.vertices
        wn = (nmat @ lt.normal).normalized()
        nz = wn.z
        is_floor = nz >= cos_walk
        is_wall = abs(nz) <= cos_wall
        if is_floor:
            floor_ct += 1
        elif is_wall:
            wall_ct += 1
        else:
            steep_ct += 1
        if a.floor_only and not is_floor:
            continue
        if a.walls_only and not is_wall:
            continue
        if need_centroid_z:
            cz = (verts[(base+i0)*3+2] + verts[(base+i1)*3+2] + verts[(base+i2)*3+2]) / 3.0
            if cz < a.zmin or cz > a.zmax:
                continue
        tris.extend((base+i0, base+i1, base+i2))
    eval_obj.to_mesh_clear()

nVerts = len(verts)//3
nTris = len(tris)//3
print(f"[extract] playable objects={n_obj} verts={nVerts} tris={nTris} "
      f"floor={floor_ct} wall={wall_ct} steep={steep_ct}")

# Write compact binary mesh.
with open(a.mesh_out, "wb") as f:
    f.write(b"PVMESH01")
    f.write(struct.pack("<II", nVerts, nTris))
    f.write(struct.pack(f"<{len(verts)}f", *verts))
    f.write(struct.pack(f"<{len(tris)}I", *tris))
print(f"[extract] wrote mesh {a.mesh_out}")

collections = {}
for cname, acc in coll_acc.items():
    if acc[3] == 0:
        continue
    collections[cname] = {
        "vertexCount": acc[3],
        "centroidWorld": [round(acc[0]/acc[3],2), round(acc[1]/acc[3],2), round(acc[2]/acc[3],2)],
        "bboxMin": [round(acc[4],2), round(acc[5],2), round(acc[6],2)],
        "bboxMax": [round(acc[7],2), round(acc[8],2), round(acc[9],2)],
    }

stats = {
    "blend": a.blend,
    "note": "World-space measurements of the playable Ascent art geometry (Vista skybox excluded). Coordinates are Unreal units (1 BU = 1 uu). Geometry itself NOT stored here.",
    "excludePrefix": a.exclude_prefix,
    "walkableSlopeDeg": a.walkable_slope_deg,
    "playableObjects": n_obj,
    "playableVerts": nVerts,
    "playableTris": nTris,
    "triangleClass": {"floor": floor_ct, "wall": wall_ct, "steep": steep_ct},
    "playableBBoxWorld": {
        "min": [round(x,2) for x in pmin],
        "max": [round(x,2) for x in pmax],
        "sizeUU": [round(pmax[i]-pmin[i],2) for i in range(3)],
    },
    "collectionsWorld": collections,
}
with open(a.stats_out, "w") as f:
    json.dump(stats, f, indent=2)
print(f"[extract] wrote stats {a.stats_out}")
