# `datasets/synthetic/` — SYNTHETIC data (NOT real matches)

Everything here is **generated**, not from any real VALORANT match. Every record carries
`provenance.synthetic = true` and `evidenceType = "simulated"`. **Never present this as real VCT
data.** The validator fails any record here that is not flagged synthetic.

Why synthetic exists: the real source we verified (VCT Reference) is Layer A (stats) only. The
positional / belief / decision-context data the simulation needs (Layer B/C) is not available from a
usable real source — the vlr.gg 2D-replay logs hold it, but **vlr.gg's ToS prohibits automated access
and redistribution**, and the authorized routes (Riot/GRID official feeds with a key, self-captured
VRF via vrfkit) are not secured yet. So the Ascent prototype (Handoff §19, DECISION-009) is seeded
with clearly labelled synthetic states.

## `scenarios/` — the 10 Handoff §20 decision contexts  ← PV-4 consumes these
`scenario_01.json` … `scenario_10.json`, each a single **DecisionContext**
(`../schema/world-state.schema.json`): ground-truth `worldState` + `decidingTeamIdx` + the deciding
team's `belief`. The belief references enemies only through observation/inference (DECISION-004:
the AI must not read enemy positions it cannot observe).

| File | Scenario (Handoff §20) | Illustrates |
|---|---|---|
| 01 | Basic attack | 5v5 round start, spike carried; generate site options |
| 02 | Observed info | one A defender seen; belief ≠ full truth |
| 03 | Fake | defenders decide on observed A pressure while spike lurks B |
| 04 | Time pressure | 8 s left at A → B rotation+plant is infeasible |
| 05 | Plant | plant only inside the A plant zone (`worldState.plantZones`, game-world uu) |
| 06 | Post-plant | 3v3, hold angles depend on the plant position |
| 07 | Operator save | 1v4, Operator preservation value |
| 08 | Ult denial | enemy neon at 6/7 ult; avoid feeding the point |
| 09 | Match point | a loss ends the map → no future-round save value |
| 10 | Exit kill | chase the saver's Operator vs keep 3 rifles |

## Coordinate frame — **v2, game-world uu**
Scenarios are `formatVersion: 2`: every position is a `gameWorldPosition`
(`{x, y, z, frame: "game-world-uu"}`) in game-world **Unreal units**, the same frame PV-4's navgraph
and `datasets/spatial/` use, and each player/spike carries a navgraph `zoneId`. The legacy v1
`minimapUnits` frame (VLR minimap, ≈ 0..1000) is **deprecated** — it caused a coordinate-mismatch bug
in PV-3. The validator checks each `zoneId` against `ascent/ascent_zones_ref.json` (a committed
snapshot of the PV-4 navgraph) and that its position is within 800 uu of the zone's representative
point.

## `ascent/` — one synthetic Ascent map + navgraph zone reference
`map.json`, `rounds.json`, `events.json`: a short, **deterministic** (seeded) map that exercises the
Round / Event / Position schemas, including per-event position snapshots in the `locs`-style shape.
`ascent_zones_ref.json`: a snapshot of the PV-4 Ascent navgraph zones (id, type, plantable,
game-world position) used by the validator's zone/coordinate check.

## Regenerate (deterministic)
```bash
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli gen-scenarios --out datasets/synthetic/scenarios
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli gen-map       --out datasets/synthetic/ascent
```

## Coordinate / economy caveats
- Positions are **illustrative** game-world uu set to each zone's representative point (v2), plausible
  but not surveyed; the authoritative navgraph geometry belongs to the Spatial agent (`datasets/spatial/`).
- Economy / ultimate constants are **approximate, patch-dependent placeholders** (`patch` is set to
  `synthetic-approx`). Verify against the real patch before using them in the engine.
