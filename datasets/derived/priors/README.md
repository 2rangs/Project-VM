# `datasets/derived/priors/` — empirical decision priors (REAL)

Aggregate statistics derived from the **real** VCT Reference round + economy data. Not raw records,
not synthetic — they are match-grouped win/outcome rates with uncertainty, for two uses:

1. **Decision priors** for the Action Generator / Outcome Predictor (sensible starting odds).
2. **Validation baselines** the 5v5 simulation must reproduce — see
   [`docs/VALIDATION_BASELINES.md`](../../../docs/VALIDATION_BASELINES.md).

Each file conforms to [`../../schema/prior.schema.json`](../../schema/prior.schema.json) and records the
source `sha256`, dataset build, filters, buy thresholds, and per-cell `n` + Wilson 95% interval +
**match-clustered** bootstrap interval. `provenance.synthetic = false`.

## Files & headline numbers (international events, VCT Reference build 2026-11-12)
| File | What | Selected results |
|---|---|---|
| `economy_matchup.international.json` | win rate by own vs opp buy tier | full vs semi **0.66**, semi vs eco **0.91**, eco vs full **0.12**; same-tier diagonals **0.50** (sanity) |
| `economy_matchup.ascent.json` | same, Ascent only | full vs semi **0.68** (n=1217), semi vs eco **0.93**; use for Ascent prototype |
| `pistol_conversion.json` | P(pistol winner wins next) | next round **0.88**, next two **0.37** |
| `save_eco_future_value.json` | P(win next round \| buy this round) | eco→next **0.60** vs full→next **0.51** (economic snowball behind saving) |
| `side_map_baselines.json` | attack/def win rate | all maps **0.50/0.50**; Ascent attack **0.51** overall, **0.58** first half / **0.41** second half |
| `round_outcome_distribution.json` | how rounds end | all maps: elim **0.66**, defuse **0.20**, detonation **0.11**, time **0.03**; Ascent: elim **0.71** |
| `combat_opening_duel.json` | opening-duel win rate by side | attacker **0.457** / defender 0.543 (all maps); Ascent attacker **0.437**. Sides sum to 1. |
| `kast.json` | KAST (kill / assist / survive / traded share of player-rounds), all and per side | all maps **0.711** (attack 0.703, defense 0.718); Ascent **0.711** (attack 0.687, defense 0.734) |
| `clutch_wins_per_round.json` | share of rounds won by a 1vX clutch, by X | any **0.156**; 1v1 0.094, 1v2 0.049, 1v3 0.011, 1v4 0.002, 1v5 0.0004 (Ascent any 0.151) |
| `plant_post_plant.json` | plant rate; post-plant attack win; share of plants that detonate | plant rate **0.687** (Ascent **0.601**); post-plant attack win **0.709** (Ascent **0.738**) |
| `role_kill_share.json` | kills / (kills + deaths) by agent role | duelist **0.515**, sentinel 0.510, controller 0.492, initiator 0.486 (K/D 1.06 / 1.04 / 0.97 / 0.95) |

The last four back the *report-only* play metrics of the sim validation (`docs/VALIDATION_BASELINES.md` §8).
They come from `player_map` / `notables` aggregates (international, performance block available);
`role_kill_share` also needs the agents catalog (`--agent-roles packages/game-data/data/agents.json`).

## Method notes (read before trusting a number)
- **Buy tiers** (team total loadout, credits): `pistol` = round 1/13; `eco` < 5000; `semi` 5000–20000
  (half + force conflated); `full` ≥ 20000. Thresholds grounded on the real bimodal loadout
  distribution; tune in `tools/data-collector/src/pv_data_collector/priors.py`.
- **Per-team rows.** Matchup/side/save priors expand each round into two perspectives (team0, team1),
  so `n` counts team-rounds; the same-tier diagonal being exactly 0.50 is the built-in sanity check.
- **Leakage-aware (Handoff §22.3–22.4).** Rounds of a match are correlated → the bootstrap resamples
  **whole matches** (`groupingUnit = match_id`). Pistol/eco priors use the *next* round only as the
  measured outcome, never as a within-round feature. `season`/`patch`/`map` filters are recorded so
  slices can be recomputed without leaking across them.
- **Overtime** is excluded from the economy matchup (OT uses a fixed-credit economy) and reported
  separately in side baselines. `smallSample=true` flags cells with n < 100 — treat with caution.

## Regenerate
```bash
./datasets/raw/vct-reference/download.sh
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  gen-priors --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/priors \
  --agent-roles packages/game-data/data/agents.json
#   --only <priorId> (repeatable) writes just those files and leaves the others' timestamps alone
#   --era 'patch>=9' --out datasets/derived/priors/patch-ge9   for the current-meta cut
```
