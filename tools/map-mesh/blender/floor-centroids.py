#!/usr/bin/env python3
"""PV-5: area-weighted centroid of FLOOR (walkable, up-facing) triangles per
playable collection. Floor centroids localise each region's ground plane far
better than whole-mesh vertex centroids (which are pulled by tall walls), giving
cleaner anchors for the Blender->game coordinate fit.
Run: blender --background --factory-startup --python floor-centroids.py -- --blend X --out Y
"""
import bpy, sys, json, math, argparse
from collections import defaultdict

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--walkable-slope-deg", type=float, default=35.0)
ap.add_argument("--zmax", type=float, default=30.0,
                help="ignore floor tris above this world z (m); drops rooftops/catwalks")
a = ap.parse_args(argv)

bpy.ops.wm.open_mainfile(filepath=a.blend)
dg = bpy.context.evaluated_depsgraph_get()
cos_walk = math.cos(math.radians(a.walkable_slope_deg))

def primary(o):
    for c in o.users_collection:
        if not c.name.startswith("Ascent_Art_Vista"):
            return c.name
    return o.users_collection[0].name if o.users_collection else "<none>"

# accumulate area-weighted centroid of floor tris: [sx,sy,sz,area,count]
acc = defaultdict(lambda:[0.0,0.0,0.0,0.0,0])

for o in bpy.data.objects:
    if o.type!="MESH": continue
    if any(c.name.startswith("Ascent_Art_Vista") for c in o.users_collection): continue
    cn = primary(o)
    eo = o.evaluated_get(dg)
    me = eo.to_mesh()
    mw = o.matrix_world
    nmat = mw.to_3x3().inverted_safe().transposed()
    me.calc_loop_triangles()
    wv = [mw @ v.co for v in me.vertices]
    for lt in me.loop_triangles:
        wn = (nmat @ lt.normal).normalized()
        if wn.z < cos_walk:
            continue
        i0,i1,i2 = lt.vertices
        p0,p1,p2 = wv[i0],wv[i1],wv[i2]
        cz = (p0.z+p1.z+p2.z)/3.0
        if cz > a.zmax:
            continue
        # triangle area
        area = (p1-p0).cross(p2-p0).length*0.5
        cx=(p0.x+p1.x+p2.x)/3.0; cy=(p0.y+p1.y+p2.y)/3.0
        s=acc[cn]
        s[0]+=cx*area; s[1]+=cy*area; s[2]+=cz*area; s[3]+=area; s[4]+=1
    eo.to_mesh_clear()

out={}
for cn,s in acc.items():
    if s[3]>0:
        out[cn]={"floorCentroidWorld":[round(s[0]/s[3],2),round(s[1]/s[3],2),round(s[2]/s[3],2)],
                 "floorArea_m2":round(s[3],1),"floorTris":s[4]}
with open(a.out,"w") as f: json.dump(out,f,indent=2)
print("[floor]", json.dumps(out))
