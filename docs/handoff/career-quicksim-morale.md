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

### Result (1,100 Bo3s, seed 2026, current engine `889ebef`)
2,583 maps. ~10–14 s per engine Bo3 per core here (4 cores ⇒ ≈ 50 min generation + ≈ 7 min fit).
The large cache is `tools/career/calibration-data.large.json` (454 KB, gitignored). Full numbers:
`tools/career/quick-sim-refit.json`.

**Best model `both` (per-map noise σ + per-series noise τ), by AIC:**

| model | logLik | AIC | note |
|---|---|---|---|
| rounds only | −8433.7 | 16873 | no noise |
| + per-map σ | −8106.7 | 16221 | |
| + per-series τ | −8237.1 | 16482 | |
| **both** | **−8097.7** | **16205** | best |
| both + cap | −8097.7 | 16207 | cap → ∞ (260): the ability term is **linear**, no saturation |

**Fitted constants (± bootstrap SE, 24 resamples):**

| | refit (1,100) | shipped (120-fit) | SE | series for target precision |
|---|---|---|---|---|
| `roundSlope` k | **9.68** | 8.2 | ±0.34 (3.5 %) | 530 (met) |
| `mapSlope` μ | **0.13** | 0.28 | ±0.11 | 1311 (**not** met — still ≈ 0, drop candidate) |
| `mapNoiseSd` σ | **0.43** | 0.39 | ±0.02 | 170 (met) |
| `seriesNoiseSd` τ | **0.22** | 0.32 | ±0.02 | 181 (met) |

- The **per-map noise is now estimated from data: σ = 0.43 ± 0.02** (it was a 0.3 guess originally,
  0.39 on 120). It is well pinned. τ fell to 0.22 and the round slope rose to 9.68. The noise terms
  gain +336 log-lik over rounds-only; held out (50/50 split) they beat rounds-only by +0.31/series.
- `mapSlope` is still indistinguishable from 0 (±0.11; needs ≈ 1,311 series). The map-pool term can
  probably be dropped; keep it only if a future, larger set separates it from 0.

**Calibration curve — "the favourite wins the series" (reps 200, in sample):**

| favourite-win bin | shipped pred→obs (n) | refit pred→obs (n) |
|---|---|---|
| 0.5–0.6 | 0.549 → 0.538 (290) | 0.548 → 0.580 (224) |
| 0.6–0.7 | 0.646 → 0.724 (294) | 0.643 → 0.676 (238) |
| 0.7–0.8 | 0.743 → 0.793 (222) | 0.750 → 0.769 (238) |
| 0.8–0.9 | 0.847 → 0.867 (181) | 0.849 → 0.822 (185) |
| **0.9–1.0** | 0.944 → 0.965 (113) | **0.950 → 0.926 (215)** |
| ECE / mean pred vs obs | 0.040 / 0.704 vs 0.737 | **0.027 / 0.741 vs 0.750** |

- **The P2-9 over-confidence is resolved.** The old "predicted 0.94, observed 0.80 (n=20)" was a
  stale small-sample artifact (the 120-series cache predated the engine changes). On 1,100 fresh
  current-engine series the top bin is **flat** (refit 0.95 → 0.926), and the quick sim is, if
  anything, mildly *under*-confident on favourites rather than over-confident. The refit tightens it
  (ECE 0.040 → 0.027, mean predicted-vs-observed gap 3.3 pp → 0.9 pp).

### Shipped constants were NOT changed (by design) — recommendation for the integrator
The engine will change again under sessions A–D, and this bundle was asked to make the refit
**re-runnable in one line so the integrator re-runs it after integration**. So the measurement is
delivered but the constants are left for the integrator to apply on the FINAL engine, not this
intermediate one. Applying them would also break the stale-engine 120-series unit test
(`quick-calibration.test.ts` checks the shipped constants against the committed old-engine cache) and
would ripple into the deterministic career tests — churn that the integrator's own re-run supersedes.

**To apply after the final engine (one procedure):**
1. `bash tools/career/refit-quick-sim.sh` → read `bestParams` and the `calibration` block of
   `tools/career/quick-sim-refit.json`.
2. Set `QUICK_SIM.roundSlope / mapSlope / mapNoiseSd / seriesNoiseSd` in
   `packages/career/src/career/quick-sim.ts` to `bestParams` (consider dropping `mapSlope` if its SE
   still spans 0).
3. Refresh the committed small cache so the unit test matches the final engine: regenerate the first
   120 (or more) of the large set into `tools/career/calibration-data.json`, then
   `node_modules/.bin/tsx tools/career/fit-quick-sim.mts > tools/career/quick-sim-fit.json`, and
   update `docs/CAREER_MODE.md` §4 numbers.
4. Re-run `node_modules/.bin/vitest run --root packages/career` and the career E2E.

---

## Gate status
- **Engine unchanged by construction.** The whole diff vs main is `packages/career/src/{development,game-data,career/quick-sim}.ts`,
  `packages/career/test/club-depth.test.ts`, `tools/career/*`, `docs/` and `.gitignore`. No file under
  `packages/match-runner`, `round-simulator`, `team-engine`, `decision-engine`, `spatial-engine`,
  `combat`, `perception`, `economy-engine` or `packages/game-data/src` was touched, so the integrator's
  `runMatch` hash and sim-batch seeds 1–160 are identical to main. (game-data.ts here is the career
  package's Node world-builder, not the engine dataset; quick-sim.ts changed only in a comment — the
  shipped constants are unchanged.)
- `packages/career` vitest: **107 passed, 1 skipped** (`PV_MORALE_MATCH` opt-in). `tsc --noEmit` clean.
- `apps/desktop` `tsc` clean, `npm run build` OK.
- **Desktop career E2E PASS** (`test:e2e:career`, xvfb + swiftshader, this container): "CAREER E2E OK —
  signed BlackWiz, played 1–2 with a chosen five; 5 engine-played AI series; season 2026 played out,
  contract expired, season 2027 open." Exercises the career+club flow and a full season advance (so the
  unified morale path), start→new career→signing→match day→engine series→background engine sim→season
  end→reload. Regenerated `apps/desktop/docs/*.png` discarded per the career-shell handoff.

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
