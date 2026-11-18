# `datasets/derived/team-profiles/` — team behaviour profiles (REAL, id-keyed)

Team economic + side/map **tendency estimates** from VCT Reference round/economy data (Handoff P4,
README §24), for PV-3 IGL opponent modelling. **Estimates from public match data, not scouting
truth.** Method + ethics + mapping: [`docs/research/TEAM_PROFILES.md`](../../../docs/research/TEAM_PROFILES.md).

- `team_profiles.json` — one record per team, **keyed by `teamId` only (no names committed)**.
  Conforms to [`../../schema/team-profile.schema.json`](../../schema/team-profile.schema.json).
- `team_profiles_meta.json` — build metadata, league means + shrinkage pseudocounts, **season
  stability**, disclaimer.
- `team_names.json` — `teamId → name` mapping with source (build, sha256).

## Point-in-time (`--as-of`)
`build_team_profiles(db, as_of=...)` uses only matches **strictly before** `as_of`, so a simulation
can reproduce the opponent profile a team had at a past date without leaking future results (Handoff
§22.3).

## What is estimated vs null
Economic: `forceBuyAfterLoss` (+ by loss tier 1/2/3+), `pistolLossForceBuy`, `bonusBuyRate`,
`antiEcoFullBuy`, `overtimeForceBuy`. Side/map: `attackWinRate`, `defenseWinRate`,
`ascentAttackWinRate`, `firstMinusSecondHalfAttack`, `mapPool`.
**Null with reason** (need positions): `sitePreference, executeTempo, defaultSetup, utilityUsage,
rotationTendency, lurkTendency, retakeVsSaveTendency, fakeTendency` — never invented.

## Names (user decision 2026-11-18)
Real team names **are committed** in `team_names.json` (user decision 2026-11-18; **public VCT teams
only**). Records stay `teamId`-keyed; join via the mapping. **Pre-launch internal dev use only —
license / name-likeness must be re-reviewed before any launch.**

## Regenerate
```bash
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  gen-team-profiles --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/team-profiles
# point-in-time: add --as-of 2025-01-01
```
