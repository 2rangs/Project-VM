# Hand-off — eco-defence steal (pre-plant defence)

Branch `claude/pv3-eco-defense` (from main `97db384`). Scope: HANDOFF §5 P0-2 — raise the eco
defence's steal so `semi` vs `eco` comes down toward VCT 0.928. Pre-plant defence only (session C owns
post-plant/retake, session D retake execution). 2026-11-26.

## Outcome: no pre-plant lever found; code reverted to main, findings below

Three pre-plant eco-defence interventions were built and measured; **none raise the eco steal**, each
for a mechanical reason that is now understood. The code is reverted to main (no default change, no
flag left behind — a dead flag is worse than none). The value of this pass is the diagnosis and the
recommendation, not a code change.

## 1. The baseline is not what the brief assumed

On main `97db384` (wave-2 integrated: `weaponModes` + `movementStyle` default **on**) the eco cells
mostly **pass** — the `0.990` in the brief is the 161–320 range, not the state everywhere:

| cell (target ±.05) | main 1–160 | main 161–320 |
|---|---|---|
| **semi vs eco** (0.928) | **0.976 ✅** (bound 0.978) | **0.990 ❌** |
| eco vs full (0.040, small-sample) | 0.062 ✅ | 0.091 ❌ (bound 0.090, by 0.001) |
| full vs eco (0.960) | 0.971 ✅ | 0.933 ✅ |
| eco vs semi (0.072) | 0.085 ✅ | 0.086 ✅ |
| original 8 | **8/8** | **8/8** |
| judged | 15/15 | 13/15 |

So the real miss is **161–320 `semi` vs `eco` 0.990** (1–160 passes at 0.976, near the bound). The eco
defence's measured round-win is **0.026 (1–160) / 0.036 (161–320)**; VCT eco defences steal ~7%.

## 2. What actually limits the eco steal (measured)

- **The eco defender already wins a 1v1 when it is the pre-aimed holder.** Monte-Carlo (combat-engine
  `monteCarloDuel`, 4,000 trials, pre-aimed stationary holder vs a moving Vandal entry, average
  skills): Sheriff **0.637**, Ghost **0.600** — and, crucially, **flat across range** (0.637 at 3 m
  and at 15 m). The combat model has **no range falloff for pistols/rifles**; only shotguns depend on
  range (Bucky 0.871 at 5 m → 0.000 at 15 m). The duel is decided by pre-aim + first-shot, not metres.
- **But the eco defence's actual opening-duel win is only 0.236 / 0.236.** The gap from 0.6 is not the
  gun — it is **being outnumbered at contact**. On an executed site two eco defenders face the attack's
  five: the combat engine's crossfire term puts the extra attacker guns on the lone defender, who loses
  even pre-aimed, and the round is a 2-v-5 that no hold wins. The eco steal in VCT comes from **early
  picks that even the numbers before the execute**, not from the site hold.

## 3. The three interventions and why each failed

| # | Idea | Where | Result | Why |
|---|---|---|---|---|
| 1 | Pre-contact rotation stack (pv2) | team-engine `decideEcoStack` | −EV (semi/eco 0.991→0.986, def-win down) | pulling defenders mid-round catches them in transit; they lose the duel they were sent to win and trade away their held angle |
| 2 | Buy-phase stack (3 on the read site) | match-runner `ecoStackStarts` | −EV (def-win 0.024→0.011; opening-duel unmoved) | concentrating cheap guns where five rifles execute **as a group** just feeds them; and a wrong-site guess loses the other site faster |
| 3 | Eco close hold (whole defence `holdClose`) | team-engine `closeGunHolds` | **no effect** (byte-identical output) | pistols are range-independent (§2), and `holdClose` only moves a defender *taking* a spot — a defender already placed and holding does not reposition, so nothing changes |

All are reverted. The buy-phase stack and close-hold were each prototyped on 40 matches vs the same
seeds; the rotation stack was the pv2 result (`docs/handoff/attack-closing.md` §5).

## 4. Side experiment — `weaponModes` shotgun run-and-gun

The brief noted the 28th merge's `weaponModes` worsened the eco cells. **Measured the opposite here:**
`--no-weapon-modes` on 1–160 gives `semi` vs `eco` **0.990** (fails), vs **0.976** with `weaponModes`
on (main). So `weaponModes` **helps** the eco defence (its one shotgun run-and-guns), and turning it
off is a regression, not a lever. I did not build the finer shotgun-only isolation: the aggregate
already shows the shotgun modes help the eco cell, so isolating them cannot turn up a cell-lowering
lever. (Original 8 unaffected by the toggle on 1–160.)

## 5. Performance (low-spec gate)

No code change, so sim cost is main's. `round-simulator/test/perf.test.ts` on this branch:
**51.67 ms/round** (1,000 rounds) — the main number, +0% by construction.

## 6. Recommendation / exact next step

The lever is **even numbers at contact**, i.e. an **aggressive eco pick**: one eco defender takes a
forward, pre-aimed off-angle (a controlled lurk, not the `aggroPush` scatter) to catch the attack's
early movement for a pick, turning the site hold from 2-v-5 into 2-v-4. The mechanics support it (a
pre-aimed holder wins 0.6, §2), but it is a **new behavioural system** (where to post, when to fall
back, how to avoid simply dying first and handing the attack a 5-v-4) with real regression risk to the
original 8, and it is a different approach from the sub-zone placement the brief specified. It should
be scoped and gated on its own, not bolted on in this pass.

Open question for the integrator: is the **161–320 `semi` vs `eco` 0.990** miss worth that system, or
is it acceptable as an eco-defence modelling limit (1–160 passes at 0.976; the cell is one of the 15,
not the original 8, and both ranges keep 8/8)? The eco-vs-full 0.091 (161–320) is 0.001 over its
small-sample, don't-tune bound and is noise.

## Notes

- Nothing merged into shared `policy.ts` logic; the experiments were reverted, so the branch's code
  equals main. No overlap with session C (post-plant) or D (retake).
- Scripts used (scratchpad, not committed): combat Monte-Carlo `duel.mts`, eco-defence analysis
  `eco_def.py`, cell analysis `analyze.py`. Baseline reports: the pv3 sim-batch runs on main `97db384`.
