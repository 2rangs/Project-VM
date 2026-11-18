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

## 3b. vlr.gg 2D replay position data ⛔ reachable but license-barred (v1 investigation)

| Field | Value |
|---|---|
| Source Name | VLR.gg match 2D-replay logs |
| Source URL | https://www.vlr.gg/754730/?game=283266&tab=logs (100 Thieves vs G2, Champions 2026, Ascent) |
| Data Category | Per-event player position snapshots on vlr's minimap |
| Data Format | HTML with embedded JSON events: `{"t":"m:ss","type":"kill\|plant\|defuse","by":id,"locs":[[playerId,x,y,angleDeg],...],"pos":[x,y],"team":n}` |
| Access Method | HTTPS GET of the match page |
| robots.txt | Allows match pages (only `/search/auto` and `/rr/` disallowed) |
| **Terms of Service** | **PROHIBITS automated access and redistribution** |
| Download Status | Reachable (HTTP 200); **NOT usable** under ToS |
| Verification Level | L2 structure confirmed in this session (one page inspected to assess feasibility/license) |

**What the data contains (confirmed this session):** game 283266 is Ascent; the logs page carried
193 events (173 kills / 16 plants / 4 defuses) with 1,089 position samples in vlr minimap space
(x≈92–973, y≈117–844). Coordinates are vlr's own minimap pixels — a different space from this
project's normalized `[0,1]` transform, so they would need an affine calibration before use.

**Why it is not used.** VLR.gg's Terms of Service (https://www.vlr.gg/terms) state:
- "...any spider, robot, cheat utility, scraper, or offline reader that accesses the Services... [prohibited]"
- "you will not access the Services through automated or non-human means, whether through a bot, script or otherwise"
- "no Content... may be copied, reproduced, aggregated, republished... distributed, sold, licensed..."
- content is provided for "personal, non-commercial use or internal business purpose only."

That forbids both the systematic scraping that a collector would do and committing/redistributing
the extracted positions. Per README §3 (collection-policy compliance) and §35 (honest reporting),
this project therefore:
- **does NOT commit** any vlr-derived observation data, and
- **does NOT commit** a vlr scraper into `tools/map-processor/`.

The brief inspection above was a one-off feasibility/license check, not a dataset build.

**Consequence for the model.** The Ascent graph stays `manual-approx`; no `derived-real` values
were produced. The v1 refinement used only license-independent, map-knowledge-based changes
(spawn pass-through constraint + tests).

**Authorized alternatives to pursue for real positions (not vlr):**
- VCT Reference DuckDB (its own `/terms`) — PV-2 is verifying; check its redistribution clause.
- Riot official APIs / Riot × GRID Open Access (auth required; user must supply keys).
- vrfkit / ValorantReplayParser on self-captured VRF replay files (no third-party ToS on your own replays).

---

## 4. Summary

| Source | Status | Level | Used |
|---|---|---|---|
| valorant-api maps | VERIFIED_API | L2 | ✅ transform + callouts |
| vlr.gg 2D replay logs | reachable, **LICENSE_RESTRICTED** (ToS bars automated use + redistribution) | L2 | ❌ not usable |
| Google Drive Blender (Ascent) | not obtained (scan interstitial) | L1 | ❌ |
| Map reference repos | INACCESSIBLE (403) | L0 | ❌ |

**Bottom line:** exactly one source is verified AND license-usable end-to-end (valorant-api). vlr.gg
holds the real per-event position data this project wants, but its ToS prohibits automated access and
redistribution, so it cannot be used without permission or an authorized feed. The Ascent spatial
model remains built from real callout positions + a `manual-approx` tactical graph; every approximated
field is tagged so the next agent never mistakes it for measured data.
