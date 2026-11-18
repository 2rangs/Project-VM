# Team-profile & player-rating fixtures (copied — do not edit)

Verbatim copies of PV-2's derived team profiles and player ratings.

- **Origin:** `origin/claude/pv-data @ 4f9bf56`
  - `datasets/derived/team-profiles/{team_profiles.json, team_names.json}`
  - `datasets/derived/ratings/{player_ratings.json, player_names.json}`
- **Docs:** `docs/research/PLAYER_RATINGS.md` (ratings→PlayerProfile mapping)
- **Copied:** 2026-11-18 by PV-3

**Team profiles** (70 teams): `economy.{forceBuyAfterLoss, pistolLossForceBuy, bonusBuyRate,
antiEcoFullBuy, overtimeForceBuy}` each `{value, n, uncertainty}`; `tacticalNull` marks
position-based tendencies PV-2 could NOT derive (not used). Weak-discriminator metrics (e.g.
`forceBuyAfterLoss ≈0.89` near-universal) are down-weighted — see docs/DECISION_MODEL.md.

**Player ratings:** per-player `attributes.{entryAggression, trading, clutch, consistency,
aim, …}` each `{value, uncertainty, …}`; null attributes left null. PV-2's mapping to PV-3's
PlayerProfile: `aggression←entryAggression`, `discipline←consistency`, `teamwork←trading`.
Values are [0,1] (ratings median 0.6); high uncertainty → shrink toward league mean; null →
default + trace flag.

These are SYNTHETIC/derived research aids, not assessments of real players. Do not edit.
