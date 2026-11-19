#!/usr/bin/env python3
"""
PROJECT V — independent orientation check for the Blender->game transform.

The scenes name their collections by region (…_AtkSpawn, …_DefSpawn, …_ASite, …). For each
map, compare the centre of those collections' bounding boxes (from the committed
mesh/<map>-extract-stats.json) with the matching valorant-api callout under the chosen
transform and under the three other axis flips. Region-level only (a bounding-box centre is
not a callout), so the absolute distance is tens of metres — what matters is that the chosen
orientation wins clearly on every map. Stdlib only; no geometry needed.

  python3 -I tools/map-mesh/align/landmark_check.py > datasets/spatial/transform-landmark-check.json
"""
import json, math, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
MAPS = ["abyss", "bind", "breeze", "fracture", "haven", "icebox", "lotus", "pearl", "split", "sunset"]
PATTERN = {"attacker-spawn": r"(AtkSpawn|Art_Atk)$", "defender-spawn": r"(DefSpawn|Art_Def)$",
           "a-site": r"(_ASite|Art_A|Asite)$", "b-site": r"(_BSite|Art_B|BSite)$", "c-site": r"(_CSite|Art_C)$"}
FLIPS = {"chosen (x,-y)": (1, -1), "(x,+y)": (1, 1), "(-x,-y)": (-1, -1), "(-x,+y)": (-1, 1)}

out = {"note": __doc__.strip().split("\n\n")[1].replace("\n", " "), "unit": "metres (mean over landmarks)", "maps": {}}
for m in MAPS:
    d = os.path.join(ROOT, "datasets", "spatial", m)
    st = json.load(open(os.path.join(d, "mesh", f"{m}-extract-stats.json")))
    zp = {z["id"]: z["position"] for z in json.load(open(os.path.join(d, f"{m}.navgraph.json")))["zones"]}
    rows = []
    for zid, pat in PATTERN.items():
        hit = [(n, c) for n, c in st["keptCollections"].items() if re.search(pat, n)]
        if zid not in zp or not hit:
            continue
        name, c = hit[0]
        cx, cy = (c["min"][0] + c["max"][0]) / 2, (c["min"][1] + c["max"][1]) / 2
        rows.append({"zone": zid, "collection": name,
                     **{k: round(math.hypot(sx * cx * 100 - zp[zid]["x"], sy * cy * 100 - zp[zid]["y"]) / 100, 1)
                        for k, (sx, sy) in FLIPS.items()}})
    out["maps"][m] = {"landmarks": rows,
                      "mean": {k: round(sum(r[k] for r in rows) / len(rows), 1) for k in FLIPS}}
json.dump(out, sys.stdout, indent=1)
print()
