# PROJECT V — Ascent Map Mesh (PV-5)

**Owner:** Map Mesh agent (PV-5)
**Date:** 2026-11-18
**Scope:** obtain the user-provided Ascent Blender map, inspect it, extract collision geometry, build a NavMesh, and calibrate real path lengths against PV-4's callout graph.
**Rule:** every status is reported at the level actually reached *in this environment*. "Link exists" ≠ "file obtained"; "file obtained" ≠ "mesh extracted".

Branch: `claude/pv-mapmesh`. PV-4's spatial work (read-only reference) is on `origin/claude/pv-spatial`.

---

## 1. Source acquisition — Ascent `.blend` ✅ obtained

| Field | Value |
|---|---|
| Source | User-provided Google Drive (README §10.1 / Handoff §9.1) |
| Ascent URL | https://drive.google.com/open?id=1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB |
| Filename | `Ascent (blender 4.2).blend` |
| Size | 326,114,514 bytes (≈311 MiB) |
| SHA256 | `51e0b327393356c197687b075bd511e591fc08a207ed1059e0817d7482f2b5e2` |
| Blender header | `BLENDER-v402` → Blender 4.2, 64-bit, little-endian |
| Download method | Playwright/Chromium → Drive "virus scan" interstitial → **Download anyway** (confirm-token form). Normal download-button flow; no protection bypassed. |
| Download status | **OBTAINED** (L2 — real bytes on disk, header verified) |
| Committed? | **No** — user-provided material, copyright/size unverified. Stored in `datasets/spatial/ascent/mesh/raw/` (`.gitignored`). Provenance committed in `datasets/spatial/ascent/mesh/download-provenance.json`. |

PV-4 (`docs/research/spatial-sources.md` §2) was blocked here: a plain
`uc?export=download` returned only the 2,474-byte "Virus scan warning" HTML, not
the `.blend`. PV-5 cleared that by driving the interstitial's own
**Download anyway** form (the `confirm`/`uuid` token flow) in a real browser.

**Reproduce:**
```bash
node tools/map-mesh/download/download-drive-map.cjs \
  1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB datasets/spatial/ascent/mesh/raw ascent
```

---

## 2. Other maps — accessibility probe (read-only, no download)

Per the task, only Ascent was downloaded. The other 10 maps were probed for
reachability only (page opened, title read, **no file bytes fetched**):
`node tools/map-mesh/download/check-drive-access.cjs`.

| Map | File ID | Reachable | Drive filename |
|---|---|---|---|
| Abyss | `1BW2cxkBUz70ed3AYA2nGITvQlvuaEX8t` | ✅ | `Abyss (blender 4.2).blend` |
| Ascent | `1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB` | ✅ (downloaded) | `Ascent (blender 4.2).blend` |
| Bind | `1kAY2m05wdDnU9_3aOgrL_4b-p66AuLnK` | ✅ | `Bind (blender 4.2).blend` |
| Breeze | `1QpiCKTIJgzU735HzNH84Io5eYeoPhDdd` | ✅ | `Breeze (blender 4.2).blend` |
| Fracture | `1WCTrmYIH9VNpXYGUN4w9U8S_nq_7Cx3I` | ✅ | `Fracture (blender 4.2).blend` |
| Haven | `1e1wFXD2iBrYMPFNBwUgDnE9GpPTwt9rJ` | ✅ | `Haven (blender 4.2).blend` |
| Icebox | `1TzjOGVTZ0Du9E9-k3d9Vi7BN7qvX6hV1` | ✅ | `Icebox (blender 4.2).blend` |
| Lotus | `1J_FcYU3iRcvZIGRvxvdM8s7sRm5OAPTN` | ✅ | `Lotus (blender 4.2).blend` |
| Pearl | `1L9BPmfJnlOOcduu-rlftTkgUP0r0ENh0` | ✅ | `Pearl (blender 4.2).blend` |
| Split | `1yTkqrAbinK1PyAFNZoyUfjvd5vA0ZMMd` | ✅ | `Split (blender 4.2).blend` |
| Sunset | `1O-iEnHY1MfGcDdm32YK3f0kiA0UEybhG` | ✅ | `Sunset (blender 4.2).blend` |

All 11 are reachable and all are Blender 4.2 files. The same download script
works for any of them by file ID.

---

## 3. Blender headless processing ✅

**Tool:** Blender **4.2.23 LTS** (official tarball, `/opt/blender-4.2`), run
`--background --factory-startup`. apt has no `blender` package in this image; the
`.blend` is Blender 4.2 so the matching 4.2 LTS runtime was used.

Reproduce:
```bash
/opt/blender-4.2/blender --background --factory-startup \
  --python tools/map-mesh/blender/inspect-scene.py -- \
  --blend "datasets/spatial/ascent/mesh/raw/Ascent (blender 4.2).blend" \
  --out /tmp/ascent-scene.json
```

### 3.1 Scene structure (measured)

| Property | Value |
|---|---|
| Blender version | 4.2.23 LTS |
| Unit system | METRIC, `scale_length = 1.0`, length unit METERS |
| Objects (total) | 9,931 |
| — MESH | 8,312 |
| — EMPTY | 1,619 (Unreal instanced-static-mesh parent transforms) |
| Collections | 16 |
| Materials | 481 |
| Vertices (total) | 4,410,155 |
| Polygons (total) | 3,320,370 |
| World bbox min | (−8845.8, −8565.1, −393.6) |
| World bbox max | (8471.7, 8573.3, 433.5) |
| World bbox size | (17317.5, 17138.3, 827.1) |

**Units caveat (important).** The scene is *labelled* METRIC/METERS at
`scale_length=1.0`, but the geometry spans ±8.5k units — a VALORANT map is ~140 m,
not 17 km. So **1 Blender unit = 1 Unreal unit (uu)**, not 1 metre. This matches
PV-4's convention (`unitsPerMeter = 100`, positions in uu). Treat Blender BU as uu
throughout; divide by 100 for metres.

**Object transforms.** Meshes are children of EMPTY parents (Unreal
`InstancedStaticMesh` export, 1,614 such groups), so `object.location` is *local*.
World position must be read from `matrix_world.translation`. All geometry
extraction below uses world space.

### 3.2 Collections (region partition)

The 15 populated collections name the map regions directly:

| Collection | Direct objs | Meaning | Playable? |
|---|---|---|---|
| Ascent_Art_Atk | 1657 | Attacker side / spawn | yes |
| Ascent_Art_AtkPathA | 1028 | A main lane | yes |
| Ascent_Art_AtkPathB | 1021 | B main lane | yes |
| Ascent_Art_DefPathA | 1072 | A defender lane | yes |
| Ascent_Art_DefPathB | 566 | B defender lane | yes |
| Ascent_Art_Mid | 919 | Mid | yes |
| Ascent_Art_A | 504 | A site | yes |
| Ascent_Art_B | 672 | B site | yes |
| Ascent_Art_APathMid | 364 | A–Mid link | yes |
| Ascent_Art_Def | 248 | Defender side / spawn | yes |
| Ascent_Art_VistaAtk | 909 | Distant skybox (islands, hospital, bell tower) | **no — exclude** |
| Ascent_Art_VistaDef | 517 | Distant skybox | **no — exclude** |
| Ascent_Art_VistaA / VistaB / Vista | 171 / 173 / 110 | Distant skybox | **no — exclude** |

Named semantic markers confirm the region labels: `ABombsite_*`, `ASite_*`,
`AStairs_*`, `ARamp_*`, `AtkBridge_*`, `AtkTower_*`, `AtkStairs_*`, etc. The
`Vista*` collections hold out-of-bounds decoration (hospital/islands/bell tower)
and dominate the raw world bbox; they are excluded from collision/navmesh.

### 3.3 Collision mesh

There is **no dedicated collision/blockout collection** — the file ships the ART
mesh only (VALORANT's real blocking volumes are not in this export). Per
README §10.3 ("원본에 충돌 메시가 없다면 직접 생성해야 한다") the collision/walkable
surface is **generated from the playable art geometry** (see §4).

---

## 4. Collision mesh extraction ✅

**Tool:** `tools/map-mesh/blender/extract-collision.py`. Merges all **playable**
collections (the 10 non-Vista collections), evaluates modifiers, triangulates,
and writes world-space geometry as a compact binary (`PVMESH01`: float32
positions + uint32 indices) plus a committable stats JSON.

```bash
/opt/blender-4.2/blender --background --factory-startup \
  --python tools/map-mesh/blender/extract-collision.py -- \
  --blend "datasets/spatial/ascent/mesh/raw/Ascent (blender 4.2).blend" \
  --mesh-out datasets/spatial/ascent/mesh/derived/ascent_playable.bin \
  --stats-out datasets/spatial/ascent/mesh/ascent-extract-stats.json
```

| Measure | Value |
|---|---|
| Playable objects (Vista excluded) | 6,736 |
| Playable vertices | 3,135,792 |
| Playable triangles | 2,355,371 |
| — floor (normal within 45° of +Z) | 410,858 |
| — wall (near-vertical, within 70° of horizontal) | 1,111,794 |
| — steep (between) | 832,719 |
| Playable world bbox (uu / **m**) | min (−67.5,−47.75,−5.58) · max (96.49,113.91,68.06) → **164.0 × 161.7 × 73.6 m** |

The playable bbox (≈164 × 162 m) is the real map extent; it confirms the
metres↔uu reading (§3.1). Floor triangles (≈411 k) are the walkable candidate
surface; walls (≈1.11 M) are the collision blockers that Recast voxelises into
impassable spans.

**Walkable/wall split** is produced by world-space triangle-normal
classification (not a separate authored collision mesh). Recast re-derives
walkability from slope during voxelisation (§7); the split here is for
inspection and statistics.

**License gate (derivative not committed).** The extracted mesh reproduces
Riot/VALORANT map geometry from the user-provided `.blend`. Its redistribution
licence is **unverified** (see §9). The `.bin` therefore lives in
`datasets/spatial/ascent/mesh/derived/` (`.gitignored`); only the numeric stats
(`ascent-extract-stats.json`) are committed.

---

## 5. Coordinate alignment: Blender ↔ PV-4 game coords ✅ (region-level)

**Goal:** relate Blender world coords (metres) to PV-4's game coords (Unreal uu,
from valorant-api) so PV-4's 22 callouts can be placed on the mesh/navmesh.

**Anchors.** Both coordinate sets only expose *region-level* markers, so the fit
uses region anchors, not exact per-callout correspondences:

| Anchor | Blender (m) | PV-4 game (uu) | Blender source |
|---|---|---|---|
| atk-spawn | (18.50, 9.30) | (60.0, 50.0) | `Ascent_Art_Atk` floor centroid |
| def-spawn | (14.00, 97.80) | (1995.2, −9744.9) | `Ascent_Art_Def` floor centroid |
| a-site | (55.96, 66.38) | (6153.6, −6626.2) | `ABombsite*` landmark |
| b-site | (−48.50, 75.60) | (−2344.1, −7548.5) | `BSite*` landmark |
| mid | (14.10, 52.30) | (1222.7, −4586.6) | `Ascent_Art_Mid` floor centroid |

Blender anchors from `floor-centroids.py` (area-weighted walkable-floor
centroid) and `landmark-centroids.py` (named site geometry). Fit by
`tools/map-mesh/align/fit-transform.py` (numpy least squares), result in
`datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json`.

**Result.**

| Model | Parameters | Residual (RMS / max) |
|---|---|---|
| Affine `game = A·bl + t` | A = [[81.19, 32.09], [−0.34, −112.40]], t = (−1394.65, 1087.50); singular values 120.6 / 75.6 uu·m⁻¹ | **659.8 uu (6.6 m) / 905.4 uu (9.1 m)** |
| Similarity (isotropic) | scale 93.25 uu·m⁻¹, rotation 10.31°, **reflection = true**, t = (−957.8, −417.7) | 1180.7 uu (11.8 m) / 1531.8 uu (15.3 m) |

**Interpretation (honest).**
- The frames are related by a **reflection** (`det R < 0`) at scale ≈ **90–100 uu
  per metre** — i.e. Blender is right-handed, VALORANT/valorant-api left-handed,
  ≈100 uu/m as expected. This is the structural relationship.
- The **affine** is the working `Blender ↔ game` map (lower residual, absorbs the
  reflection and anchor anisotropy). Its ~6.6 m RMS residual is **region-level,
  not callout-precise**: both anchor sets are *approximate* region markers
  (valorant-api callout points are themselves region centres, and the Blender
  anchors are floor/geometry centroids). A ~7 m agreement between two independent
  approximate datasets is the honest precision available without per-callout
  ground truth.
- Consequence for downstream use: when placing PV-4 callouts on the navmesh,
  snap each mapped point to the nearest navmesh polygon (search radius ≥ 10 m) to
  absorb this placement uncertainty (see §8).

---

## 6. License judgement (before committing any derivative)

The `.blend` is **user-provided** (README §10.1 Google Drive) and clearly contains
Riot/VALORANT map art. Its redistribution/commercial licence is **UNVERIFIED**
(same open question PV-4 flagged for valorant-api). Therefore, per the task rule
*"파생물을 커밋하기 전에 원본 라이선스 판단을 기록하고, 불명확하면 생성 스크립트만 커밋한다"*:

- **NOT committed** (gitignored under `datasets/spatial/ascent/mesh/raw|derived/`):
  the raw `.blend`, the extracted geometry (`ascent_playable.bin`,
  `ascent_ground.bin`), and the exported Detour navmesh (`ascent.navmesh.bin`) —
  all reproduce Riot map geometry.
- **Committed** (numeric measurements / derived facts, not geometry): extraction
  stats, the Blender↔game transform, navmesh stats (tile/poly counts, bounds,
  config), and the path-calibration report, plus **all generation scripts**.

Anyone with the source `.blend` reproduces every artifact with the committed
scripts; nothing proprietary is redistributed in git.

---

## 7. NavMesh generation ✅ (built; partially connected — see §8)

**Tool:** `tools/map-mesh/navmesh/build-navmesh.cjs` using
**recast-navigation-js 0.44.0** (Recast/Detour, WASM). Input is the ground-band
walkable surface; Blender Z-up is swapped to Recast Y-up.

```bash
node tools/map-mesh/navmesh/build-navmesh.cjs \
  --mesh datasets/spatial/ascent/mesh/derived/ascent_ground.bin \
  --out  datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin \
  --stats datasets/spatial/ascent/mesh/ascent-navmesh-stats.json \
  --cs 0.3 --ch 0.3 --climb 2.0 --radius 0.3 --mergeRegion 60 --minRegion 5 --tileSize 128
```

Committed navmesh (`ascent-navmesh-stats.json`): **7 tiles, 66 polys, 147 verts**,
bounds (Blender m) min (−67.5, −9.35, −1.36) · max (86.1, 105.85, 15.53). Config:
cs 0.3, ch 0.3, walkableSlopeAngle 45°, walkableHeight 2 m, walkableClimb 2 m,
walkableRadius 0.3 m, tileSize 128.

**Input surface choice (measured, not guessed).** Three inputs were built and
their intrinsic connectivity measured by random-point reachability (largest
connected component as a fraction of sampled area):

| Input to Recast | polys | largest connected component |
|---|---|---|
| Full playable mesh (walls + floor, 2.36 M tris) | 722 | **~7 %** (hundreds of fragments: wall-tops, prop-tops, ledges) |
| Floor-only (up-facing tris) | ~50 | ~35 % |
| Floor-only, ground band z∈[−6,14] m, foliage/clutter dropped (279 k tris) | 66 | **~27–39 %** (best) |

The ground-band floor surface is the committed input. Dropping walls and
clutter and clamping the ground band removes the geometry that shatters
walkability (wall/prop tops, tree canopies, catwalks/rooftops), but even the
best result is a **partially connected** navmesh.

---

## 8. Calibration: NavMesh path vs PV-4 straight-line ⚠️ partial (connectivity-limited)

**Tool:** `tools/map-mesh/navmesh/calibrate-paths.cjs`. Each PV-4 zone is mapped
game→Blender via the inverse affine (§5), represented by the nearest point on the
navmesh **main connected component** (`repDist` = that distance), and paths are
routed between representatives; lengths convert at 100 uu/m. **PV-4 files are read
only.** Report: `datasets/spatial/ascent/mesh/ascent-path-calibration.json`.

```bash
node tools/map-mesh/navmesh/calibrate-paths.cjs \
  --navmesh datasets/spatial/ascent/mesh/derived/ascent.navmesh.bin \
  --navgraph <PV-4 ascent.navgraph.json> \
  --transform datasets/spatial/ascent/mesh/ascent-blender-to-game-transform.json \
  --out datasets/spatial/ascent/mesh/ascent-path-calibration.json
```

**Result (honest).** The navmesh main component covers **~27 %** of the map, so
only the **3 Mid-region zones** (`mid-bottom`, `mid-market`, `mid-pizza`) fall
within 18 m of it. Of PV-4's 32 edges, **2 are measurable**:

| Edge | NavMesh path | rep straight-line | detour ratio | note |
|---|---|---|---|---|
| mid-bottom → mid-market | 0.9 m | 0.9 m | 1.01 | both endpoints solidly on main component |
| mid-bottom → mid-link | 6.0 m | 7.9 m | 0.76 | `mid-link` rep is 18 m off → ratio unreliable (shown as a caveat, not a map fact) |

The remaining 30 edges are **unreachable on this navmesh** because their endpoints
sit on disconnected fragments or off the main component — a **NavMesh
connectivity limitation**, *not* a statement that those routes don't exist in
VALORANT.

**Why full calibration is not yet possible.** The user-provided `.blend` is the
**art** mesh with **no collision/blockout layer** (§3.3). Auto-voxelising art
geometry (multi-level buildings, stairs modelled as discrete steps, doorways
narrower than the voxel/erosion scale, decorative clutter) yields a shattered
walkable surface. Recast parameter tuning (cell size, climb, radius, region
merge, floor-only, ground-banding, clutter removal) was swept extensively; the
best single connected component reached ~27–39 % of the map. A fully connected
Ascent NavMesh needs one of:

1. a **clean collision/blockout mesh** (ideally VALORANT's own blocking volumes,
   not shipped in this export) as the Recast input;
2. **manual stair/ramp bridging** via Detour **off-mesh connections** at the
   ~dozen level transitions, plus doorway-preserving simplification; or
3. a **watertight ground-plane reconstruction** per region before voxelisation.

**Replacement proposal for PV-4 (no PV-4 files changed).** For the one solidly
measured edge, the NavMesh path (0.9 m) matches PV-4's straight-line
`distanceMeters`, i.e. Mid-bottom↔Mid-market is effectively open with no detour —
PV-4's manual-approx value is a sound lower bound there. No edge yet shows a
large measured detour because the sites/lanes (where real wall-detours live)
are not on the connected component. Once a connected navmesh exists (options
above), re-run `calibrate-paths.cjs`; the report's `replacementProposal` array is
the drop-in table of `distanceMeters` → `navmeshPath_m` suggestions for PV-4.
