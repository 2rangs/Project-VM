# `datasets/derived/ratings/` — estimated player attributes (REAL, id-keyed)

Player attribute **estimates** derived from VCT Reference box-score stats, with uncertainty and
sample-size shrinkage (README §23). **These are statistical estimates from public match stats, NOT
assessments of real players' ability.** Full method + ethics: [`docs/research/PLAYER_RATINGS.md`](../../../docs/research/PLAYER_RATINGS.md).

- `player_ratings.json` — one record per player, **keyed by `playerId` only (no names committed)**.
  Conforms to [`../../schema/player-rating.schema.json`](../../schema/player-rating.schema.json).
- `ratings_meta.json` — build metadata, shrinkage params, validation (shrinkage gain, attribute
  correlations), attribute distribution, and the disclaimer.

## Names
Names are intentionally **not** stored. To join them locally for analysis:
```sql
-- after datasets/raw/vct-reference/download.sh
SELECT pr.playerId, p.player_name
FROM read_json_auto('datasets/derived/ratings/player_ratings.json') pr
JOIN players p ON p.player_id = CAST(pr.playerId AS INTEGER);
```

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
