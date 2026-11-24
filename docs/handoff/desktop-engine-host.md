# Handoff: desktop engine host, packaging, Review decisions

Branch `claude/desktop-decisions-3de329`, merged with main 65180b9. Not pushed, not merged.
Commits:
- `bd1f9bf`: round decisions in the post-match Review, pre-match options.
- `7665df5`: engine bundled into a worker, packaged macOS build, localised plan-change reasons.
- The main merge, then this note.

**Merge port (`claude/remaining-work-final-push-fa1459` @ c29b4df merged in).** series-veto's in-match manager layer now runs in the engine host:
- The managed match session (`createManagedSession`) in `src/engine/match-session.ts`, with `setShouts` / `setStrategy` / `teamTalk`, `cfg.plan` and `cfg.scouting`, and the manager view in state and result.
- `managed: true` series maps with the same commands in `src/engine/series-session.ts`.
- The projection onto our seat, in `src/engine/manager-view.ts` (was `scripts/manager-view.mts`).
- The pre-match opponent report as host op `prematch.report` (`src/engine/prematch.ts`, its own `prematch` worker).

The renderer IPC contract (`prematchReport`, session commands) is unchanged. `scripts/match-session.mts`, `series-session.mts` and `prematch.mts` are thin tsx wrappers. The manager flags (`moodEffects`, `aiManager`, `timeoutsPerHalf`) stay default-off, as series-veto shipped them. `setup.ts` keeps the data cache together with weapon modes and the `plantTactics` / `midControl` / `information` policy flags.

Detail lives in `apps/desktop/README.md`: "How a match reaches the screen", "Packaged build (macOS)" and "Round decisions".

## Done and default-on

Nothing here changes the simulation. All of it is on by default.

**No `npx tsx` at run time** (HANDOFF P2-11 / P3-15)
- `@pv/match-runner` and everything under it is bundled into `out/main/engine-host.js` (`apps/desktop/src/engine/host.ts`).
- It runs in Electron utility processes (`src/main/engine-worker.ts`). There is one long-lived worker each for:
  - one-shot matches
  - the interactive session
  - the series
  - the career background sim
- The renderer-facing IPC contracts are unchanged.
- `scripts/*.mts` are now thin tsx wrappers around `src/engine/*.ts`. They are the reference path for tests and command-line use; the app does not spawn them.

**Map data parsed once per process**
- `packages/match-runner/src/setup.ts` caches the parsed nav, vis, tactics, objects and weapons JSON. `clearDataFileCache()` is exported.
- Every match still builds its own engine. Output is byte-identical; see the numbers below.

**Engine data location**
- The build rewrites each `import.meta.url` under `packages/**` to a path inside an "engine data root" (`src/engine/root.ts`).
- That root is the repo in development and `Resources/engine` in the packaged app.

**Packaged macOS build**
- `npm run package:mac` produces `dist/mac-arm64/PROJECT V.app`. It uses electron-builder 26.0.12, ad-hoc signed.
- `scripts/stage-engine-data.mjs` ships only data that is both allow-listed and tracked in git.
- `scripts/verify-package.mjs` fails the build if the app contains any of:
  - `node_modules`
  - TypeScript sources
  - `.glb` / `.blend` files
  - `assets/maps` or `assets/banners`
  - data outside the allowlist
- Kingdom Archives player cards ship when present (`assets/playercards/**`), marked for release review. They were not on this branch, so the current build has none.

**Review**
- Plan-change reasons are shown in Korean and English (`src/renderer/decision-reasons.ts`). A sentence the parser does not recognise is shown in the engine's English.
- Call labels now cover the engine's newer forms: `stack A ×3`, `support B ×1`, `hold`, `cExecute`, `stackC`.

## Behind a flag

None. Neither commit changes engine behaviour.

## Measured

- **Determinism** (`apps/desktop/test/engine-bundle.test.ts`, part of `npm run test:engine`, needs `npm run build`): the bundle and the tsx source path give byte-identical output for:
  - 3 one-shot configs, including opponent memory off plus a throw floor, and Haven
  - a managed interactive session: plan, timeout, orders, shouts, strategy, half-time team talk
  - the pre-match report
  - a Bo1 series through the veto, with the managed map played round by round with shouts / strategy / talk, then closed
  - a career series
- **Staged data alone**: the bundle also runs from a staged data copy outside the repo and matches the repo run. Every series-pool map plays from it.
- **Cache safety**: matches on all 7 pool maps plus a Bo3 ran with the cached data deep-frozen, with no mutation. `packages/match-runner` vitest passes 104/104.
- **Timing** (seed 42, one full map):
  - bundle cold: 3.4 s
  - bundle warm, same worker: 1.8–2.0 s
  - tsx: 3.0 s per process, including tsx start-up
- **Package size**: app.asar 7.4 MB, engine data 70 files / 5.6 MB, whole app 256 MB.
- **After the merge port** (on c29b4df + this branch): desktop typecheck and build pass, `test:unit` 75/75, `test:matchday` 55/55, `test:engine` 10/10. `packages/match-runner` vitest 135/135 and tsc clean.
- **Package with the merged tree**: app.asar 27.7 MB (141 player cards included, flagged for release review), whole app 277 MB, content check OK.

## Unfinished (exact next step)

**Not run inside Electron.** The utility-process path has only been exercised under plain Node `child_process.fork` (the same host code). My queued runs were cancelled at the integrator's request, which leaves three things unrun:
- the packaged smoke test
- the four e2e suites
- the screenshot of the packaged app playing a match

Next step, one at a time through the lock:
```bash
cd apps/desktop && npm run package:mac
/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "packaged smoke" -- npm run test:e2e:packaged   # → docs/desktop-packaged.png
/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "desktop e2e" -- npm run test:e2e   # then :series, :career, :club
git checkout -- apps/desktop/docs   # keep only desktop-packaged.png if wanted
```

`test:e2e:packaged` does the following:
- copies the .app to a temp dir and launches it with no `PV_*` variables and a bare PATH
- plays a quick match
- asserts that round progress streamed live, that Review decisions exist (proof that the real engine ran, not the fallback), and that no node or tsx child process was started

## Known risks

- **utilityProcess specifics** are untested: `env` and `serviceName` on fork, and message delivery. If they misbehave, Match Day falls back to the round-simulator worker, which gives no decisions and no Review decision panel. The packaged smoke test catches this.
- **A request that times out kills its worker.** The engine is synchronous. Timeouts are 180 s for a match, 60 s for session commands, and 300 s per career series. A long series play-out on a slow machine could hit one.
- **Stale pnpm copy:** round-simulator depends on decision-engine as a `file:` copy, which goes stale after decision-engine changes until `pnpm install` is re-run. match-runner's `tsc` then reports missing `InfoProfile` / `InformationLayer` exports. The app bundle aliases every `@pv/*` to source, so it is unaffected. This predates this branch.
- **Engine code that mutates loaded map or weapon data** will now leak into the next match in the same process. Clone before mutating.
- **A new engine data file** must be read via an `import.meta.url`-relative path and added to `ENGINE_DATA_ALLOW` in `stage-engine-data.mjs`. `test:engine` fails if it is missing from the staged copy.
- **Rewording a reason in team-engine** makes it fall back to English in Review (no crash). The cases are listed in `test/decisions.test.ts`.
- **Files outside this area that I touched:**
  - `src/renderer/screens/matchday/Hud.tsx`: 2 lines in `callText` for the new call kinds. This is matchday-uiux's file, so watch for a merge conflict.
  - `docs/CAREER_MODE.md` still names `scripts/kill-lines.mts`, which is now `src/engine/kill-lines.ts`.
- **Not release-ready:** no Developer ID, not notarised, default icon, no Windows or Linux target. The licence review in HANDOFF §6 is still open.
- **Dependencies:** electron-builder adds 325 dev packages to `apps/desktop/package-lock.json`. No existing versions changed.
