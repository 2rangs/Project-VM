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

## 3. Blender headless processing

_(filled in below as the work proceeds)_
