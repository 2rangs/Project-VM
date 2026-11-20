# PV-5 Map Mesh pipeline

End-to-end tooling to turn a user-provided VALORANT Blender map into a NavMesh and
calibrate it against PV-4's callout graph. All geometry artifacts are derivatives
of the user-provided `.blend` and stay **gitignored** (see `docs/research/ascent-mesh.md`
§6); only scripts + numeric stats/reports are committed.

## Steps (Ascent)

```bash
RAW="datasets/spatial/ascent/mesh/raw/Ascent (blender 4.2).blend"
BL=/opt/blender-4.2/blender   # Blender 4.2 LTS (official tarball; apt has none)

# 1. Download the .blend from Google Drive (normal download-button flow)
node tools/map-mesh/download/download-drive-map.cjs \
  1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB datasets/spatial/ascent/mesh/raw ascent
#   (node tools/map-mesh/download/check-drive-access.cjs probes all 11 maps)

# 2. Inspect the scene
$BL --background --factory-startup --python tools/map-mesh/blender/inspect-scene.py -- \
  --blend "$RAW" --out /tmp/ascent-scene.json

# 3. Extract the ground-band walkable surface (floor-only, foliage/clutter dropped)
$BL --background --factory-startup --python tools/map-mesh/blender/extract-collision.py -- \
  --blend "$RAW" --floor-only --zmin -6 --zmax 14 \
  --drop-name-regex "foliage|tree|grass|bush|vine|ivy|leaf|plant_|shrub|hedge|flower|rubble|papers|wires|pipe" \
  --mesh-out datasets/spatial/ascent/mesh/derived/ascent_ground.bin \
  --stats-out datasets/spatial/ascent/mesh/ascent-ground-extract-stats.json

# 4. Fit Blender<->game coordinate transform (anchors from floor/landmark centroids)
python3 -I tools/map-mesh/align/fit-transform.py \
  --out datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json

# 5. Build the NavMesh (recast-navigation-js)
node tools/map-mesh/navmesh/build-navmesh.cjs \
  --mesh datasets/spatial/ascent/mesh/derived/ascent_ground.bin \
  --out  datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin \
  --stats datasets/spatial/ascent/mesh/ascent-navmesh-stats.json \
  --cs 0.3 --ch 0.3 --climb 2.0 --radius 0.3 --mergeRegion 60 --minRegion 5 --tileSize 128

# 6. Calibrate NavMesh paths vs PV-4 straight-line lower bounds
node tools/map-mesh/navmesh/calibrate-paths.cjs \
  --navmesh datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin \
  --navgraph <PV-4 datasets/spatial/ascent/ascent.navgraph.json> \
  --transform datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json \
  --out datasets/spatial/ascent/mesh/ascent-path-calibration.json
```

## Layout
- `download/`  — Playwright Drive downloader + reachability probe
- `blender/`   — headless Blender scripts (inspect, name dump, extract, centroids)
- `align/`     — numpy transform fit
- `navmesh/`   — recast-navigation-js build + calibration (its own node_modules)

## Status / limitation
The committed NavMesh is **partially connected** (main component ~27 % of the
map) because the source `.blend` is art geometry with no collision/blockout
layer. See `docs/research/ascent-mesh.md` §7–§8 for the measured evidence and the
options to reach full connectivity.

## Any map (generalised pipeline, 2026-11-19)

The Ascent steps above are kept as the record of how Ascent was calibrated. For every other
map — and for an Ascent control run — use the map-agnostic scripts. Geometry stays outside
the repo; only numbers and the schematic PNG are committed. Full method, evidence and
caveats: `docs/research/MAPS_DATA.md`.

```bash
BL=/path/to/Blender
PY=/path/to/Blender.app/Contents/Resources/4.2/python/bin/python3.11   # any Python with numpy
D=/path/OUTSIDE/the/repo/derived

# 1. one triangle soup per scene (positions, normals, object + material ids) — ~5 s
$BL --background --factory-startup --python tools/map-mesh/blender/extract-map.py -- \
  --blend /path/Bind.blend --out-dir $D/bind

# 2. transform check, 2.5D walk grid, zone adjacency + travel distances, LoS matrix
#    -> datasets/spatial/bind/mesh/*.json   (--debug / --no-los for inspection)
$PY -I tools/map-mesh/pipeline/measure_map.py --map bind --derived $D/bind

# 3. navgraph + coordinate system (pure JSON -> JSON, no geometry needed)
python3 -I tools/map-processor/build_map.py bind          # or --all

# 4. schematic PNG (graph over the walkable footprint, minimap orientation)
$PY -I tools/map-mesh/pipeline/render_map.py --map bind --derived $D/bind

# 4b. walkable route (polyline) for every edge -> mesh/bind-routes.json, then merge into the navgraph
$PY -I tools/map-mesh/pipeline/route_map.py --map bind --derived $D/bind
python3 -I tools/map-processor/build_map.py bind          # Ascent: python3 -I tools/map-processor/apply_routes.py ascent

# 5. independent orientation check from named collections
python3 -I tools/map-mesh/align/landmark_check.py > datasets/spatial/transform-landmark-check.json
```

- `pipeline/mapgeom.py`   — surface sampling, voxel occupancy, walk grid, Dijkstra, ray index
- `pipeline/measure_map.py` — the measurement stage (reuses `los/los.py`'s tested ray/triangle core)
- `pipeline/route_map.py`  — A* + string-pull + exact cell-by-cell validation of one polyline per edge
  (`docs/research/MAP_ROUTES.md`); writes `<derived>/walkable.json` for the optional local tests
- `pipeline/render_map.py`, `pipeline/pngdraw.py` — dependency-free PNG schematic
- `../map-processor/mapzones.py` — callout -> zone rule; `../map-processor/build_map.py` — rules + provenance

Key finding: every scene is a plain export, **game_uu = 100 * (x, -y, z)** of Blender
coordinates. The 6.6 m-RMS affine recorded for Ascent came from coarse region anchors; the
relation is exact, which is what makes zone-level line of sight usable.
