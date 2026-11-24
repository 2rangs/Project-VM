# Handoff — engine truth (round-simulator, combat/perception/ability engines, team-engine policy constants)

Branch `claude/peaceful-agnesi-b01f91` (main 65180b9 merged). Details and tables: `docs/ENGINE_TRUTH.md` §8–§12.

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
