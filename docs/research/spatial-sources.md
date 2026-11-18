# PROJECT V — Spatial Data Sources (PV-4)

**Owner:** Spatial agent
**Date:** 2026-11-18
**Scope:** map geometry / coordinate / callout sources needed for the Ascent tactical spatial model.
**Rule:** a source is only marked verified at the level actually reached in *this* environment. "Link exists" ≠ "file obtained".

Status vocabulary follows README §3.2 (`VERIFIED_API`, `VIEW_ONLY`, `AUTH_REQUIRED`, `INACCESSIBLE`, …) and verification levels follow README §3.3 (L0 link → L1 structure → L2 real access → L3 reproduced).

---

## 1. valorant-api.com — maps endpoint ✅ used

| Field | Value |
|---|---|
| Source Name | VALORANT-API Maps |
| Source URL | https://valorant-api.com/v1/maps |
| Source Type | Public REST API (JSON) |
| Data Category | Map metadata, minimap coordinate transform, callouts |
| Access Method | HTTPS GET, no auth |
| Authentication | None |
| License | Community project; data derived from Riot game files. Commercial/redistribution terms UNVERIFIED — confirm before shipping. |
| Download Status | **VERIFIED_API — HTTP 200, 90,168 bytes read** |
| Verification Level | **L2 (response read and parsed)** |
| Project Relevance | HIGH — sole verified source of the Ascent coordinate transform and real callout positions |

**What was extracted and used:**
- Ascent `uuid` = `7eaecc1b-4337-bbf6-6ab9-04b8f06b3319`
- Coordinate transform: `xMultiplier 0.00007`, `yMultiplier -0.00007`, `xScalarToAdd 0.813895`, `yScalarToAdd 0.573242`
- 22 callouts with game-world `(x,y,z)` locations

Raw object saved: `datasets/spatial/ascent/valorant-api-ascent.raw.json`
(sha256 `c48a1d753854e7da99904db1593ffedd535986c61b783ea38b34524c1bcfc8a2`).

**Transform orientation (verified empirically):** the minimap transform is axis-swapped —
`minimapX = gameY·xMultiplier + xScalarToAdd`, `minimapY = gameX·yMultiplier + yScalarToAdd`.
All 22 callouts land inside `[0,1]` under this orientation and no other; round-trip error ≈ 1e-12 units.
Reproduce: `node tools/map-processor/verify-transform.mjs`.

---

## 2. User-provided Blender maps (Google Drive) ⚠️ not obtained here

| Field | Value |
|---|---|
| Source URL (folder) | https://drive.google.com/drive/u/0/folders/1henHDT5PX5HW3PRAJ018UBMTgL0F3-2a |
| Ascent file | https://drive.google.com/open?id=1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB |
| Access Method | Google Drive web download |
| Download Status | **NOT OBTAINED.** Direct `uc?export=download` returned the Google "Virus scan warning" HTML interstitial (HTTP 200, 2,474 bytes of HTML, **not** the `.blend`). |
| Verification Level | L1 (link resolves; real file behind a confirm-token / browser step) |
| Blocker | Large-file download needs the Drive confirm-token flow or an authenticated browser session; neither was completed here. Parsing `.blend` geometry would also require Blender, which is not installed. |
| Project Relevance | HIGH (future) — real collision/geometry mesh. Not required for the v0 callout graph. |

**Consequence:** the v0 Ascent model uses **no** measured mesh. Zone adjacency, plant polygons,
sightlines and sound links are hand-authored (`provenance: "manual-approx"`). Only node *positions*
come from real data (valorant-api).

**Follow-up to obtain it:** run the Drive confirm-token download (fetch interstitial → extract
`confirm` token → re-request) in an environment that allows it, then open in Blender via
`tools/map-processor` to extract collision meshes and build a real navmesh.

---

## 3. Map reference GitHub repos ⛔ outside this session's GitHub scope

Checked via `gh api repos/<r>`; all returned **HTTP 403 — not enabled for this session**
(this session's GitHub access is scoped to `2rangs/project-vm`; `add_repo` is for task repos, not
third-party reference code, so they were not attached).

| Repo | Purpose | Status |
|---|---|---|
| https://github.com/Shreshth1x/ValorantBrowser | Riot asset/map browser | INACCESSIBLE (403 this session) |
| https://github.com/LouisAsanaka/Valorant-Zone-Stats | Zone/callout stats, minimap coords | INACCESSIBLE (403 this session) |
| https://github.com/f0rmatme/Piana | Lineup/map tooling | INACCESSIBLE (403 this session) |

Not verified here; left as L0 (named in handoff only). Re-check from an environment whose GitHub
scope includes public repos, or mirror the needed data manually.

---

## 4. Summary

| Source | Status | Level | Used in v0 |
|---|---|---|---|
| valorant-api maps | VERIFIED_API | L2 | ✅ transform + callouts |
| Google Drive Blender (Ascent) | not obtained (scan interstitial) | L1 | ❌ |
| Map reference repos | INACCESSIBLE (403) | L0 | ❌ |

**Bottom line:** exactly one source was verified end-to-end (valorant-api). The Ascent v0 spatial
model is built from real callout positions + a manual-approx tactical graph, and every approximated
field is tagged so the next agent never mistakes it for measured data.
