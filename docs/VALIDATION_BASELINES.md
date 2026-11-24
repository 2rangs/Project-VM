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

## 6. Opening-duel win rate  (`combat_opening_duel.json`)
Which side wins the first duel of the round (from `player_map` fk/fd aggregates). Attacker and
defender rates sum to 1.
| Scope | Attacker opening-duel win | Defender | Tolerance |
|---|---|---|---|
| All maps | **0.457** | 0.543 | ±0.03 |
| **Ascent** | **0.437** | 0.563 | ±0.04 |

*Interpretation:* defenders win the opening duel more often (they hold angles); Ascent is slightly
more defender-sided on first blood. A simulation whose attacker opening-duel rate is ~0.50 is
over-rewarding entries.

### Mapping to PV-4 `CombatCalibration`
PV-4's combat engine (`packages/combat-engine`, `CombatCalibration = { hitChanceScale?,
headshotScale?, reactionScale? }`) has no direct "opening-duel" field — it is a *calibration target*,
not a parameter. Use it in a loop: run the Monte-Carlo first-duel many times, measure the simulated
attacker opening-duel rate, and nudge `reactionScale` / `hitChanceScale` until it lands inside the
interval above (overall 0.450–0.463, Ascent 0.420–0.454). The validation harness
(`tools/data-validator` sim mode) computes the simulated rate for you.

### Combat data NOT available from VCT Reference (gaps)
VCT Reference has **no per-round kill sequence, timestamps, or alive counts** (`kill_matrix` is a
per-map player-pair aggregate; `rounds` carries no kills). So these have **no real baseline from this
source** and need an authorized Layer-B source (GRID feed / self-captured VRF):
- **Entry → round win** (does the first-kill team win the round) — not round-linked here.
- **Man-advantage win rates** (5v4, 4v3, 2v1, …) — needs per-round alive transitions.
- **Trade rate** (re-kill within N seconds) — needs kill timestamps.

The harness still *computes* these from simulation logs (which do have the sequence), and reports them
as "no real baseline (data gap)" rather than pass/fail.

---

## 7. Meta era: `all` vs `patch>=9`
PV-1's patch history (`pv-research:datasets/derived/meta/patch-history.json`) finds Ascent is
**structurally stable** (no site/route rework — map changes do not invalidate older stats); the meta
driver is **agent balance**. So we publish two baseline sets:
- **`all`** — every international match (default; `datasets/derived/priors/*.json`).
- **`patch>=9`** — current-meta cut, major patch ≥ 9 (`datasets/derived/priors/patch-ge9/*.json`,
  `team-profiles/patch-ge9/`). ~3–4× fewer samples → more `smallSample` cells.

Select at validation time with `--era` (`pv-validate-sim --era patch>=9`).

### What changes between eras (Ascent)
| Metric | `all` | `patch>=9` | Reading |
|---|---|---|---|
| economy full>semi | 0.681 (n=1217) | 0.66 (n=335) | stable, CIs overlap |
| economy semi>eco | 0.928 (n=263) | 0.882 (n=76, small) | stable |
| opening-duel attack | 0.437 (n=3106) | 0.455 (n=875) | stable |
| attack win (overall) | 0.509 | 0.487 | stable |
| **attack win, first half** | **0.580** | **0.425** | **shifted** |
| **attack win, second half** | **0.413** | **0.574** | **shifted** |

Most economy/combat baselines are **era-stable** (intervals overlap). The **Ascent half-split flipped**
in recent patches — a real agent-meta effect, not noise (though on smaller samples).

### Recommendation
**Default to `all`** for economy, pistol, save, outcome and opening-duel baselines: they are
era-stable and the larger sample gives tighter intervals (Ascent's structure hasn't changed, per
PV-1). **Use `patch>=9` specifically for side/half-split checks** (attack timing), where the meta
shift is real — accepting that many `patch>=9` cells are small-sample and must be read with their
wider intervals. Do not tune a simulation to a `patch>=9` cell flagged `smallSample`.

## 8. Report-only play metrics  (`kast.json`, `clutch_wins_per_round.json`, `plant_post_plant.json`, `role_kill_share.json`)

Added 2026-11-24 (HANDOFF P0-2). The validation report now also describes how rounds are played. Every
metric below is **report-only**: it is never judged and never changes the exit code. A VCT figure is
attached as a reference where VCT Reference (build 2026-11-12, sha `a1a189d0…4890`, international
matches, performance block available) can back it.

| Report metric | VCT baseline (all maps) | Ascent | n (Ascent) | Why (not) |
|---|---|---|---|---|
| Plant rate (`post_plant` · `plant_rate`) | **0.687** [0.681, 0.692] | **0.601** [0.583, 0.618] | 3,106 rounds | `player_map.plants` summed per map / rounds |
| Post-plant attack win (`post_plant_attack_win`) | **0.709** [0.702, 0.716] | **0.738** [0.718, 0.757] | 1,866 plants | 1 − defuses / plants (a planted round is lost only by a defuse) |
| Plants that detonate (`post_plant_detonation`) | 0.155 | 0.140 | 1,866 plants | detonations / plants |
| Clutch wins per round, any X | **0.156** [0.152, 0.161] | **0.151** [0.138, 0.163] | 3,130 rounds | `notables` clutch_1vX rows / rounds of maps with the detail block |
| — 1v1 / 1v2 / 1v3 / 1v4 / 1v5 | 0.094 / 0.049 / 0.011 / 0.002 / 0.0004 | 0.086 / 0.051 / 0.011 / 0.002 / 0.0003 | 3,130 rounds | same |
| KAST, all / attack / defense | **0.711** / 0.703 / 0.718 | 0.711 / 0.687 / 0.734 | 31,060 player-rounds | round-weighted `kast_all` / `kast_atk` / `kast_def` |
| Kill share by role (K/D) | duelist 0.515 (1.06), sentinel 0.510 (1.04), controller 0.492 (0.97), initiator 0.486 (0.95) | 0.514 / 0.504 / 0.492 / 0.492 | 9–14k kills+deaths per role | `kills_all`, `deaths_all` by the role of the agent played |
| Force buy into a full buy | semi vs full 0.34 (existing `economy_matchup`) | — | — | tier definitions differ (VCT "semi" = half + force) |
| First-kill time, round duration, plant→end time, trades within 3 s | — | — | — | **no baseline**: the source has no kill or plant timestamps (map duration includes buy phases and pauses) |
| Flawless rounds, clutch win *rate* (wins / attempts), post-plant by man-advantage | — | — | — | **no baseline**: no per-round kill sequence; the source lists clutches won, not attempted |
| Site-arrival spread, route diversity, body overlap | — | — | — | **no baseline**: no positions |

Definitions used on the simulator side (`tools/data-validator/src/pv_data_validator/sim_harness.py`):
- **Clutch**: an attempt starts when a team is reduced to one living player with X ≥ 1 opponents
  alive; it is won if that team wins the round *with that player alive*. A last player who dies and
  whose spike then detonates is not credited (assumed to match the source's convention — not verified).
- **KAST**: a player-round counts if the player got a kill, an assist, survived, or died and was
  avenged by a teammate within 3 s. The simulator records **no assists**, so its figure is K+S+T and
  is expected to sit below the real one. The source does not document its own trade window.
- **Kill share by role**: the simulator fields one fixed comp for both teams with agents bound to
  roster slots, so "role" there is a slot of the roster, not a play style.

### Which of these could become judged (proposal — nothing is switched on)
A metric is a candidate when (a) the baseline is exact source data with a large sample and (b) the
simulator measures the same thing the same way.

| Candidate | Baseline (Ascent) | Suggested tolerance | Why it qualifies |
|---|---|---|---|
| **Plant rate** | 0.601 (n 3,106; CI ±0.017) | ±0.04 | counted identically on both sides (a plant is a plant); large sample; it separates "the attack gets the spike down" from "the attack wins", which the outcome mix alone does not |
| **Post-plant attack win rate** | 0.738 (n 1,866; CI ±0.020) | ±0.04 | identical definition; it is the retake balance in one number, today only visible indirectly through defuse + detonation shares |
| **Clutch wins per round (any X)** | 0.151 (n 3,130; CI ±0.013) | ±0.03 | exact counts in the source; checks that late-round man-count situations resolve realistically. Depends on the survive-to-be-credited convention above — confirm that first |

Not proposed:
- **KAST** — the simulator has no assists, so the comparison is structurally biased; revisit once damage/assists are recorded.
- **Kill share by role** — solid data, but the simulator's roles are roster slots of one fixed comp. Becomes meaningful with real per-team comps.
- **Clutch wins by single X** — 1v1 and 1v2 have the sample, but 1v3+ are too rare for an absolute tolerance; judge `any` and keep the split report-only.
- **Force buy** — the tier definitions differ between the two sides of the comparison.
- Everything timed or positional — there is no baseline to judge against.

Before switching any of them on: run the measurement suite once on the default condition and on the
unseen seeds (`measure-suite.mts`) to see where the simulator stands, and decide the tolerance from
the seed-to-seed spread, not from the table above alone.

## Caveats
- **Coverage/era mix.** These pool 2021–2026 international events across many patches; agent pools and
  map/economy rules shifted. The JSON keeps `season`/`patch` filters so an era-matched baseline can be
  regenerated when validating a patch-specific simulation.
- **Not positional.** These validate *outcomes and economy*, not movement/engagement geometry — that
  needs Layer B data (not yet secured; see `docs/handoffs/PV-2-data.md`).
- **Small samples flagged.** Any cell with `smallSample=true` (n<100) is illustrative only.
- Regenerate after a new download: `pv-data gen-priors` (numbers shift slightly as the daily build grows).
