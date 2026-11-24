# Hand-off — match economy (per-player economy, EC-01…05)

Branch `claude/epic-mahavira-18c91b`. Model and history: `docs/ECONOMY_MODEL.md` (v1, v1.1, v1.2 sections).
Last updated 2026-11-24.

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
| `MatchConfig.weaponModes` (sim-batch `--weapon-modes`) | Catalogue `altFire` (Classic 3-round burst within 3 m) and `movingAccuracy` (Classic 0.8, shotguns 0.85, Frenzy 0.75, Stinger 0.7). Changes pistol rounds. |

Always present but inert unless something buys the guns (only the flagged eco does):
- Catalogue (`packages/match-runner/data/weapons.manual-approx.json`, manual-approx): Shorty, Frenzy, Ghost,
  Stinger, Bucky, Judge, Bulldog, Guardian, Marshal, Outlaw. Shotgun `spreadDeg` is an effective cone: all
  pellets land out to ~3 m (Shorty), ~4 m (Judge), ~5 m (Bucky).
- combat-engine optional `WeaponSpec.pellets / spreadDeg / movingAccuracy / altFire` (`pelletLandChance`):
  guns without them resolve exactly as before.
- `ActionCommand.holdClose` (shared-types + round-simulator contract; mover takes the see-spot nearest the
  watched zone); team-engine sets it for a pre-plant defender whose gun's full-damage range is ≤ 12 m
  (`weaponFullDamageRangeM`, i.e. a shotgun).

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
