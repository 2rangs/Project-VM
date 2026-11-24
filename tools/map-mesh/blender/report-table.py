#!/usr/bin/env python3
"""Markdown calibration table from ~/ProjectV-assets/maps/glb/<map>.report.json (run with plain python3)."""
import json, os, sys
d = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/ProjectV-assets/maps/glb")
print("| map | tris | MB | nodes on floor ≤15 uu | no floor under | vertical p50 / p95 / max (uu) | horizontal p95 / max (uu) | sight: visible / blocked agree | offset uu | zones on floor |")
print("|---|---|---|---|---|---|---|---|---|---|")
for m in "abyss ascent bind breeze fracture haven icebox lotus pearl split sunset".split():
    p = os.path.join(d, f"{m}.report.json")
    if not os.path.exists(p):
        print(f"| {m} | – | – | – | – | – | – | – | – | – |"); continue
    r = json.load(open(p)); v = r["verify"]; c = r["calibration"]["chosen"]; s = v.get("sight", {})
    f = lambda x: "–" if x is None else f"{x:.0f}"
    vv, hh = v["verticalUU"], v["horizontalUU"]
    print(f"| {m} | {r['outTris']//1000}k | {r['outBytes']/1e6:.1f} | {v['nodesOnFloorWithin15uu']}/{v['nodes']} ({100*v['nodesOnFloorWithin15uu']/v['nodes']:.0f} %) | {v['nodesNoFloorUnder']} | "
          f"{vv['median']:.1f} / {vv['p95']:.1f} / {vv['max']:.0f} | {f(hh['p95'])} / {f(hh['max'])} | "
          f"{s.get('visiblePairs',{}).get('rate','–')} / {s.get('blockedPairs',{}).get('rate','–')} | {c['offsetUU']} | {c['zonesOnAFloor']}/{c['zonesTotal']} |")
