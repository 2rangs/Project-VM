#!/usr/bin/env python3
"""
PROJECT V — PV-5 Map Mesh (round 2)
Assemble datasets/spatial/ascent/mesh/replacement-proposal.json: measured
replacements for PV-4's callout-graph edge distances/times and sightlines, each
with its basis and an honest confidence. AGGREGATE values only (no geometry).
PV-4 files are NOT modified — integration is the orchestrator's step.

Inputs: PV-4 navgraph (read-only), the grid calibration, the LoS matrix.
Usage:
  python3 -I tools/map-mesh/make_proposal.py \
    --navgraph <PV-4 ascent.navgraph.json> \
    --grid datasets/spatial/ascent/mesh/ascent-grid-calibration.json \
    --los  datasets/spatial/ascent/mesh/ascent-los-matrix.json \
    --out  datasets/spatial/ascent/mesh/replacement-proposal.json
"""
import json, argparse


def edge_confidence(row):
    if not row.get("reachable"):
        return "none"
    sd = max(row.get("snapDist_from_m", 0) or 0, row.get("snapDist_to_m", 0) or 0)
    if sd <= 3.0:
        return "medium"          # grid geodesic is solid; placement ~region-level
    if sd <= 6.0:
        return "low"
    return "very-low"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--navgraph", required=True)
    ap.add_argument("--grid", required=True)
    ap.add_argument("--los", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    nav = json.load(open(a.navgraph))
    grid = json.load(open(a.grid))
    los = json.load(open(a.los))

    grid_edge = {(e["from"], e["to"]): e for e in grid["edges"]}

    edge_props = []
    for e in nav["edges"]:
        key = (e["from"], e["to"])
        g = grid_edge.get(key)
        if not g:
            continue
        prop = {
            "from": e["from"], "to": e["to"],
            "current": {
                "distanceMeters": e.get("distanceMeters"),
                "runTimeMs": e.get("runTimeMs"),
                "provenance": e.get("provenance"),
            },
            "proposed": {
                "distanceMeters": g.get("gridPath_m"),
                "runTimeMs": g.get("gridRunTimeMs"),
                "detourRatioVsStraightLine": g.get("detourRatio"),
            },
            "basis": "2.5D walkable-grid geodesic (floor triangles, cs 1.2 m, "
                     "step-tol 3.0 m, 8-neighbour, 1 auto off-mesh bridge); "
                     "endpoints placed via region-level affine (~6-9 m RMS) then "
                     "snapped to nearest grid node, run time at 6.75 m/s.",
            "confidence": edge_confidence(g),
            "reachable": g.get("reachable", False),
            "snapDist_from_m": g.get("snapDist_from_m"),
            "snapDist_to_m": g.get("snapDist_to_m"),
        }
        edge_props.append(prop)

    # Sightlines: PV-4 asserts 11; attach measured visibility from LoS.
    vm = los.get("visibilityMatrix", {})
    sight_props = []
    for sl in nav.get("sightlines", []):
        aa, bb = sl.get("a"), sl.get("b")
        mv = vm.get(aa, {}).get(bb)
        sight_props.append({
            "a": aa, "b": bb,
            "current": {k: sl[k] for k in sl if k not in ("a", "b")},
            "proposed": {"visibilityProbability": mv,
                         "visibleAtThreshold_0_25": (mv is not None and mv >= 0.25)},
            "basis": "eye-to-eye wall raycast, seeded KxK jittered samples "
                     "(eye height 1.6 m).",
            "confidence": "low",
            "caveat": "Eye points carry the region-level transform error (~7 m), "
                      "which OVER-estimates blocking; a 0 here is often a placement "
                      "artifact, not a real block. Use as corroboration where >0, "
                      "not as refutation where 0. Needs meter-precise alignment.",
        })

    reach = sum(1 for p in edge_props if p["reachable"])
    out = {
        "note": "PV-5 measured replacements for PV-4's Ascent callout graph. "
                "AGGREGATE values only (no geometry). PV-4 files are NOT modified; "
                "the orchestrator integrates these at merge time. Each value "
                "carries its basis and an honest confidence.",
        "generatedBy": "tools/map-mesh/make_proposal.py",
        "sources": {
            "pv4Navgraph": "origin/claude/pv-spatial:datasets/spatial/ascent/ascent.navgraph.json (read-only)",
            "gridCalibration": "datasets/spatial/ascent/mesh/ascent-grid-calibration.json",
            "losMatrix": "datasets/spatial/ascent/mesh/ascent-los-matrix.json",
            "transform": "datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json",
        },
        "summary": {
            "edgesProposed": len(edge_props),
            "edgesReachable": reach,
            "edgeConfidence": {
                c: sum(1 for p in edge_props if p["confidence"] == c)
                for c in ("medium", "low", "very-low", "none")
            },
            "sightlinesProposed": len(sight_props),
            "note": "Edge distances are usable (medium/low confidence). Sightline "
                    "visibility is low confidence pending meter-precise alignment.",
        },
        "edgeReplacements": edge_props,
        "sightlineReplacements": sight_props,
    }
    json.dump(out, open(a.out, "w"), indent=2)
    print(f"[proposal] edges={len(edge_props)} (reachable {reach}) "
          f"sightlines={len(sight_props)} -> {a.out}")
    print(f"[proposal] edge confidence: {out['summary']['edgeConfidence']}")


if __name__ == "__main__":
    main()
