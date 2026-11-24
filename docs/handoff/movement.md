# Movement variety and buy phase: hand-off

Branch `claude/infallible-wing-679e6e`. Full design: `docs/MOVEMENT_STYLE.md`.

## Done and on by default
- **Buy phase** (30 s, `round-simulator/src/buy-phase.ts`; `MatchConfig.buyPhase`, default on).
  - Both teams move behind their barriers: buy spot, idle wanders, then the walk to their setup.
  - Match Day shows it: "Buy phase" tag, countdown, and the scrubber, timeline and round jumps start at the buy phase.
  - Every player ends exactly on the spot the round would have started it on:
    - setup spots are held for their owner;
    - the final move uses exact `at` arrival;
    - the leave time is re-checked every 0.5 s.
  - So with the live parts off the round is the very round without a buy phase: 60/60 pistol rounds identical, 0/1000 players off their spot.
  - The earlier "buy phase costs pistol" (0.438 vs 0.469) came from 25/300 players ending off their spot. Fixed.
- **Default style.** `MatchConfig.movementStyle` defaults to `BUY_PHASE_ONLY_STYLE`: the per-player buy-phase script is on, the live-round parts are off.

## Behind a flag (default OFF)
- **Live-round movement style.** Lanes, spacing, routes, checks and lurk. Turn them on with `MatchConfig.movementStyle: true` (or a parts object) or `sim-batch --style`.
  - `--style-off lanes,...` switches single parts off.
- **Mover crowd rules** (`MovementExecutor.followCloseUp` and `.crossingByRank`).
  - They come with the spacing part. The buy-phase executor always uses `crossingByRank`.
  - With them off, the default round's crowd model is the gated one.

## Numbers
Real rosters, Ascent.

**Pistol ablation** (`tools/data-validator/scripts/pistol-probe.mts`): round 1 only, seeds 1–800 played both ways, so 1,600 rounds per variant (SE ≈ 0.012).

| Variant | Pistol attack |
|---|---|
| live parts off | 0.453 |
| all on (before fixes) | 0.430 |
| +routes alone | 0.455 |
| +checks alone | 0.452 |
| +lanes alone | 0.438 |
| +lurk alone | 0.431 |
| +spacing alone | 0.428 |

- **Spacing:** the median plant time went from 24 s to 40 s. A follower whose full step would close its gap stood the whole tick, so a stack moved at half speed. Fixed by `followCloseUp`.
- **Lurk:** the lurker walked with the spike and when joining the execute. It now walks only its own approach.
- **After both fixes,** all on vs off on the same mover: 0.436 vs 0.438. Plant rate 0.60 vs 0.63, median plant 25.9 s vs 24.1 s.
- **Noise:** rounds are chaotic, since any mover change re-rolls about 90% of them. No pistol gap above is significant (|z| < 1.5). Pistol sits around 0.44 in every variant, the same level engine-truth found with no style (0.447 pooled over 960 rounds).

**Gate with every part on** (`--style`, before merging main 65180b9), seeds 1–160:
- 7/8 original metrics: attack 0.471, opening duel 0.429, pistol 0.438 (fail), full-v-full 0.461.
- Judged 13/15 (fails: pistol, full-v-semi 0.625).

Seeds 161–320:
- 7/8 original metrics: attack 0.475, opening duel 0.447, pistol 0.434 (fail).
- Judged 13/15 (fails: pistol, semi-v-eco 0.978).

Pooled over 640 pistol rounds that is 0.436, which agrees with the ablation's 0.436. With every part on, pistol is about 1.5–2 pp below the no-style level, consistently on both seed sets. That is why the live parts stay off by default.

The default (buy-phase script only) is the integrator's no-style run: 8/8, pistol 0.469.

## Unfinished: next step
1. Pistol with the live parts on is about 0.44. The mechanical costs are fixed, so what remains is the engine's pistol level, not movement.
   - To turn the style on by default, confirm on the merged tree with a pooled pistol sample: `pistol-probe.mts` with 800 seeds, comparing `{"off":{...all false},"all":true}`.
   - Gate it if the two are within noise. Don't tune a constant for it.
2. **Role-based setup at the barrier** (attackers grouping by role at the exit) is still not done.
   - Measured earlier: a role stack at the door cost 2.5 pp attack, because the duel calibration assumes attackers leave from the spawn's middle.
   - It needs the opening-duel calibration refitted on the new start positions. That belongs to the engine-truth owner.

## Risks
- `pistol-probe.mts` is a scratch diagnostic (not in CI).
- With the style on, `followCloseUp` and `crossingByRank` change the crowd model, and queue ticks per round fall from about 108 to about 43. The duel calibration was fitted on the old crowd model.
- The buy phase holds setup spots only in its own executor. The live round's executor is fresh, so nothing carries over.
