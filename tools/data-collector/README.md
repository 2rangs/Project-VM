# pv-data-collector

PROJECT V ETL. Two strictly separated jobs:

1. **Normalize real data** — read the verified VCT Reference DuckDB and emit PROJECT V schema JSON
   (`provenance.synthetic=false`). Missing source fields are left `null`, never imputed.
2. **Generate synthetic data** — the 10 Handoff §20 decision-context scenarios and a short
   deterministic Ascent map (`provenance.synthetic=true`), written only under `datasets/synthetic/`.

## Install / run (no install needed)
```bash
# from repo root; stdlib + duckdb only
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli --help
```
Or install editable: `pip install -e tools/data-collector[dev]` → gives the `pv-data` command.

## Commands
```bash
pv-data normalize-vct --db datasets/raw/vct-reference/vct.duckdb --match 754737 \
        --out datasets/normalized/vct-reference
pv-data gen-scenarios --out datasets/synthetic/scenarios
pv-data gen-map       --out datasets/synthetic/ascent
pv-data gen-priors    --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/priors
```

## Tests
```bash
cd tools/data-collector && python3 -m pytest -q
```
`test_vct_reference.py` is **skipped** unless `datasets/raw/vct-reference/vct.duckdb` is present
(run `datasets/raw/vct-reference/download.sh` first); the synthetic/provenance tests always run.

## Layout
```
src/pv_data_collector/
  provenance.py        real()/synthetic() — the only place the synthetic flag is set
  vct_reference.py     DuckDB -> normalized JSON (read-only, no imputation)
  synthetic_ascent.py  scenarios + synthetic map (seeded, deterministic)
  stats.py             Wilson interval + match-clustered bootstrap (pure, tested)
  priors.py            DuckDB -> empirical decision priors / validation baselines
  cli.py
```

The priors ETL turns the real round + economy data into
[`datasets/derived/priors/`](../../datasets/derived/priors/) (see that README and
[`docs/VALIDATION_BASELINES.md`](../../docs/VALIDATION_BASELINES.md)).
