# Models and map meshes

Everything here serves the live match view's team cams (`screens/matchday/CamStage3D.ts`).
**Licensing:** map geometry is a derivative of third-party assets and never goes into git
(`docs/LICENSE_AUDIT.md`). Meshes, `.glb`, `.blend` and textures live in `~/ProjectV-assets/maps/` only.
Only scripts, tests and these docs are committed. Operators and weapons are **original** procedural
models (`models.ts`); no game agent, weapon or skin model is used or approximated.

## A. Map meshes (all 11 maps)

### Pipeline — `tools/map-mesh/blender/export-web-glb.py`
1. Drop vista/sky/`_NPEV2`/audio/lighting collections, foliage & clutter by name (structural pieces
   — `Floor_`, `Shell_`, `Wall_`, `Doorway_`, `Stair_`… — are **never** dropped by name; Haven's
   `Floor_8_BirdHouse*` once matched `bird`), and props smaller than 0.9 m.
2. Paint a vertex-colour layer from each material's albedo (`*_DF`, 64 px box filter), strip
   materials/UVs/textures — no texture leaves the `.blend`.
3. Join per source collection (about 10 draw calls) and decimate to `--target-tris` (default 390 k); if the GLB
   exceeds `--max-bytes` (20 MB) it is decimated once more.
4. **Calibrate** Blender → game: the maps pipeline's transform
   (`datasets/spatial/<map>/mesh/<map>-blender-to-game-transform.json`: 1 BU = 100 uu, y flipped) is the prior
   and is kept unless another of the 8 axis candidates scores clearly better; then a horizontal offset is
   refined (50 uu then 10 uu steps, ±200 uu) against up to 300 roadmap nodes. **The vertical offset is 0 when a
   roadmap exists** (nodes are measured on the same `.blend`); zone-centre heights are not floors on every
   map (Sunset's callouts sit ~4 m off, which sent the first Pearl/Sunset exports 150–860 uu off in height).
5. **Verify** on the exported (decimated) mesh, in game units, against `<map>.nav.json` / `<map>.vis.json`:
   every roadmap node is dropped on the mesh floor (vertical error where a floor lies within 1 m above and
   2 m below the node; horizontal error = distance to the nearest floor at the node's height, capped at 300 uu),
   and 300 visible + 300 blocked sight-table pairs are re-cast at eye/chest height.
6. Bake to the app's scene frame `scene = (game.x, game.z, game.y) × 0.01` and export positions + vertex colours.
7. Optional Workbench previews: `<map>-preview-top.png`, `<map>-preview-oblique.png`.

### Rebuild
```bash
tools/map-mesh/blender/export-all-maps.sh            # all eleven, one at a time through heavy-run.sh
tools/map-mesh/blender/export-all-maps.sh haven bind # some
python3 tools/map-mesh/blender/report-table.py       # the table below, from the reports
```
Output: `~/ProjectV-assets/maps/glb/<map>.glb` (+ `.report.json`, `.export.log`, previews). The app already looks there
(`PV_MAP_ASSETS_DIR` overrides). ~100–150 s per map. Needs `~/ProjectV-assets/maps/raw/<Map>.blend` and Blender 4.2.

### Per-map calibration and budget
Floor/verticals are measured on the **exported, decimated** mesh. "No floor under" nodes lie where decimation or the
name filters removed the surface (mostly under thin decks, stairs and removed props). Sight rates are the share of
300 sampled sight-table pairs on which the mesh agrees (visible pairs: mesh also finds a clear line; blocked pairs: mesh also blocks).
Budget: ≤ 400 k triangles and ≤ 20 MB — all maps are within.

| map | tris | MB | nodes on floor ≤15 uu | no floor under | vertical p50 / p95 / max (uu) | horizontal p95 / max (uu) | sight: visible / blocked agree | offset uu | zones on floor |
|---|---|---|---|---|---|---|---|---|---|
| abyss | 389k | 16.9 | 980/1160 (84 %) | 78 | 0.0 / 12.8 / 49 | 40 / 300 | 0.897 / 0.97 | [10.0, 50.0] | 21/23 |
| ascent | 389k | 18.1 | 1213/1328 (91 %) | 24 | 0.8 / 14.6 / 48 | 40 / 300 | 0.883 / 0.987 | [-20.0, 30.0] | 21/22 |
| bind | 389k | 17.1 | 1027/1108 (93 %) | 3 | 0.4 / 7.8 / 48 | 20 / 300 | 0.967 / 0.997 | [-10.0, -10.0] | 24/24 |
| breeze | 389k | 17.4 | 2303/2671 (86 %) | 86 | 1.3 / 14.2 / 50 | 40 / 300 | 0.967 / 0.96 | [-20.0, 20.0] | 20/23 |
| fracture | 389k | 17.8 | 900/935 (96 %) | 14 | 0.4 / 6.8 / 50 | 0 / 170 | 0.927 / 1.0 | [10.0, 0.0] | 22/22 |
| haven | 389k | 18.4 | 829/867 (96 %) | 16 | 0.1 / 6.2 / 50 | 0 / 300 | 0.967 / 0.99 | [10.0, 20.0] | 19/21 |
| icebox | 340k | 19.3 | 1660/2119 (78 %) | 132 | 0.2 / 19.4 / 49 | 50 / 300 | 0.94 / 0.98 | [40.0, -20.0] | 24/25 |
| lotus | 389k | 17.0 | 1306/1452 (90 %) | 39 | 0.4 / 8.3 / 49 | 30 / 300 | 0.977 / 0.993 | [-10.0, 10.0] | 26/28 |
| pearl | 389k | 16.8 | 1202/1391 (86 %) | 102 | 0.1 / 13.2 / 46 | 30 / 300 | 0.93 / 0.997 | [-30.0, 10.0] | 17/26 |
| split | 389k | 17.9 | 940/999 (94 %) | 23 | 0.0 / 7.0 / 42 | 10 / 300 | 0.98 / 0.993 | [-20.0, -20.0] | 24/24 |
| sunset | 389k | 17.6 | 867/894 (97 %) | 7 | 0.1 / 5.0 / 34 | 0 / 240 | 0.987 / 0.997 | [-10.0, 0.0] | 11/17 |

Reading it: vertical p50 is ~0 uu everywhere (the frame is right); p95 is 5–19 uu (one stair step ≈ 18 uu). Max is capped at
50 uu by construction (a node whose nearest floor is further is counted as "floor beyond 50 uu", not in the percentile).
Weakest: Icebox (78 % — many multi-level nodes), Abyss (84 %), Breeze/Pearl (86 %). Ascent/Abyss visible-pair agreement
(88 % / 90 %) is the lowest: the decimated mesh has some openings (railings, glass) the sight table treats as clear or the
reverse; sampled disagreements are in each `report.json` (`verify.sight.examples`).

### Frame time in the cams
`apps/desktop/test/perf.maps.mjs` — the app plays Ascent only, so this harness (`test/perf/maps-harness.ts`) mirrors the
cams renderer (same renderer flags, static sun shadow, vertex-coloured BVH mesh, 5 monitors of a 1600×900 canvas each with a
first-person rig, 10 skinned operators in mixed states) on any map's GLB, in Electron on the real GPU (Apple GPU, DPR 1, 360 frames,
uncapped rAF). Run: `PLAYWRIGHT_REQUIRE_BASE=… heavy-run.sh "perf maps" -- node test/perf.maps.mjs [map…]`
(`OUT=file.json`, `SHOT_DIR=dir`, `FIGURES=file.png` for a model lineup).

| map | fps | frame p50 / p95 / max (ms) | CPU p50 / p95 (ms) | draw calls | triangles / frame | parse+BVH (ms) | first-frame compile (ms) |
|---|---|---|---|---|---|---|---|
| abyss | 92.2 | 9.6 / 16.3 / 305.9 | 9.4 / 15.8 | 282 | 2.49M | 177 | 649 |
| ascent | 129.9 | 8 / 10.3 / 18 | 7.7 / 9.8 | 230 | 1.29M | 161 | 65 |
| bind | 127.4 | 8 / 10.5 / 36.1 | 7.8 / 10.1 | 239 | 1.16M | 174 | 66 |
| breeze | 111.8 | 9.1 / 13.3 / 29.4 | 8.8 / 12.8 | 247 | 1.68M | 165 | 65 |
| fracture | 103.9 | 9.4 / 15.4 / 33.8 | 9.1 / 14.5 | 252 | 2.01M | 180 | 65 |
| haven | 132.7 | 7.9 / 9.8 / 36 | 7.7 / 9.4 | 225 | 1.23M | 173 | 66 |
| icebox | 114.7 | 8.9 / 11.9 / 36 | 8.8 / 11.5 | 257 | 2.29M | 160 | 64 |
| lotus | 120.2 | 8.3 / 11.9 / 36.2 | 8.1 / 11.6 | 249 | 1.47M | 174 | 66 |
| pearl | 111.9 | 9 / 13.9 / 36 | 8.6 / 13.2 | 247 | 1.59M | 178 | 69 |
| split | 105.6 | 9.3 / 14.5 / 52.8 | 9.1 / 13.8 | 247 | 1.46M | 190 | 69 |
| sunset | 118.4 | 8.5 / 11.7 / 36 | 8.3 / 11.4 | 270 | 2.07M | 187 | 68 |

All maps ≥ 92 fps, p95 ≤ 16.3 ms (Abyss, the slowest, had one 306 ms hitch in its first sample — a shader/GPU warm-up, not seen on the others).
Ten operators cost 40 draw calls (2 per body + 2 per weapon). Fogged views are bounded by the mesh's 390 k triangles per monitor (Icebox 340 k).

## B. Operators, weapons, first-person arms (`screens/matchday/models.ts`)

- **Figures:** four role silhouettes (controller: hooded long coat; initiator: recon pack, mast, helmet lamp; sentinel: broad, pauldrons, face plate;
  duelist: slim, swept crest, thigh/arm stripes). Team colour is carried by armour plates, a chest bar, armbands, cuffs (and glow accents);
  a wide emissive **visor** on the helmet shows where the player looks. One skinned mesh over a 13-bone skeleton + one glow mesh; geometry shared per
  (role, accent); weapons are 2 meshes shared per class. 8 weapon classes (rifle, carbine, sniper, smg, shotgun, lmg, pistol, handcannon).
- **Animation state from the track:** `animInputFor(round, player, pose, tMs, weapon, abilityMs?, speedUUps?)` → `selectAnimState(input)` → `AnimState`
  (`locomotion`: idle/walk/run/crouch/crouchWalk; `action`: aim/shoot/reload/plant/defuse/throw; `dead` with `deadT`; `kick`, `flash`, `gait`, `actionT`).
  Shots come from the kill feed (`shotTimesFor`), plant/defuse windows from `RoundTimeline`, abilities from `abilityUse` events when passed in, death from
  `deathMs`. Reload follows a gunfight (delay after the last shot).
- **Gaze (slicing the pie):** `AnimInput.aimYawRad` / `aimPitchRad` (+ `headingRad`, `travelRad`) read the engine's continuous aim when recorded; without them the
  figure looks along its heading. `AnimState.aimYawRel/aimPitch/strafe/slice`. The torso takes 60 % of the gaze (≤ 0.9 rad), the head the rest, the feet turn beyond ±1.5 rad,
  the weapon follows the spine, and strafing/slow slicing uses a side-step gait with lowered hips. Angles: game x/y counter-clockwise.
- **Posing:** `poseOperator(op, state, tMs, phase, aimPitch?)` — locomotion cycles, kneel for plant/defuse, reload with a magazine hand path, throw wind-up, a
  ragdoll-lite fall (topple, bounce, limp), two-bone arm IK to the gun's grips. Back-compat: `animateOperator(op, moving, tMs, phase)`.
- **First person:** `FirstPersonRig` (drop-in for `ViewModel`: `scene`, `camera`, `update(cls, state, tMs)`): gloved arms per weapon class, bob/sway, recoil + flash,
  magazine reload, kneel with our own device (hex puck) for plant/defuse, ability throw with an orb; hidden while dead. 5–8 draw calls.
- **Light presets:** `MAP_LIGHTING` (11 maps) / `lightingFor(map)` / `applyMapLighting({hemi, sun, scene}, root, mapId)`; returns the clear colour. Ascent keeps the previous look.
- **Integration (UI session):** `CamStage3D` still uses the old API (it compiles and renders; `animateOperator` is the compatible shim). To adopt: build the `AnimInput` per ally from the
  Frame/RoundTimeline (`animInputFor`), call `poseOperator`, replace `ViewModel` with `FirstPersonRig`, and call `applyMapLighting` in `lightForMap` with the loaded map id
  (today `MatchDayScreen`/`assets.ts` hard-wire `ascent`; other maps need the match to run on that map's geometry).
- **Tests:** `test/matchday/models.test.ts` (state selection incl. gaze, model building: no NaN, draw calls ≤ 4 per player with weapon, bone/IK reach, all roles × weapons × states, lighting).
  `npm run test:matchday`.
