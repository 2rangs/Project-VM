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

## Performance (HANDOFF P2-12) — branch `sim-perf`

Faster simulation with **byte-identical output**. Every change is a cache or a lookup deferred until
it is needed; no decision logic was rewritten. Nothing is behind a flag — there is nothing to switch:
same seed and options give exactly the same match as before.

### Guard: match signatures
`packages/match-runner/test/signature.test.ts` hashes the full `runMatch` output (stable JSON,
SHA-256) of six cases and compares with `test/signature/signatures.json`, recorded **before** any
perf change (commit `d6602f0`):

| Case | What it covers |
|---|---|
| `ascent-seed1`, `ascent-seed161` | the default game (real rosters), calibration and unseen seeds |
| `ascent-abilities` | agent abilities on |
| `ascent-tracks-stats` | `recordTracks` + `collectStats` (replay frames, sight events, movement stats) |
| `haven-own`, `bind-own` | other maps on their own geometry (three sites; a geometry-derived roadmap) |

Each is capped at 13 rounds (crosses the half). All six pass after every commit below. Separately,
three full-length matches (Ascent seed 77; Ascent with abilities seed 300; Split on its own geometry
seed 9) were hashed before and after: identical.
**If you change behaviour on purpose**, the test fails by design — re-record with
`npx tsx packages/match-runner/test/signature/capture.mts` and say so in the commit.

### What changed (one commit each)
| Commit | Where | Change |
|---|---|---|
| `7eb1d7e` | spatial-engine `navigation.ts` | memoise `Navigator.locate` / `locateInZone` (pure over the immutable roadmap; perception located both bodies for every observer–target pair every tick); numeric `zoneTravelMs` cache key (no string per call — ~200 k calls a match) |
| `c4df420` | round-simulator `buy-phase.ts` | memoise the buy phase's run-time estimate (the leave check re-ran a blocked A* every half second for every standing player — ~7 000 searches a match) on blocker version, start, destination |
| `3e74e93` | spatial-engine `engine.ts`, `navigation.ts`; perception `oracle.ts` | cache `audibleZones` per (origin, threshold) (returns a fresh copy); per-zone blocker edges; `hearableSounds` collected the world's sound sources once **per observer** (O(players²) a tick) — now once per world snapshot |
| `e52e521` | spatial-engine `engine.ts` | memoise `nearestZone` per exact position, cleared whenever `setPositionZones` changes the hints (once a tick) |
| `cacf752` | team-engine `policy.ts` | memoise `retakeApproach` when no spike position is involved (pure in the static map; the defense rotation asked it for every rotator on every decision) |
| `a4c77c0` | perception `hearing.ts` | look up a sound source's zone only when the sound is heard |
| `f9e3895` | round-simulator `simulator.ts` | build mover hooks once per tick per (target zone, intent) instead of per player (each set is a handful of closures; under tsx every closure also pays esbuild's `__name` wrapper) |

`routeCache` (team-engine `planRoute`): left as it is. It is keyed by (from, to) on a zone graph that
never changes for the life of the policy object (the spatial query is a constructor argument), so it
cannot go stale; its size is bounded by zones².

Tried and dropped: reusable A* scratch buffers with generation stamps (no measurable gain — the
search is already ~30 µs on 800–1 300 nodes).

### Measured (unit-level, no batch)
Workload: the six signature cases, best of 3, interleaved base (`d6602f0`) / final (`f9e3895`)
three times, process CPU time (user + sys — robust to other sessions' load):

| | CPU | Wall |
|---|---|---|
| base | 8.10 – 8.97 s | 7.44 – 8.60 s |
| final | 5.00 – 5.51 s | 4.30 – 5.00 s |
| change | **≈ −38 % CPU** | **≈ 1.7× faster** |

Where the time goes now (profile of the same workload): team decisions ~24 % (action generation
~7 %, world-state freeze ~2 %), perception ~22 % (pairwise sight ~9 %), buy phase ~8 %, mover path
planning ~7 %, A* search ~10 % overall.

### Next steps (not done)
1. **tsx keepNames**: every closure created at run time pays esbuild's `__name` (`Object.defineProperty`).
   It was ~8 % before the hooks change and is still visible in hot loops; a bundled build without
   keepNames (or creating fewer closures in per-tick code) would remove it. Desktop runs matches
   through `npx tsx`, so it pays this today.
2. **Perception runs three times per decision tick** (engagements + one view per side), each over
   every observer × target. Sharing the sight pass is the biggest remaining win, but the
   perception engine keeps per-call memory/comms state, so it needs a careful design — not a cache.
3. Action generation (`generateActions` + `createWorldState`'s deep freeze) per decision.
4. nav/vis JSON re-parsed per match (HANDOFF P2-11) — not touched here.

### Risks
- Memo sizes are bounded (locate 50 k, nearestZone 20 k entries, retake approaches 5 k), cleared
  wholesale when full. Memory is a few MB at most.
- The `nearestZone` memo relies on the hints map not being mutated after `setPositionZones` (the
  round simulator builds a new map each time). A caller that mutates the map in place would get
  stale answers — call `setPositionZones` again instead.
- `hearableSounds`' per-world cache relies on each perceive call building a fresh world object (as
  `smokedPairs` already did).
