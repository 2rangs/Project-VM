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

## Tactics screen (2026-11-25, branch `tactics-screen` from main 85eadc8)
- **Done, default ON (no effect on the sim):** `TacticsPlanner` — per site the plant spot (auto / default / safe / open / cover /
  near, or a spot picked on the minimap from the engine's `plantSpotsOf`), the post-plant plan for that spot (hold on / off the
  spike, flank watcher, ground utility kept for the spike, fall back when outnumbered), the retake plan per site and spot
  (entry, stack / split, save threshold: auto / never / custom man deficit + spare seconds); mid per map ("*" or the map) and
  side (contest / give up / auto, how many, which players or roles). Used in the Match Day plan panel, the Tactics screen
  (saved per team: career save `career.ext.tactics`, or `localStorage` outside a career) and career series.
- **Played only with engine flags, default OFF:** `plantTactics` (plant / post-plant / retake) and `midControl` (mid). Desktop:
  Match options checkboxes, and the Tactics screen's two checkboxes (stored with the team's plans, applied to career series).
  Every section is labelled "engine option off — recorded but not played" while its flag is off.
- **Proof the default is unchanged:** `packages/match-runner/test/tactics-plan.test.ts` — with both flags off, a match with every
  tactic set for both teams plays byte-identically (every event, kill, economy) to one without. With `plantTactics` on, > 70% of
  the planned team's plants are the manager's spot kind, recorded `by: "manager"` (the carrier still overrides under clock pressure).
- **Engine:** `MatchPlan` extends `TacticsPlan` (the placeholder `pending` field is gone); `planTeamInputs` copies the four fields;
  `planPending(plan, flags)` lists those whose flag is off; `SeriesConfig.match` accepts `plantTactics` / `midControl`.
- **Desktop plumbing:** engine op `tactics.map` (src/engine/tactics-map.ts) + IPC `pv:tactics:map`; `MatchOptions.plantTactics/midControl`
  reach run-match, the match session and series (`SeriesStartRequest.plan/plantTactics/midControl`); `career/session.ts setCareerExt`.
- **Tests:** match-runner 138, root 307 / 4 todo, desktop unit 87 (tactics-plan 9 incl. a type check against the engine types),
  matchday 58, engine contract 10; typecheck + build clean. e2e: see the report (run once through heavy-run).
- **Limits:** plant spots are Ascent's (every map runs on Ascent's geometry); "who goes mid" by player is offered only in a career
  (Match Day has no roster list, so roles there); the minimap image shows only once the live view's assets are loaded (dots otherwise).

## Unfinished — exact next steps
1. Run `test:e2e` and `test:e2e:series` on the merged tree (new steps: `prematch-toggle`, `pre-build`, `mgr-toggle`, `mgr-risk-more`,
   `mgr-strat-apply`, `post-match-summary`). If `pre-build` times out, the report subprocess is `scripts/prematch.mts` (2 simulated games).
2. Measure the flags: 160 managed matches (both AI) with `moodEffects`+`aiManager` on vs off, judged on the real-roster gate
   (8/8, attack 0.47–0.55); only then consider default-on.
3. (Done 2026-11-25: tactics screen.) Next for it: once `plantTactics` / `midControl` pass the gate, flip their defaults and
   drop the "recorded, not played" labels; add a per-player "who" list to Match Day (needs a roster in the desktop data).
4. Desktop packaging (desktop-decisions): move `scripts/manager-view.mts`, `scripts/prematch.mts` and the new session
   commands (`setShouts`, `setStrategy`, `teamTalk`; state/result carry `manager`) into the bundled engine host.

## Known risks
- `moodEffects` makes a losing team shakier → snowballing; constants are design values with no data behind them.
- `policy.ts` `currentPlan` change (3 lines, gated by `asOpening`) is a merge point with engine-truth / balance-recovery.
- `LiveMatch.tsx` got one optional prop (`managerOverlay`); the drawer sits top-right over the stage (matchday-uiux area).
- The pre-match report reads simulated film, not real per-round data; thin samples are tagged in the UI.
