# PROJECT V — VALIDATION BASELINES

**Owner:** Data Engineering (PV-2) · **Date:** 2026-11-18 · **Status:** v0.1
**Source:** VCT Reference `vct.duckdb` build **2026-11-12**, sha256 `a1a189d0ec7d…`, **international** events.
**Machine data:** [`datasets/derived/priors/*.json`](../datasets/derived/priors/) (schema
[`prior.schema.json`](../datasets/schema/prior.schema.json)).

These are the real-data target distributions the 5v5 simulation must reproduce (README §31) and the
decision priors the Action Generator / Outcome Predictor can lean on (Handoff §13, §15). Every target
below has a sample size and a 95% interval in the JSON; **compare the simulation's rate against the
interval, not the point estimate.** Numbers are descriptive of pro VCT, not laws — treat them as
calibration targets with the tolerances suggested here.

## How to validate
1. Run the simulation over the **same situation distribution** (e.g. the same buy-tier mix, same map).
2. Compute the simulation's rate for each cell below.
3. **Pass** if the simulated rate falls within the suggested tolerance of the real point estimate
   **and** overlaps the real 95% interval. Flag cells where the real `smallSample=true` (n<100) as
   low-confidence — don't tune against them.
4. Keep the comparison **match/episode-grouped** (don't let many correlated rounds inflate confidence).

---

## 1. Economy matchup — win rate by buy tier  (`economy_matchup.*`)
Buy tiers on team total loadout (credits): `eco` <5000, `semi` 5000–20000 (half+force), `full` ≥20000,
`pistol` = round 1/13. Per-team rows (each round counted from both sides), OT excluded.

| own vs opp | Intl all-maps rate | Ascent rate | Target tolerance |
|---|---|---|---|
| full vs full | 0.500 | 0.500 | ±0.03 (diagonal **must** stay ≈0.50 — symmetry sanity) |
| semi vs semi | 0.500 | 0.500 | ±0.03 |
| full vs semi | **0.660** | **0.681** | ±0.05 |
| semi vs eco | **0.914** | **0.928** | ±0.04 |
| full vs eco | 0.885 | 0.960 (n=25, small) | ±0.06 (Ascent small-sample: don't tune) |
| eco vs full | 0.115 | 0.040 (small) | ±0.06 |
| eco vs semi | 0.086 | 0.072 | ±0.04 |

*Interpretation:* a buy advantage is worth ~+16pp (full>semi) to ~+41pp (semi>eco); eco upsets a full
buy ~11% of the time. These are the economic odds the Outcome Predictor should approximately match.

## 2. Pistol conversion  (`pistol_conversion.json`)
| Event | Rate | Tolerance |
|---|---|---|
| Win the round after winning the pistol | **0.879** | ±0.04 |
| Win both rounds after the pistol | **0.37** | ±0.05 |

## 3. Save / eco future value  (`save_eco_future_value.json`)
Per-team baseline win rate is 0.50 by construction; the contrast is the signal (Handoff §15).
| Condition | P(win next round) | Tolerance |
|---|---|---|
| Team on **eco** this round | **0.598** | ±0.04 |
| Team on **full** this round | 0.506 | ±0.03 |

*Interpretation:* the ~+9pp eco→next-round bump is the economic snowball that makes saving valuable —
the save decision engine should produce next-round advantage of roughly this size, not treat a save as
a pure loss.

## 4. Side / map baselines  (`side_map_baselines.json`)
| Scope | Attack win rate | Tolerance |
|---|---|---|
| All maps, overall | 0.500 | ±0.03 |
| **Ascent**, overall | **0.509** | ±0.04 |
| Ascent, **first half** (attack) | **0.580** | ±0.05 |
| Ascent, **second half** (attack) | **0.413** | ±0.05 |
| Ascent, overtime (attack) | 0.500 (n=66, small) | — (don't tune) |

*Interpretation:* on Ascent the first-half attackers over-perform and second-half attackers
under-perform in this sample — a real asymmetry the Ascent prototype should not flatten to 50/50.

## 5. Round-outcome distribution  (`round_outcome_distribution.json`)
Share of rounds ending each way (per round):
| Outcome | All maps | Ascent | Tolerance |
|---|---|---|---|
| elimination | **0.662** | **0.714** | ±0.04 |
| defuse | 0.199 | 0.160 | ±0.03 |
| bomb_detonated | 0.105 | 0.082 | ±0.03 |
| time_expired | 0.034 | 0.043 | ±0.015 |

*Interpretation:* ~2/3 of rounds end in a team wipe; spike detonation ~10%, defuse ~20%, timeout rare.
A simulation that detonates or times out far more/less than this is mis-modelling post-plant play.

---

## Caveats
- **Coverage/era mix.** These pool 2021–2026 international events across many patches; agent pools and
  map/economy rules shifted. The JSON keeps `season`/`patch` filters so an era-matched baseline can be
  regenerated when validating a patch-specific simulation.
- **Not positional.** These validate *outcomes and economy*, not movement/engagement geometry — that
  needs Layer B data (not yet secured; see `docs/handoffs/PV-2-data.md`).
- **Small samples flagged.** Any cell with `smallSample=true` (n<100) is illustrative only.
- Regenerate after a new download: `pv-data gen-priors` (numbers shift slightly as the daily build grows).
