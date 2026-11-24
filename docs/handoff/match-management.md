# Handoff — match management, series & veto (branch `claude/series-veto-dc09f7`)

Owner session: series-veto. Detailed docs: `docs/MATCH_MANAGEMENT.md` (in-match management, prep) and
`docs/SERIES_AND_VETO.md` (series, veto, mastery, scouting — already on main).

## Done, default ON (no effect on the sim unless a person acts)
- **Managed match session** `createManagedSession` (`packages/match-runner/src/managed-session.ts`), a superset of
  `createMatchSession`. With default options and no manager action it plays exactly like `createMatchSession`
  (test `management.test.ts` › "default options").
- **Manager levers (person-chosen):** shouts (tempo / risk / defense), strategy for the next N rounds, timeout orders,
  pre-match plan (leans → standing priors, report → opponent-model prior, pistol and after-pistol-loss orders),
  half-time talk choice. These change play only when the user uses them.
- **Alerts + auto-pause** (0–4 run, broken economy, player tilting, half-time), **decision log** with rounds won 3 before /
  3 after and tilt after, **pre-match opponent report** (`prep.ts buildOpponentReport`, simulated film).
- **Desktop:** manager drawer in the live view, half-time talk dialog, post-match decision summary (Review),
  report + plan panel on Match Day setup, ko/en strings, series maps through the same layer.
- `MatchEngine.setRoundInputs` (per-round values composed with teamInputs), all marked `[manager]` in `match.ts`.

## Behind flags, default OFF (not validated against the real-roster gate)
| Flag | Where | What it turns on |
|---|---|---|
| `moodEffects` | `ManagedSessionOptions`; desktop `MatchOptions.moodEffects` | state of mind → round form σ, throw hazard, trading / gameSense |
| `aiManager` | `ManagedSessionOptions`; desktop `MatchOptions.aiManager` | AI shouts, half-time talks, attribute-driven timeouts |
| `timeoutsPerHalf` | `ManagedSessionOptions`; desktop `MatchOptions.timeoutsPerHalf` | per-half timeout limit (VCT rule unverified) |
| `asOpening` | `TeamOrder` / `PolicyOrder` (`team-engine/src/policy.ts`) | a forced strategy is the round's opening call, so the attack goes to the named site |
| `managed` | `SeriesSessionOptions` (series-session host passes `true`) | series maps played with the managed session (flags above still off) |
Desktop: Match options → **감독 실험 기능 / Manager experimental** (default off) sets the first three.
`asOpening` is set by the manager layer for person-chosen levers only; the legacy AI timeout order does not set it.

## Measured
- `runMatch` unchanged: 5-match full-record hash identical to main 7073bac's engine (`scripts/match-signature.mts`, `e8da5918…bd32f1`).
- Order → site counterfactual (asOpening): forced A-executes planted A 7 / B 0; B-executes A 0 / B 10 (seed 9).
- Series / mastery / scouting effects: `docs/SERIES_AND_VETO.md` §6.1 (seeds 1–200). Scouting's win-rate effect was not detectable.
- **Not measured:** win-rate effect of `moodEffects` / `aiManager` (needs a few hundred managed matches through heavy-run).
- Tests at handoff: match-runner 119 (management 15), root 264 / 4 todo, desktop unit 69 · matchday 54 · engine contract 4,
  typecheck + build clean. e2e: the gate run was cancelled at the integrator's request (combined gate on the merged tree);
  `test:e2e` and `test:e2e:series` now include report / plan / manager-drawer / decision-summary steps that have NOT run yet.

## Unfinished — exact next steps
1. Run `test:e2e` and `test:e2e:series` on the merged tree (new steps: `prematch-toggle`, `pre-build`, `mgr-toggle`, `mgr-risk-more`,
   `mgr-strat-apply`, `post-match-summary`). If `pre-build` times out, the report subprocess is `scripts/prematch.mts` (2 simulated games).
2. Measure the flags: 160 managed matches (both AI) with `moodEffects`+`aiManager` on vs off, judged on the real-roster gate
   (8/8, attack 0.47–0.55); only then consider default-on.
3. Wire engine-truth plant / post-plant / retake and maps-data mid control: `prep.ts planTeamInputs` copies `MatchPlan.pending.*`
   into `TeamMatchInputs` once those fields exist; enable the disabled selects in `PrematchPanel.tsx`.
4. Desktop packaging (desktop-decisions): move `scripts/manager-view.mts`, `scripts/prematch.mts` and the new session
   commands (`setShouts`, `setStrategy`, `teamTalk`; state/result carry `manager`) into the bundled engine host.

## Known risks
- `moodEffects` makes a losing team shakier → snowballing; constants are design values with no data behind them.
- `policy.ts` `currentPlan` change (3 lines, gated by `asOpening`) is a merge point with engine-truth / balance-recovery.
- `LiveMatch.tsx` got one optional prop (`managerOverlay`); the drawer sits top-right over the stage (matchday-uiux area).
- The pre-match report reads simulated film, not real per-round data; thin samples are tagged in the UI.
