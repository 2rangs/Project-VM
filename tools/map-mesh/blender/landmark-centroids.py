#!/usr/bin/env python3
"""PV-5: world-space centroids of named landmark object groups, as anchors for
the Blender->game coordinate fit. Matches objects by name prefix (case-insens)
and averages their world vertex positions.
Run: blender --background --factory-startup --python landmark-centroids.py -- --blend X --out Y
"""
import bpy, sys, json, re, argparse
from collections import defaultdict
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args(argv)

# prefix (regex, matched at name start, case-insensitive) -> landmark label
GROUPS = {
    r"ABombsite":   "A-bombsite",
    r"ASite":       "A-site-obj",
    r"BBombsite":   "B-bombsite",
    r"BSite":       "B-site-obj",
    r"AtkSpawn":    "Atk-spawn",
    r"DefSpawn":    "Def-spawn",
    r"AtkTower":    "Atk-tower",
    r"MidTop|Mid_Top": "Mid-top",
    r"MidCourt":    "Mid-courtyard",
}
compiled = [(re.compile("^"+p, re.I), lbl) for p, lbl in GROUPS.items()]

bpy.ops.wm.open_mainfile(filepath=a.blend)
depsgraph = bpy.context.evaluated_depsgraph_get()

acc = defaultdict(lambda: [0.0,0.0,0.0,0])
allprefix = defaultdict(lambda: [0.0,0.0,0.0,0])

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    # track every distinct alpha prefix token too (for discovery)
    tok = re.match(r"[A-Za-z]+", obj.name)
    label = None
    for rx, lbl in compiled:
        if rx.match(obj.name):
            label = lbl
            break
    if label is None:
        continue
    eval_obj = obj.evaluated_get(depsgraph)
    me = eval_obj.to_mesh()
    mw = obj.matrix_world
    s = acc[label]
    for v in me.vertices:
        w = mw @ v.co
        s[0]+=w.x; s[1]+=w.y; s[2]+=w.z; s[3]+=1
    eval_obj.to_mesh_clear()

out = {}
for lbl, s in acc.items():
    if s[3]:
        out[lbl] = {"centroidWorld":[round(s[0]/s[3],2),round(s[1]/s[3],2),round(s[2]/s[3],2)],
                    "verts": s[3]}
with open(a.out,"w") as f:
    json.dump(out, f, indent=2)
print("[landmark]", json.dumps(out))
