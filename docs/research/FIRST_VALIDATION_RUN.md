# PROJECT V — First Validation Run (PV-4)

**Owner:** Spatial agent (PV-4)
**Date:** 2026-11-18
**Scope:** 1,000 synthetic Ascent rounds from `round-simulator` v0, scored against PV-2's
real VCT-Reference baselines with PV-2's `pv-validate-sim` harness.

## 1. How it was run

- Sim: `round-simulator` with the **scripted** team policy (NOT the final AI), synthetic 5v5
  initial state on real Ascent zones, 1,000 rounds (seeds 1000–1999), sites alternating A/B.
- Export: `toValidationRun()` → PV-2 sim_run bundle (pv-core GameEvent shape).
- Harness: PV-2 `tools/data-validator` `pv-validate-sim --scope ascent` run **locally** against
  `datasets/derived/priors` (read-only extract of `origin/claude/pv-data`; PV-2 files not modified).
- Reproduce: `vite-node packages/round-simulator/scripts/run-validation.mjs <out.json> 1000 [hitChanceScale]`,
  then `pv-validate-sim --logs <out.json> --priors datasets/derived/priors --scope ascent`.

## 2. Baseline result (uncalibrated) — 0/7 judged metrics passed

| Metric | Sim | Real | Real 95% CI | Result |
|---|---|---|---|---|
| side_winrate attack (all) | **0.309** | 0.509 | [0.491,0.527] | ❌ |
| opening_duel attack | **0.531** | 0.437 | [0.420,0.454] | ❌ |
| outcome: elimination | 0.384 | 0.714 | [0.699,0.730] | ❌ |
| outcome: bomb_detonated | **0.000** | 0.082 | [0.074,0.092] | ❌ |
| outcome: defuse | 0.112 | 0.160 | [0.148,0.173] | ❌ |
| outcome: time_expired | **0.504** | 0.043 | [0.037,0.051] | ❌ |
| economy_matchup full/full | 0.309 | 0.500 | [0.479,0.521] | ❌ |

Reported-only: trade_rate 0.488, round_duration 66.3 s, man-advantage curve monotonic
(5v5→0.309, 4v3→0.464, 2v1→0.707, …) — qualitatively sane.

## 3. Decomposition of the attack-win-rate gap (0.309 vs ~0.509)

The gap is **dominated by the scripted policy, not combat parameters**:

1. **time_expired 0.504 (vs 0.043) — the biggest anomaly, a POLICY artifact.**
   - **No spike pickup:** when the spike carrier dies, the spike drops and the scripted
     policy has no "pick up spike" behaviour → attackers can no longer plant → the round
     runs to timeout.
   - **Hold-stalemate:** at the site, when an enemy is visible the scripted attacker *holds*
     instead of committing to the plant; defenders also hold → no engagement → timeout.
2. **bomb_detonated 0.000 (vs 0.082) — POLICY.** Attackers rarely reach a clean plant
   (same two causes), and the few planted rounds resolve by elimination/defuse before the
   45 s timer; there is no post-plant positioning to run the timer out.
3. **elimination 0.384 (vs 0.714) — follows from 1 & 2:** many rounds that *should* end in
   elimination instead time out.
4. **Combat is NOT the cause of the round gap.** The only engagement-level metric,
   opening_duel, actually has attackers **over-winning** first blood (0.531 > 0.437), the
   opposite of what a combat-under-powering-attackers hypothesis would predict.

**Conclusion:** round-level realism needs a real `DecisionPolicy` (PV-3), plus spike-pickup
and post-plant behaviour in the sim — not combat tuning.

## 4. Opening-duel calibration (the only combat target)

Per the brief, **only the opening duel** is calibrated, via `combat-engine`'s
`CombatCalibration`. Finding: a symmetric `hitChanceScale < 1` **does** move the attacker
opening-duel rate — lowering hit chance lengthens TTK, letting the surprised (defending)
side trade back, which shrinks the first-shooter's (attacker's) first-blood edge.

| hitChanceScale | opening_duel (attack) | harness |
|---|---|---|
| 1.00 (baseline) | 0.531 | ❌ FAIL |
| 0.80 | 0.469 | ✅ |
| 0.75 | 0.460 | ✅ |
| **0.65 (chosen)** | **0.453** | ✅ PASS |
| 0.60 | 0.453 | ✅ (plateau) |

Chosen: **`hitChanceScale = 0.65`** (`ASCENT_OPENING_DUEL_CALIBRATION`), opening_duel 0.453,
within the ±0.04 tolerance of 0.437 (near the upper CI edge; the metric plateaus ≈0.45 for
this scripted-positioning setup, so it cannot be pushed to the 0.437 centre without a
posture change — see §6).

**Before → after (calibrated run, hitChanceScale 0.65):** opening_duel **0.531 ❌ → 0.453 ✅**
(1/7 judged metrics now pass). As expected and intended, the round-level metrics did **not**
improve (side_winrate 0.309→0.257, time_expired 0.504→0.502, bomb 0.000): combat calibration
does not fix a policy-dominated round outcome, and I did **not** distort it to chase the
round win rate (README §31).

## 5. Honesty / provenance

- All sim numbers are from an actual harness run; the "real" columns are PV-2's VCT-Reference
  priors (sha `a1a189d0…`). No numbers are invented.
- The policy is a **scripted stand-in**, explicitly not the final AI.
- Weapon/ability values are `manual-approx` (PV-1 LICENSE_AUDIT); opening-duel tuning is on
  the engagement model, not on weapon stats.

## 6. Recommendations (next)

1. **PV-3 `TeamDecisionPolicy`** (real AI) is the main lever for round-level realism — re-run
   this harness once it's integrated.
2. **round-simulator:** add spike pickup (dropped spike → nearest attacker) and post-plant
   positioning; these should move time_expired/detonation toward the baselines.
3. **Opening-duel to the 0.437 centre:** the residual +0.016 is a *positioning* effect
   (defenders hold facing their anchor, not the entry, so attackers get first sight). Fixing
   defender hold-angles in the policy would lower attacker opening-duel further — a policy
   change, not a combat one. The `hitChanceScale` seam is a stopgap; prefer the posture fix.
4. Keep opening-duel and round-outcome calibration **separate** — they are governed by
   different layers (combat/posture vs policy/rules).
