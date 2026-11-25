# Handoff — engine truth (round-simulator, combat/perception/ability engines, team-engine policy constants)

Branch `engine-truth-2` (from main d91f646; earlier work on `claude/peaceful-agnesi-b01f91`, merged to main). Details and tables: `docs/ENGINE_TRUTH.md` §8–§12.

## 2026-11-25 batch (branch `engine-truth-2` from main d91f646)

### Default change: carrier killed mid-plant drops the spike (bug fix, ON)
`round-simulator simulator.ts dropSpike`. A carrier that died while `planting` stayed the carrier: nobody could pick the
spike up and the attack ran out the clock however far ahead (in 80 matches with `ecoSidearms`, 28 of 28 time-expired
rounds with the attack ahead were this — carrier killed planting on A, traded, spike never recovered). This is the
"close-out" the integrator saw (4 alive vs 1–2, 5.7% of full-vs-eco rounds). Not a decision problem; no formula added.
Gate, real rosters, 160 matches, every flag off:

| Seeds | Core 8 | Attack | Judged 15 | Fails |
|---|---|---|---|---|
| 1–160 | **8/8** | 0.523 | **13/15** | semi-eco 0.995, semi-semi 0.572 |
| 161–320 | 7/8 | 0.505 | 11/15 | pistol 0.416 (main: 0.397), semi-eco 0.990, eco-semi 0.019, semi-semi 0.552 (each 0.002–0.012 outside) |

time_expired 0.019 (VCT 0.043, in band). Main d91f646 for comparison: 1–160 8/8 0.499 13/15; 161–320 7/8 0.483 14/15.
If the combined gate rejects it, revert `dropSpike` to the old `phase === "carried"` condition (one function).

### Pistol (seeds 161–320) — mechanism
- Not pistol-specific. Pistol and full-vs-full rounds in the same matches give the attack the same share (pooled 0.447 vs
  0.446); even loadouts put the attack at ≈0.45. Pre-plant duels: attack 0.40–0.44, 90% of them a moving attacker vs a
  still holder with mutual sight. The pistol cell fails because it is judged on 320 rounds; 161–320 vs 1–160 is the same
  team pairings with other seeds (0.397 vs 0.469, ≈1.8 SE apart) — the first kill (attack 0.381 vs 0.431) is the swing.
- Lever found: run-and-gun accuracy. Without `MatchConfig.weaponModes` the Classic loses its catalogue movingAccuracy
  (0.8) and a moving Classic is penalised like a rifle (mover-duel: mover wins 0.38 vs 0.44 with modes). With
  `weaponModes` on, pistol at 161–320 = **0.459** (first kill attack 0.463). The flag belongs to the economy session
  (`docs/handoff/economy.md` step 2): gating it is the pistol fix. No constant tuned.
- Tools: `pistol-breakdown.mts` (pistol vs r2–3 vs full-full: outcomes, plant, post-plant, first kill, trades, loadouts,
  duels by phase/distance/first sight/motion), `mover-duel.mts`.

### plantTactics (default OFF)
| Run | Core 8 | Attack | Judged 15 | Fails |
|---|---|---|---|---|
| main d91f646, 1–160 | 7/8 | 0.494 | 13/15 | elimination 0.666 |
| main, 161–320 | 6/8 | 0.489 | 12/15 | elimination 0.668, pistol 0.378 |
| + spike-drop fix, 1–160 | **8/8** | 0.542 | **13/15** | — (pistol 0.503) |
| + spike-drop fix, 161–320 | 7/8 | 0.523 | 11/15 | pistol 0.412, semi-eco 1.0, semi-full 0.376, semi-semi 0.554 |
Next step: with `weaponModes` gated on (pistol), re-run `sim-batch --plant-tactics` on 161–320; attack 0.52–0.54 has room.

### gaze + plantTactics (both OFF)
Guards now aim at the point that minimises the expected angle over every retake route they can see (own entry doubled),
and their post walk is budgeted by the believed retake ETA (not defender spawn): post-plant duel attack 0.34–0.45 →
0.496, guard hold offset 46° → 28°, guards caught walking 37 → 14 per 6 matches.
| peekerAdvantageMs | Attack | Opening | Elim | Defuse | Pistol | (60 matches unless noted) |
|---|---|---|---|---|---|---|
| 180 | 0.505 | 0.514 ✗ | 0.643 ✗ | 0.219 ✗ | 0.425 ✗ | |
| 140 | 0.478 | 0.471 | 0.665 ✗ | 0.211 ✗ | 0.458 | |
| 100 | 0.453 ✗ | 0.430 | 0.695 | 0.182 | 0.425 ✗ | |
| 140, 160 matches + fix | 0.498 | 0.470 | 0.668 ✗ | 0.214 ✗ | 0.494 | judged 13/15 |
Remaining gap: retakes succeed too often (defuse/plant ≈0.34 vs VCT 0.295). 14% of post-plant duels the retaker sees the
guard first, guard ≈90° off — retakers come through routes no guard covers. Next step: assign guard entries from the
retake routes actually reachable to the defenders (the policy's `retakeApproach` entries), not every zone joined to the
spike's zone, then re-run `sim-batch --gaze --plant-tactics --tuning '{"peekerAdvantageMs":140}'`.

### Tools added
`closeout.mts` (ahead-on-time rounds with timeline), `pistol-breakdown.mts`, `mover-duel.mts`; `postplant-duels.mts` and
`duel-breakdown.mts` take `--tactics`.

## Earlier (2026-11-24)

## Default-on (gated: real rosters, 160 matches, seeds 1–160 8/8 at aca57b7 — attack 0.512, 13/15 economy cells)
- Engine as calibrated through §4–§7 (attrition `damageCarryover` 0.4, physical stop time 260/220 ms in combat-engine with the legacy 700/350 kept for the gaze-off duel model, crossfire, info window, peeker's advantage 180 ms).
- Recording only (no effect on play): where the spike went down — `RoundRecord.plant` {zoneId, site, position, atMs, spotId, spotKind, intendedSpotId, by}; replay `spikePlanted.at`/`spotId`/`spotKind`; `planted` event detail `spot=<id>`; plan summaries carry `retake` (passive record).

## Behind flags (default OFF)
| Flag | What | Status |
|---|---|---|
| `MatchConfig.gaze` / `SimConfig.gaze` | gaze as state, Fitts aim time, peek techniques (walkIn/swing/slice/jiggle/re-peek), symmetric tracking | attack 0.39–0.41 (needs 0.47–0.55) |
| `MatchConfig.plantTactics` (+ `SimConfig.plantTactics`, `TeamPolicyOptions.plantTactics`) | carrier picks the plant spot (plant-spot.ts), post-plant guard posts by spike position, retake reads the spike position (`pointSight`), manager plant preference / post-plant plans / retake plans (`teamInputs`), ground utility kept for the spike + defuse denial | gate 7/8 on all three seed ranges (see below) |
| `MatchConfig.soundDetail` | landings, gunfire masking, rope/zipline/teleporter sounds (MS-09) | not calibrated |
| `SimConfig.defuseHalfwayMs` (MatchTuning `defuseHalfwayMs`) | half-defuse checkpoint (A3) | no measurable effect in 60 matches |

## Numbers
- Default gate (aca57b7 + main 93fce88): 1–160 8/8 attack 0.512; 161–320 7/8 (pistol 0.394); 321–480 8/8 0.517; economy 13/15 each.
- plantTactics ON gate: 1–160 0.494 (pistol 0.431 fails), 161–320 0.481 (pistol 0.394), 321–480 0.492 (full-full 0.440 fails).
- plantTactics ON vs VCT (60 matches): defuse/plant 0.303 (VCT 0.295), detonation/plant 0.146 (0.155), post-plant attack 0.697 (≤0.705); plant rate 0.56 vs 0.685.
- Post-plant attack by spot kind (160 matches): safe 0.737, near 0.628, default 0.524.
- Isolation (160): old plant spot 0.484 (plant rate 0.627), old retake 0.523 (defuse/plant 0.290).

## Unfinished — exact next steps
1. plantTactics: measure the last three changes (plant window cost, numbers weight λ, P6 flank pick) on 160 matches seeds 1–160 — `sweep.mts --matches 160 --tactics --spots` — then gate (`sim-batch.mts` with `plantTactics: true`). If attack stays < 0.50, the retake `pointSight` exposure weight is the lever (it moved attack −0.03).
2. Plant rate is low in every variant (0.56–0.63 vs 0.685): pre-plant problem, not post-plant.
3. Gaze: recalibrate with plantTactics on (guard posts took gaze attack 0.386 → 0.412); remaining gap is pre-plant duels (attack 0.39) and retaker swings.
4. Pistol at 161–320 (0.394) — pooled 0.447 over 960 rounds, no cause found (§11.4).
5. Eco (EC-04) needs the economy session + more weapons in the catalog (§11.3).
6. Research gap map `docs/research/PLANT_POSTPLANT.md` §7: P7 lineups (needs MAP-2 data), P10 taps, P13 attack save after plant, P15 retake utility order, P18 stick/ninja defuse.

## API (stable; desktop tactics screen and maps-data mid control may build on it)
`shared-types/src/plant-plans.ts`: `PlantChoice`, `PlantPreferences`, `PostPlantPlan`, `RetakePlan`, `SpotPlans`, `planForSpot`, `PostPlantDecision`, `RetakeDecision`. Inputs in `MatchConfig.teamInputs[slot]` (`plantPreference`, `postPlantPlans`, `retakePlans`), keyed site letter → "*" | kind | spot id. Spot list: `plantSpotsOf(loadMap(id))` (re-exported by match-runner). Note for the UI: these inputs only play with `plantTactics: true`.

## Known risks
- plantTactics ON shifts attack ~−0.02 and fails pistol/full-full cells; do not default it on without a gate.
- Guard posts are computed from roadmap sight (`nav.nodesVisible`); maps without a sight table fall back to the old rule silently.
- Post-plant ground utility lands on the spike position (no throw arc); lineup data would replace it.
- `retakeStages` are cleared when a retake plan assigns entries; with no plan nothing changes.
