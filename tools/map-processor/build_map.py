#!/usr/bin/env python3
"""
PROJECT V — build datasets/spatial/<map>/<map>.navgraph.json + coordinate-system.json.

Pure JSON -> JSON (stdlib only, no geometry needed): anyone can rebuild a navgraph after
editing an authoring file. Inputs, all committed under datasets/spatial/<map>/:
  valorant-api-<map>.raw.json                 callouts + minimap transform (fetched)
  mesh/<map>-grid.json                        walk distances + zone adjacency (measured on mesh)
  mesh/<map>-los-matrix.json                  zone-to-zone visibility (measured on mesh)
  <map>.authoring.json  (optional)            hand-authored extras: special edges, doors, notes

Every value in the output carries one of three provenance classes:
  measured-on-mesh   read off the map geometry by tools/map-mesh/pipeline/measure_map.py
  derived-by-rule    computed from measured values by a rule documented in docs/research/MAPS_DATA.md
  manual-approx      hand-authored or a flagged fallback (e.g. a straight-line lower bound)

Usage: python3 -I tools/map-processor/build_map.py <map> [<map> ...] | --all
"""
import heapq, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import mapzones  # noqa: E402
import apply_routes  # noqa: E402

MAPS = ["abyss", "bind", "breeze", "fracture", "haven", "icebox", "lotus", "pearl", "split", "sunset"]
FETCHED = "2026-11-19"

# Same movement model as Ascent's dataset.
MOVEMENT = {
    "unitsPerMeter": 100, "runSpeedMetersPerSec": 6.75, "walkSpeedMetersPerSec": 3.4,
    "note": "Same model as Ascent: run 6.75 m/s documented base speed, walk ~3.4 m/s approximate (manual-approx).",
}
RUN, WALK = MOVEMENT["runSpeedMetersPerSec"], MOVEMENT["walkSpeedMetersPerSec"]

# ---- rules (documented in docs/research/MAPS_DATA.md §3) ----
EDGE_STRETCH = 1.10        # keep a walk-adjacent pair unless the graph already connects it within 10 %
DROP_GAIN = 1.25           # add a one-way drop when it beats the walkable route by >= 25 %
SIGHT_MIN = 0.02           # a sightline exists when >= 2 % of eye-point pairs see each other
SIGHT_OPEN = 0.60          # ... and is NOT smokeable when >= 60 % do (one smoke cannot cut it)
LANE_TYPES = {"main", "mid", "site", "lobby", "spawn"}     # "direct" = lane-to-lane, else "angle"
PLANT_HALF = 600.0         # plant polygon: callout-centred 12 m square (uu)


def sound_attenuation(distance_m, door):
    """Reverse-fitted to Ascent's six hand-set links (reproduces all six)."""
    if door or distance_m > 50:
        return 0.4
    return 0.2 if distance_m <= 25 else 0.3


def dist3(a, b):
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2)


def graph_dist(adj, src, dst):
    best = {src: 0.0}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            return d
        if d > best.get(u, math.inf):
            continue
        for v, w in adj.get(u, ()):
            nd = d + w
            if nd < best.get(v, math.inf):
                best[v] = nd
                heapq.heappush(pq, (nd, v))
    return math.inf


def reach_set(adj, src, blocked=()):
    seen, stack = {src}, [src]
    while stack:
        u = stack.pop()
        if u in blocked and u != src:
            continue
        for v, _ in adj.get(u, ()):
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return seen


def mk_edge(a, b, meters, bidirectional, provenance, kind, door=None, run_ms=None, note=None):
    run = run_ms if run_ms is not None else round(meters / RUN * 1000)
    e = {
        "from": a, "to": b, "bidirectional": bidirectional, "door": door, "destructible": None,
        "distanceUnits": round(meters * 100), "distanceMeters": round(meters, 2),
        "runTimeMs": run,
        "walkTimeMs": run if run_ms is not None else round(meters / WALK * 1000),
        "provenance": provenance, "kind": kind,
    }
    if note:
        e["note"] = note
    return e


def build(mp):
    d = os.path.join(ROOT, "datasets", "spatial", mp)
    raw = json.load(open(os.path.join(d, f"valorant-api-{mp}.raw.json")))
    grid = json.load(open(os.path.join(d, "mesh", f"{mp}-grid.json")))
    los = json.load(open(os.path.join(d, "mesh", f"{mp}-los-matrix.json")))
    apath = os.path.join(d, f"{mp}.authoring.json")
    authoring = json.load(open(apath)) if os.path.exists(apath) else {}

    zones = mapzones.zones_from_api(raw, authoring.get("zoneOverrides"))
    by_id = {z["id"]: z for z in zones}
    snaps = grid["zoneSnaps"]
    callout_pos = {z["id"]: dict(z["position"]) for z in zones}     # before z is snapped to the floor
    for z in zones:
        s = snaps.get(z["id"], {})
        if s.get("onMesh") and s.get("anchorAuthored"):
            z["position"]["z"] = s["floorZ_uu"]
            z["positionProvenance"] = ("x,y: valorant-api callout; z: measured-on-mesh (floor at the zone's authored anchor — "
                                       "the callout is not on its zone's floor, see zoneAnchors in the authoring file)")
        elif s.get("onMesh"):
            z["position"]["z"] = s["floorZ_uu"]
            z["positionProvenance"] = "x,y: valorant-api callout; z: measured-on-mesh (floor under the callout)"
        else:
            z["positionProvenance"] = "valorant-api callout (not snapped: no walkable floor found near it)"
    ids = [z["id"] for z in zones]

    edges = []
    adj = {i: [] for i in ids}            # directed, weights in metres

    def add(e):
        edges.append(e)
        adj[e["from"]].append((e["to"], e["distanceMeters"]))
        if e["bidirectional"]:
            adj[e["to"]].append((e["from"], e["distanceMeters"]))

    # 1. walk edges: zones whose cells touch on foot, shortest first; skip what the graph already has
    for w in sorted(grid["walkAdjacency"], key=lambda w: w["pathWithinTheTwoCells_m"]):
        a, b, L = w["a"], w["b"], w["pathWithinTheTwoCells_m"]
        if graph_dist(adj, a, b) <= EDGE_STRETCH * L and graph_dist(adj, b, a) <= EDGE_STRETCH * L:
            continue
        add(mk_edge(a, b, L, True, "measured-on-mesh", "walk"))
    # 2. one-way drops that beat the walkable route
    for w in sorted(grid["dropAdjacency"], key=lambda w: w["pathWithinTheTwoCells_m"]):
        a, b, L = w["from"], w["to"], w["pathWithinTheTwoCells_m"]
        if graph_dist(adj, a, b) <= DROP_GAIN * L:
            continue
        add(mk_edge(a, b, L, False, "measured-on-mesh", "drop",
                    note="one-way: a drop down from the higher zone"))
    # 3. authored special edges (teleporters, ziplines, ropes, known connections)
    for s in authoring.get("specialEdges", []):
        a, b = s["from"], s["to"]
        if a not in by_id or b not in by_id:
            raise ValueError(f"{mp}: special edge references unknown zone {a} / {b}")
        meters = dist3(by_id[a]["position"], by_id[b]["position"]) / 100.0
        add(mk_edge(a, b, meters, s.get("bidirectional", True),
                    "manual-approx (" + s.get("basis", "authored; straight-line length") + ")",
                    s["kind"], run_ms=s.get("travelTimeMs"), note=s.get("note")))
    # 4. doors on existing edges
    doors_missing = []
    for dr in authoring.get("doors", []):
        hit = [e for e in edges if {e["from"], e["to"]} == {dr["a"], dr["b"]}]
        if not hit:
            doors_missing.append(dr)
        for e in hit:
            e["door"] = {"name": dr["name"], "defaultOpen": dr["defaultOpen"],
                         "destructibleSwitch": dr["destructibleSwitch"]}
            e["doorProvenance"] = "manual-approx"
    # 5. fallback: any zone the mesh could not connect gets a straight-line link to its nearest
    #    connected neighbour, flagged as an approximate lower bound.
    spawns = [i for i in ("attacker-spawn", "defender-spawn") if i in by_id]
    fallback = []
    for _ in range(len(ids)):
        ok = set(ids)
        for sp in spawns:
            ok &= reach_set(adj, sp, blocked=set(spawns))
        bad = [i for i in ids if i not in ok]
        if not bad:
            break
        pool = [g for g in ok if g not in spawns] or sorted(ok) or spawns[:1]
        m, b, g = min((dist3(by_id[b]["position"], by_id[g]["position"]), b, g) for b in bad for g in pool)
        # two callouts stacked on different floors can snap to the same cell: fall back to the
        # raw callout separation, and never below 1 m
        m = max(m, dist3(callout_pos[b], callout_pos[g]), 100.0)
        add(mk_edge(g, b, m / 100.0, True,
                    "manual-approx (straight-line lower bound; the walk grid did not connect this zone)",
                    "approx-link"))
        fallback.append(f"{g}<->{b}")

    # ---- walkable routes (tools/map-mesh/pipeline/route_map.py), when they have been measured:
    # edge lengths/times become the route's, so this runs before anything derived from them
    route_summary = None
    rpath = os.path.join(d, "mesh", f"{mp}-routes.json")
    if os.path.exists(rpath):
        part = apply_routes.apply({"zones": zones, "edges": edges, "movement": MOVEMENT}, json.load(open(rpath)))
        route_summary = part["routes"]
    fallback = [f"{e['from']}<->{e['to']}" for e in edges if e["kind"] == "approx-link"]

    # ---- sightlines: measured visibility, typed/flagged by rule
    sightlines = []
    vis = los["visibility"]
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            v = vis.get(a, {}).get(b)
            if v is None or v < SIGHT_MIN:
                continue
            lane = by_id[a]["zoneType"] in LANE_TYPES and by_id[b]["zoneType"] in LANE_TYPES
            sightlines.append({"a": a, "b": b, "type": "direct" if lane else "angle",
                               "smokeable": v < SIGHT_OPEN, "visibility": v,
                               "provenance": "measured-on-mesh (visibility); derived-by-rule (type, smokeable)"})
    unmeasured = [i for i in ids if not snaps.get(i, {}).get("onMesh")]

    # ---- sound: along every travel connection, attenuation by rule
    sound, seen = [], set()
    for e in edges:
        if e["kind"] == "teleporter":
            continue
        key = tuple(sorted((e["from"], e["to"])))
        if key in seen:
            continue
        seen.add(key)
        sound.append({"a": key[0], "b": key[1],
                      "attenuation": sound_attenuation(e["distanceMeters"], e["door"] is not None),
                      "provenance": "derived-by-rule"})

    plant = []
    for z in zones:
        if z["zoneType"] != "site":
            continue
        x, y = z["position"]["x"], z["position"]["y"]
        plant.append({"id": f"plant-{z['superRegion'].lower()}", "site": z["superRegion"], "zoneId": z["id"],
                      "provenance": "derived-by-rule (callout-centred 12 m square; the real plant boundary is NOT measured)",
                      "polygon": [{"x": x - PLANT_HALF, "y": y + PLANT_HALF}, {"x": x + PLANT_HALF, "y": y + PLANT_HALF},
                                  {"x": x + PLANT_HALF, "y": y - PLANT_HALF}, {"x": x - PLANT_HALF, "y": y - PLANT_HALF}]})

    kinds = {}
    for e in edges:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    nav = {
        "mapId": mp, "mapUuid": raw["uuid"], "schemaVersion": "0.2.0", "patchVersion": "UNVERIFIED",
        "sites": mapzones.site_letters(zones),
        "provenance": {
            "nodePositions": {"sourceId": "valorant-api-maps", "sourceUrl": "https://valorant-api.com/v1/maps",
                              "retrievedAt": FETCHED, "evidenceType": "decoded", "verified": True,
                              "notes": ["x,y are the callout locations returned by valorant-api; z is the measured floor height under the callout where the mesh stage found one (see each zone's positionProvenance)."]},
            "zoneTypes": "manual-approx (by callout name, tools/map-processor/mapzones.py)",
            "graph": "measured-on-mesh for kind walk/drop; manual-approx for special edges and approx-links (see each edge)",
            "plantZones": "derived-by-rule (callout-centred square; not the real plant boundary)",
            "sightlines": "measured-on-mesh visibility fraction; type and smokeable derived-by-rule",
            "soundLinks": "derived-by-rule (one link per travel connection; attenuation by distance bucket / door)",
            "rules": {"edgeStretch": EDGE_STRETCH, "dropGain": DROP_GAIN, "sightMinVisibility": SIGHT_MIN,
                      "notSmokeableAtVisibility": SIGHT_OPEN, "soundAttenuation": "<=25 m 0.2; <=50 m 0.3; >50 m or door 0.4"},
            "notes": ["Art geometry only (no collision layer in the source scene): walkability and occlusion are inferred from visible meshes.",
                      "Grid distances overestimate straight walks by up to ~8 % (8-neighbour metric)."],
        },
        "movement": MOVEMENT,
        "zones": zones, "plantZones": plant, "edges": edges, "sightlines": sightlines, "soundLinks": sound,
        **({"routes": route_summary} if route_summary else {}),
        "mechanics": authoring.get("mechanics", []),
        "dataQuality": {
            "edgeKinds": kinds,
            "approxLinks": fallback,
            "zonesWithoutMeasuredSightlines": unmeasured,
            "doorsNotAttached": [f"{dr['name']} ({dr['a']}<->{dr['b']}: no such edge in the measured graph)" for dr in doors_missing],
            "zonesOnMainWalkComponent": f"{grid['zonesOnMainWalkComponent']}/{grid['zonesTotal']}",
        },
        "generatedBy": "tools/map-processor/build_map.py",
    }
    apply_routes.dump_nav(nav, os.path.join(d, f"{mp}.navgraph.json"))

    cs = {
        "mapId": mp, "mapUuid": raw["uuid"], "patchVersion": "UNVERIFIED",
        "description": f"Game-world <-> minimap coordinate transform for {raw['displayName']}, verbatim from valorant-api.com/v1/maps (read {FETCHED}). Same axis-swapped convention as Ascent.",
        "units": {"gameUnit": "Unreal unit (uu)", "unitsPerMeter": 100},
        "transform": {
            "xMultiplier": raw["xMultiplier"], "yMultiplier": raw["yMultiplier"],
            "xScalarToAdd": raw["xScalarToAdd"], "yScalarToAdd": raw["yScalarToAdd"],
            "forward": {"minimapX": "gameY * xMultiplier + xScalarToAdd", "minimapY": "gameX * yMultiplier + yScalarToAdd"},
            "inverse": {"gameY": "(minimapX - xScalarToAdd) / xMultiplier", "gameX": "(minimapY - yScalarToAdd) / yMultiplier"},
        },
        "provenance": {"sourceId": "valorant-api-maps", "sourceUrl": "https://valorant-api.com/v1/maps",
                       "retrievedAt": FETCHED, "evidenceType": "decoded", "verified": True},
    }
    json.dump(cs, open(os.path.join(d, "coordinate-system.json"), "w"), indent=2)
    open(os.path.join(d, "coordinate-system.json"), "a").write("\n")
    print(f"{mp}: zones={len(zones)} edges={len(edges)} {kinds} sightlines={len(sightlines)} "
          f"sound={len(sound)} approx-links={fallback} sites={nav['sites']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    for m in (MAPS if args == ["--all"] else args):
        build(m)
