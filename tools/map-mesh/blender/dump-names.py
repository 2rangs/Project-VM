#!/usr/bin/env python3
"""PV-5: dump object/collection/empty names + token frequency from a .blend,
to look for semantic markers (spawn, site, plant, spike, bomb, callout).
Run: blender --background --factory-startup --python dump-names.py -- --blend X --out Y
"""
import bpy, sys, json, re, argparse
from collections import Counter
from mathutils import Vector

argv = sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--blend", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args(argv)

bpy.ops.wm.open_mainfile(filepath=a.blend)

tokens = Counter()
empties = []
interesting = []
KEYS = re.compile(r"spawn|site|plant|spike|bomb|callout|collision|collider|blocon|"
                  r"nav|floor|ground|wall|teleport|rope|door|ramp|stair", re.I)

for o in bpy.data.objects:
    base = re.split(r"[._0-9]", o.name)[0].lower()
    tokens[base] += 1
    if o.type == "EMPTY":
        empties.append({"name": o.name, "loc": [round(float(x),1) for x in o.location]})
    if KEYS.search(o.name):
        interesting.append({"name": o.name, "type": o.type,
                            "loc": [round(float(x),1) for x in o.location]})

out = {
    "topTokens": tokens.most_common(60),
    "emptyCount": len(empties),
    "emptiesSample": empties[:60],
    "interestingNameMatches": interesting[:200],
    "interestingCount": len(interesting),
}
with open(a.out, "w") as f:
    json.dump(out, f, indent=2)
print(f"[names] empties={len(empties)} interesting={len(interesting)} -> {a.out}")
