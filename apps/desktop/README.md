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
| **Match Day** | working (stub match) | SimulationRunner (stub → real), real PV-3 decision trace for the coach note; fog-of-war + Belief heatmap are **TODO** (need PV-3 Belief State) |
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

## Security posture
- `contextIsolation: true`, `nodeIntegration: false`; the renderer reaches
  privileged work only through the preload whitelist (`src/preload` → `window.pv`:
  `runSimulation`, `loadTrace`, `listTraces`) via `contextBridge`.
- CSP set in `index.html` (PixiJS needs `unsafe-eval` + blob workers, allowed only
  in this local renderer). `sandbox` is off for ESM-preload compat on Electron 33.

## Run / build / verify

```bash
cd apps/desktop
npm install
npm run dev                                   # electron-vite dev
npm run build                                 # → out/{main,preload,renderer}
npm run test:unit                             # IPC contract + trace parser (6)
npm run build && xvfb-run -a npm run test:e2e # Playwright _electron E2E + screenshots
```

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

Screens: `docs/desktop-{shell,matchday,squad,debugger}.png`.
