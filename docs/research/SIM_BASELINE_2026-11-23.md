# PROJECT V — Simulation Baseline Snapshot (2026-11-23): real rosters

The first `sim:batch` measurement with **real game-data rosters**. Every earlier batch — including
the "8 of 8, attack 0.521" result in `NAVIGATION_ENGINE.md` §7 — read team ids as `t.id`, a field
game-data's `Team` does not have (`teamId`). Both sides therefore resolved to no team and played
league-average players (every attribute and trait at the 0.6 fallback). The batch now plays the 46
simulatable teams (`simulatableTeamRefs()`, match i = teams[2i mod n] vs teams[2i+1 mod n]); the old
condition is `--mirror`, which reproduces those runs exactly.

## How to reproduce
```bash
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --out reports/real-1-run.json --report reports/real-1
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --seed-start 161 --out reports/real-161-run.json --report reports/real-161
# the old league-average condition, for comparison:
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --mirror --out reports/mirror-run.json --report reports/mirror
# diff a later run against this baseline (seeds 1..160):
npx tsx tools/data-validator/scripts/sim-batch.mts --matches 160 --compare docs/research/SIM_BASELINE_2026-11-23.json
```
- **Engine commit:** `origin/main` `4b031cd` plus the sim-batch roster fix (no engine change).
- **Config:** Ascent, abilities off, default options — what the desktop Match Day sends.
- **Machine-readable baseline:** `SIM_BASELINE_2026-11-23.json` (seeds 1–160 report).

## Result: 6 of 8 judged metrics on both seed ranges (the mirror condition passed 8 of 8)

| Metric | Real (95% CI) | Mirror, seeds 1–160 | **Rosters, seeds 1–160** | **Rosters, seeds 161–320** |
|---|---|---|---|---|
| Attack round win | 0.509 [0.491, 0.527] | 0.521 ✅ | **0.460 ❌** | 0.484 ✅ |
| Ends by elimination | 0.714 | 0.704 ✅ | 0.728 ✅ | 0.730 ✅ |
| Ends by detonation | 0.082 | 0.106 ✅ | 0.079 ✅ | 0.095 ✅ |
| Ends by defuse | 0.160 | 0.148 ✅ | 0.130 ✅ | **0.111 ❌** |
| Ends by time | 0.043 | 0.042 ✅ | 0.062 ✅ | 0.063 ✅ |
| Opening duel (attack) | 0.437 | 0.462 ✅ | 0.440 ✅ | 0.430 ✅ |
| Pistol vs pistol (attack) | 0.500 | 0.528 ✅ | 0.481 ✅ | **0.447 ❌** |
| Full vs full (attack) | 0.500 | 0.495 ✅ | **0.448 ❌** | 0.480 ✅ |
| Rounds / matches / OT | — | 3,383 / 160 / 17 | 3,349 / 160 / 14 | 3,315 / 160 / 15 |

What moved, consistently on both ranges: the attack loses 3–6 points of round win rate, fewer rounds
reach a defuse, and more run out the clock (0.062 vs 0.042). The opening duel is unchanged, so the
shift happens after first contact. Differences between the two ranges (0.460 vs 0.484) are about
1.5 standard errors; read the pair, not one range.

The constants calibrated in `NAVIGATION_ENGINE.md` §7.2 (moving-shot stopping time, the attack's save
threshold) were fitted on the mirror condition. Recalibrating against real rosters — mechanism first,
constants as options (`docs/STAT_OUTCOME_MATRIX.md`) — is the next balance step; nothing is retuned
here.
