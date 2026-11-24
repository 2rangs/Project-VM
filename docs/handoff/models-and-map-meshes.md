# Handoff — 3D models and map meshes (branch `claude/serene-goldberg-b05635`)

Full pipeline, tables and API: `docs/MODELS_AND_MAP_MESHES.md`. This page is the state of play.

## Done, default-on (renderer only — nothing touches the simulator, so no flag)
- **Map mesh pipeline** (`tools/map-mesh/blender/export-web-glb.py`, `export-all-maps.sh`, `report-table.py`): all 11 maps exported to
  `~/ProjectV-assets/maps/glb/<map>.glb` (outside git, never commit), roadmap-calibrated, verified on the exported mesh.
- **Models** (`screens/matchday/models.ts`): original skinned operators (4 roles), 12 weapon classes (added marksman, pump, sawnoff,
  autopistol), animation states (idle/walk/run/crouch/crouch-walk, aim/peek/shoot, reload, plant, defuse, throw, death), gaze yaw/pitch +
  strafe/slice, `FirstPersonRig`, spike device, smoke/wall/area/flash/orb placeholders, per-map light presets.
- **Wired into the cams** (`CamStage3D.ts`): per-player weapon class from the round buys, `poseOperator` from the track, fallen players stay 6 s,
  first-person rig, spike prop, ability placeholders (own team always, enemies only while in view), `applyMapLighting`.
  `timeline.ts`: `RoundTimeline.abilities` (from `abilitySpawn`), optional field.

## Flags
None. If a risk below worries the merger, the cheapest switch is `CamStage3D.updateAbilities` (one call) for the placeholders.

## Numbers
- Maps (390 k tris, 16.8–19.3 MB each): roadmap nodes within 15 uu of the mesh floor 78–97 %, vertical p95 5–19 uu, horizontal p95 0–50 uu,
  sight-table agreement 88–99 % (visible) / 96–100 % (blocked). Per-map rows in `docs/MODELS_AND_MAP_MESHES.md`.
- Cams harness (5 monitors + 10 operators, `test/perf.maps.mjs`): ≥ 92 fps and frame p95 ≤ 16.3 ms on all 11 maps; 40 draw calls for ten operators.
- Tests: `npm run test:matchday` 57/57, typecheck and build clean. App perf probe + `test:e2e` were queued (see the report; not a sim gate).

## Unfinished / next steps
1. **Other maps in the app:** `MatchDayScreen` / `assets.ts` hard-wire `ascent`. Next: pass the match's map id to `preloadMatchAssets(mapId)` and
   `CamStage3D.setMapId(mapId)` (already there) — only meaningful once matches run on that map's geometry.
2. **Gaze from the engine:** `selectAnimState` accepts `aimYawRad` / `aimPitchRad` / `travelRad` (peek and slice use them); the cams pass only the heading
   today. When the engine-truth session records continuous aim, add it to `animInputFor` call in `CamStage3D.render`.
3. **Ability classification:** `abilityKindOf` is keyword-based; check it against the engine's real `abilityId` strings and adjust the regexes/`ABILITY_LIFE_MS`.
4. **Visual polish not yet reviewed in a live match:** figures were checked in a lineup render only; peek lean direction and the reload hand path are
   untested by eye in the app.

## Known risks
- Map meshes decimated to 390 k tris: ~10–20 % of roadmap nodes have no floor under them (thin decks, stairs); ground probing falls back to the navgraph height.
  Icebox (78 %), Abyss (84 %), Breeze/Pearl (86 %) are the weakest.
- Enemy ability placeholders are gated by "caster currently seen"; a smoke can vanish when its caster leaves view.
- `CamStage3D` is also edited by the matchday-uiux session: expect a small merge around `render()` (animation/weapon section) and the ViewModel removal.
