# @pv/desktop

PROJECT V desktop app — a **manager-game-style** front end (Electron + Vite +
React + TS, DECISION-007) over the PROJECT V simulation and data packages. It
adopts sports-manager **information conventions only**; no third-party game's
branding, screen designs, icons or colour schemes are copied.

![Match Day](docs/desktop-matchday.png)

Shell: left nav (MATCH / TEAM / CLUB / DEV), a top context bar (team · season ·
next match · Continue), main content, and a right detail panel. DECISION-001 —
the match/data screens work first; club ops are reserved "준비 중" placeholders.

Contents: [Run](#run--build--verify) · [Screens](#screens--data-sources) ·
[Match Day](#match-day) · [Review](#round-decisions-post-match-review) ·
[Series](#series--map-veto) · [Architecture](#how-a-match-reaches-the-screen) ·
[Security](#security-posture) · [Open items](#open-items)

## Run / build / verify

```bash
# once, at the repo root: the engine packages are bundled from workspace source at build time
# (the tsx reference scripts and test:engine also need this install)
pnpm install --frozen-lockfile
cd apps/desktop
npm install

npm run dev                                   # electron-vite dev
npm start                                     # build + run the built app
npm run typecheck                             # tsc --noEmit
npm run build                                 # → out/{main,preload,renderer}

npm run test:unit                             # IPC contract, trace parser, i18n, match merge, round decisions, series view, navigation debug model (48)
npm run test:matchday                         # live match view logic: graph, timeline, visibility, monitors, playback, blockout (29)
npm run build && npm run test:engine          # engine contract (run-match output, options, tracks) + bundled-engine determinism: bundle vs. tsx source, staged data (9)
npm run package:mac                           # → dist/mac-arm64/PROJECT V.app (build + stage engine data + electron-builder + content check)
npm run test:e2e:packaged                     # copies the .app out of the repo, plays a quick match, screenshots it
npm run build && npm run test:e2e             # Playwright _electron E2E + screenshots (macOS / Windows: opens a real window)
npm run build && xvfb-run -a npm run test:e2e # the same on Linux, headless
npm run build && npm run test:e2e:series      # full Bo3 through the veto + Match Day, in Korean and English
```

Notes:
- The match engine runs **inside the app**: `@pv/match-runner` and everything under it are bundled
  into `out/main/engine-host.js` and run in Electron utility processes (see "How a match reaches
  the screen"). At run time the app needs **no tsx, no Node on PATH and no workspace install**;
  in development it reads the engine's data files straight from the repository.
- The shared `ReplayViewer` source lives in `../replay-viewer`; `react` / `pixi.js`
  are resolved from *this* app's `node_modules` (`resolve.dedupe` in
  `electron.vite.config.ts`, `paths` in `tsconfig.json`), so no install is needed there.
- `test:engine` needs the repo-root install (`node_modules/.bin/tsx`) and, for the determinism
  half, a current `npm run build` (it **fails**, not skips, without the bundle). Run it after any
  engine change: it proves the bundled engine and the tsx source path give the same bytes.
- `test:e2e` needs Playwright, which is not a dependency of this app: set
  `PLAYWRIGHT_REQUIRE_BASE` to a directory whose `node_modules` has `playwright`
  (e.g. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright` in a temp dir; no
  browser download is needed for `_electron`). It pins the UI language to Korean,
  plays one-shot and interactive matches, turns the navigation developer view on, checks the
  round-decisions view in both languages and the opponent-memory option, and **rewrites the PNGs in
  `docs/`** (restore them with `git checkout -- docs` unless the screens really changed).
- `test:e2e:series` (same Playwright setup) plays a whole best-of-three twice — Korean, then
  English: a first ban against the staff advice, the AI's replies, map 1 through Match Day in one
  go, map 2 round by round, a decider if needed, the summary — checks for sideways overflow at
  1280×720 and 1920×1080, and writes `docs/desktop-veto*.png` / `desktop-series-summary*.png`.
- Heavy runs (every e2e, the packaged smoke test) go one at a time on the shared Mac:
  `/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "<label>" -- npm run test:e2e`.

Windows is the first target (README §07). Development and verification were on Linux
(Electron under `xvfb` + SwiftShader) and, since 2026-11-20, on macOS. If Electron can't be
installed, the renderer still runs in plain-browser mode (`window.pv` absent → in-page
`StubRunner` + bundled fixtures; see `src/renderer/platform.ts`).

## Screens & data sources

The app opens on a **start menu** (New career · Continue · Load · Settings · Quick Match · Quit);
no engine runs until a match is played. A career is the calendar loop described in
[`docs/CAREER_MODE.md`](../../docs/CAREER_MODE.md): Home (Continue), Inbox, Schedule, Standings
and the manager's match days through the series screen with the career world's players. The
screens below the career group are also reachable without a career under **Quick Match**.

| Screen | Status | Data |
|---|---|---|
| **Start menu · New career · Home · Inbox · Schedule · Standings** | working (career) | `@pv/career` calendar / competition / inbox (`screens/career/*`, `career/session.ts`); AI series through `scripts/career-sim.mts` (match-runner, separate process) or the quick estimate; save slots in `<userData>/saves` |
| **Match Day** | working (REAL sim) | `@pv/match-runner` in a separate process (one-shot map or interactive round-by-round session with tactical timeouts and coach orders); real team select; coach note from a real PV-3 trace. While a match is on, the screen is the full-window **live match view** — tactical map / team cams, our team's fog of war, belief overlay, navigation developer view |
| **Match Day → Review (post-match)** | working (REAL sim) | match-runner summary + replay: round results, **round decisions** (each team's read, call, plan changes), economy timeline, timeout log, MVP, ground-truth replay |
| **Series · Map veto** | working (REAL engine) | `@pv/match-runner` series layer (`createSeriesSession`): Bo1/Bo3/Bo5, step-by-step veto vs the AI, per-map mastery + scouting, maps played through Match Day |
| **Squad / Player Profile** | working | PV-2 `player_ratings` + `player_names` — 402 real VCT players, 1–20 grid, uncertainty, explicit null |
| **Opponent Report** | working | PV-2 `team_profiles` + `team_names` — 70 real teams, economy + map pool |
| **Tactics** | working (list) | PV-1 `ascent-tactics` (provenance tags shown) |
| **Agent Select** | working (data) | PV-1 `ascent-comps` (win rates + CI, role templates) |
| **Dev → Decision Debugger** | working | real PV-3 `@pv/decision-debugger` traces (Handoff §21) |
| **About** | working | pre-release real-names disclaimer; language switch |
| Finance / Transfers / Training | 준비 중 | — (club operations: hook API in `docs/CAREER_MODE.md` §6) |

Data fixtures are copied from PV-1/PV-2 branches; see `src/data/README.md` and
`test/fixtures/traces/README.md` for exact sources. All values are
**synthetic/estimated**. Real VCT **professional** player/team names are shown by
user decision for pre-release internal development only — license / name /
likeness rights must be re-reviewed before any launch. The `.vrf` sample players
(non-pro) stay anonymous (`player_N`).

## Home (lobby)

![Home](docs/desktop-home.png)

The app opens on a full-window lobby (`src/renderer/screens/home/`). It follows the design
language of the game's 5.08 interface refresh as published — less ornament, higher contrast, one
clear call to action, symmetric team presentation with a VS, `NN // LABEL` section heads and a
centred trapezoid PLAY tab — re-drawn with this project's own icon set (`screens/matchday/Icons.tsx`);
no game artwork, logo or icon is used.

| Block | Data |
|---|---|
| Next match + **PLAY** | our club / opponent / map: the same defaults Match Day opens with (`HOME_CLUB`, `HOME_OPPONENT` in `HomeScreen.tsx`). PLAY, the top-bar tab and the Series button lead to Match Day and Series |
| Starting five | the first five players of our club's game-data roster — the slots the engine fields — with the agent of their slot (and that agent's role) and 1–20 estimates (overall = mean of aim, reaction, positioning, impact, trading, consistency) |
| Opponent five | the opponent's first five roster players, with the slot's agent and overall estimate; opens Opponent Report |
| Club | attack / defense win rate, maps on record and most-played maps from `team_profiles.json` |
| Career | season and population from the career world (`career/store.ts`); optional `inbox` / `calendar` props let the career shell add its previews |
| Go to | every working screen of the manager shell |

`홈` in the left nav returns to it. There is no scheduled fixture list yet, so "next match" is the
default pairing, not a calendar entry.

## Loading screens

One original design (`src/renderer/loading/`: CSS + inline SVG, no game assets) covers every wait:

| Wait | What is shown |
|---|---|
| App start | a static splash in `index.html` (visible before any script runs), replaced when React mounts; if the app never mounts a help line appears after 12 s |
| One-shot match simulation | `LoadingScreen` with **round and score** as they are played (`run-match.mts` writes one `PVPROGRESS` line per round → `SimProgress.round/score`; the bar is the leader's score out of 13) |
| Interactive session start | `LoadingScreen` until the session answers |
| Next round of a session | an inline chip on the stage ("라운드 N 시뮬레이션 중…") |
| Series preparation / quick-simulated series map | `LoadingScreen` with `맵 n/m`; the series worker replies once per map, so there is no per-round counter here |
| Season advance (Scouting) | `LoadingScreen`; the work is synchronous, so the screen is painted first and the season runs on the next tick |
| Live-view assets (3D map mesh for the team cams, minimap image) | **prepared during the game load**: `screens/matchday/assets.ts` starts with the simulation / session start and the loading screen waits for it ("3D 맵 · 맵 이미지 준비 중…", capped at 20 s). The cams' renderer is created with the live view and warmed up, so switching to the team cams starts no load. Inline chips remain only for the case of re-opening the view before the preload has settled; a mesh that fails to parse says so and the blockout is used |

The emblem on every loading screen is a **streak banner** (`loading/StreakBanner.tsx`): it builds
up in five steps — core, ring, cap and ticks, wings, outer ring, burst — the way a shooter's kill
banner escalates from one kill to five. With real progress the steps follow the work (20 % each,
with a five-pip counter); without it the banner loops 1 → 5. Four original variants (스탠다드 /
프리즘 / 포지 / 시그널) can be chosen in **정보 → 로딩 배너**; the choice is stored in `localStorage`
(`pv-loading-banner`). They are drawn for this project — the game's own kill banners are
third-party artwork and are not shipped or downloaded.

Rules: a loader is rendered only while its work is pending (it owns no timers, so it cannot outlive
the work), the inline chips never take input, and a failure turns the same surface into a message
with **다시 시도 / 닫기** instead of a spinner. Usage is documented at the top of `loading/Loading.tsx`.

## Match Day

### Pre-match options (match setup)

**⚙ 경기 옵션 / Match options** on Match Day exposes the `MatchConfig` options that
are a team's or organiser's choice; they apply to both one-shot and interactive
matches and lock while a session is live:

- **상대 기억 / Opponent memory** (`opponentMemory`, default on) — off makes both
  teams play every round like the first; the Review then shows no reads.
- **최소 쓰로잉률 / Minimum throw rate** per team (`minThrowRates.teams[teamId]`,
  /s, default 0) — a floor on how often a player breaks a winning post-plant hold.

Only non-default choices are sent, so a default match is exactly the engine's
default config. Per-player floors (`minThrowRates.players`) pass through the IPC
types and scripts but have no UI yet. The engine tunables in `MatchConfig.tuning`
(crossfire slope, info half-life, save thresholds, moving-shot stopping time, …; listed in
`docs/STAT_OUTCOME_MATRIX.md` §5 at the repo root) are deliberately not exposed.

### Live match view (while a match is played or watched)

Starting a match (one-shot or interactive) opens a full-window broadcast-style screen
(`src/renderer/screens/matchday/`, logic in `src/renderer/matchday/`). **◂ 로비** returns to the
shell without stopping the session; the shell's Match Day then shows the score so far and a
button back into the match. Look and layout follow tactical-shooter spectator-HUD conventions
(top-centre score and round clock, rosters left/right, kill feed, spike timer, angular panels,
ally teal / enemy red); no Riot logo, font, icon or screen is copied. Team colours are always
doubled by shape (ally circle, enemy diamond, sound ring, spike hexagon).

Icons are an original set (`screens/matchday/Icons.tsx`): solid single-colour glyphs on a 24 px
grid with 45° terminals, in the spirit of the game's published iconography guide but drawn for
this project — none of the game's icons, role symbols or logo are reproduced. The top-left
breadcrumb (`로비 // 경기`), `//` section labels and the symmetric VS card before round 1 follow
the same language. Each player carries their engine slot's agent name and role glyph (the fixed
comp the match-runner fields, mirrored in `matchday/roster.ts`).

Two view modes, switched with the toggle top-left (or `M`); the choice, the playback tempo and
the belief overlay persist in `localStorage` (`pv-matchday-view`):

| | Tactical map (`전술 맵`) | Team cams (`팀 캠`) |
|---|---|---|
| ![tactical](docs/screenshots/matchday-tactical-map.png) | The 2D map is the centre and largest element; our roster + team intel left, opponent roster + kill feed right, score/clock top, transport + coach actions bottom. Nothing scrolls at 1280×720 or 1920×1080. | |
| ![cams](docs/screenshots/matchday-team-cams.png) | | Five **first-person 3D cameras**, one per player of our team, plus the team's shared 2D picture. Camera at the player's position and eye height, looking along their facing; CAM id, name, LIVE/OFFLINE, round time, what they are doing, a radar inset. Death → "신호 없음" (signal lost). Click a monitor to focus it. |

Shared by both modes — **a round is watched in full**: it plays from the round start to the round
end in real time (1× by default; 0.5×/2×/4×/8× on request) and then stops. Nothing advances on its
own: the next round starts from the round summary (result, reason, kills, credits, buys and — when
the bridge passes `RoundRecord.decisions` through — our own plan changes) or the `다음 라운드`
button; `자동 진행` / `연속 재생` is an explicit opt-in. Controls are always on screen: play/pause,
speed, a scrubber over the round, previous/next event, and skip-to-round-end as a deliberate
choice. `Space` = play/pause, `←/→` = previous/next event (a jump lands 1.5 s before the event).

Nothing reveals a round before it happens: score, clock, alive pips, rosters, kill feed and the
round chip all follow the playhead, and the scrubber only marks events (kills, plant, defuse,
timeouts) up to the furthest point you have watched — a round you have already seen keeps its
marks. Banners appear when they matter (spike planted + countdown, 1 v N clutch, opponent
timeout), and the tactical timeout opens the orders sheet over the stage.

#### Players are drawn where the engine recorded them

The engine moves every player along its navigation roadmap and records a position on every tick
(`MatchConfig.recordTracks`, requested by `scripts/run-match.mts`, `match-session.mts` and
`series-session.mts`). The live view draws exactly those positions — consecutive samples joined
linearly — so players walk along the real corridors and nobody is drawn crossing a wall
(`packages/match-runner/test/movement-floor.test.ts` checks every recorded position of whole matches
against the roadmap). Each round's replay starts with one zero-length move per player, so a player
who never leaves their spot still has a position.

The view itself still invents nothing: no movement trails, plan arrows or rotation lines in the
normal view; the only lines on the map connect two real positions in a fight (a player and the
enemy they see). Planned routes and walked traces exist only in the developer view below. For a
replay with sparse tracks (an older engine: one keyframe per zone arrival) the player stays on the
origin zone, the destination zone is ringed and an arc shows how far along the hop is — never a
straight line between two zone centres. The 3D blockout — used only when no map mesh is installed —
is a schematic of the zone graph, so its corridors are straight; the older `ReplayViewer` (Review's
full-view replay and Dev) still interpolates between keyframes through `@pv/replay-engine`.

#### Navigation (developer) view

![Navigation developer view](docs/desktop-nav-debug.png)

The **내비게이션 (개발자) / Navigation (developer)** checkbox at the bottom right of the tactical map
(off by default, not persisted) draws engine output only — nothing is re-planned in the renderer:

- the walkable floor as the engine's roadmap knows it (`src/data/sim/ascent.nav.json`), one-way
  drops in their own colour, and the zone graph with every zone ringed green (connected) or red (not);
- for each player of the viewed team: the destination, the planned waypoints still ahead (coloured
  by route preference — fastest / safest / quiet / tactical), the walked trace, replans and refused
  paths, and ground patches priced into the plan;
- a panel beside the map that says, per player, WHY that route: what the order is for → goal ·
  route preference · zones avoided (from the team's belief) · length · time.

Source: `RoundRecord.navTrace` → `MatchRoundSummary.nav`; model `src/renderer/matchday/navdebug.ts`
(unit-tested in `test/navdebug.test.ts`). Engine side: `docs/research/NAVIGATION_ENGINE.md` at the
repo root.

#### The coach sees only what the team knows
The default view is OUR team's fog of war: our players, enemies while one of our players sees
them, remembered sightings (hollow, fading with age), sound cues, and — public information —
kills and the planted spike. The opponent's real positions are never drawn otherwise. The
`시야` select can switch the tactical map to the opponent's fog for debugging (labelled
"디버그"; the app had that POV switch before); the cams are always our team. Ground truth stays
in Dev.

#### Data each mode uses
| Source | Used for |
|---|---|
| `Replay.tracks` (per-round `move` events, one per player per tick while moving) | our players' positions; enemies only once gated by perception |
| `Replay.events` kill / plant / defuse / roundEnd | kill feed, spike state and clock, round result, monitor states |
| `Replay.perception[team]` snapshots (500 ms) | observed enemies, sound cues, belief zones |
| `MatchSummary.rounds[]` | attacker (engine id → team), buys/weapon, economy, score, round decisions, navigation trace |
| `src/data/sim/ascent.navgraph.json` | zones, travel edges, sightlines, sound links (vision/hearing rules, blockout) |
| `src/data/sim/ascent.nav.json` | the navigation roadmap, for the developer view (and the in-app round simulator) |
| `@pv/game-data` `rosters.json` (read-only import) | engine slot 1..5 → real player handle |

#### Approximations (derived in the renderer — and the engine field that would make each exact)
| Shown | How it is derived today | Exact with |
|---|---|---|
| Movement | **Exact**: recorded per-tick positions (above). Only a replay with sparse tracks falls back to "stay on the origin zone + ring the destination", with a small per-player offset separating players that such an engine stacks on one point | — |
| Facing | derived: along the recorded motion while moving, toward the choke on the enemy-spawn → here path when standing, toward the opponent during a duel (the engine itself faces a mover toward the next zone of its route) | `TrackFrame.players[].facing` (a policy `aimZone` overrides the default and is not exported) |
| Which of OUR players sees an enemy | team snapshot `currentlyVisible` ∩ the engine's `canSee` (alive, ≤ 4500 uu, 110° cone, zone sightline) evaluated per player, ∪ the opponent of a kill event the player is in. The team snapshot is the upper bound | per-player `visibleEnemyIds` in the perception snapshot |
| Duels | a kill resolves in one engine tick; the two players are shown squaring up 1.2 s before it | `engage` events (dropped by the replay bridge) with real duel timing |
| What a player hears | team sound cues filtered by loudness × sound-link attenuation to the player's zone; our own footsteps removed by zone | per-player `heardSounds`, and a source team on each cue |
| "Last seen N s ago" | recomputed from when an observed-enemy entry appears/changes (`lastSeenMsAgo` is always 0 in engine output) | a correct `lastSeenMsAgo` |
| Planting / defusing | `[done − 4 s / 7 s, done)` from the plant/defuse events | `plantStart`, `defuseStart`, `defuseInterrupted` (dropped by the bridge) |
| Health / armor / per-player weapon, ult, abilities | **not shown** — the roster shows alive/dead, the team's bought weapon, team credits and ult points | `health`, `armor`, `weaponId`, `ultimatePoints`, ability charges per player per frame |
| Spike carrier before the plant | not shown | `spikePickup` events / carrier id |

#### 3D cams: map mesh and blockout
`CamStage3D` (three.js) renders all monitors with ONE WebGL renderer and scissored viewports,
capped at 30 fps; the 2D map (PixiJS) keeps its own canvas and pace.

- **Figures and view model are original.** Players are a procedurally built stylised operator
  (dark fatigues, team-coloured plates and visor, generic rifle, walk cycle); each monitor also
  draws a first-person view model (generic gloved hands + rifle or pistol silhouette, bob while
  moving, recoil and muzzle flash around the kills that player is part of). No character, weapon or
  skin model from the game or any third party is used; identity comes from team colour and the
  player's handle. An enemy the engine counts as seen keeps a marker and name tag that are drawn
  through walls.
- **Blockout (always available; used when no mesh is installed).** Generated at runtime from the navgraph: a round room
  per zone, a walled corridor per travel edge, zone heights, plant areas, callout labels. No wall
  ever stands in a travel lane or across an authored sightline (unit-tested), so it never
  contradicts the simulation. Everything above works on it.
- **Real map mesh (optional, never in git).** If `apps/desktop/assets/maps/ascent.glb` exists
  (gitignored; `PV_MAP_ASSETS_DIR` overrides the folder) the cams load it instead. Build it from
  the user-provided `.blend` with headless Blender 4.2:
  ```bash
  Blender --background --factory-startup --python tools/map-mesh/blender/export-web-glb.py -- \
    --blend <assets>/maps/raw/Ascent.blend --map ascent \
    --navgraph apps/desktop/src/data/sim/ascent.navgraph.json \
    --out <assets>/maps/glb/ascent.glb --report <assets>/maps/glb/ascent.report.json \
    --link apps/desktop/assets/maps/ascent.glb --target-tris 380000
  ```
  The script drops vista/foliage/clutter, bakes material colours into vertex colours (no
  textures leave the .blend), joins per collection, decimates, **calibrates the Blender→game frame
  against the navgraph** and bakes it so sim coordinates map straight onto the mesh. Ascent:
  3.32 M → 380 k triangles, 17.6 MB, 10 draw calls; calibration = 100 uu per Blender metre with y
  flipped (22/22 zone centres over geometry, 17–18/22 on a floor within 0.6 m; the next-best axis
  assignment scores 8).
- **Known limits on the real mesh.** Positions are continuous now, so a monitor's camera moves with
  the player instead of cutting from zone to zone (this was not re-checked on the real mesh in the
  navigation work — only the 2D map was watched). The engine now decides sight
  between real positions on Ascent, but the monitors still take "seen" from the team snapshot, so an
  enemy counted as seen can be behind real geometry for that one player — its marker is drawn through
  walls rather than hidden; per-player observations would fix that.
- **Measured** (this Mac, 1920×1080, 1× playback, before the view model was added): wall render 0.8–1.4 ms CPU
  per 30 fps tick on the blockout (8 k triangles, 72 draw calls) and ≈1.1 ms with the 600 k-triangle
  mesh (2.0 M triangles per wall render; the 380 k export above is lighter still); the page stayed at 16.6 ms/frame (p95 17.4 ms) in both.
  CPU-side timings only — GPU time is not measured. Under software GL (the e2e flags) the tactical
  map runs at ≈12 fps; the real mesh is not usable there.

#### Readability aids (tactical view)
Matchup strip (players alive, us vs them), keys **1–5** / roster click to highlight one player with a pulsing ring
(**Esc** clears), site labels emphasised, key hints in the map corner.

#### Kingdom Archives player cards
`assets/playercards/` holds a pool of player cards (wide + large art) from [Kingdom Archives](https://kingdomarchives.com)'s public
distribution, committed at the user's decision (subject to release review); refresh with `node scripts/fetch-playercards.mjs`.
The match load screen gives every player one (stable per player) plus an account level, like the in-game screen. Without
the folder it falls back to the plain gradient (e2e runs point `PV_MEDIA_ASSETS_DIR` at an empty folder to cover that).

#### Economy, plans, gaze, sound and duels (UI-1 … UI-6)
Each item reads what the engine records and says so when it falls back (`시야: 근사치`, "no duel records"):

| Item | Where | Reads | Without it |
|---|---|---|---|
| **Economy** (UI-6) | our roster rows: weapon + how it was obtained (kept / bought / `<name> 드롭`), credits entering the round, ult points carried in; opponent rows: weapon only | `buys[team].players` (PlayerBuy), `economy[team].players` of this and the previous round | team weapon only, as before |
| **Buy call** | left panel under the roster, **our team only** (the opponent's reasoning is not information a coach has) | `buys[team].plan / loadoutValue / vctTier / call / evaluation / drops` — plan, coach call, the alternative it beat, who dropped to whom | hidden |
| **Gaze** (UI-1) | vision cones and the facing used by the 3D cams come from the sim; the cam caption shows what the player is looking at (enemy / threat / holding / route) and a flash-blind tag | `RoundSummary.sight[].facing / gaze / blind` | engine-rule estimate, labelled approximate |
| **Sound** (UI-3) | rings by kind (footstep, gunfire, landing, defuse / plant in the spike colour); masked cues drawn faint with a slash and tagged | perception `sounds[].kind` and an optional `masked` | footsteps and gunfire only |
| **Plan** (UI-5) | our plan's mid-round revisions as ticks on the timeline (shown as they are reached); opening → final call and any fake in the round summary | `decisions.plans[team]` (opening, strategy, feint, revisions) | — |
| **Duel cards** (UI-2) | round summary → "교전 카드": who saw first, pre-aim, crossfire, angle delay, call info, flash, winner | `RoundSummary.engagement` (the engine's `engagementTrace`) | says the engine sent none |
| **Comms feed** (UI-4) | **not built** — the engine records no calls with delay and noise yet | — | — |

Per-frame `sees`, `facing`, `gaze`, `blind` and the duel records exist on `RoundResult.tracks` /
`engagementTrace` but are not on `RoundRecord` yet (requested from the engine-truth session); the
desktop scripts pass them through (`scripts/compact-round.mts`) as soon as the record carries them.

## Round decisions (post-match Review)

![Round decisions](docs/desktop-review-decisions.png)

The Review tab's **라운드별 판단 / Round decisions** card shows *why* each round went
the way it did, from the engine's `RoundRecord.decisions` (`@pv/match-runner`;
background in `docs/CONTINUOUS_TACTICAL_INTELLIGENCE.md` at the repo root). Pick a
round; for **both teams** it reads as an analyst's note:

- **들고 들어간 상대 리딩 / Read of the opponent going in** — where the team thinks
  the opponent attacks and defends (`opponentReadBefore`). The estimate that matters
  for the side it plays this round is tagged *used this round* (attacking → where
  they defend; defending → where they attack); the other is a compact reference
  line. Each shows the lean ("A 쪽 68%"), an A|B split bar, and confidence with the
  sample count. **Thin evidence is visibly weak**: no data → grey hatched bar,
  "근거 없음", no percentage; low confidence (< 0.4, i.e. about one round of
  evidence) → hatched bar, dashed amber frame and a note that it barely moves the
  call; medium < 0.6 ≤ high. With opponent memory off the read is `null` and the
  card says so.
- **콜 / The call** — opening call → final call, the objective site, and the fake
  ("A를 먼저 보여준 뒤 전환") if any. When the team held a read at medium+ confidence,
  one line says whether the opening went **with** it (defence stacks the expected
  site; attack goes away from the expected stack), **against** it, or picked no site.
- **플랜 수정 / Plan changes** — every revision with the round clock remaining
  ("1:23 남음"), from → to, and the engine's reason. No revisions → "수정 없음".
- **라운드가 끝난 뒤 / After the round** — whether the read held up against what the
  round showed (plant > first contact for the defence; where defenders fell for the
  attack), and what the team learned (the evidence its model takes into the next round).

Above the picker, **경기 전체: 상대에 맞춰 적응했는가 / Did they adapt?** totals per
team: rounds with a mid-round plan change, fakes, openings with / against the read,
and how often the read was right. The picker marks rounds with a plan change (●) or
a fake (F). So "why did they rotate?" is the plan-change line of that round, and
"did they adapt to us?" is the read + with/against line across rounds and the summary.

Data path: `scripts/run-match.mts` / `scripts/match-session.mts` pass `decisions`
through untouched → `mergeMatch` (`src/shared/match-merge.ts`) →
`MatchRoundSummary.decisions` (`src/shared/ipc.ts`) → view model
`src/renderer/decisions.ts` (pure; unit-tested in `test/decisions.test.ts`) →
`src/renderer/screens/DecisionsPanel.tsx`. The two judgements the view adds on top
of the engine data (with/against the read, read right/wrong) are computed and
documented in `decisions.ts`; everything else is shown as recorded. Matches from an
engine without `decisions` (or the browser stub) show "판단 기록이 없습니다".

**Plan-change reasons are localised by parsing.** The engine writes each revision's `reason` as
an English sentence ("spike planted — retake call", "3 runners heard on B, no contact on A —
P(hit B) 0.62, fake 0.11 — rotate 2", …). `src/renderer/decision-reasons.ts` (`parseReason`)
recognises every sentence `@pv/team-engine` writes today — retake call, swing off a stacked site,
clock commit, player advantage, save / un-save, exit-kill chase, and the defensive rotation with
its evidence and odds — and the Review renders them from `rev.dec.reason.*` in Korean or English
(probabilities as percentages; the engine sentence stays in the tooltip). A sentence the parser
does not know is shown verbatim, so a new engine reason is never lost, only untranslated; add a
case to `parseReason`, the keys to `ko.ts` / `en.ts`, and a line to `test/decisions.test.ts`.
Revision `from` / `to` are parsed the same way (`parseCall`: strategy ids incl. the three-site
`cExecute` / `stackC`, the `" (slow)"` suffix, `"commit A|B"`, `"stack A ×3"`, `"support B ×1"`,
`"hold"`). If the engine later emits a reason key + params, both parsers can be dropped.

## In-match management, half-time, match prep

Full model and formulas: `docs/MATCH_MANAGEMENT.md` at the repo root (Korean).

- **Match Day → 상대 분석 · 경기 계획 / Opponent report · match plan** (interactive mode): build the opponent report
  (their simulated recent film read through the scouting model: preferred sites, pistol and eco habits, key players,
  map mastery; thin samples are tagged), take its suggested plan or set your own (attack / defensive lean, tempo,
  risk, defensive set-up, pistol calls, the call after a lost pistol, start our read of them from the report).
  Plant spot, post-plant, retake and mid control are shown disabled — they wait for the engine-truth / maps-data work.
- **Live view → 감독 지시 / Manager** (top right): alerts, the timeout left this half (opens the orders panel), standing
  instructions (tempo / risk / defense), a strategy for the next N rounds, and each player's state of mind
  (★ key player, tilted / shaky / steady / confident, personality tags). A 0–4 run, a broken economy, a player
  tipping into tilt or half-time **stops auto-play and opens the panel**.
- **Half-time team talk**: four talks; each player reacts by personality (lifted / unmoved / rattled). Skippable.
- **Review → 감독 결정 요약 / Manager decisions**: both managers' decisions (the opponent's is the AI) with the rounds won
  in the three rounds before and after, tilt three rounds later, talk reactions, and a tilt chart per team.
- Series maps are played with the same layer (through the series host). One-shot matches stay plain `runMatch`.
- **Default off — Match options → 감독 실험 기능 / Manager experimental**: turns on the engine flags `moodEffects`
  (state of mind affects play), `aiManager` (AI uses shouts, talks, attribute-driven timeouts) and `timeoutsPerHalf: 1`.
  Off, moods are shown but do not affect play, and the AI behaves as before. Not validated against the balance gate.

Data path: `scripts/match-session.mts` (now `createManagedSession`; commands `setShouts`, `setStrategy`, `teamTalk`)
and `scripts/series-session.mts` (same commands, seat ⇄ slot) → `scripts/manager-view.mts` (state from our seat) →
`src/shared/manager.ts` → `useMatchSession` → `screens/matchday/{ManagerPanel,PostMatchSummary}.tsx`;
`scripts/prematch.mts` → IPC `pv:prematch:report` → `PrematchPanel.tsx`. View logic: `src/renderer/matchday/manager.ts`
(unit-tested in `test/manager-view.test.ts`).

## Series · map veto

![Map veto](docs/desktop-veto.png)

**시리즈 · 밴픽 / Series · Veto** (left nav) runs a best-of-1/3/5 on the engine's series layer
(`docs/SERIES_AND_VETO.md` at the repo root has the formulas and the measured effects).

> **Every map is currently simulated on the Ascent geometry.** Ascent is the only map the engine can
> play: the other ten have spatial data and navigation roadmaps but are not playable yet
> (`docs/research/NAVIGATION_ENGINE.md` §9 at the repo root). So a "Lotus" game is an Ascent game with
> Lotus's mastery and scouting applied. The veto and series screens carry a persistent note saying so,
> and Match Day shows it on such maps.

Flow:

1. **Setup** — our team, the opponent, the format, the seed, and the team's own pre-match options:
   **상대 사전 분석 / Scout the opponent** and **분석관 수준 / Analyst quality** (0–1; how many of their
   games are reviewed and how exact the estimate of their map mastery is).
2. **Veto** — the pool as cards. The bar at the top always says whose turn it is and what the step
   is (ban / pick / choose side, `n/total`). We make our team's choices (the card's 밴/픽 button, or
   the side buttons); the AI makes the opponent's one step at a time, ~1 s apart, each landing in
   the veto log tagged `AI`. Banned maps grey out and are struck through; picked maps show
   "N맵 · team 픽" and our starting side; the last map left is marked **디사이더 / Decider**.
3. **Decision support, on the same screen** — every card shows our mastery and our analysts'
   estimate of theirs (0–100, `±` one standard deviation). Selecting a card opens the breakdown
   for both teams — map record, roster continuity, composition fit, each with its own `±` and the
   note of what it is based on ("34경기 24승", "선수별 맵 출전 기록 기준") — and the scouting report for that
   map: strong / average / weak verdict, where they attack and defend with the amount of evidence
   behind it, and how many games were reviewed. **Uncertain numbers look uncertain**: at
   `±` ≥ 10 the bar is hatched amber with a dashed outline and the `±` is highlighted (the same
   idea as low-confidence reads in the Review); "not scouted" is a grey hatched bar with no number.
   The **분석팀 추천 / Staff advice** line gives the engine's recommended choice (it searches the
   rest of the veto on our own win estimates) with the visible numbers behind it, and a one-click
   "추천대로".
4. **Maps** — between maps the series scoreboard lists every map (who picked it, our starting
   side, score). The next map opens in the existing **Match Day** (one-shot or round by round with
   timeouts) with a banner and a "시리즈로 돌아가기" button, or is simulated in one go
   ("결과만 빠르게"). Leaving an unfinished map plays it out.
5. **Summary** — winner, map scores, the full veto record, mastery by map.

![Series summary](docs/desktop-series-summary.png)

Data path: `src/engine/series-session.ts` (`createSeriesSession` behind a command handler, living
in the `series` engine worker) ⇄ `src/main/series-host.ts`
⇄ IPC `pv:series:{start,cmd,stop}` ⇄ `src/renderer/series/useSeries.ts` → view logic
`src/renderer/series/view.ts` (pure; `test/series-view.test.ts`) → `screens/series/*`. The host
reports every game from **our seat** (our team is always slot A, whichever side it starts on), so
Match Day needs no change in how it reads a match: a map of the series is requested with
`seriesGame: true` on the ordinary `runSimulation` / `sessionStart` calls and the session channels
are routed to the series host while that map is open.

What is simulated rather than real: the **scouting film** is each team's last two games against
other teams, simulated at series start (`PV_SERIES_FILM` changes the count) — the data has no real
per-round history. The map records themselves are real (`packages/game-data/data/map-history.json`:
maps played and won per team and per player since 2025); a team without a record shows
"승패 데이터 없음" and is treated as neutral. Not built yet: the team game plan (site leans)
and both-teams-human veto have no UI; a series does not survive leaving the screen's route
mid-series (the host keeps running, the screen state is not restored).

## How a match reaches the screen

```
renderer (React) ──IPC──▶ main process ──utilityProcess──▶ out/main/engine-host.js (the whole engine, one bundle)
      ▲                       │    EngineWorker: match · session · series · career      │
      └── Replay + MatchSummary ◀── mergeMatch (src/shared/match-merge.ts) ◀── result (JSON text) + progress events
```

- **Engine host** (`src/engine/host.ts` → `out/main/engine-host.js`): `@pv/match-runner`, every
  engine package under it and the desktop's own projections, bundled by electron-vite into one
  entry. No `npx tsx`, no cold start per match. `src/main/engine-worker.ts` runs it in Electron
  **utility processes**, forked on first use and kept alive: one worker each for one-shot matches,
  the interactive session, the series and the career background sim, so a day of AI fixtures never
  holds up the user's own match. The engine is synchronous; a request that times out (or a session
  disposed mid-round) ends its worker, and the next request forks a new one.
- **Same contracts as before**: the renderer-facing IPC (`src/shared/ipc.ts`, `series.ts`,
  `career.ts`) is unchanged; results cross the process boundary as JSON text, so payloads are what
  the old stdout-JSON subprocesses produced.
- **Map data is parsed once per process**: `packages/match-runner/src/setup.ts` caches the parsed
  nav / vis / tactics / objects / weapons JSON; every match still builds its own engine from it.
- **Where the engine finds its data** (`src/engine/root.ts`): the engine packages locate JSON via
  `import.meta.url`; the build rewrites those to paths inside an *engine data root* shaped like the
  repository — the repository itself in development, `Resources/engine` in the packaged app.
- **What runs in the worker** (`src/engine/*.ts`, shared with the tsx reference scripts):
  `run-match.ts` (a whole map; one progress event per round), `match-session.ts` (round by round,
  a managed session: `state`, `callTimeout`, `setOrders`, `setShouts`, `setStrategy`, `teamTalk`,
  `playNextRound`, `result`; plus `cfg.plan` / `cfg.scouting`), `series-session.ts` (the same plus
  the veto, every map managed), `career-sim.ts` (one AI series), `prematch.ts` (the pre-match
  opponent report, in its own `prematch` worker), `manager-view.ts` (the manager layer projected
  onto our seat). `mergeMatch` then puts every round on one
  timeline and keeps per-round extras (`decisions`, `nav`) in the summary.
- **tsx reference path** (`scripts/run-match.mts`, `match-session.mts`, `series-session.mts`,
  `career-sim.mts`, `prematch.mts`): thin stdin/stdout wrappers around the same modules, run from workspace source.
  The app no longer spawns them; they are the reference `test/engine-bundle.test.ts` compares the
  bundle against, byte for byte, and remain usable from the command line.
- **In-app round simulator** (`src/shared/real-sim.ts`, run in `src/main/sim-worker.ts` off the UI
  thread): `@pv/round-simulator` bundled from source with scripted policies; the fallback if the
  engine host fails, and the simulation-runner path. Its data inputs are the JSON copies under
  `src/data/sim/` (zone graph, roadmap, visibility table, coordinate system, weapons).
- Types shared by both sides: `src/shared/ipc.ts`; worker messages: `src/engine/protocol.ts`.

## Packaged build (macOS)

```bash
npm run package:mac            # → dist/mac-arm64/PROJECT V.app
npm run test:e2e:packaged      # copy it out of the repo, launch, play a quick match → docs/desktop-packaged.png
```

`package:mac` = `electron-vite build` → `scripts/stage-engine-data.mjs dist/engine-data` →
`electron-builder --mac --dir` (`electron-builder.yml`) → `scripts/verify-package.mjs`. The
result runs with no repository, no `node_modules` and no tsx:

| In the app | From | Notes |
|---|---|---|
| `Resources/app.asar` → `out/{main,preload,renderer}` | electron-vite | main, preload, renderer, the engine host bundle. Renderer dependencies are bundled by Vite, so **no `node_modules` ships** |
| `app.asar` → `test/fixtures/traces/*.json` | repo | Decision Debugger traces |
| `Resources/engine/**` | `stage-engine-data.mjs` | the engine's data, laid out like the repo: `packages/game-data/data`, `packages/match-runner/data`, per map `datasets/spatial/<map>/{<map>.navgraph,<map>.nav,<map>.vis,<map>.tactics,<map>.objects,coordinate-system}.json`, `datasets/synthetic/setups` — 70 files, 5.6 MB |
| `app.asar` → `assets/playercards/**` | repo (when present) | Kingdom Archives player cards: committed by the owner's decision and allowed in internal builds; **release review required** |

**Never shipped** (and checked by `verify-package.mjs`, which fails the build otherwise): anything
git-ignored — local map meshes (`assets/maps/*.glb`, `.blend`), loading banners
(`assets/banners/`) — raw map extractions (`datasets/spatial/*/mesh`, `*.raw.json`,
`*.source.json`, `*.authoring.json`), TypeScript sources and scripts. Engine data is copied from
an **allowlist intersected with `git ls-files`**, so an untracked file cannot ship by accident, and
`test/engine-bundle.test.ts` runs the engine from a staged copy alone, so a data file the engine
starts to need without being allow-listed fails that test. A packaged app still *reads* a local
map mesh from `~/ProjectV-assets/maps/glb` if the user has one there; it does not contain it.

Status: **internal pre-release only.** The bundle is ad-hoc signed (`scripts/adhoc-sign.cjs`;
enough to launch on the Mac that built it — Apple Silicon refuses unsigned code), not signed with a
Developer ID and not notarised; the icon is Electron's default; Windows / Linux targets are not
configured. The shipped map derivatives and player cards, and the runtime images from
`valorant-api.com`, are the open licence questions of `docs/HANDOFF.md` §6.

## Security posture
- `contextIsolation: true`, `nodeIntegration: false`; the renderer reaches
  privileged work only through the preload whitelist (`src/preload` → `window.pv`:
  simulation run, trace list / load, match session, series, map-mesh load) via `contextBridge`.
- CSP set in `index.html` (PixiJS needs `unsafe-eval` + blob workers, allowed only
  in this local renderer; images and the minimap come from `valorant-api.com`). `sandbox` is off
  for ESM-preload compat on Electron 33.

## Open items
1. **Per-player data for the live match view** — see "Approximations" above for the engine
   fields that would replace each renderer-side derivation.
2. **One map on screen** — the live view's map image, zone graph, roadmap and transform are
   Ascent's (`src/data/sim/`, `src/shared/ascent-transform.ts`); a per-map spatial adapter is needed
   before another map can be shown.
3. **Options without UI** — per-player minimum throw rates, the team game plan (site leans),
   both-teams-human veto, and every `MatchConfig.tuning` field.
4. **Not localised** — the navigation view's "why" lines are engine English in both languages
   (plan-change reasons are localised by parsing; see "Round decisions").
5. **A series does not survive leaving the screen's route** mid-series (the host keeps running,
   the screen state is not restored).
6. **`test:e2e` has fixed waits** in its interactive part (1.5 s after "next round"); it timed out
   once in about ten runs on 2026-11-20 and passed on rerun.

Screens: `docs/desktop-{shell,matchday,fog,fog-pov,orders,interactive,review,review-interactive,review-decisions,review-decisions-en,match-options,nav-debug,squad,debugger,veto,veto-1080p,veto-en,veto-en-1080p,series-summary,series-summary-en}.png`,
`docs/screenshots/matchday-{tactical-map,team-cams}.png`. UI terms: `docs/GLOSSARY_KO.md`.
