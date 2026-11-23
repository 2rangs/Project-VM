#!/usr/bin/env python3
"""
PROJECT V — the gameplay objects of one map as points and types (no surfaces).

  datasets/spatial/<map>/<map>.objects.json

  drops        every one-way drop of the navigation roadmap: the two roadmap points, the fall
               height, the zones on each side.
  traversals   ropes, ziplines, teleporters and jumps: one entry per roadmap link, with the two
               roadmap points it joins, its travel time, where its sound comes from and the scene
               objects it was measured on.
  doors        switch / rotating / exit doors, and
  breakables   breakable doors, walls and props: a position, the zone on each side, the default
               state where known.
  notLocated   authored mechanics whose object could not be found in the scene, with the reason.

Pure JSON -> JSON. Inputs, all committed:
  <map>.nav.json          the roadmap (drops, links, node positions and zones)
  <map>.navgraph.json     zone ids
  <map>.authoring.json    "traversals" (measured end points), "objects" (doors and breakables,
                          measured positions), "objectsNotLocated"

A position in the authoring file is a measurement made on the extracted scene (object bounding
boxes and the walk grid, see tools/map-mesh/README.md); this script does not read the scene. It
adds what follows from the roadmap: the node a traversal end snapped to, and the zone of the
nearest roadmap point on each side of a door.

  python3 -I tools/map-mesh/pipeline/objects_map.py <map> [<map> ...] | --all
"""
import json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
MAPS = ["abyss", "ascent", "bind", "breeze", "fracture", "haven", "icebox", "lotus", "pearl", "split", "sunset"]
SIDE_STEP = 150.0        # how far either side of a door's plane a roadmap point is looked for (uu)
SIDE_REACH = 500.0       # ... and how far from that spot it may be (uu)
SIDE_HEIGHT = 250.0      # ... and how far above or below the door's floor (uu)


def pos(n):
    return {"x": n[0], "y": n[1], "z": n[2]}


def build(mp):
    d = os.path.join(ROOT, "datasets", "spatial", mp)
    nav = json.load(open(os.path.join(d, f"{mp}.nav.json")))
    apath = os.path.join(d, f"{mp}.authoring.json")
    authoring = json.load(open(apath)) if os.path.exists(apath) else {}
    nodes, zones = nav["nodes"], nav["zones"]
    zone = lambda i: zones[nodes[i][4]] if nodes[i][4] >= 0 else None

    drops = []
    for a, b in nav["drops"]:
        drops.append({"from": pos(nodes[a]), "to": pos(nodes[b]),
                      "fallMeters": round((nodes[a][2] - nodes[b][2]) / 100.0, 2),
                      "fromZone": zone(a), "toZone": zone(b), "fromNode": a, "toNode": b})

    authored = authoring.get("traversals", [])
    traversals = []
    for k, l in enumerate(nav["links"]):
        a, b = nodes[l["from"]], nodes[l["to"]]
        e = {"kind": l["kind"], "bidirectional": l["bidirectional"], "travelTimeMs": l["travelTimeMs"],
             "from": pos(a), "to": pos(b), "fromNode": l["from"], "toNode": l["to"],
             "zones": [zone(l["from"]), zone(l["to"])],
             "lengthMeters": round(math.dist(a[:3], b[:3]) / 100.0, 2)}
        if k < len(authored):          # nav_map.py writes the measured traversals first, in order
            t = authored[k]
            e = {"id": t["id"], "name": t.get("name", t["id"]), **e}
            if t["kind"] == "rope":
                lo, hi = (a, b) if a[2] <= b[2] else (b, a)
                e["bottom"], e["top"] = pos(lo), pos(hi)
                e["ascending"] = a[2] <= b[2]          # travelling from -> to goes up
            e["soundSource"] = t.get("soundSource", pos(a))
            e["soundSourceExit"] = t.get("soundSourceExit", pos(b))
            e["objectNames"] = t.get("objectNames", [])
            for key in ("speedMetersPerSec", "basis", "note"):
                if key in t:
                    e[key] = t[key]
            e["provenance"] = t["provenance"]
        else:
            e = {"id": f"link-{k}", **e, "soundSource": pos(a), "soundSourceExit": pos(b), "objectNames": [],
                 "provenance": "manual-approx (a link between two zone anchors: no end point was measured)"}
        e["soundRadiusUu"], e["soundVerified"] = None, False     # not measured; filled by the engine side
        traversals.append(e)

    def side_zone(o, sign):
        nx, ny = o["normal"]
        px, py, pz = o["position"]["x"] + sign * nx * SIDE_STEP, o["position"]["y"] + sign * ny * SIDE_STEP, o["position"]["z"]
        best = None
        for n in nodes:
            if abs(n[2] - pz) > SIDE_HEIGHT or ((n[0] - o["position"]["x"]) * nx + (n[1] - o["position"]["y"]) * ny) * sign <= 0:
                continue
            dd = math.hypot(n[0] - px, n[1] - py)
            if dd <= SIDE_REACH and (best is None or dd < best[0]):
                best = (dd, zones[n[4]] if n[4] >= 0 else None)
        return best[1] if best else None

    doors, breakables = [], []
    for o in authoring.get("objects", []):
        e = {"id": o["id"], "name": o["name"], "kind": o["kind"], "position": o["position"]}
        if "normal" in o:
            e["zones"] = [side_zone(o, -1), side_zone(o, +1)]
        else:
            n = min(nodes, key=lambda n: math.dist(n[:3], (o["position"]["x"], o["position"]["y"], o["position"]["z"])))
            e["zones"] = [zones[n[4]] if n[4] >= 0 else None]
        e["defaultState"] = o.get("defaultState", "unknown")
        for key in ("gates", "switch", "note", "basis"):
            if key in o:
                e[key] = o[key]
        e["objectNames"] = o.get("objectNames", [])
        e["provenance"] = o["provenance"]
        (breakables if o["kind"].startswith("breakable") else doors).append(e)

    xs, ys, zs = ([n[i] for n in nodes] for i in range(3))
    out = {
        "mapId": mp, "schemaVersion": "1.0.0",
        "note": "Gameplay objects as points and types, game uu (100 uu = 1 m); no surfaces. drops: the roadmap's "
                "one-way drops (from/to are roadmap nodes of <map>.nav.json; fallMeters = height lost). traversals: "
                "one per roadmap link, in the roadmap's link order (from/to are the roadmap nodes the link joins; "
                "ropes also name bottom/top and whether from->to ascends; soundSource / soundSourceExit are the "
                "points its sound is emitted from at the entry and the exit, soundRadiusUu is null and soundVerified "
                "false until a value is measured). doors / breakables: position on the floor in the opening, zones = the zone of the "
                "nearest roadmap point on each side of the opening (one zone for a prop; gates, where present, is the zone-graph "
                "edge the door is attached to), defaultState "
                "open/closed/intact/unknown. notLocated: mechanics known for the map that no scene object or "
                "floor measurement could place. ultOrbs: orb positions, empty where the scene has no orb object. Every entry states its own provenance.",
        "provenance": "measured-on-mesh (positions: scene object bounding boxes and walk-grid cells; drops and the "
                      "zones: the navigation roadmap); manual-approx (travel times and speeds, default states, and "
                      "the reading of which scene object is which gameplay object)",
        "roadmapBounds": {"min": {"x": min(xs), "y": min(ys), "z": min(zs)}, "max": {"x": max(xs), "y": max(ys), "z": max(zs)}},
        "counts": {"drops": len(drops), "traversals": len(traversals), "doors": len(doors), "breakables": len(breakables),
                   "notLocated": len(authoring.get("objectsNotLocated", []))},
        "drops": drops, "traversals": traversals, "doors": doors, "breakables": breakables,
        "ultOrbs": authoring.get("ultOrbs", []),
        "notLocated": authoring.get("objectsNotLocated", []),
        "generatedBy": "tools/map-mesh/pipeline/objects_map.py",
    }
    path = os.path.join(d, f"{mp}.objects.json")
    body = json.dumps(out, indent=1, ensure_ascii=False)
    # one drop per line: the list is long and numeric
    head, tail = body.split('"drops": [', 1)
    rest = tail.split('\n "traversals"', 1)[1]
    lines = ",\n".join("  " + json.dumps(x, separators=(",", ":")) for x in drops)
    body = head + '"drops": [\n' + lines + ("\n " if drops else "") + '],\n "traversals"' + rest
    json.loads(body)
    open(path, "w").write(body + "\n")
    print(f"[objects] {mp}: drops={len(drops)} traversals={len(traversals)} doors={len(doors)} "
          f"breakables={len(breakables)} notLocated={out['counts']['notLocated']} size={os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    args = sys.argv[1:]
    for m in (MAPS if args == ["--all"] else args):
        build(m)
