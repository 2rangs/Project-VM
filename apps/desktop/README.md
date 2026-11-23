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
# once, at the repo root: the match runs from workspace source via tsx
pnpm install --frozen-lockfile
cd apps/desktop
npm install

npm run dev                                   # electron-vite dev
npm start                                     # build + run the built app
npm run typecheck                             # tsc --noEmit
npm run build                                 # → out/{main,preload,renderer}

npm run test:unit                             # IPC contract, trace parser, i18n, match merge, round decisions, series view, navigation debug model (48)
npm run test:matchday                         # live match view logic: graph, timeline, visibility, monitors, playback, blockout (29)
npm run test:engine                           # desktop ↔ live engine contract: run-match.mts output, options, tracks + navigation trace (4)
npm run build && npm run test:e2e             # Playwright _electron E2E + screenshots (macOS / Windows: opens a real window)
npm run build && xvfb-run -a npm run test:e2e # the same on Linux, headless
npm run build && npm run test:e2e:series      # full Bo3 through the veto + Match Day, in Korean and English
```

Notes:
- The match itself does not run inside the app bundle. The main process spawns
  `scripts/run-match.mts` (one-shot), `scripts/match-session.mts` (round by round) or
  `scripts/series-session.mts` (series) with `npx tsx` from the repo root, so **Node 22 and the
  repo-root install are needed at run time**, not only for tests.
- The shared `ReplayViewer` source lives in `../replay-viewer`; `react` / `pixi.js`
  are resolved from *this* app's `node_modules` (`resolve.dedupe` in
  `electron.vite.config.ts`, `paths` in `tsconfig.json`), so no install is needed there.
- `test:engine` needs the repo-root install (`node_modules/.bin/tsx`) and skips with
  a message without it. Run it after any engine change that touches `RoundRecord`.
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
- `test/review.test.ts` is not in `test:unit`: `src/renderer/data.ts` imports JSON
  without an import attribute, which Node's test runner rejects (Vite is fine).

Windows is the first target (README §07). Development and verification were on Linux
(Electron under `xvfb` + SwiftShader) and, since 2026-11-20, on macOS. If Electron can't be
installed, the renderer still runs in plain-browser mode (`window.pv` absent → in-page
`StubRunner` + bundled fixtures; see `src/renderer/platform.ts`).

## Screens & data sources

| Screen | Status | Data |
|---|---|---|
| **Match Day** | working (REAL sim) | `@pv/match-runner` in a separate process (one-shot map or interactive round-by-round session with tactical timeouts and coach orders); real team select; coach note from a real PV-3 trace. While a match is on, the screen is the full-window **live match view** — tactical map / team cams, our team's fog of war, belief overlay, navigation developer view |
| **Match Day → Review (post-match)** | working (REAL sim) | match-runner summary + replay: round results, **round decisions** (each team's read, call, plan changes), economy timeline, timeout log, MVP, ground-truth replay |
| **Series · Map veto** | working (REAL engine) | `@pv/match-runner` series layer (`createSeriesSession`): Bo1/Bo3/Bo5, step-by-step veto vs the AI, per-map mastery + scouting, maps played through Match Day |
| **Squad / Player Profile** | working | PV-2 `player_ratings` + `player_names` — 402 real VCT players, 1–20 grid, uncertainty, explicit null |
| **Opponent Report** | working | PV-2 `team_profiles` + `team_names` — 70 real teams, economy + map pool |
| **Tactics** | working (list) | PV-1 `ascent-tactics` (provenance tags shown) |
| **Agent Select** | working (data) | PV-1 `ascent-comps` (win rates + CI, role templates) |
| **Dev → Decision Debugger** | working | real PV-3 `@pv/decision-debugger` traces (Handoff §21) |
| **About** | working | pre-release real-names disclaimer; language switch |
| Inbox / Schedule / Finance / Transfers / Training / Scouting | 준비 중 | — |

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

**Not localised yet:** revision `reason` strings ("spike planted — retake call",
"enemies reading B — rotate/stack B", …) are free English text built inside
`@pv/team-engine` and are shown verbatim in both languages. Localising them needs
the engine to emit a reason *key* (+ params) per revision; the UI would then map it
through `ko.ts` / `en.ts`. Revision `from` / `to` are parsed on the desktop side
(`parseCall`: strategy ids, the `" (slow)"` suffix, `"commit A|B"`) and are localised.

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

Data path: `scripts/series-session.mts` (one long-lived tsx subprocess hosting
`createSeriesSession`; line-delimited JSON like `match-session.mts`) ⇄ `src/main/series-host.ts`
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
renderer (React)  ──IPC──▶  main process  ──spawn `npx tsx`──▶  scripts/*.mts  ──▶  @pv/match-runner (workspace source)
      ▲                         │                                   │
      └──── Replay + MatchSummary ◀── mergeMatch (src/shared/match-merge.ts) ◀── JSON on stdout / line protocol
```

- **One-shot map**: `scripts/run-match.mts` prints the whole match as JSON; `mergeMatch` puts every
  round on one timeline (events, perception per real team) and keeps per-round extras (`decisions`,
  `nav`) in the summary.
- **Round by round**: `scripts/match-session.mts` is one long-lived subprocess speaking
  line-delimited JSON (`state`, `callTimeout`, `setOrders`, `playNextRound`, `result`, `stop`).
- **Series**: `scripts/series-session.mts` ⇄ `src/main/series-host.ts` (same protocol, plus the veto).
- **In-app round simulator** (`src/shared/real-sim.ts`, run in `src/main/sim-worker.ts` off the UI
  thread): `@pv/round-simulator` bundled from source with scripted policies, used by the simulation
  runner path; its data inputs are the JSON copies under `src/data/sim/` (zone graph, roadmap,
  visibility table, coordinate system, weapons — see the README there).
- Types shared by both sides: `src/shared/ipc.ts`.

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
4. **Not localised** — plan-revision reasons and the navigation view's "why" lines are engine
   English in both languages.
5. **A series does not survive leaving the screen's route** mid-series (the host keeps running,
   the screen state is not restored).
6. **`test:e2e` has fixed waits** in its interactive part (1.5 s after "next round"); it timed out
   once in about ten runs on 2026-11-20 and passed on rerun.

Screens: `docs/desktop-{shell,matchday,fog,fog-pov,orders,interactive,review,review-interactive,review-decisions,review-decisions-en,match-options,nav-debug,squad,debugger,veto,veto-1080p,veto-en,veto-en-1080p,series-summary,series-summary-en}.png`,
`docs/screenshots/matchday-{tactical-map,team-cams}.png`. UI terms: `docs/GLOSSARY_KO.md`.
