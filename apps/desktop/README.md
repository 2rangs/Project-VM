# @pv/desktop

PROJECT V desktop app — a **manager-game-style** front end (Electron + Vite +
React + TS, DECISION-007) over the PROJECT V simulation and data packages. It
adopts sports-manager **information conventions only**; no third-party game's
branding, screen designs, icons or colour schemes are copied.

![Match Day](docs/desktop-matchday.png)

Shell: left nav (MATCH / TEAM / CLUB / DEV), a top context bar (team · season ·
next match · Continue), main content, and a right detail panel. DECISION-001 —
the match/data screens work first; club ops are reserved "준비 중" placeholders.

## Screens & data sources

| Screen | Status | Data |
|---|---|---|
| **Match Day** | working (REAL sim) | PV-4 `@pv/round-simulator` in a separate process (real 5v5 rounds), real team select, coach note from a real PV-3 trace; fog-of-war + Belief heatmap are **TODO** (need PV-3 Belief State) |
| **Match Day → Review (post-match)** | working (REAL sim) | match-runner summary + replay: round results, **round decisions** (each team's read, call, plan changes — see below), economy timeline, timeout log, MVP, ground-truth replay |
| **Squad / Player Profile** | working | PV-2 `player_ratings` + `player_names` — 402 real VCT players, 1–20 grid, uncertainty, explicit null |
| **Opponent Report** | working | PV-2 `team_profiles` + `team_names` — 70 real teams, economy + map pool |
| **Tactics** | working (list) | PV-1 `ascent-tactics` (provenance tags shown) |
| **Agent Select** | working (data) | PV-1 `ascent-comps` (win rates + CI, role templates) |
| **Dev → Decision Debugger** | working | real PV-3 `@pv/decision-debugger` traces (Handoff §21) |
| **About** | working | pre-release real-names disclaimer |
| Map Veto / Inbox / Schedule / Finance / Transfers / Training / Scouting | 준비 중 | — |

Data fixtures are copied from PV-1/PV-2 branches; see `src/data/README.md` and
`test/fixtures/traces/README.md` for exact sources. All values are
**synthetic/estimated**. Real VCT **professional** player/team names are shown by
user decision for pre-release internal development only — license / name /
likeness rights must be re-reviewed before any launch. The `.vrf` sample players
(non-pro) stay anonymous (`player_N`).

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

## Pre-match options (match setup)

**⚙ 경기 옵션 / Match options** on Match Day exposes the `MatchConfig` options that
are a team's or organiser's choice; they apply to both one-shot and interactive
matches and lock while a session is live:

- **상대 기억 / Opponent memory** (`opponentMemory`, default on) — off makes both
  teams play every round like the first; the Review then shows no reads.
- **최소 쓰로잉률 / Minimum throw rate** per team (`minThrowRates.teams[teamId]`,
  /s, default 0) — a floor on how often a player breaks a winning post-plant hold.

Only non-default choices are sent, so a default match is exactly the engine's
default config. Per-player floors (`minThrowRates.players`) pass through the IPC
types and scripts but have no UI yet. The physics tunables in `MatchConfig.tuning`
are deliberately not exposed.

## Security posture
- `contextIsolation: true`, `nodeIntegration: false`; the renderer reaches
  privileged work only through the preload whitelist (`src/preload` → `window.pv`:
  `runSimulation`, `loadTrace`, `listTraces`) via `contextBridge`.
- CSP set in `index.html` (PixiJS needs `unsafe-eval` + blob workers, allowed only
  in this local renderer). `sandbox` is off for ESM-preload compat on Electron 33.

## Run / build / verify

```bash
# once, at the repo root: the match runs from workspace source via tsx
pnpm install --frozen-lockfile
cd apps/desktop
npm install
npm run dev                                   # electron-vite dev
npm run typecheck                             # tsc --noEmit
npm run build                                 # → out/{main,preload,renderer}
npm run test:unit                             # IPC contract, trace parser, i18n, match merge, round decisions (30)
npm run test:engine                           # desktop ↔ live engine contract: run-match.mts output shape + options (3)
npm run build && xvfb-run -a npm run test:e2e # Playwright _electron E2E + screenshots (Linux, headless)
npm run build && npm run test:e2e             # macOS / Windows: opens a real window
```

Notes:
- The shared `ReplayViewer` source lives in `../replay-viewer`; `react` / `pixi.js`
  are resolved from *this* app's `node_modules` (`resolve.dedupe` in
  `electron.vite.config.ts`, `paths` in `tsconfig.json`), so no install is needed there.
- `test:engine` needs the repo-root install (`node_modules/.bin/tsx`) and skips with
  a message without it. Run it after any engine change that touches `RoundRecord`.
- `test:e2e` needs Playwright, which is not a dependency of this app: set
  `PLAYWRIGHT_REQUIRE_BASE` to a directory whose `node_modules` has `playwright`
  (e.g. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright` in a temp dir; no
  browser download is needed for `_electron`). It pins the UI language to Korean,
  plays one-shot and interactive matches, checks the round-decisions view in both
  languages and the opponent-memory option, and rewrites the PNGs in `docs/`.
- `test/review.test.ts` is not in `test:unit`: `src/renderer/data.ts` imports JSON
  without an import attribute, which Node's test runner rejects (Vite is fine).

Windows is the first target (README §07); development and verification here were
on Linux (Electron under `xvfb` + SwiftShader). If Electron can't be installed,
the renderer still runs in plain-browser mode (`window.pv` absent → in-page
`StubRunner` + bundled fixtures; see `src/renderer/platform.ts`).

## Integration swap points (TODO)
1. **`SimulationRunner`** (`src/shared/sim.ts`) — `StubRunner` → PV-4/PV-3 real
   Match Runner (`pnpm sim:match` on the integration branch), same interface; the
   worker + IPC path stay unchanged.
2. **Belief / fog** — Match Day fog-of-war and Belief heatmap need PV-3 Belief
   State output per frame.
3. **Spatial adapter** — `src/shared/ascent-transform.ts` (copied PV-4 transform)
   → a real spatial-engine adapter supplying the transform per map.
4. **Team select** — pick two real teams + seed to start a match.

Screens: `docs/desktop-{shell,matchday,squad,debugger,review,review-decisions,review-decisions-en,match-options}.png`.
