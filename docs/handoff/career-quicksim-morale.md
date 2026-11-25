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
  then runs the MLE fit (`refit-report.mts`, analytic and bounded for thousands of series — the old
  `fit-quick-sim.mts` cross-validation is ~100× too slow at 1,100 series) which estimates the per-map
  noise σ and the per-series noise τ from the data.
- Writes the summary + calibration curve to `tools/career/quick-sim-refit.json` (committed) and stdout.
- It always replays the engine (no stale-cache reuse), so after any further engine change the integrator
  re-runs the single command to re-fit.

### Result — refit on the FINAL engine (`4584275`, 28th merge: movementStyle+weaponModes default ON, close-out fix)
Run on the final engine after merging main. 1,100 Bo3s / 2,580 maps, seed 2026, ~15 s/Bo3/core on the
heavier engine (4 cores ⇒ ≈ 60 min generation + ≈ 7 min fit). Large cache gitignored; full numbers in
`tools/career/quick-sim-refit.json`.

An earlier identical refit on the pre-final engine (`889ebef`) gave k 9.68 / σ 0.43 / τ 0.22 and was
already well-calibrated; the final engine's changes made favourites stronger, which raised the round
slope further and left the OLD shipped slope under-confident — hence the apply below.

**Best model `both` (per-map σ + per-series τ), by AIC** (rounds −8545 / +σ −8143 / +τ −8310 / **both −8133** /
both+cap −8132): the noise terms gain +412 log-lik over rounds-only (held-out 50/50 +0.45/series); a
finite ability cap (≈1.9) gains only ~1 AIC over linear, within noise, so the term is kept **linear**.

**Fitted constants (± bootstrap SE, 24 resamples) and what was shipped:**

| | refit (1,100, final engine) | SE | shipped now | note |
|---|---|---|---|---|
| `roundSlope` k | 10.57 | ±0.35 (3.3 %) | **10.57** | applied |
| `mapSlope` μ | −0.135 | ±0.122 (spans 0) | **0.28 (kept)** | fit can't pin it (needs ≈1,650 series); μ barely moves the round prob, so calibration is identical at 0.28, but a positive μ keeps the veto picking each team's *stronger* maps — a negative μ would pick the weaker ones |
| `mapNoiseSd` σ | 0.469 | ±0.013 | **0.47** | applied; **per-map noise now estimated from data** (was a 0.3 guess) |
| `seriesNoiseSd` τ | 0.238 | ±0.031 | **0.24** | applied |

**Calibration curve — "the favourite wins the series" (reps 200, final-engine 1,100 series), old shipped vs applied:**

| favourite-win bin | BEFORE k=8.2 pred→obs (n) | AFTER applied pred→obs (n) |
|---|---|---|
| 0.5–0.6 | 0.548 → 0.566 (288) | 0.551 → 0.555 (229) |
| 0.6–0.7 | 0.647 → 0.707 (304) | 0.647 → 0.674 (224) |
| 0.7–0.8 | 0.745 → 0.830 (218) | 0.749 → 0.759 (220) |
| 0.8–0.9 | 0.848 → 0.921 (177) | 0.844 → 0.855 (193) |
| **0.9–1.0** | 0.945 → 0.991 (113) | **0.951 → 0.957 (234)** |
| **Brier** | 0.166 | **0.163** |
| **ECE** | 0.055 | **0.011** |
| mean pred vs obs | 0.703 vs 0.758 (−5.5 pp) | 0.747 vs 0.758 (−1.1 pp) |

- **The P2-9 miscalibration is resolved.** On the final engine the OLD shipped slope is *under*-confident
  (favourites win more than it predicts — the engine changes strengthened favourites), the opposite of
  the original stale-120 "over-confidence" (0.94 predicted vs 0.80 observed, which was a small-sample
  artifact). Either way the applied refit flattens every bin: **ECE 0.055 → 0.011**, Brier 0.166 → 0.163,
  the 90–100% bin from 4.6 pp off to ~0.6 pp (flat).

### Constants applied + committed cache refreshed
- `QUICK_SIM` in `packages/career/src/career/quick-sim.ts` now ships k=10.57, σ=0.47, τ=0.24 (μ kept
  at 0.28, cap 0); the JSDoc records the fit and SEs.
- The committed `tools/career/calibration-data.json` (the 120-series set the unit test validates
  against) was refreshed to 120 **final-engine** series — a stride-9 sample across all four shards of
  the large set, record-having home teams first so the map-pool term is live. `quick-sim-fit.json`
  regenerated on it. On that cache the shipped constants are 1.56 log-lik from its optimum (< 3), ECE
  0.071, mean pred-vs-obs 0.005 — `quick-calibration.test.ts` passes.
- **Re-running later:** `bash tools/career/refit-quick-sim.sh`, copy `bestParams` into `QUICK_SIM`
  (keep μ positive or drop it to 0), refresh the committed 120-series cache from the large set the same
  way, `node_modules/.bin/tsx tools/career/fit-quick-sim.mts > tools/career/quick-sim-fit.json`, update
  `docs/CAREER_MODE.md` §4, and re-run the career vitest + E2E.

---

## Gate status (final engine `4584275`, merged into `claude/pv2-career`)
- **Engine untouched by this bundle.** Every change is in `packages/career` + `tools/career` + `docs`
  + `.gitignore`; no file under `packages/match-runner`, `round-simulator`, `team-engine`,
  `decision-engine`, `spatial-engine`, `combat`, `perception`, `economy-engine` or
  `packages/game-data/src` was modified beyond the merge of main, so `runMatch` hash and sim-batch seeds
  1–160 match main. (`packages/career/src/game-data.ts` is the career package's Node world-builder, not
  the engine dataset.) The quick-sim constants are a career-only change and do not reach `runMatch`.
- `packages/career` vitest: **107 passed, 1 skipped** (`PV_MORALE_MATCH` opt-in) with the applied
  constants and refreshed cache. `tsc --noEmit` clean.
- `apps/desktop` `tsc` clean, `npm run build` OK.
- **Desktop career E2E PASS** on the final engine (`test:e2e:career`, xvfb + swiftshader, this
  container): "CAREER E2E OK — signed Secret, played 0–2 with a chosen five; 5 engine-played AI series;
  season 2026 played out, contract expired, season 2027 open." Exercises the career+club flow and a full
  season advance (the unified morale path) through the engine. Regenerated `apps/desktop/docs/*.png`
  discarded per the career-shell handoff.

## Re-run commands
- Quick-sim refit (after the final engine, one line): `bash tools/career/refit-quick-sim.sh`
- Fit only, on the committed 120-series cache (seconds, no engine): `node_modules/.bin/tsx tools/career/fit-quick-sim.mts`
- Career tests: `node_modules/.bin/vitest run --root packages/career`
- Desktop career E2E: `cd apps/desktop && npm run build && xvfb-run -a env PLAYWRIGHT_REQUIRE_BASE=/opt/node-tools/ node test/e2e.career.test.mjs`
  (then discard `apps/desktop/docs/*.png`).

## Left to do
1. **Apply the refit constants on the FINAL engine** (procedure above). The current shipped constants
   are left in place on purpose because sessions A–D still change the engine; the integrator's one-line
   re-run supersedes an intermediate flip.
2. **Consider dropping `mapSlope`** (the map-pool term): at 1,100 series its SE still spans 0 (0.13 ±
   0.11; ≈ 1,311 series to separate from 0). If the final-engine refit agrees, drop it.
3. **Morale depth left for club-ops**, unchanged by this bundle: `CLUB_FLAGS.moraleInMatch` is still
   default off and ungated (size `DEPTH_MODEL.moraleAbility` from the engine's ability response first —
   `docs/handoff/club-ops.md` step 1). The unification does not turn it on.
4. AI clubs still do not track morale, so their players always develop under the model (`modelMorale`),
   never a tracked value — by design (AI clubs are neutral). If AI-club morale is ever wanted, give them
   a `club.morale` map and `moraleWeek` will populate it and development will pick it up automatically.
