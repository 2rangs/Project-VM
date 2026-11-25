# Hand-off — match economy (per-player economy, EC-01…05)

Branch `claude/epic-mahavira-18c91b`. Model and history: `docs/ECONOMY_MODEL.md` (v1, v1.1, v1.2 sections).
Last updated 2026-11-25 (weaponModes gate on main 889ebef + engine-truth-2).

## Default-on (gated, on main)

| Piece | Where | Gate |
|---|---|---|
| v1 per-player credits, buys, drops, post-round pickups, ult points | match-runner `economy.ts`, `match.ts` | v1.1 |
| v1.1 partial buys play for picks on attack, per-player save worth, belief β 8.35 τ 18500 | team-engine `igl.ts`/`policy.ts`, economy-engine `plan-value.ts` | 8/8 (1–160), 7/8 (161–320, pistol) |
| v1.2 round-2 SMG buys (armor-matched gun worth, `EconomyOptions.armorMatchedValue`), plan `smg` | `weapon-worth.ts`, `economy.ts` | 8/8, cells 13/15 both ranges, attack 0.512 / 0.503 |
| v1.2 mid-round weapon pickups (`MatchConfig.floorItems`, sim `SimConfig.floorItems`) | round-simulator `floor-items.ts` | same |
| v1.2 ult-orb consumer (`loadUltOrbs`; no orb points on any map yet → no-op) | match-runner `setup.ts` | — |
| **Eco rounds** — `EconomyOptions.ecoSidearms` (default **true** since 2026-11-25; `false` → v1.2 buys). The `sidearms` eco replaces the zero-spend `eco` and `light` plans: each player spends what is above their reserve (4,000 − next loss bonus: their share of a VCT full buy, 20,000) on Sheriff/Ghost + light shield, star first, team loadout capped under 5,000; on defence one player takes a Bucky/Shorty and holds close (`ActionCommand.holdClose`). Also the eco ladder (Stinger, Ghost) for every plan, and a full buy short of the kit buys part of it. | match-runner `economy.ts`, team-engine `policy.ts` | gate below — flipped on the integrator's call |

The new default reproduces the gate run exactly (3 matches / 80 rounds compared with the `ecoSidearms: true`
gate run, seeds 1–3: every round's winner, reason, loadouts and event count).

## Behind flags (default OFF — not gated)

| Flag | What it turns on |
|---|---|
| `MatchConfig.weaponModes` (sim-batch `--weapon-modes`) | Catalogue `altFire` (Classic 3-round burst within 3 m) and run-and-gun: `movingAccuracy` (shotguns 0.95, Classic/Frenzy 0.75, Stinger 0.65); a moving shooter keeps moving through the duel when its gun keeps at least what the opponent keeps against a moving target, lerp(0.7, 1, tracking) (combat-engine `keepsMovingAgainst`, `EngagePosture.keepsMoving`). Under engine-truth's two-sided tracking only the shotguns qualify at average tracking: Bucky moving vs a standing Vandal at 5 m 0.58 → 0.79, Judge 4 m 0.73 → 0.87. Changes pistol rounds (Classic burst). Not gated. |

Catalogue and combat pieces the eco uses (guns appear only when the eco or a pickup puts them in a hand):
- Catalogue (`packages/match-runner/data/weapons.manual-approx.json`, manual-approx): Shorty, Frenzy, Ghost,
  Stinger, Bucky, Judge, Bulldog, Guardian, Marshal, Outlaw. Shotgun `spreadDeg` is an effective cone: all
  pellets land out to ~3 m (Shorty), ~4 m (Judge), ~5 m (Bucky).
- combat-engine optional `WeaponSpec.pellets / spreadDeg / movingAccuracy / altFire` (`pelletLandChance`):
  guns without them resolve exactly as before.
- `ActionCommand.holdClose` (shared-types + round-simulator contract; mover takes the see-spot nearest the
  watched zone); team-engine sets it for a pre-plant defender whose gun's full-damage range is ≤ 12 m
  (`weaponFullDamageRangeM`, i.e. a shotgun).

## Gate — `weaponModes` ON (2026-11-25, branch `weapon-modes-gate` = main 889ebef + engine-truth-2 9257a80) → NOT flipped

Reports: `docs/research/SIM_WEAPON_MODES_GATE_2026-11-25_{1-160,161-320}.json`. Real rosters, 160 matches,
`sim-batch --weapon-modes`.

| | 1–160 | 161–320 |
|---|---|---|
| Original 8 | **7/8** — defuse **0.203** (≤ 0.200) | **8/8** |
| Pistol (0.50) | 0.487 ✓ | **0.453 ✓** (0.397 with the flag off on main) |
| Attack | 0.529 | 0.507 |
| Elimination / detonation / time | 0.691 / 0.084 / 0.022 | 0.706 / 0.083 / 0.023 |
| Judged cells | 13/15 (defuse; eco vs full 0.123) | 14/15 (semi vs eco 0.991) |

Engine-truth's finding holds: with run-and-gun on, pistol at 161–320 passes. The gate still fails on 1–160 by one
metric, defuse share 0.203 against ≤ 0.200 (n 3,254 rounds; the share's standard error is ≈ 0.007, so this is
about half an SE over). **Same-seed baseline (flag off, same branch, seeds 1–160;
`docs/research/SIM_WEAPON_MODES_OFF_BASELINE_2026-11-25_1-160.json`):**

| | flag off | flag on |
|---|---|---|
| Original 8 | 8/8 | 7/8 |
| Defuse (≤ 0.200) | **0.198** | **0.203** |
| Attack | 0.531 | 0.529 |
| Pistol | 0.481 | 0.487 |
| Post-plant attack win / detonation | 0.701 / 0.117 | 0.695 / 0.125 |
| Judged cells | 13/15 (semi vs eco 0.986, eco vs full 0.137) | 13/15 (defuse, eco vs full 0.123) |

`weaponModes` moves defuse +0.005; the standard error of a difference between two runs of ~3,250 rounds is
≈ 0.010, so the move is noise. Defuse sits at the bound on this tree with or without the flag (0.198 / 0.203),
and the flag-on run trades the semi-vs-eco miss for the defuse miss (same 13/15). On 161–320 the flag is what
lifts pistol into the band (0.397 → 0.453) and makes it 8/8. Next step: the integrator's call — the gate's
strict reading (8/8 on both ranges) is not met on 1–160 by 0.003 of defuse; a measured effect of the flag on
that metric is not there. Defuse at the bound is engine-truth's (post-plant/retake).

## Gate — `ecoSidearms` ON (2026-11-25, main d91f646, real rosters, 160 matches) → default on

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
plant — attack close-out, engine-truth's area. Flipped on by the integrator: original 8 pass on both ranges,
the judged count stays at main's (13/15, 14/15), both target cells match VCT, and the eco-vs-full miss is inside
the prior's interval with a non-buy cause.

**Eco vs full cell and the close-out finding (passed to engine-truth by the integrator):**
- Cell (seeds 1–160): eco vs full 0.099, full vs eco 0.905 — fails the ±0.05 tolerance around the Ascent prior
  0.040 (≈25 rounds, Wilson 0.007–0.195); VCT international all maps 0.115. Seeds 161–320 pass (0.077 / 0.934).
- Close-out: with an eco defending against a full buy, **5.7%** of rounds end by time (1–160; 0% flag off), the
  attack typically **4 alive against 1–2 defenders** and no plant. Against a semi buy 3.3%. Counting script:
  rounds with `buyTiers.defense == "eco"` and `reason == "timeExpired"`, alive counts from kill events.

Tried and dropped: a Lanchester firepower ratio in the attack's save
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

1. engine-truth: attack close-out against an eco defence (above). When fixed, the 1–160 eco-vs-full cell
   should come back inside tolerance.
2. Gate `--weapon-modes` alone (it moves pistol rounds; pistol is judged) and flip
   `MatchConfig.weaponModes` default if it passes.
3. Refit `SIM_ROUND_WIN_BELIEF` on the gated default (procedure in `docs/ECONOMY_MODEL.md`).
4. Ult orbs: maps-data adds `ultOrbs[]` (`position {x,y,z}` or `x,y,z`, optional `id`) to `<map>.objects.json`.

## Known risks

- Elimination share sits near the bound (0.681 / 0.682 on the eco gate vs ≥ 0.674).
- Eco tier share 0.112 (VCT 0.054) and full share 0.52 (VCT 0.62) on the eco gate.
- The eco package lowers the full-tier share (0.545 → 0.496 on 40 matches) even with the partial kit.
- Shotgun/burst numbers are manual-approx and the pellet cone is a fitted stand-in, not game spread.
- `holdClose` touches round-simulator's mover (engine-truth's area): one branch in `pickSpot`, only
  when the command sets it.
- Saves are rare (2 per 60 lost rounds); the match-level save test only checks direction.
- Perf test (`round-simulator/test/perf.test.ts`, 60 s ceiling) fails under machine load (137 s with
  other gates running; 33 s alone).
