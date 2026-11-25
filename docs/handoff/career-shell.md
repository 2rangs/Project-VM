# Handoff — career shell (FM-style career mode)

Branch `claude/festive-brattain-042f51` (from main bcc3458). Not pushed or merged.
Design doc: `docs/CAREER_MODE.md` (flow, calendar, competition, sim, saves, hook API, not done).

## Done and verified
- **Hook API for club-ops** (c784fe1, stable): `registerCareerHook({ id, order?, onCareerStart,
  onDay(world, date, ctx), onMonth, onMatchResult, onSeasonEnd (before advanceSeason),
  onSeasonStart, onAnswer })`, `ctx = { career, world, date, post(draft), rng(label), ext(init) }`,
  ISO `YYYY-MM-DD` dates. `packages/career/src/career/hooks.ts`. Sent to the club-ops session
  (local_95879096…, branch claude/happy-newton-649a94), which had started a parallel
  `ClubOpsHooks` — asked it to use this one instead.
- **`packages/career` calendar/competition** (315bc99): 12-team regional league, Stage 1/2 with
  two Bo3 round-robin groups + QF/SF Bo3 / Bo5 final, stage 2 drawn from stage 1 placings,
  standings with tiebreaks; `newCareer`, `dayAgenda`, `continueCareer` (stops: match day /
  answer needed / season end), `recordResult` (standings, maps played, K/D form), season end →
  `advanceSeason(world, { mapsPlayed })` with real minutes; quick formula series sim; career
  save/load; core inbox mail + monthly reports. Vitest: 7 career-mode tests (deterministic
  season, full season to `advanceSeason`, mid-season save/load round trip, hooks) + all existing
  career tests — 23/23 pass.
- **match-runner**: `SeriesTeamConfig.roster` → every game's `MatchConfig.rosters` (additive;
  absent = unchanged). Test in `packages/career/test/match.test.ts` passes.
- **Desktop** (24a1ab3 + this commit): start menu (new career / continue / load / settings /
  quick match / quit), new-career flow with team overview, Home hub + Continue with progress,
  Inbox (ko/en, answers), Schedule (calendar + fixtures), Standings + bracket, career match via
  the series screen with world rosters/analyst, instant result, save slots on disk with
  autosave, background AI sim through `scripts/career-sim.mts` (verified standalone: real Bo3
  with per-player K/D). `npm run typecheck`, `npm run build` and `test:unit` (53 incl. new
  `test/career-mode.test.ts`) pass. Clicked through in plain-browser mode: start → new career →
  answer board → Continue to first match day → instant result → standings/schedule → reload via
  Continue from the save.

## Half-done / not verified
- **Career e2e** `apps/desktop/test/e2e.career.test.mjs` (`test:e2e:career`): first run failed
  on a test assumption (the board question blocks Continue from day one); fixed and re-run:
  **passes** — "CAREER E2E OK — T1: 2–1 on 2026-02-07; 5 engine-played AI series; next match day
  2026-02-14" (start menu → new career → board answer → first match day → real-engine Bo3 →
  recorded → standings → engine background sim → main menu → Continue reproduces the save).
  Moved to "Done and verified".
- `test/e2e.electron.test.mjs` and `test/e2e.series.test.mjs` were edited to click "Quick Match"
  on the new start menu; **not re-run**.
- match-runner's own test suite not re-run after the roster change (only the career test that
  exercises it).

## Known problems
- Full-engine AI sim ≈ 10–25 s per Bo3 → ~20–30 min background per season; quick estimate is a
  setting and the automatic fallback.
- The manager's own series records map scores only (no per-player K/D) → their form uses round
  share. Lineup is always the roster's first five.
- The manager's squad still changes automatically in `advanceSeason` (squads step) until
  club-ops adds contracts/transfers.
- Loading UI is a simple `CareerProgress` (same props as matchday-uiux's `LoadingScreen`, which
  is not on main yet).
- Opponent Report / Tactics still read the dataset; Quick Match uses dataset rosters.
- `apps/desktop/vite.browser.config.ts` and `.claude/launch.json` are local, uncommitted helpers.

## Next steps (in order)
1. Re-run `test:e2e` and `test:e2e:series` (start-menu edits) under heavy-run.sh; discard the
   regenerated `apps/desktop/docs/*.png`.
2. Run the match-runner suite once for the `roster` change.
3. Merge with club-ops (`claude/happy-newton-649a94`). It still uses its own `CareerHooks`
   interface; the adapter onto `registerCareerHook` is described in `docs/handoff/club-ops.md` on
   that branch. Expected conflicts:
   - `App.tsx` / `nav.ts`: both rewritten here; their three route lines go on top.
   - `advanceSeason` options: both branches added an options object (`{ mapsPlayed }` here,
     `{ focus }` there). The merged `AdvanceSeasonOptions` needs both, and `endSeason` in
     `packages/career/src/career/career.ts` should pass `focus: seasonFocus(world)` too.
4. Swap `CareerProgress` for the match-day `LoadingScreen` when it lands.
5. Lineup choice before a match; per-player K/D from the manager's series; Kickoff/Masters,
   double elimination; other regions' leagues.

---

## Update: club operations integrated (second task)

Merged `origin/claude/remaining-work-final-push-fa1459` (297143b) and integrated the club layer.
Done (commits 8050d2f, 763d174, c6bd559, then the wip/docs commits):
- Club hook adapter: `packages/career/src/club/career-hook.ts` (`clubCareerHook`, run by `career.ts`
  after the core hook). The club's own `CareerHooks`/local driver, `ClubClock` buttons,
  `DEFAULT_USER_TEAM`, `withClub` and the `club*` aliases are gone. One `InboxItem`, one date
  helper set (career/calendar.ts), one `teamStrength` (club/market.ts).
- `advanceSeason({ managedTeams })`: the season loop does not touch the manager's squad.
- Lineup choice before each match (squad with form/fatigue/sharpness/readiness), readiness formula
  `R = (1 − 0.25·max(0, f − 0.3))·(1 − 0.08·(1 − s))` scaling attributes toward the floor,
  K/D from the manager's series, map practice → mastery records (`withPractice`) for the series
  and the background sim.
- AI sim: quick formula calibrated to the engine (slope 5.39, 48 engine maps) is the default;
  full engine optional. Measured: quick season 0.3 s; engine 2.6 s/series ≈ 2.8 min/season
  (the earlier "20–30 min" was wrong).
- Unscheduled lobby `screens/home` deleted; career loading uses the match-day `LoadingScreen`.
- Verified: `packages/career` vitest 49/49, desktop typecheck, build, `test:unit` 58/58.

Verified (heavy-run.sh): `test:e2e:career` passes — "signed rion, played 0–2 on 2026-02-06 with a
chosen five; 5 engine-played AI series; season 2026 played out, contract expired, season 2027
open" (first run failed at the first match day because a bid question stopped Continue; the test
now answers it); `test:e2e:club` (starts a career first) passes. Not re-run: the edited
`test:e2e` and `test:e2e:series` (start-menu edits; `test:e2e` no longer has a club step), the
full match-runner suite. Known gaps: below five players after expiries the lineup cannot be
confirmed (no Home warning); the manager's squad is never auto-refilled.


---

## Update 3: the competitive world and season speed (HANDOFF P2-11/12)

Branch `claude/festive-brattain-042f51`, origin/main merged (65180b9 era). Typecheck, build,
`packages/career` vitest 62/62 and desktop `test:unit` 61/61 pass.

**Done, default on** (nothing here touches the match sim):
- Four regional leagues in parallel (Kickoff, Stage 1, Stage 2 in every region) and the
  international circuit: Masters 1, Masters 2 and Champions (12/12/16 teams: groups, then 8-team
  double elimination, Bo3, Bo5 grand final), Champions Points and qualification (3/3/4 per region),
  draws, brackets, placings. Teams of different regions only meet at the internationals. 519
  series a season. `packages/career/src/career/{circuit,progress,schedule}.ts`, tests in
  `test/circuit.test.ts` (leagues, calendar 2026–2040, qualification by points, DE structure,
  points, news, two seasons, depth table, quick-sim map pools).
- News in the inbox (ko/en): points race, international draws, qualification or the miss, group
  exits, next bracket opponent, event champions, own result and points, upsets (≥ 0.08 strength gap
  in knockouts). Standings screen: any region's stages, event groups and both brackets, points
  race; Home gets a circuit card; Schedule shows the league plus the internationals.
- Season end moved to 15 September (a Champions final can fall on 1 Sep in some years); AI clubs
  no longer build fatigue from matches (nothing recovers it).
- Saves are version 2 (older saves do not load, with a clear message).

**Behind a setting** — world sim depth (`pv-career-depth` in localStorage; Settings, start menu):
`league` default (engine for the manager's own league, quick for other regions and
internationals), `quick` (all AI series quick; default only in the plain browser), `full`
(everything through the engine). Decision per the wrap-up rule: the quick estimate is calibrated
but **not settled**, so the engine stays the default for the manager's league; the quick path
only covers other regions and the international events.

**Measured:** quick season 0.6 s (519 series); engine 3.0–5.1 s per series (`league` depth ≈ 7.8
min, `full` ≈ 36 min a season). Quick-sim fit on 120 engine Bo3s / 286 maps: round slope 7.76 ±
0.63, map-pool slope 0.28 ± 0.21; series Brier 0.197 vs 0.25 for a coin; **overconfident** on
favourites (predicted 13% vs observed 28% in the lowest bin, n = 54). Per-map noise σ = 0.3 is an
**unfitted provisional**.

**Not run:** `test:e2e:career` and `test:e2e:club` after the circuit changes (the career e2e was
extended to check four leagues, three events and the brackets on screen, and uses
`pv-career-depth`); the σ / slope scan. Both were dropped at the wrap-up.

**Next step, in order:** (1) `cd packages/career && npx tsx ../../tools/career/calibrate-quick-sim.mts`
(no `--refit`: uses the committed engine series; seconds) — read `best`, set `mapNoiseSd` /
`roundSlope` in `quick-sim.ts` to the minimum-log-loss row, check the calibration table is flat;
(2) if it is, make `quick` the default depth for other regions and internationals officially
(already so) and consider it for the own league; (3) run `test:e2e:career` and `test:e2e:club`
through heavy-run.sh; (4) regional playoffs as double elimination; region-protected draws.

**Risks:** other regions' and international results are somewhat too predictable until σ is fitted;
`league` depth is ≈ 8 minutes of waiting per season on this machine; the first career e2e on the new
circuit has not been run; saves are about 2.5 MB (519 series with per-map K/D) and the browser
fallback stores them in localStorage (≈ 5 MB limit).

---

## Update 4: `test:e2e:career` on the merged tree

Passing twice in a row plus `test:e2e:club` (through heavy-run.sh, on the final-push tip + this commit).
Timings of a passing run: club step 9 s, first series recorded 23–26 s, the engine Continue (one week of
our league's AI series at depth `league`, 1–5 series) 4–17 s, the season played out by 33–45 s.
- The 15-minute wait seen once was not the step's own cost: one Continue is a day-by-day batch of
  ≈ 5 engine series (3–5 s each). A first run here died even earlier, in `electron.launch` (180 s) while
  the machine was loaded by other jobs. Not reproduced since, so no code cause was found; the
  worst case is now bounded instead: the career sim host kills a series stuck for 60 s
  (`CAREER_SERIES_TIMEOUT_MS`, env `PV_CAREER_SERIES_TIMEOUT_MS`; it was 300 s), the worker is
  re-forked and that day falls back to the quick estimate with a notice on Home. The e2e waits 4 min
  for that step and, on a timeout, reports what the progress box said.
- The app that closed during the veto (one run, no log): not reproduced. The main process now logs
  `uncaughtExceptionMonitor`, unhandled rejections, `render-process-gone`, `child-process-gone` and
  `before-quit` to stderr (monitor-only, no behaviour change) and the e2e prints page crash / window
  close / app close, so the next occurrence leaves a line (`PV_E2E_VERBOSE=1`).
- Player-facing speed at the default depth: a week of Continue ≈ 5 engine series ≈ 15–25 s with the
  progress box; a season ≈ 8 minutes. Slower than quick, by design.

---

## Update 5: the quick sim calibrated properly (no engine runs)

Branch `quicksim-fit` (from origin/main 85eadc8). Details, tables and the reliability chart:
`docs/CAREER_MODE.md` §4.
- **Method:** maximum likelihood on the committed engine series (`tools/career/calibration-data.json`, 120
  Bo3s / 286 maps) with the exact first-to-13 map-score likelihood and noise integrated out
  (`packages/career/src/career/quick-fit.ts`; `tools/career/fit-quick-sim.mts`, 2 minutes, offline).
  New in the quick sim: a per-SERIES noise term next to the per-map one.
- **Shipped constants:** `roundSlope` 8.2, `mapSlope` 0.28, `mapNoiseSd` 0.39, `seriesNoiseSd` 0.32
  (before: 7.9 / 0.4 / 0.3 guessed / none). Standard errors: k ± 1.25, μ ± 0.29 (not distinguishable
  from 0), σ ± 0.044, τ ± 0.063. Leaving noise out costs 43 log-likelihood units.
- **Checks:** 5-fold held-out series Brier 0.201 (coin 0.25), ECE 0.078 (noise floor ≈ 0.06–0.07);
  shipped constants on all series: Brier 0.197, mean predicted favourite win 0.716 vs observed 0.742.
  `test/quick-calibration.test.ts`: likelihood normalised, fitter recovers known constants, shipped
  constants within 3 log-lik of the optimum, ECE < 0.10, mean error < 0.05, Brier < 0.215,
  held-out half beats rounds-only by > 0.15 per series.
- **Not settled:** the 90–100% bin (predicted 0.94, observed 0.80, n = 20; held out 0.77, n = 17).
  A saturating ability term did not explain it. The engine series predate the latest engine
  changes (ecoSidearms etc.).
- **More data needed:** τ ±0.05 → ≈ 190 series (+70); ability slope ±5% → ≈ 1,100 (+980, ≈ 70 min
  of engine time); the map-pool slope ±0.1 → ≈ 975 (it may be ≈ 0: drop it). Not run (the lock belongs
  to the engine gates). Refit: `calibrate-quick-sim.mts --refit` on the final engine, then
  `fit-quick-sim.mts`.
- **Default depth:** recommendation, not a flip — keep `league` as the default for the manager's own
  league until a ≈ 1,100-series refit on the shipped engine passes the same bounds and the top bin is
  flat. `quick` stays right for other regions and the international events.
