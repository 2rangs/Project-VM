# Handoff — validation metrics & measurement suite (HANDOFF P0-2 / P0-3)

Branch `claude/wider-validation-metrics` (merged with `origin/main` 65180b9). Tooling only: no engine,
policy or desktop code changed, so the default game and every judged number are unchanged.

## Done (all default-on — there is nothing to switch on)

1. **Report-only play metrics** in every `sim:validate` / `sim:batch` report
   (`tools/data-validator/src/pv_data_validator/sim_harness.py`, `play_metrics`):
   first-kill time (mean/p10/p50/p90, share ≤ 15 s), flawless rounds, round duration (distribution and
   p50 by outcome), plant→end time, trades within 3 s (`trade_rate` keeps its 5 s window), clutch win
   rate by 1vX (wins / attempts), clutch wins per round by 1vX, plant rate, post-plant attack win,
   post-plant attack win by man-advantage at the plant, KAST (all / attack / defense), kill share by
   agent role (K/D in the note), and — from the engine's own stats, passed in the bundle's `engine`
   block — site-arrival spread, lead-route entropy / count, body overlap. Force-vs-full was already a
   row (`economy` → `force_vs_full_win`). **None is judged; none changes the exit code.**
2. **VCT baselines** for the ones the source can back, generated from `vct.duckdb`
   (sha `a1a189d0…`) into `datasets/derived/priors/` and `…/patch-ge9/`:
   `kast.json`, `clutch_wins_per_round.json`, `plant_post_plant.json`, `role_kill_share.json`
   (generator: `tools/data-collector/src/pv_data_collector/priors.py` `build_play_priors`;
   `gen-priors --agent-roles packages/game-data/data/agents.json --only <id>`). They appear in the
   report's `Real` column marked "reference only". Timed and positional metrics have no baseline
   (the source has no timestamps or positions). Table and definitions: `docs/VALIDATION_BASELINES.md` §8.
3. **Measurement suite, one command:** `npx tsx tools/data-validator/scripts/measure-suite.mts`
   (`pnpm sim:suite`). Default 160 (seeds 1–160) → unseen seeds 161–320 → abilities on → 60 matches per
   map on its own geometry (11 maps). Each batch runs through the heavy-run lock, strictly one at a time,
   into its own files under `reports/suite/<run-id>/`; ends with `SUITE.md` + `comparison.csv` against
   the latest earlier run with the same match counts. `--plan` prints the batches without running.
4. **Python environment check, fail early:** `scripts/python-env.mjs`, used by `sim-validate.mjs`,
   `sim-batch.mts` and the suite. A missing interpreter, a broken venv (dangling symlink), a Python < 3.11
   or one that cannot import the harness exits **3** within a second with a plain message — before any
   match is simulated. A harness crash is also exit 3, not 1 ("a metric failed"). `sim:validate` no longer
   needs `jsonschema` (the package imports the dataset validator lazily), so any system Python works.
   Exit codes: 0 pass · 1 judged fail · 2 usage · 3 environment · 4 (suite) a batch did not finish.

## Flags

None added to the engine. Suite-only options: `--no-lock` (off by default — the lock is always used),
`--compare none`, `--only`, `--maps`, `--matches`, `--map-matches`, `--python`, `PV_HEAVY_RUN`.

## Measured

- Judged metrics: unchanged by this branch (tooling only). Last real-roster gate is the integrator's.
- Suite dry run (`--matches 2 --map-matches 1 --maps haven`, run `dry-1`): `default` and `seed161`
  batches completed through the lock with every new row filled in; `abilities` and `map-haven` were
  cancelled at the wrap-up (lock queue). Sample from `default` (2 matches — not meaningful as numbers):
  first kill p50 37.2 s · flawless 0.125 · plant rate 0.550 (VCT Ascent 0.601) · KAST 0.802 (VCT 0.711)
  · clutch wins/round 0.225 (VCT 0.150) · duelist kill share 0.429 (VCT 0.514) · lead-route entropy
  1.47 bits · body overlap 0.003 of ticks.
- Tests: data-validator pytest 65 (incl. real 1-match batch, through the lock), TS tooling vitest 26
  (`npx vitest run --config tools/data-validator/vitest.config.ts`), data-collector pytest 50 (+4
  skipped), root vitest 264, typecheck clean.

## Unfinished — exact next step

1. Run the full suite once on main (`pnpm sim:suite`, ≈ 3 × 160 + 11 × 60 matches, one batch at a time)
   to get the first comparable baseline run; the second run onward gets the change columns.
2. Proposed to become judged (not switched on — `VALIDATION_BASELINES.md` §8): **plant rate** (Ascent
   0.601, ±0.04), **post-plant attack win** (Ascent 0.738, ±0.04), **clutch wins per round, any X**
   (Ascent 0.151, ±0.03). Decide tolerances from the suite's seed-to-seed spread first.
3. The suite's map batches were not exercised beyond planning (`map-haven` cancelled).

## Known risks

- **KAST levels are not comparable to VCT**: the simulator records no assists (pushes its KAST down),
  while other differences (e.g. more survivals) can push it up — the 2-match sample above came out
  higher than VCT. Compare trends between runs, not levels. Not proposed as judged.
- **Kill share by role** reflects roster slots of the one fixed comp (`ASCENT_COMP`), not play style.
- **Clutch convention** (a dead last player whose spike detonates is not credited) is assumed to match
  the source's — not verified.
- The suite's default lock path is this machine's (`/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh`);
  elsewhere pass `--lock`/`PV_HEAVY_RUN` or `--no-lock`. A full suite holds the queue for a long time
  (each batch re-queues, so others can interleave between batches).
- `reports/` is git-ignored: suite runs live only on the machine that made them.
