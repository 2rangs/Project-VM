# `datasets/derived/ratings/` — estimated player attributes (REAL, id-keyed)

Player attribute **estimates** derived from VCT Reference box-score stats, with uncertainty and
sample-size shrinkage (README §23). **These are statistical estimates from public match stats, NOT
assessments of real players' ability.** Full method + ethics: [`docs/research/PLAYER_RATINGS.md`](../../../docs/research/PLAYER_RATINGS.md).

- `player_ratings.json` — one record per player, **keyed by `playerId` only (no names committed)**.
  Conforms to [`../../schema/player-rating.schema.json`](../../schema/player-rating.schema.json).
- `ratings_meta.json` — build metadata, shrinkage params, validation (shrinkage gain, attribute
  correlations), attribute distribution, and the disclaimer.
- `player_names.json` — `playerId → handle` mapping with source (build, sha256).

## Names (user decision 2026-11-18)
Real player handles **are committed** in `player_names.json` (user decision 2026-11-18; **public VCT
pros only**). Records stay `playerId`-keyed; join names via the mapping file. **Pre-launch internal
dev use only — license / name-likeness must be re-reviewed before any launch.** The values remain
estimates from public stats, not real skill assessments.

## What is estimated vs null
Estimated (shrunk, [0,1], median ~0.6): `aim, crosshairPlacement, firstBulletAccuracy, reaction,
tracking, impact, entryAggression, trading, clutch, consistency`.
**Null with a reason** (no box-score support): `movement, weaponControl, positioning, utilityUsage,
mapAwareness, rotations, communication, teamworkDiscipline, lurking, anchoring, weaponPreference,
agentMastery`. These need Layer-B / positional data and are **never** invented.

## Regenerate
```bash
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  gen-ratings --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/ratings
```
