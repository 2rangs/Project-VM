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
