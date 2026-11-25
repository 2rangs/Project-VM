# Hand-off — match economy (per-player economy, EC-01…05)

Branch `claude/epic-mahavira-18c91b`. Model and history: `docs/ECONOMY_MODEL.md` (v1, v1.1, v1.2 sections).
Last updated 2026-11-25 (main d91f646 + 5453fc0).

## Default-on (gated, on main)

| Piece | Where | Gate |
|---|---|---|
| v1 per-player credits, buys, drops, post-round pickups, ult points | match-runner `economy.ts`, `match.ts` | v1.1 |
| v1.1 partial buys play for picks on attack, per-player save worth, belief β 8.35 τ 18500 | team-engine `igl.ts`/`policy.ts`, economy-engine `plan-value.ts` | 8/8 (1–160), 7/8 (161–320, pistol) |
| v1.2 round-2 SMG buys (armor-matched gun worth, `EconomyOptions.armorMatchedValue`), plan `smg` | `weapon-worth.ts`, `economy.ts` | 8/8, cells 13/15 both ranges, attack 0.512 / 0.503 |
| v1.2 mid-round weapon pickups (`MatchConfig.floorItems`, sim `SimConfig.floorItems`) | round-simulator `floor-items.ts` | same |
| v1.2 ult-orb consumer (`loadUltOrbs`; no orb points on any map yet → no-op) | match-runner `setup.ts` | — |

## Behind flags (default OFF — not gated)

The eco-round package (2026-11-24). With both flags off the game is **bit-identical to main 65180b9**
(4 matches / 83 rounds, every round's winner, reason, loadouts and event count compared).

| Flag | What it turns on |
|---|---|
| `EconomyOptions.ecoSidearms` (`MatchConfig.economy`, sim-batch `--economy '{"ecoSidearms":true}'`) | The `sidearms` eco replaces the zero-spend `eco` and `light` plans: each player spends what is above their reserve (4,000 − next loss bonus: their share of a VCT full buy, 20,000) on Sheriff/Ghost + light shield, star first, team loadout capped under 5,000; on defence one player takes a Bucky/Shorty. Also: the eco ladder (Stinger, Ghost) for every plan, and a full buy short of the kit buys part of it. |
| `MatchConfig.weaponModes` (sim-batch `--weapon-modes`) | Catalogue `altFire` (Classic 3-round burst within 3 m) and run-and-gun: `movingAccuracy` (shotguns 0.95, Classic/Frenzy 0.75, Stinger 0.65); a moving shooter keeps moving through the duel when its gun keeps at least what the opponent keeps against a moving target, lerp(0.7, 1, tracking) (combat-engine `keepsMovingAgainst`, `EngagePosture.keepsMoving`). Under engine-truth's two-sided tracking only the shotguns qualify at average tracking: Bucky moving vs a standing Vandal at 5 m 0.58 → 0.79, Judge 4 m 0.73 → 0.87. Changes pistol rounds (Classic burst). Not gated. |

Always present but inert unless something buys the guns (only the flagged eco does):
- Catalogue (`packages/match-runner/data/weapons.manual-approx.json`, manual-approx): Shorty, Frenzy, Ghost,
  Stinger, Bucky, Judge, Bulldog, Guardian, Marshal, Outlaw. Shotgun `spreadDeg` is an effective cone: all
  pellets land out to ~3 m (Shorty), ~4 m (Judge), ~5 m (Bucky).
- combat-engine optional `WeaponSpec.pellets / spreadDeg / movingAccuracy / altFire` (`pelletLandChance`):
  guns without them resolve exactly as before.
- `ActionCommand.holdClose` (shared-types + round-simulator contract; mover takes the see-spot nearest the
  watched zone); team-engine sets it for a pre-plant defender whose gun's full-damage range is ≤ 12 m
  (`weaponFullDamageRangeM`, i.e. a shotgun).

## Gate — `ecoSidearms` ON (2026-11-25, main d91f646, real rosters, 160 matches)

Reports: `docs/research/SIM_ECONOMY_ECO_GATE_2026-11-25_{1-160,161-320}.json`.

| | flag off (integrator, d91f646) | **ON, 1–160** | **ON, 161–320** |
|---|---|---|---|
| Original 8 | 8/8 | **8/8** | 7/8 (pistol 0.397 — before any buy) |
| Judged cells | 13/15 | **13/15** | **14/15** |
| Attack | — | 0.508 | 0.483 |
| Elimination (≥ 0.674) | — | 0.681 | 0.682 |
| Eco vs semi (VCT Ascent 0.072) | 0.021 ✗ | 0.060 ✓ | 0.079 ✓ |
| Semi vs eco (0.928) | ✗ | 0.958 ✓ | 0.931 ✓ |
| Semi vs semi (0.50 ± 0.05) | 0.550 ✗ | 0.503 ✓ | 0.469 ✓ |
| Eco vs full (VCT Ascent 0.040, Wilson 0.007–0.195) | — | **0.099 ✗** | 0.077 ✓ |
| Full vs eco (0.960) | — | **0.905 ✗** | 0.934 ✓ |
| Eco loadout mean / median (VCT 2,736 / 2,700) | ~480 / 0 | 3,125 / 3,450 | 3,129 / 3,700 |

The one failing cell on 1–160 (eco vs full, both directions) is inside the Ascent prior's interval (it rests on
about 25 rounds) and matches VCT international all maps: ecos win **0.115** against full buys and carry 3,812
against them (vs semi: 0.086, 2,612). What raises it in the sim is not the buy: eco-defence rounds against a full
buy end by time 5.7% of the time (0% flag off), mostly with the attack 4 alive against 1–2 defenders that fail to
plant — attack close-out, engine-truth's area. Tried and dropped: a Lanchester firepower ratio in the attack's save
(no change; elimination 0.666 on 40 matches); disabling the shotgun close holds (rounds identical — no effect).

## Measured (eco package ON, 40 matches, seeds 1001–1040, small batches — not a gate)

| | flags off (same seeds) | ecoSidearms on | VCT |
|---|---|---|---|
| Eco loadout mean / median | 377 / 0 | 3,160 / 3,500 | 2,736 / 2,700 |
| Eco loadout < 1,000 | 85% | 9% | 4% |
| Eco bank | 13,221 | 10,691 | 8,684 |
| Eco vs semi (validator) | 0.022 | 0.037 (n 27; 0.047–0.069 on earlier variants) | 0.072 |
| Eco vs full (report) | 0.037 | 0.074 | 0.115 |
| Full-tier share | 0.545 | 0.496 | 0.621 |
| Attack | 0.528 | 0.512 | 0.509 |
| Elimination (≥ 0.674) | 0.653 | 0.673 | 0.714 |

VCT: international, non-pistol rounds, team loadout < 5,000 (vct.duckdb). Monte-Carlo duels (average
skills): Shorty vs Vandal 0.32 at 4 m / 0.00 at 12 m; Judge 0.88 at 4 m / 0.13 at 8 m; Bucky 0.81 at 6 m;
Sheriff 0.34 and Ghost 0.20 vs Vandal at 15 m.

Why the eco spend is a rule, not the expected-value pick: with the sim's belief (eco loadouts win
0.3–3% vs a full buy) and the two-round lookahead, spending the surplus and keeping it differ by < 0.01
of map-win probability, and the zero-spend eco wins by that margin. Whether to eco at all is still the EV
choice. A belief refit on sidearm-eco data (β 7.2, τ 20,000) did not change that.

## Unfinished — exact next step

1. Gate the eco package: `sim-batch --matches 160 --seed-start 1 --economy '{"ecoSidearms":true}'`, then
   `--seed-start 161`, through the heavy-run lock. Pass → set `ecoSidearms: true` in
   `DEFAULT_ECONOMY_OPTIONS` (`economy.ts`). Watch elimination (bound 0.674) and the full-tier share.
2. Then gate `--weapon-modes` alone (it moves pistol rounds; pistol is judged) and flip
   `MatchConfig.weaponModes` default if it passes.
3. Refit `SIM_ROUND_WIN_BELIEF` on the gated default (procedure in `docs/ECONOMY_MODEL.md`).
4. Ult orbs: maps-data adds `ultOrbs[]` (`position {x,y,z}` or `x,y,z`, optional `id`) to `<map>.objects.json`.

## Known risks

- Elimination share sits at the bound (0.673–0.687 on recent runs vs ≥ 0.674).
- The eco package lowers the full-tier share (0.545 → 0.496 on 40 matches) even with the partial kit.
- Shotgun/burst numbers are manual-approx and the pellet cone is a fitted stand-in, not game spread.
- `holdClose` touches round-simulator's mover (engine-truth's area): one branch in `pickSpot`, only
  when the command sets it.
- Saves are rare (2 per 60 lost rounds); the match-level save test only checks direction.
- Perf test (`round-simulator/test/perf.test.ts`, 60 s ceiling) fails under machine load (137 s with
  other gates running; 33 s alone).
