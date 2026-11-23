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

Not verified at the time of writing: `test:e2e:career` (rewritten for the whole loop: sign on a
one-year contract → training → lineup with the signing → engine series → engine background sim →
season out → contract expiry → load). The first run failed at the first match day (a bid question
stopped Continue; the test now answers it); the re-run was queued behind other sessions on
heavy-run.sh. `test:e2e:club` (now starts a career) and the edited `test:e2e` / `test:e2e:series`
were not re-run. Known gaps: below five players after expiries the lineup cannot be confirmed
(no Home warning); the manager's squad is never auto-refilled.
