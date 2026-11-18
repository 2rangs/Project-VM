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

## Tests
```bash
cd tools/data-validator && python3 -m pytest -q
```
Tests validate the committed datasets tree and check that the separation rule and schema rejection
actually fail bad records.
