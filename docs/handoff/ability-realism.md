# Handoff — abilities as a tactical environment (branch `claude/ability-realism-6cc513`)

Written 2026-11-24 at wrap-up. On top of main `65180b9`, **not pushed, not merged**.
Details, formulas and measurements: `docs/CONTINUOUS_TACTICAL_INTELLIGENCE.md` §8 (round 1) and §10 (this round).

## Default-on vs behind a flag

**Everything here sits behind the existing `MatchConfig.enableAbilities` (default `false`; `sim-batch --abilities`).**
With abilities off the game is byte-identical to main: 20-match `sim-batch --no-validate` summary and SimRun bundle
compared against main `7073bac` — identical (attack 0.517, pistol 0.400).

No new flag was added. The changes are inert when no ability exists:
- round-simulator: every new branch needs a deployed effect, a cast, or a `screenZone` order;
- team-engine `utility.ts`: `planUtility` returns the commands unchanged without ability knowledge;
- match-runner: `paidAbilities` and the defender starts only matter on the `enableAbilities` path;
- shared-types: `ActionCommand.screenZone` is a new optional field.

Abilities stay **off** by default. They are not ready to be the default: the last gate (160 matches) is 4/8 of the
original eight, with the attack win rate inside the target band (0.474).

## Done (round 2, commit `6604c35`)

What I measured first, with 12-match ablations (real rosters, abilities on, one ability family or side's casts removed at a time):
- main `7073bac` with abilities on: attack 0.324. With no ability cast at all it was 0.667. The 0.667 came from the
  abilities mode starting the defenders on scripted VCT setups; on the map's normal starts it was 0.496.
- Attack smokes cost about 27 points: cover smokes landed on the attack's own lane, so the entry walked out of its own
  smoke into a watched edge (attack win 0.19 in those duels).
- Attack flashes blinded someone on 17% of casts.

Mechanisms (no constant was fitted):

| Change | Where |
|---|---|
| The defense starts on the map's starts with abilities on too (`selectDefenseSetup` is no longer called) | `match-runner/src/match.ts` |
| A player gets basic abilities only if its buy includes the kit (`PlayerBuy.utility > 0`); otherwise only the free signature charge and its ultimate | `match-runner/src/match.ts` `paidAbilities` |
| `ActionCommand.screenZone`: a smoke thrown into `targetZone` to hide `screenZone` from it. It lands where it cuts the most of that view and stays more than its radius + 1 m off the walkway between the two zones. Map geometry only | `round-simulator/src/simulator.ts` `screenPoint`, shared-types + round-simulator mirror |
| Cover smokes target the defenders' zone and screen the attack's lane | `team-engine/src/utility.ts` |
| A flash pops in the air: it is seen by anyone who sees floor within 3 m of where it lands, and blinds only players with the pop in their field of view | `simulator.ts` `seesPop`, `flashTargets` |
| Reach uses the catalogued range when there is one (run-route length ≤ range) | `utility.ts` `abilityReaches` |
| A team never denies (mollies or smokes to stall) a zone a teammate is routed through, and the attack before the plant never denies a site | `utility.ts` `stallWants` |

New tests (counterfactual, one condition changed each):
- `round-simulator/test/screen-smoke.test.ts`: lane smoke vs screening smoke. The first lands on the walkway and makes a
  watched smoke exit; the second lands off the walkway and makes none.
- `smoke-exit.test.ts`: a holder looking away from the pop is not blinded.
- `team-engine/test/utility.test.ts`: cover target and `screenZone`, range, route exclusion, site exclusion.
- `match-runner/test/paid-abilities.test.ts`: a player that skipped the kit casts no basic ability.

## Numbers (real rosters, Ascent, abilities on)

| Run | Judged | Attack | Notes |
|---|---|---|---|
| engine-truth's measurement before this round (seeds 1–160) | 3/8 | 0.281 | |
| this branch, 40 matches (seeds 1–40) | 11/15 (6/8 of the original eight) | 0.477 | detonated 0.173 ✗, defuse 0.118 ✗, eco-v-full 0.106 ✗, full-v-eco 0.903 ✗ |
| **this branch, 160 matches (seeds 1–160) — last gate** | **10/15 (4/8 of the original eight)** | **0.474** | elimination 0.697 ✓, detonated 0.156 ✗ (real 0.082), defuse 0.116 ✗ (0.160), time 0.031 ✓, opening duel 0.388 ✗ (0.437), pistol 0.553 ✗ (0.500), full-v-full 0.488 ✓; economy: semi-eco 0.951 ✓, eco-full 0.090 ✓, semi-full 0.316 ✓, eco-semi 0.081 ✓, semi-semi 0.515 ✓, full-eco 0.911 ✓, full-semi 0.602 ✗ (0.681) |

## Unfinished — exact next steps

Still failing on the 160-match gate: detonation and defuse (post-plant, items 1–2 below), the opening duel (0.388 —
the 40-match run had it at 0.402, so this is not noise from a small batch: paid-for kits removed flashes from
non-kit rounds while defenders keep their signature smokes), pistol 0.553 (pistol rounds are now signature-only for
both sides) and full-v-semi 0.602.

1. **Post-plant (engine-truth's area).** All extra detonations are saves with defenders alive.
   - About a third come from attack post-plant mollies on the retake path: dropping them took detonations from 61 to 45
     in 12 matches.
   - The rest come from lopsided plants after flash-won entries.
   - Defence casts **no** utility after the plant. Its flashes have no catalogued range, so the map reach rule rules out
     throws from the retake staging zone, which is chosen out of the plant's sight.
   - Next step: retake utility through engine-truth's `retakePlans`, and route attack post-plant ground utility through
     its `postPlantPlans.utility`. engine-truth is already adding `groundReserve` / `defuseDenyWants` to `planUtility`;
     the merge point is the caster-loop reach line (see the shared notes `ability-realism-handover.md`).
2. **A flashed duel is a certain loss.**
   - In 12 matches, 188 of 188 duels against a blinded defender went to the attacker.
   - The combat engine adds the whole remaining blind plus 700 ms (`flashReactionPenaltyMs`, combat-engine).
   - There is no fade phase and no turning away on hearing a flash cast; the cast cue already reaches the defense's
     observation.
   - Next step: a defender turns away / falls back on a heard flash cast. Needs a per-player facing decision; the gaze
     model is off by default.
3. **Airborne flash sight** is approximated (3 m floor spread). Replace it with the maps session's `seesPoint` when it exists.
4. **Recon** already goes into team belief: a frozen snapshot becomes `observation.visibleEnemies` and team intel, and
   ages like any other sighting. It is not routed through the information layer's comms (`claude/amazing-mayer-2f95d0`).
   Do that when that branch merges.
5. **Throw rates:** utility casts have no rate; each comes from a purpose the observation supports. Throws (쓰로잉) already
   come from profiles + `minThrowRates`; nothing ability-specific was added.
6. **Signature recharge** is not modelled: charges never come back, and the cooldown only blocks repeat casts.

## Known risks

- `ActionCommand.screenZone` is a new optional field in shared-types. It is additive, but any code that copies commands
  field by field would drop it.
- `screenPoint` caches per (target zone, screened zone, radius) for the whole simulator instance. The map is fixed per
  instance, so this is safe today.
- `selectDefenseSetup` (`match-runner/src/defense-setups.ts`) is now unused but still exported.
- `utility.ts` is also being edited on engine-truth's branch (`planUtility` signature gains an `opts` parameter there),
  so expect a small conflict when both are merged.
- The airborne-pop spread (300 uu), the smoke walkway margin (100 uu) and the 40-point scoring cap are manual-approx.
