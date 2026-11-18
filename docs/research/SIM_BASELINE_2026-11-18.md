# PROJECT V — Simulation Baseline Snapshot (2026-11-18)

First batch validation of the **match-level simulator** (`@pv/match-runner`) against PV-2's real VCT
baselines. This is the **reference point** PV-3 (timeExpired fix) and PV-4 (round-engine improvements)
compare against: re-run the same command after a change and watch the headline metrics move toward
the real targets.

## How to reproduce
```bash
# 20 matches (seeds 1..20), Ascent, validate against the 'all' era priors:
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20 --out reports/sim-batch-run.json --report reports/sim-batch
#   → writes the SimRun bundle + reports/sim-batch.{json,md}; prints the summary below.
# options: --matches N  --seed-start S  --max-rounds R  --era all|patch>=9  --no-validate
# (once PV-3 adds the root script:  pnpm sim:batch -- --matches 20)
```
- **Engine commit:** integration `482a304` (match-runner; numbers are bit-identical to the first
  measurement at `8a0ea8f` — the game-data/team change between them does not affect round mechanics).
  This is **pre** PV-3's timeExpired fix and **pre** PV-4's round-engine merge.
- **Machine-readable baseline:** `SIM_BASELINE_2026-11-18.json` (the report JSON for this run). Diff a
  later run against it: `npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20 --compare
  docs/research/SIM_BASELINE_2026-11-18.json` → adds Base / Δ / Move (↑ better / ↓ worse) columns.
- **Config:** 20 matches, seeds 1–20, map Ascent, `@pv/match-runner` `runMatch` (pistol → halves →
  first-to-13 w/ OT). 461 rounds total, 4 matches to OT, ~30 s.
- **Baselines:** VCT Reference priors `a1a189d0ec7d9a71…` (build 2026-11-12), era `all`,
  tolerances from `docs/VALIDATION_BASELINES.md`.

## Result: 0/9 judged metrics pass — the draft engine is **attacker-broken**
| Metric | Sim | Real | Real 95% CI | Δ (sim−real) |
|---|---|---|---|---|
| **round end: time_expired** | **0.618** | 0.043 | [0.037, 0.051] | **+0.575** |
| round end: elimination | 0.377 | 0.714 | [0.699, 0.730] | −0.337 |
| round end: bomb_detonated | 0.004 | 0.082 | [0.074, 0.092] | −0.078 |
| round end: defuse | 0.000 | 0.160 | [0.148, 0.173] | −0.160 |
| **attack side win rate** | **0.197** | 0.509 | [0.491, 0.527] | **−0.312** |
| opening duel (attack) | 0.686 | 0.437 | [0.420, 0.454] | +0.249 |
| economy pistol vs pistol | 0.300 | 0.500 | [0.459, 0.541] | −0.200 |
| economy full vs full | 0.237 | 0.500 | [0.479, 0.521] | −0.263 |
| economy full vs eco | 0.000 | 0.960 | [0.805, 0.993] | −0.960 |

Round-end reasons (sim): `timeExpired 285 (61.8%)`, `elimination 174 (37.7%)`, `spikeDetonation 2 (0.4%)`.
Pistol attack win rate 30.0% (12/40). Reported-only (no real baseline): man-advantage conversion,
trade rate 0.223, mean round duration 91.8 s.

## Diagnosis (for PV-3 / PV-4)
1. **Attackers win the opening duel (0.686) but lose the round (0.197).** First blood doesn't convert:
   after the opening pick the attack side stalls instead of taking space / planting.
2. **Plants barely happen** — `bomb_detonated` 0.004 and `defuse` 0.000 vs real 0.082 / 0.160, so the
   spike is almost never planted. With no plant, rounds run to the clock → **time_expired 0.618** (14×
   the real 0.043), which is the single dominant error and drags every downstream metric.
3. **Economy matchups collapse toward the defender** (full vs eco 0.000) because round outcome is
   governed by "did the clock run out", not by buy/skill — consistent with (1)–(2).

**So the highest-leverage fix is attacker execution: reach site + plant.** When `time_expired` drops
toward ~0.04 and plant/detonation/defuse rise, attack side win rate and the economy cells should
follow. Track **time_expired** and **attack side win rate** as the two headline numbers across fixes.

## Notes / caveats
- Players are side-named (`atk1..5` / `def1..5`); team identity (game-data `listSimulatableTeams()`)
  is cosmetic in this engine draft, so team-specific tendencies are not yet exercised.
- `force`-buy economy cells have no real prior (VCT classifies full/semi/eco/pistol), so they are
  reported-only, not judged.
- Man-advantage and trade-rate rows are reported-only: VCT Reference has no per-round kill sequence
  to back them (see `VALIDATION_BASELINES.md`).
- Deterministic per seed (DECISION-010): the same command reproduces these numbers bit-for-bit until
  the engine changes.
