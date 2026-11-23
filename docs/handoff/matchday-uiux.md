# Hand-off — matchday-uiux (live match view, home, loading screens)

Branch `claude/matchday-uiux-efc023`. All code is under `apps/desktop/**` plus one Blender script
(`tools/map-mesh/blender/export-web-glb.py`). Not merged, not pushed by this session.

## Done and verified in the running app
- **Live match view** (`src/renderer/screens/matchday/`, logic in `src/renderer/matchday/`):
  tactical map mode (2D, PixiJS) and team cams mode (five first-person 3D views, three.js, one
  renderer with scissored viewports, 30 fps cap), mode toggle persisted. Coach view = our team's fog
  of war only. Rounds play in full at 1× by default (0.5–8×), no auto-advance, event jumps,
  spoiler-free timeline, round summary. Original icon set, agent/role tags, no straight lines
  between zone centres. Verified at 1920×1080 and 1280×720 in ko/en, full matches in both modes.
- **Real Ascent mesh** for the cams: `export-web-glb.py` builds it from the user's `.blend` (Ascent:
  380 k tris, 17.6 MB, navgraph-calibrated). Loaded from gitignored `apps/desktop/assets/maps/`.
- **Asset preload during the game load**: the 3D map and minimap are prepared while the match is
  simulated; opening the cams starts no load (first 3D frame 240–420 ms after the switch, measured).
- **Home screen** (`screens/home/`): lobby with next match + PLAY, starting five, club stats,
  career, quick links; default route. Verified: no overflow, nothing blocked at 1920/1280, ko/en.
- **Loading screens** (`src/renderer/loading/`): sim progress "라운드 n · a–b", session start,
  series prep/quick map, season advance, app-start splash; errors show a message with retry/close.
  Verified for the one-shot match path (shows progress, closes, no error panel).
- Unit tests: `npm run test:unit` (50) and `npm run test:matchday` (29) pass. Typecheck passes.

## Half-done — where it stops
- **Match load screen** like the game's pre-match screen (`loading/MatchLoadScreen.tsx`: map name
  large in the centre, two line-ups facing each other with side labels, VS, progress). Typechecks,
  wired into one-shot and interactive starts; **never seen running**. The line-up tiles use role
  glyphs and team colours, not agent portraits or player cards.
- **Selectable loading banner**: four original build-up banners (`StreakBanner.tsx`) chosen in
  정보 → 로딩 배너, plus a slot for the user's own banner files (`assets/banners/<name>/1..5.webm|png…`,
  gitignored, listed via IPC `pv:asset:banner-list` / `-file`). Typechecks; picker and local packs
  **not run**. e2e checks for the banner choice were added but have not passed yet.
- **Game assets (user decision: Kingdom Archives / valorant-api assets are fine to use).** Done at
  runtime / locally, nothing in git:
  - Kill banner: the default kill banner layers (frame, ring, emblem, pip + 1–5 kill sounds) from
    kingdomarchives.com are downloaded to the gitignored `apps/desktop/assets/banners/default/` and
    composited like the game (`LayeredBanner` in `StreakBanner.tsx`: pips light 1 → 5 with
    progress). It appears in 정보 → 로딩 배너 as "default". Sounds are downloaded but not played yet.
    Other skins: same folder layout (`*Frame*.png`, `*Ring*.png`, `*Emblem*.png`, `*Pip*.png`).
  - Match load screen: agent portraits and the map splash from valorant-api.com (fetched at runtime,
    like the minimap); falls back to role glyphs offline.
  - Typechecked only — **not seen in the running app**.

## Known problems
- **Main e2e**: the last run got past the one-shot match, loading screen and live view, then failed
  at line 100 because the opponent-POV select is disabled in team-cams mode and the view mode had
  persisted as cams. The test now selects the tactical map first; **not re-run** (wrap-up).
- `e2e.series.test.mjs` was updated (enters via home) but not run to completion this round.
- `test/review.test.ts` fails under node strip-types (JSON import attribute) — pre-existing, not in
  `test:unit`.
- Large mesh: the 600 k export renders ~3 M tris per wall at 1920; fine on this Mac (≈1 ms CPU), GPU
  time not measured. Software GL (CI flags) cannot run the real mesh.
- Cams on the real mesh: the engine's sight is zone-to-zone, so a "seen" enemy can stand behind real
  geometry (drawn as a through-wall marker).
- Home "next match" is the default pairing, not a fixture — there is no schedule data yet.

## Overlap with career-shell (important for merging)
The career-shell session is building a Home hub, the App.tsx shell and a start menu. This branch
also adds `screens/home/` and edits `App.tsx` (default route `home`, a `home` route) and `nav.ts`
(a `home` item). Merge one home, not two: keep career-shell's shell/start flow and either drop
`screens/home/` or mount its blocks (next match, starting five, club, quick links) inside their hub.
`HomeScreen` takes optional `inbox` / `calendar` props for that purpose.

## Next steps, in order
1. Rebuild and run `test:e2e` once under `heavy-run.sh` (expect it to pass after the POV fix).
2. Run `test:e2e:series` once (under `heavy-run.sh`).
3. Look at `MatchLoadScreen` in the app at 1920×1080 and 1280×720 (ko/en); fix layout; screenshot.
4. Run the banner picker; put a test pack in `assets/banners/test/` and check it plays and is chosen.
5. Play the downloaded kill sounds per step (opt-in, volume setting); add more banner skins.
6. Reconcile home with career-shell (previous section), then replace `docs/screenshots/*` and the
   README images.
7. Engine-side improvements the view would use: per-player facing / health / weapon / ult, per-player
   observations, walkable polylines per edge (see README "Approximations").

## Rules followed / to keep
- One heavy job at a time: wrap e2e, captures, batches in
  `/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "<label>" -- <cmd>`.
- No game asset, map geometry or banner media in git (`assets/maps/`, `assets/banners/` ignored).
