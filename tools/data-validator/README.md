# pv-data-validator

Validates every PROJECT V dataset JSON against the machine schemas in `datasets/schema/` and
enforces the **real/synthetic separation rule**: files under `datasets/synthetic/` must be marked
`provenance.synthetic=true`; files under `datasets/normalized/` must be `false`.

## Run
```bash
PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.cli \
  --datasets datasets --schema datasets/schema
# add --quiet to print only failures + the summary
```
Exit code is non-zero if any file fails. File→schema routing: `match.json`→match, `teams.json`→team[],
`players.json`→player[], `maps.json`→map[], `rounds.json`→round[], `events.json`→event[],
`scenario_*.json`→worldState (DecisionContext).

## Simulation validation harness (`pv-validate-sim`)
Checks a bundle of **simulated** round logs (PV-core `EventLog` shape) against PV-2's real baselines
(`datasets/derived/priors/` + the tolerances in `docs/VALIDATION_BASELINES.md`). Metrics with a real
baseline are PASS/FAIL; combat metrics VCT Reference can't back (man-advantage, trade rate, round
duration) are **reported only** (see the data-gap note in `VALIDATION_BASELINES.md`).

```bash
# once a real 5v5 sim exists, dump its per-round EventLogs to one JSON bundle, then:
PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.sim_cli \
  --logs sim_run.json --priors datasets/derived/priors --scope ascent --out reports/sim_validation
# writes reports/sim_validation.json + .md; exit code != 0 if any judged metric fails
```

**Input bundle** (`examples/sim_run_good.json` is a runnable sample):
```jsonc
{ "meta": {"synthetic": true},
  "rounds": [ {
      "roundNumber": 1, "map": "Ascent",
      "roster": {"a0":"attack", ..., "d0":"defense", ...},   // side per player this round
      "buyTiers": {"attack":"full","defense":"full"},         // optional (enables economy matchup)
      "events": [ {"kind":"roundStart",...}, {"kind":"kill","killer":"a0","victim":"d0",...},
                  {"kind":"roundEnd","winner":"attack","reason":"spikeDetonation",...} ] } ] }
```
Metrics: round-outcome distribution, attacker win rate, opening-duel rate, economy matchup (judged);
man-advantage states, trade rate, average round duration (reported-only). A worked sample report is
`examples/report_good.md`.

Try it now against the committed example runs:
```bash
PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.sim_cli \
  --logs tools/data-validator/examples/sim_run_good.json --scope ascent   # 7/7 pass, exit 0
PYTHONPATH=tools/data-validator/src python3 -m pv_data_validator.sim_cli \
  --logs tools/data-validator/examples/sim_run_bad.json  --scope ascent   # all fail,  exit 1
```

### `sim:validate` runner (Match Runner → report)
`scripts/sim-validate.mjs` is the integration entry: it takes the Match Runner's exported
`SimRun` bundle (round-simulator `toValidationRun()` output) and runs the harness, writing
`reports/sim-validation.{json,md}`. It resolves repo-root paths regardless of cwd, validates the
`SimRun` shape with friendly errors, and propagates the harness exit code (non-zero on any judged
failure) so CI can gate on it.

```bash
# direct:
node tools/data-validator/scripts/sim-validate.mjs --logs path/to/sim_run.json
node tools/data-validator/scripts/sim-validate.mjs --example            # runs the shipped good fixture
pnpm --filter @pv/economy-engine exec node ../../tools/data-validator/scripts/sim-validate.mjs --example
```

**era default** is `all` — PV-2's recommendation (era-stable baselines, tighter CIs; see
`docs/VALIDATION_BASELINES.md §7`). Override per run with `--era 'patch>=9'` or env `PV_SIM_ERA`.
The Match Runner can also pipe the bundle: `… | node …/sim-validate.mjs --logs -`.

**Root wiring (owned by the root-config owner, not PV-2):** add one line to the root `package.json`
`scripts` so `pnpm sim:validate` works repo-wide —
```jsonc
"sim:validate": "node tools/data-validator/scripts/sim-validate.mjs"
```
then: `pnpm sim:validate -- --logs reports/last_match.json` (era override: `pnpm sim:validate -- --era 'patch>=9' --logs …`).

### `sim:batch` runner (N matches → validate)
`scripts/sim-batch.mts` runs **N full matches** through `@pv/match-runner` `runMatch`, bundles every
round into the SimRun contract, and pipes it into `sim:validate` — the end-to-end "how close is the
simulator to real VCT?" check and the way PV-3/PV-4 measure improvements against a fixed baseline.

```bash
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20            # writes reports/sim-batch.{json,md}
#   options: --matches N  --seed-start S  --map NAME  --max-rounds R  --era all|patch>=9
#            --out FILE (SimRun bundle)  --report PREFIX  --no-validate (bundle + summary only)
#            --abilities (agent abilities on; default off, as the desktop game plays today)
#            --mirror (both teams league-average players instead of real rosters — see below)
#   --compare FILE : diff against a prior report JSON — report gains Base / Δ / Move (↑ better /
#                    ↓ worse) columns and an "N improved, N worsened" summary. Use this after each
#                    PV-3/PV-4 fix to judge it against the committed baseline:
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20 \
  --compare docs/research/SIM_BASELINE_2026-11-18.json
```
**Teams.** Matches are played by real game-data rosters (46 teams, `simulatableTeamRefs()`), match
i pairing teams[2i mod n] vs teams[2i+1 mod n]; the rest of the MatchConfig is what the desktop Match
Day sends with default options. Every batch before 2026-11-23 — including the committed baselines and
the "8/8, attack 0.521" result in `docs/research/NAVIGATION_ENGINE.md` §7 — read team ids as `t.id`,
a field game-data does not have, so both sides played league-average players. `--mirror` keeps that
condition and reproduces those runs exactly (same match ids, same seeds).

"improved" = the sim value moved **closer to the real VCT target** than the baseline was. A metric
absent from the baseline is `＋ new`; reported-only metrics show Δ but no direction.
It prints a summary (attack win rate, pistol win rate, round-end reason distribution) to stderr and
writes the SimRun bundle + the `sim:validate` report. Deterministic per seed. A recorded baseline is
in `docs/research/SIM_BASELINE_<date>.md`. **Root wiring** (root owner):
`"sim:batch": "tsx tools/data-validator/scripts/sim-batch.mts"` → `pnpm sim:batch -- --matches 20`.

> Needs the pnpm workspace installed (`pnpm install`) so tsx can resolve the engine packages. The
> pytest smoke test skips cleanly when it isn't.

### Report-only play metrics
Besides the judged metrics, every report lists how the rounds were *played*. None of these is judged
or changes the exit code; where VCT Reference can back one, the real figure is shown in the `Real`
column as a reference (`note: reference only: <prior>`).

| Metric (report row) | What | VCT reference |
|---|---|---|
| `first_kill_time_s`, `first_kill_early` | seconds to the first kill (mean, p10/p50/p90); share within 15 s | none — no kill timestamps |
| `flawless_rounds` | rounds the winner took without losing a player | none — no per-round deaths |
| `economy` → `force_vs_full_win` | force buy into a full buy | `economy_matchup` semi vs full (tier definitions differ) |
| `round_duration_s` | round length (mean, p10/p50/p90; p50 by outcome) | none — the source has map duration incl. buy phases and pauses |
| `plant_to_end_s` | seconds from the plant to the round end (and p50 by outcome) | none |
| `site_arrival_spread_s` | first→last attacker onto the site; gap between consecutive arrivals | none — no positions |
| `route_diversity` | entropy (bits) and count of the lead attacker's routes; entropy over all routes | none |
| `body_overlap` | share of ticks / rounds with two bodies closer than 30 uu | none |
| `trade_rate_3s` | deaths avenged by a teammate within 3 s (`trade_rate` keeps the 5 s window) | none |
| `clutch_win_rate` | 1vX clutches won / attempted, by X | none — the source lists clutches won, not attempts |
| `clutch_wins_per_round` | share of rounds won by a 1vX clutch, by X and `any` | `clutch_wins_per_round.json` |
| `post_plant` | plant rate, post-plant attack win rate, share of plants that detonate | `plant_post_plant.json` |
| `post_plant_by_advantage` | post-plant attack win by attackers − defenders alive at the plant | none — no per-round kill sequence |
| `kast` | Kill / Assist / Survive / Traded (3 s) share of player-rounds, all and per side | `kast.json` — the simulator records no assists, so its value is K+S+T |
| `role_kill_share` | kills / (kills + deaths) by agent role (K/D in the note) | `role_kill_share.json` |

The event-derived ones are computed by the harness from the bundle; the positional ones are measured
by the engine (`MatchConfig.collectStats`) and reach the report through the bundle's `engine` block,
which `sim:batch` writes. A bundle without `roles` or `engine` simply has no rows for those metrics.
Definitions, the baselines and which of them could become judged: `docs/VALIDATION_BASELINES.md` §8.

### Measurement suite (one command)
```bash
npx tsx tools/data-validator/scripts/measure-suite.mts        # or: pnpm sim:suite
```
runs the regular set of batches — **one at a time**, each through the machine's heavy-run lock — and
writes one comparison table against the previous comparable run:

| Batch | What |
|---|---|
| `default` | 160 matches, seeds 1..160, Ascent — the judged baseline condition |
| `seed161` | 160 matches, seeds 161..320 — is a result specific to the calibration seeds? |
| `abilities` | 160 matches with agent abilities on |
| `map-<id>` | 60 matches on each map's own geometry (`--geometry own`), every map in the registry |

Output goes to `reports/suite/<run-id>/` (not committed): `SUITE.md` (the table: judged metrics,
report-only metrics, verdicts that flipped), `suite.json`, `comparison.csv`, and per batch
`<batch>.run.json` (bundle), `<batch>.json` / `.md` (report), `<batch>.engine.json`, `<batch>.log` —
every file has its own path. The previous run is the most recent earlier one **with the same match
counts** (a small dry run never becomes the baseline of a full run); `--compare DIR` picks one,
`--compare none` writes the table without changes.

```bash
# options: --matches N (Ascent batches, default 160)   --map-matches M (per map, default 60)
#          --maps a,b,c   --only default,map-haven   --run-id ID   --out-dir DIR   --python BIN
#          --lock PATH (default $PV_HEAVY_RUN, else the project's shared lock)   --no-lock
#          --plan         print the batches and commands as JSON; runs nothing
npx tsx tools/data-validator/scripts/measure-suite.mts --matches 2 --map-matches 1 --maps ascent,haven   # dry run
```
Each batch is started as `<lock> "suite <run>: <batch>" -- npx tsx sim-batch.mts …`: it waits behind
any other heavy job on the machine and frees the lock when it ends. A batch that does not finish
(e.g. a map whose own geometry still breaks) is marked **failed** in the table and the suite goes on;
the exit code is then 4. Judged-metric failures are the report's business, not an error (exit 0).

### Python environment and exit codes
`sim:validate` needs only a Python ≥ 3.11 — the sim harness is standard-library only (`jsonschema` is
needed by the *dataset* validator, `pv_data_validator.cli`, not by this). The interpreter is
`--python`, else `$PYTHON`, else `python3`. It is checked **before** anything else runs, so a missing
interpreter, a virtualenv whose base Python is gone, or a too-old Python fails in under a second with
a plain message — `sim:batch` and the suite check it before simulating a single match.

| Exit | Meaning |
|---|---|
| 0 | every judged metric passes |
| 1 | a judged metric fails |
| 2 | usage error |
| 3 | the Python environment or the harness is broken — nothing was judged |
| 4 | (suite only) at least one batch did not finish |

### Tests
```bash
cd tools/data-validator && python -m pytest          # harness, play metrics, env check, runners (needs pytest; the TS runners need `pnpm install`)
npx vitest run --config tools/data-validator/vitest.config.ts   # TS tooling: suite planning / comparison, env check
```

## Tests
```bash
cd tools/data-validator && python3 -m pytest -q
```
Tests validate the committed datasets tree, check the separation rule and schema rejection fail bad
records, and prove the sim harness passes a baseline-matching run and fails a deliberately-wrong one.
