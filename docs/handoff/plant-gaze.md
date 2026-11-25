# Handoff — plant tactics & gaze (session C, 2026-11-25)

Branch `claude/pv2-plant-gaze`. Scope: `plantTactics` + `gaze` (round-simulator gaze/post-plant,
team-engine plant-spot-onward/post-plant/retake, related docs). Owns P0-3 (gaze recalibration) and
P1-5 (plantTactics gate). Decision this session: **both flags stay OFF** — neither passes the real-roster
gate on both seed ranges. Causes and the next concrete step are below. Engine source is unchanged
(only the two diagnostic scripts gained a `--plant-tactics` flag, see §4).

## 0. Gate method
Real rosters (46 teams), Ascent, `sim-batch --matches 160`, `PYTHON=` a venv with jsonschema
(system python3 has it here). The 8 judged metrics = round-outcome ×4 (elimination / detonation /
defuse / time-expired), attack win rate, opening duel, pistol-vs-pistol, full-vs-full. Default change
only when the 8 are **no worse than main** on **both** seeds 1–160 and 161–320 (HANDOFF §3).

## 1. Baselines on this tree (HEAD = main at session start)
| config | range | judged8 | attack | pistol | full-full | opening | elim | deto | defuse | timeout |
|---|---|---|---|---|---|---|---|---|---|---|
| **default** | 1–160 | **8/8** | 0.508 | 0.469 | 0.486 | 0.449 | 0.681 | 0.078 | 0.185 | 0.056 |
| **default** | 161–320 | 7/8 | 0.483 | 0.397✗ | 0.454 | 0.432 | 0.682 | 0.078 | 0.182 | 0.058 |

(pistol 0.397 @ 161–320 is a pre-existing main failure, HANDOFF §5 P0-1.)

## 2. P1-5 — plantTactics gate: FAILS, kept OFF
### Measured (unmodified `--plant-tactics`, 160 matches)
| range | judged8 | attack | pistol | full-full | elim | deto | defuse | plant_rate | deto/plant | defuse/plant |
|---|---|---|---|---|---|---|---|---|---|---|
| 1–160 | **7/8** | 0.495 | 0.463 | 0.465 | **0.644✗** | 0.117 | 0.195 | 0.639 | **0.184** | 0.305 |
| 161–320 | **4/8** | **0.463✗** | **0.378✗** | 0.478 | **0.658✗** | 0.100 | **0.205✗** | 0.616 | 0.162 | 0.332 |

vs default (both the same ~0.636 plant_rate): elimination drops below the realistic band and
detonation/defuse rise. VCT reference: plant 0.601, deto/plant 0.155, defuse/plant 0.295.

### Cause (localised with `duel-breakdown`, `postplant-duels`, per-advantage report rows)
Two independent overshoots, pulling the same metrics the wrong way:
1. **Post-plant hold is too strong (raises detonation → lowers elimination).** plant rate is
   unchanged, but **detonation/plant 0.123 → 0.184**. post_plant_by_advantage shows the win rates
   compress toward 0.5: a man-**down** attack holds to detonation far more (−1 adv 0.309 → 0.403),
   while even/up attacks convert less. The driver is the **guard-post positioning** (`guardPostFor`,
   simulator) — it puts the holder on an idealised angle (sees spike + retake lane, min exposure to
   other entries) so it out-holds the realistic band in the *gaze-off* duel model. It is **not** the
   P6 flank watcher (tested `off`/`surplus`: elim 0.640 either way) and **not** plant rate.
2. **pointSight retake is too strong for the defence (lowers attack, raises defuse).** The
   `approachAmong` exposure uses the fractional share of each zone that sees the spike, so retakers
   find lower-exposure entries than the binary rule → safer retakes. Isolation (ENGINE_TRUTH §12.5)
   already flagged this as the −0.03-attack lever; it hits 161–320 hardest (attack 0.463, defuse
   0.205).

### Recalibration attempted (measured, did not pass)
- Softening the pointSight exposure (blend toward a floor; floor ≥0.5 collapses to "fastest entry")
  recovers **defuse 0.195 → 0.181 and attack 0.486 → 0.512** on seeds 1–60 — toward VCT. Good
  direction, confirms the named lever.
- Reverting the post-plant hold to legacy + the softened retake (160 matches, seeds 1–160):
  elim 0.666, deto 0.113, defuse 0.181, attack 0.495, **pistol 0.447**, full-full 0.489 → still
  **6/8** (elimination 0.666 < 0.674 band; pistol regressed 0.463 → 0.447).

The levers trade off: softening the retake fixes 161–320's attack/defuse but **breaks pistol** on
1–160 (0.463 → 0.447); the guard-post hold still holds detonation above default (0.113 vs 0.078) so
elimination stays below the band. No single-knob config passes all 8 on both ranges. All four
experimental toggles were reverted; engine source is unchanged.

### Next step (one)
plantTactics and gaze are **coupled** and must be recalibrated **together**, not independently: the
guard-post advantage over-performs specifically in the legacy gaze-off duel model (which absorbs aim
time into `LEGACY_STOP_MS`). Recalibrate the post-plant guard duel with the **gaze model on** (explicit
aim time) so the holder's positional edge and the retaker's swing balance to the VCT detonation/defuse
bands, then re-gate both flags as a pair. Treat the pointSight-exposure floor and the guard-post
hold strength as the two knobs; the pistol cell @ 1–160 is the tightest constraint.

## 3. P0-3 — gaze recalibration (post-plant guard 38°): measured, still OFF
### Gaze gate (160 matches, this tree)
| config | range | judged8 | attack | elim | defuse | opening | pistol | full-full |
|---|---|---|---|---|---|---|---|---|
| `--gaze` | 1–160 | 3/8 | **0.337✗** | 0.533✗ | 0.373✗ | 0.468 | 0.312✗ | 0.349✗ |
| `--gaze --plant-tactics` | 1–160 | **5/8** | **0.514** ✅ | 0.637✗ | 0.223✗ | 0.521✗ | 0.466 | 0.506 |
| `--gaze --plant-tactics` | 161–320 | **5/8** | **0.514** ✅ | 0.628✗ | 0.229✗ | 0.518✗ | 0.494 | 0.516 |

**New this session:** gaze ON *alone* is catastrophic (attack 0.337 — the post-plant guard has no post
and is lost). But gaze **with plant-tactics** now reaches **attack 0.514 — inside the 0.47–0.55 target
the handoff set** (ENGINE_TRUTH §12.4 had 0.412 @ 60 matches; the plant-spot/retake changes since have
lifted it). So the "gaze attack too low" problem is **resolved on this tree**. The remaining gate
blockers moved to: **elimination 0.63** (the same post-plant-hold overshoot as §2), **defuse 0.22**
(the retaker's pre-aimed swing wins too much — the 38° guard below), and **opening 0.52** (the pre-plant
attack entry now over-wins). Both ranges behave the same, and gaze+plantTactics even repairs the
pre-existing 161–320 pistol cell (0.397 → 0.494). gaze stays OFF, but it is much closer than the docs say.


### Measured (`duel-breakdown --gaze --plant-tactics`, 12 matches)
Post-plant attacker (guard) duel win 0.457 (gaze-off ≈ 0.576). Aim offset: **guard 38°, retaker 26°**.
- `D-swing` (retaker pre-aims the guard): n=186, atkWin 0.403, **guard 42° / retaker 12°**.
- `first=defender` (retaker sees first): n=190, atkWin 0.216, **guard 104°** — the guard is watching
  the wrong lane entirely.
- `first=mutual`: guard 11° — when both see at once the guard is fine. The 38° average is dominated by
  the wrong-lane cases.
Pre-plant is the opposite error: holder (defender) offset 2–6°, attacker 13–19° (ENGINE_TRUTH §11.2).

### Cause
The stationary post-plant guard cannot predict where the retaker emerges: the guard covers the
travel-/threat-weighted entry and aims the first point of the *fastest* anchor→spike route it can see
(`guardPostFor.show`), but the retaker arrives via the *least-exposed* entry (`retakeApproach`,
pointSight) and swings onto it with a fresh read. The two selection rules are structurally opposed, so
the guard is systematically off. The retaker, moving, also gets the peeker's advantage; the guard,
stationary, pays the 180 ms holder delay the gaze model made explicit (§11.2). Two opposing pre/post
errors cannot be closed with one peek constant.

### Attempted & rejected
Aiming the guard at the *deepest* point of the retake lane it can see (nearest the spike) instead of
the lane mouth made it **worse** (post-plant offset 38° → 52°, atkWin 0.457 → 0.380): the retaker
fights from up-lane, not the deep corner. Reverted.

### Next step (one)
gaze+plantTactics already clears the attack-win target (0.514); the three failing metrics are the
tractable work. In priority order: (a) **elimination** — the shared post-plant-hold overshoot (§2),
fix once for both flags; (b) **defuse 0.223** — the retaker's pre-aimed swing beats the 38°-off guard,
so fixing the guard's post-plant aim (put it on the retake's **exposed** points / off-angles, MAP-1
`holdSpots`, not the lane mouth — the naive "aim deeper" tried here backfired) cuts the retaker's edge;
(c) **opening 0.521** — add belief-staleness dispersion to the *pre-plant* holder (its 2–6° offset is
unrealistically perfect, which over-helps the attacker's entry). Do (a)/(b) with gaze on and re-gate
gaze and plantTactics together. gaze stays OFF until the 8 metrics hold on both ranges.

## 4. Changes committed
- `tools/data-validator/scripts/{duel-breakdown,postplant-duels}.mts`: added `--plant-tactics` so the
  gaze diagnostics can run with guard posts active (they previously only took `--gaze`).
- No engine/source change. `plantTactics` and `gaze` remain default OFF.
