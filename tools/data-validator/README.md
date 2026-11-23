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

## Tests
```bash
cd tools/data-validator && python3 -m pytest -q
```
Tests validate the committed datasets tree, check the separation rule and schema rejection fail bad
records, and prove the sim harness passes a baseline-matching run and fails a deliberately-wrong one.
