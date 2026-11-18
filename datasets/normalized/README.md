# `datasets/normalized/` — REAL normalized data

Every file here is derived from a **real, verified source** and carries
`provenance.synthetic = false`. Do not place synthetic data here (the validator enforces this).

## `vct-reference/<matchId>/`
Normalized from the VCT Reference DuckDB (see `../raw/vct-reference/`). One directory per match:
`match.json`, `teams.json`, `players.json`, `maps.json`, `rounds.json` — each conforming to the
schemas in `../schema/`.

| matchId | Series | Maps | Notes |
|---|---|---|---|
| `754737` | LOUD vs Team Vitality — Champions 2026 Grand Final (Bo5) | Summit, Lotus, Sunset, Haven | The Handoff §6.3 reference match. **No round economy recorded** → `startEconomy` is `null` on every round (not zero-filled). |
| `754730` | 100 Thieves vs G2 — Champions 2026 UBQF (Bo3) | Abyss, Ascent | Contains a real **Ascent** map with full per-round economy (loadout/bank). |

### What is and isn't here (Layer A only)
VCT Reference is match/player/team **statistics** + a start-of-round **economy snapshot**. It has
**no** player positions, per-event timeline, per-player loadout detail, or ultimate points. Those
fields exist in the schema but are intentionally **absent** here — never imputed. Obtaining them
(Layer B) requires the vlr.gg 2D-replay logs path documented in `docs/handoffs/PV-2-data.md`.

## Regenerate
```bash
./datasets/raw/vct-reference/download.sh           # fetch vct.duckdb (~13 MB)
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  normalize-vct --db datasets/raw/vct-reference/vct.duckdb --match 754737 \
  --out datasets/normalized/vct-reference
```
