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
