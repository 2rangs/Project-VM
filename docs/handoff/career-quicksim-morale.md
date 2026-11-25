# Handoff — career quick sim refit (P2-9) and morale unification (P2-10)

Branch `claude/pv2-career` (from main `889ebef`). Second work bundle, session E (career).
Owns `packages/career` and the career tools/docs; the engine packages were **not** touched
(other sessions A–D own those). Not merged; the integrator runs the combined gate.

Design/background: `docs/CAREER_MODE.md` §4 (quick sim), `docs/GENERATED_PEOPLE.md` §10 (development),
`docs/CLUB_OPERATIONS.md` §9–10 (club morale), `docs/handoff/career-shell.md` Update 5 (the prior
120-series fit that deferred the ~1,100-series refit).

---

## P2-10 — morale is now one model (done)

### The problem
Two moralés existed, on disjoint player sets and with different formulas:
- **club tracked morale** (`club/people.ts`): a stored value `club.morale[id]` ∈ [0,1], neutral 0.5,
  for the manager's squad only. `moraleWeek` drifts it toward `moraleTarget` (from recent results,
  playing time vs the contract's role, pay vs market, coach motivation); `clubSeriesResultMut` swings
  it ±`moraleSeries` after each series. This is what the UI shows, what renewals read, and — behind
  `CLUB_FLAGS.moraleInMatch` (default off) — what reaches the match roster.
- **development season morale** (`development.ts` `developmentMorale`): recomputed at season end from
  the season's form and the player's role against ambition, for **every** player, and fed to the
  development growth multiplier `Mor = morBase + morSpan·morale`.

So the manager's squad developed under a number disconnected from the morale the club tracked all
season and showed to the player.

### The unification
There is now **one** morale per player, and `developmentMorale` is the single getter:

```
developmentMorale(w, p, form) = isTrackedMorale(w, p) ? moraleOf(w.club, p)   // the club's tracked value — canonical
                                                      : modelMorale(w, p, form) // the model, for untracked players
```

- `isTrackedMorale(w, id)` is true when `club.morale[id]` exists — it distinguishes "tracked at
  neutral 0.5" from "not tracked" (both read 0.5 through `moraleOf`).
- `modelMorale` is the former `developmentMorale` formula verbatim (form + role-vs-ambition). It now
  only serves players the club does not track: AI clubs, free agents, and any world with no club.
- So career development for the manager's squad runs on the tracked morale (results, playing time,
  pay, coach, and the per-series swings), the same value the UI and renewals use. No second number.

`CLUB_FLAGS.moraleInMatch` stays default **off**; `readiness.ts` (the match path) is unchanged, and
`moraleTarget` / `moraleWeek` / the series swing keep their exact formulas (the club-depth assertions
pin them).

### Why it is safe
Every existing development test runs on a club-less world (`w.club` undefined ⇒ nothing is tracked ⇒
`developmentMorale` falls to `modelMorale`), so their outputs are **byte-identical**. The club tests
pin the club formulas, which did not change. A new `club-depth` test proves the precedence: a tracked
value overrides the form argument, drives growth, and an AI club's player still uses the model.

### Tests
`packages/career` vitest: **107 passed, 1 skipped** (was 106/1 — the +1 is the new unification test).
Full career suite green; `tsc --noEmit` clean.

---

## P2-9 — quick sim refit on ~1,100 engine series

### What was deferred, and done here
The prior fit (`docs/handoff/career-shell.md` Update 5) was a maximum-likelihood fit on **120** cached
engine Bo3s and shipped `roundSlope 8.2 / mapSlope 0.28 / mapNoiseSd 0.39 / seriesNoiseSd 0.32`. It left
two things open: the 90–100% reliability bin was over-confident (predicted 0.94, observed 0.80, n=20),
and the ability slope wanted ±5% precision ⇒ ≈ 1,100 series (≈ +980, the engine-time run was not done
because the heavy-run lock belonged to the engine gates). This bundle runs that ≈ 1,100-series refit on
the **current** engine.

### The harness (one line, re-runnable after the engine changes)
```
bash tools/career/refit-quick-sim.sh [series=1100] [seed=2026] [shards=nproc]
```
- Fans the generation across cores (`calibrate-quick-sim.mts --shard=i/n --gen-only`, independent
  team-draw stream per shard, globally unique match seeds), merges the shard caches into one cache
  keyed by `seed` at `tools/career/calibration-data.large.json` (**gitignored — big, do not commit**),
  then runs the MLE fit (`fit-quick-sim.mts`) which estimates the per-map noise σ and the per-series
  noise τ from the data.
- Writes the summary + calibration curve to `tools/career/quick-sim-refit.json` (committed) and stdout.
- It always replays the engine (no stale-cache reuse), so after sessions A–D's engine changes land the
  integrator re-runs the single command to re-fit on the final engine.

<!-- FILL AFTER REFIT: measured per-series time, best-fit params ± bootstrap SE, reliability table
     (shipped vs refit), whether the 90–100% bin is now flat, whether shipped constants were updated,
     whether the 120-series quick-calibration.test.ts still passes. -->

---

## Gate status
- **Engine unchanged by construction**: no file under `packages/match-runner`, `round-simulator`,
  `team-engine`, `decision-engine`, `spatial-engine`, `combat`, `perception`, `economy-engine` or
  `packages/game-data/src` was touched (diff is `packages/career` + `tools/career` + docs + gitignore).
  The integrator's `runMatch` hash and sim-batch seeds 1–160 are therefore identical to main.
- `packages/career` vitest + `tsc`: green (see above).
- Desktop career E2E: <!-- FILL: attempted / result -->

## Re-run commands
- Quick-sim refit (after the final engine): `bash tools/career/refit-quick-sim.sh`
- Fit only, on the committed 120-series cache (seconds, no engine): `node_modules/.bin/tsx tools/career/fit-quick-sim.mts`
- Career tests: `node_modules/.bin/vitest run --root packages/career`

## Left to do
<!-- FILL AFTER REFIT -->
