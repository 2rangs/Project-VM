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
