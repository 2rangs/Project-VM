# PROJECT V — ECONOMY & ULTIMATE MODEL

## Match economy v1.2 — round-2 buys, mid-round pickups, ult-orb consumer (2026-11-24)

**Round 2 after a pistol win.** VCT international (vct.duckdb, 2248 pistol wins): the winners field
16,023 (median 16,100) in round 2, keep 2,538 banked and convert 0.878; teams 2–0 up then play round 3
on 17,435 with 11,992 banked and win 0.427. The database has team loadout and bank only, no weapons, so
the "ratio" is matched through these. Before: the sim's winners bought rifles with light shields
(round-3 bonus 0.57 on 20,700 — kept rifles). The buy is still the expected-value choice; what changed
is what a gun is worth in this round's belief:
- `weapon-worth.ts` `armorMatchedPrice`: a gun's price scaled by its kill time against the shield it
  meets, relative to the Vandal, from the sim's own damage table (100 hp, shields block first, 27%
  head shots = VCT mean, range mix 8/22/40 m at 0.4/0.4/0.2 — provisional). Equal to the price against
  heavy shields, so full-buy rounds read as before; a Spectre against light shields ≈ 1,950.
- `score()` reads both loadouts at that worth against the other side's expected shields
  (`EconomyOptions.armorMatchedValue`, default true). The lookahead keeps shop prices.
- New plan `smg` (Spectre + heavy + kit, tier label `half`) beside `max`/`half`/`keep`/`light`/`eco`.

Seeds 1–160 / 161–320: round-2 winners field 14,113 / 13,947 (median 14,950 / 14,650), bank 2,884 /
3,041, rifles-for-all in 63 / 56 of 318 (plan "half" — SMGs — 171 / 171); round 3 after 2–0:
19,417 / 19,201, bank 7,608 / 8,117, **win 0.438 / 0.427 (VCT 0.427; was 0.572 / 0.567)**. Round-2
conversion is 0.943 / 0.943 (VCT 0.878; was 0.931 / 0.909) — report only; the sim's pistols-vs-SMG
fights are one-sided.

**Mid-round pickups** (round-simulator `floor-items.ts`, `SimConfig.floorItems`, off unless set;
match-runner sets it, `MatchConfig.floorItems` default true). A dead player's gun lies where they
fell; a living player within 2 m (same height band) who sees no enemy and is not planting or defusing
takes it when it is worth more than theirs and drops their own there. Nothing moves players to a gun.
Event `weaponPickup` (actor, target = whose gun, detail "taken|dropped"); match-runner
`floorAfterRound` updates what lies on each body before the post-round pickups. 0.029–0.030 pickups
per kill mid-round; post-round pickups fell from 0.031 to 0.026 of player-rounds.

**Ult orbs.** `setup.ts` `loadUltOrbs(map)` reads `<map>.objects.json` `ultOrbs` (`position {x,y,z}` or
`x,y,z`, optional `id`); the floor-items step emits `orbPickup` for the first player in reach (once per
orb per round) and settlement already credits a point per event. Every map's `ultOrbs` is empty today,
so this is a no-op until maps data adds the points.

**Gate** (real rosters, 160 matches, defaults; `docs/research/SIM_ECONOMY_V12_2026-11-24.json`):

| | v1.1 1–160 | **v1.2 1–160** | v1.1 161–320 | **v1.2 161–320** |
|---|---|---|---|---|
| Original 8 | 8/8 | **8/8** | 7/8 | **7/8** (pistol 0.394, pre-buy) |
| Judged cells | 13/15 | **13/15** | 13/15 | **13/15** |
| Elimination (≥ 0.674) | 0.677 | 0.681 | 0.682 | 0.687 |
| Defuse (≤ 0.200) | 0.194 | 0.191 | 0.190 | 0.176 |
| Attack | 0.503 | 0.512 | 0.489 | 0.503 |
| Force vs full (VCT 0.340) | 0.291 | 0.346 | 0.328 | 0.368 |

Failing cells: 1–160 semi-vs-eco 0.995 and eco-vs-semi 0.022 (EC-04 eco play); 161–320 semi-vs-semi
0.551 (tolerance 0.50 ± 0.05; inside the real CI) and pistol.

## Match economy v1.1 — on the recalibrated engine (2026-11-23)

Main `4f72e64` (engine-truth: damage carryover 0.4, positional smoke/plant, post-plant guards) passes the
original 8 at 8/8 with the old team-threshold economy. v1 on that engine fell to 6/8: elimination 0.661
(needs ≥ 0.674) and defuse 0.204 (needs ≤ 0.200).

**Measured cause** (seeds 1–160, bundles split by both teams' plans):
1. *Partial buys executed like full buys.* team-engine's `isEco` sent only true ecos to the slow
   `default` plan, so a force (on average 2.8 rifles + SMGs) ran a full execute. It reached the site
   (plant rate 0.52; main's five-Spectre force planted 0.31) and lost the retake: defuse 0.30 against
   0.16 for VCT Ascent semi-vs-full rounds (VCT ends those by elimination, 0.74). The win rate was
   already right (0.33 vs VCT 0.32); the round just ended the wrong way.
2. *Rifle carriers saved where Spectre carriers played out.* The policy's save rule keeps any gun worth
   ≥ 1900. Main's force was Spectres (1600), so those attacks never saved. v1's forces carry rifles, so
   losing attacks saved and ran the clock: time-expired from force attacks 1.5–1.8% of all rounds vs 0.4%.
3. Not the cause: the tier mix. Reweighting v1's per-tier outcome rates to VCT Ascent's tier mix still
   gives elimination 0.657 / defuse 0.203. And main's 8/8 partly rests on its old mix: 23% of its rounds
   were full attacks against a five-Spectre defence (attack wins 0.89; VCT full-vs-semi is 0.68).
   VCT Ascent end reasons by attack/defence tier (international, 3,061 rounds with loadouts): full/full
   elim 0.64 defuse 0.18; semi/full 0.74 / 0.16; full/semi 0.73 / 0.13; pistol 0.80 / 0.18. The sim's
   defuse rate is high on every tier (full/full 0.20, pistol 0.24); that part is engine, not economy.

**Fixes (economy mechanism; no combat constant changed):**
- `team-engine/igl.ts`: a partial buy (`buyCall` `force` or `half`) on attack plays the slow `default` plan:
  take lanes, hit when a player up or at the commit clock. Bonus rounds and full buys still execute.
- Save worth per player: `match-runner` `saveWorth(eco, buy)` → `TeamDecisionPolicy.setSaveWorth(map)`
  (new per-round setter, like `setProfiles`). A gun counts toward a save only if its holder's own next
  round (credits left after this buy + next loss bonus) could not buy it back with a heavy shield. A rich
  player plays a lost round out. `EconomyOptions.saveByCredits` (default true) turns it off; the
  policy's price rule still applies.
- Win belief refit on the new engine: β 8.35, τ 18,500 (table below).

**Validation (160 matches, real rosters, Ascent, abilities off; defaults)**

| Metric | Real | main 4f72e64 1–160 | v1 merged 1–160 | **v1.1 1–160** | **v1.1 161–320** |
|---|---|---|---|---|---|
| Ends by elimination | 0.714 | 0.686 ✓ | 0.661 ✗ | 0.677 ✓ | 0.682 ✓ |
| Ends by detonation | 0.082 | 0.082 ✓ | 0.085 ✓ | 0.090 ✓ | 0.084 ✓ |
| Ends by defuse | 0.160 | 0.185 ✓ | 0.204 ✗ | 0.194 ✓ | 0.190 ✓ |
| Ends by time | 0.043 | 0.047 ✓ | 0.050 ✓ | 0.039 ✓ | 0.044 ✓ |
| Attack round win | 0.509 | 0.501 ✓ | 0.482 ✓ | 0.503 ✓ | 0.489 ✓ |
| Opening duel (attack) | 0.437 | 0.448 ✓ | 0.441 ✓ | 0.449 ✓ | 0.450 ✓ |
| Pistol vs pistol (attack) | 0.500 | 0.463 ✓ | 0.463 ✓ | 0.463 ✓ | 0.394 ✗ |
| Full vs full (attack) | 0.500 | — | 0.498 ✓ | 0.457 ✓ | 0.468 ✓ |
| **Original 8** | | 8/8 | 6/8 | **8/8** | **7/8** |
| VCT economy cells | | — | 6/7 | 5/7 | 6/7 |
| **All judged** | | | 12/15 | **13/15** | **13/15** |

The 161–320 pistol miss is decided before any buy; engine-truth reported 0.394 on that range too. Failing economy
cells: semi-vs-eco 0.98 (VCT 0.93) on both ranges, and eco-vs-semi 0.02 (VCT 0.07) on 1–160. Both are the
eco-rounds-never-win gap (`EC-04`, engine-truth).

Report-only (1–160 / 161–320, VCT): force-vs-full 0.29 / 0.33 (0.34) · bonus conversion 0.57 / 0.57
(0.43) · pistol conversion 0.93 / 0.91 (0.88) · eco-vs-full 0.016 (0.115) · tier share eco / semi / full
0.10 / 0.35 / 0.55 (0.054 / 0.326 / 0.621). The steeper belief makes teams save more: eco share went from
0.073 to 0.10, above VCT. Drop rate 0.09.

Intermediate runs (1–160): the plan fix alone gave elimination 0.668 / defuse 0.190 / time 0.055. Adding the
refit gave 0.668 / 0.191 / 0.051 with attack 0.502. Adding save worth gave 0.677 / 0.194 / 0.039.
Final 1–160 report: `docs/research/SIM_ECONOMY_V11_2026-11-23.json`.

## Match economy v1 — per player (EC-01/02/03/05, 2026-11-23)

**Code:** `packages/match-runner/src/economy.ts` (state, plans, settlement, pickups) ·
`packages/economy-engine/src/plan-value.ts` (belief, map-win probability, lookahead) ·
`packages/game-rules/src/utility.ts` (kit costs). **Tests:** `match-runner/test/economy.test.ts`,
`economy-engine/test/plan-value.test.ts`. Replaces the team-level `decideBuy` threshold (kept only as a
compatibility helper).

### State and rules (all from `@pv/game-rules`)
Each of the five players carries `credits`, `weapon` (kept from the last round, `null` = Classic),
`armor` (shield points) and `ultPoints`. After every round, per player:

```
credits' = min(9000, leftover + (won ? 3000 : lossLadder[streak+1]) + 200·kills + (planted && attacking ? 300 : 0))
weapon'  = survived ? (picked-up gun if better, else own gun) : null      armor' = survived ? shield left : 0
ult'     = min(cost, points at round end + orbs)                          (kill / own death / plant / defuse: +1 each)
```
Loss ladder 1900 / 2400 / 2900, reset on a win. Half time and every overtime round reset credits
(800 / 5000) and clear carried equipment; ultimate points persist. Shields are never dropped; only
weapons are.

**Post-round pickups.** Every dead player drops the gun they fought with where they died. A survivor
picks one up if it is worth more than what they hold and they can reach it: they killed its owner, or
they ended the round in that zone (`PlayerRoundOutcome.endZoneId`). Most valuable first, one each.
(Mid-round pickups need a floor-weapon entity in the simulator — see Gaps.)

### Buy decision: a team call over expected map-win probability
For each candidate plan the team scores

```
J(plan) = P_now · V(after a win) + (1 − P_now) · V(after a loss)
P_now   = belief(own loadout value of the plan, expected opponent loadout value)
V(...)  = lookahead over the next 2 rounds: in each, buy-or-save maximising E[P(map win)],
          then every later round a coin flip (mapWinProbability: first to 13, OT win by two)
```
So the weight of the future (`γ`) is not a constant: it comes from the scoreline. A round that can end
the map leaves nothing to save for; a round before the half or overtime has no economic future because
credits reset.

**Plans** (all per player, from that player's own credits): `max` (rifle + heavy + full kit; a player
who can't afford it buys the best below; labelled `full` if all five have a rifle and a shield, else
`force`), `half` (SMG + light), `light` (a light shield on the Classic — a real eco buy, ≈2k a team),
`eco` (nothing), `keep` (carried guns, a light shield for gun carriers — the bonus round). The pistol
round buys a light shield and as much kit as the 800 allows. A coach `save` order forces `eco`;
`force`/`full` orders force `max`.

**Drops.** Within `max`, a player short of a rifle gets one bought by the richest teammate who can pay.
The donor gives up utility, then heavy → light, only while the rifle (minus the receiver's current
gun, plus the shield difference) is worth more than what the donor gives up. **Star first:** players are
served in order of mechanical rating (mean of aim, reaction, first-bullet accuracy, crosshair).

**Opponent read.** The opponent's buy is predicted with the same objective, one level deep (it expects
our maximum). A team with gameSense *g* (mean `decisionMaking`) weighs that prediction by *g* against
the cautious read that the opponent fields everything it can.

**Discipline.** Future rounds' beliefs are pulled toward 0.5 by `w = 1 + 1.0·(discipline − 0.6)`
(clamped 0.2–1.8; `EconomyOptions.disciplineFutureSlope`). An impatient team underrates what a save buys.

**Survival belief.** How much of a loadout is still carried after a won / lost round, from the team's
own rounds this match with a prior of 0.5 / 0.12 over 4 pseudo-rounds.

**Ultimates (abilities on only).** A ready ultimate is worth `ultValueCredits` (1500, provisional) of
loadout in the round it is used. The team may hold ready ults: a held ult counts in the next round, a
used one counts now, and using it restarts the charge (the points earned over the lookahead, at the
team's observed rate, prior 1.4 per player-round, count as that share of an ult; a held, full ult
wastes them). A held ult is sent to the simulator with cost 99 so it is not cast. With abilities off
ults do nothing in the sim, so they carry no value in the buy. Ult orbs: match-runner counts
`orbPickup` events (none exist yet — Gaps).

### The round-win belief
`P = σ(β·(g(own) − g(opp)))`, `g(v) = 1 − exp(−v/τ)`, on team loadout values (weapons + shields + kit).

| Fit | Data | β | τ | log-loss |
|---|---|---|---|---|
| `ROUND_WIN_BELIEF` (VCT) | VCT Reference international rounds 2–24, both loadouts known, 42,364 team-rounds, vct.duckdb `a1a189d0…4890` | 4.12 | 10,000 | 0.612 |
| `SIM_ROUND_WIN_BELIEF` (**default**, v1.1) | this simulator after engine-truth's recalibration (main `4f72e64`), seeds 1–160, 5,618 team-rounds | 8.35 | 18,500 | 0.532 (old sim fit: 0.534; VCT curve: 0.557) |
| first sim fit (v1) | pre-recalibration engine (`38ab6a5`), seeds 1–160, 5,392 team-rounds | 7.75 | 12,000 | 0.566 (VCT curve: 0.595) |

VCT reality check (opponent ≈ 22.6k): own 7.9k → curve 0.19 / real 0.22; 12.5k → 0.32 / 0.29;
16.6k → 0.41 / 0.39; 19.7k → 0.46 / 0.48. An eco (≈2.7k) is under-read: 0.06 / 0.13 (n = 179).

**Why the default is the simulator's own curve.** In the simulator loadout decides a round much harder
than in real play: rounds the VCT curve rates 0.3 are won 0.14, rounds it rates 0.7 are won 0.86.
Teams that believed the VCT curve forced into fights their world doesn't give them (no ecos at all, 55%
semi buys, bonus conversion 0.86 on a 40-match check). Teams believe what their world does. The gap is
itself a finding for engine-truth: the simulator's semi-vs-full is 0.26–0.31 against VCT 0.32–0.34, and
eco-vs-full is 0.01 against 0.12 (`EC-04` eco play: ranges, stacking).

**Refitting the belief** after a combat change: run `sim:batch --matches 160`, fit β, τ by maximum
likelihood on `rounds[].econ.{attack,defense}.value` and the round winner (rounds 2–24), and update
`SIM_ROUND_WIN_BELIEF`. `sim:batch --belief-beta B --belief-tau T` runs any curve
(`MatchConfig.economy.winBelief`).

### Validation (160 matches, real rosters, Ascent, abilities off)
Base = `a9c993a` (team threshold). After = this branch (`37800dd`). Bundles re-scored with the new
harness. Judged metrics marked ✓/✗ (tolerance ±0.04, economy cells ±0.05).

**The original 8 judged metrics**

| Metric | Real | Base 1–160 | Base 161–320 | **After 1–160** | **After 161–320** |
|---|---|---|---|---|---|
| Ends by elimination | 0.714 | 0.728 ✓ | 0.717 ✓ | 0.714 ✓ | 0.708 ✓ |
| Ends by detonation | 0.082 | 0.085 ✓ | 0.082 ✓ | 0.084 ✓ | 0.075 ✓ |
| Ends by defuse | 0.160 | 0.136 ✓ | 0.146 ✓ | 0.149 ✓ | 0.159 ✓ |
| Ends by time | 0.043 | 0.051 ✓ | 0.055 ✓ | 0.054 ✓ | 0.058 ✓ |
| Attack round win | 0.509 | 0.455 ✗ | 0.430 ✗ | 0.448 ✗ | 0.419 ✗ |
| Opening duel (attack) | 0.437 | 0.422 ✓ | 0.410 ✓ | 0.423 ✓ | 0.408 ✓ |
| Pistol vs pistol (attack) | 0.500 | 0.444 ✗ | 0.384 ✗ | 0.444 ✗ | 0.384 ✗ |
| Full vs full (attack) | 0.500 | 0.457 ✓ (n 1447) | 0.434 ✗ | 0.480 ✓ (n 834) | 0.431 ✗ |
| **Passed** | | **6/8** | **5/8** | **6/8** | **5/8** |

`full` in the base is the plan label (Vandal + heavy = 19.5k, VCT "semi" by value); after, it is the VCT
definition (team loadout ≥ 20k). Pistol rounds are bit-identical: the pistol round is decided before
any economy exists (the pistol buy's kit has no effect with abilities off), so the pistol attack rate
is not an economy mechanism — it is the attack-side weakness the status audit already lists.

**Economy cells now judged** (the bundle's `buyTiers` are VCT loadout-value tiers): 5 of 7 pass on
each range — semi vs full 0.298 / 0.317 (real 0.319 ✓), semi vs eco 0.956 / 0.941 (0.928 ✓), eco vs semi
0.059 / 0.042 (0.072 ✓), eco vs full 0.000 / 0.000 (0.040 ✓, small n), full vs eco 0.986 / 0.989 (0.960 ✓);
failing: full vs semi 0.630 / 0.567 (0.681) and semi vs semi 0.444 / 0.449 (0.500) — both the attack
deficit seen from the other side. With these the summary reads 11/15 and 10/15.

**Economy report (not judged; VCT reference where one exists)**

| Metric | VCT | Base 1–160 | Base 161–320 | After 1–160 | After 161–320 |
|---|---|---|---|---|---|
| Force into a full buy, win rate | 0.340 (semi vs full) | 0.102 | 0.105 | **0.261** | **0.312** |
| Force plan win rate (any opponent) | — | 0.108 | 0.108 | 0.317 | 0.369 |
| Pistol conversion (win r+1 after a pistol win) | 0.879 | 0.908 | 0.892 | 0.921 | 0.915 |
| Bonus conversion (win r+2 after winning r, r+1) | 0.427 | 0.713 | 0.713 | **0.585** | **0.593** |
| Eco next-round win | 0.598 | — | — | 0.518 | 0.481 |
| Full next-round win | 0.506 | 0.528 | 0.522 | 0.564 | 0.552 |
| Eco vs full, win rate | 0.115 | — | — | 0.011 | 0.007 |
| Tier share eco / semi / full (rounds 2–24) | 0.054 / 0.326 / 0.621 | 0 / 0 / 0.74¹ | 0 / 0 / 0.74¹ | **0.079 / 0.371 / 0.550** | **0.083 / 0.369 / 0.549** |
| Team-rounds with a drop | — | — | — | 0.086 | 0.095 |
| Team-rounds with a post-round pickup | — | — | — | 0.032 | 0.035 |
| Half-buy win rate | — | — | — | 0.872 (n 133) | 0.881 (n 151) |

¹ Base tiers are plan labels (`force` 26%, `full` 74%), not loadout values.

The first all-VCT-belief run (`38ab6a5`, same seeds) is the evidence for the default: attack 0.429 /
0.415, force-vs-full 0.243 / 0.237, tier share 0 / 0.56 / 0.44, bonus conversion 0.816 / 0.766.

### Counterfactual tests (direction and size) — `match-runner/test/economy.test.ts`
- **More credits buy better:** 1000 → 6000 credits each takes the team from < 5k (VCT eco) to five
  rifles, `full`, ≥ 20k; loadout value is monotone in between.
- **A drop rifles a poor player:** [9000 ×4, 800] → the 800 player plays a dropped Vandal paid by a
  teammate (+≥1 rifle against [4000 ×4, 800], where no one can pay); round-win belief +>0.02.
- **The bonus round keeps guns:** pistol-and-round-2 winners on carried Spectres at 1500 each →
  tier `bonus`, all five guns kept, ≤ 1000 spent each; > 4000 more value than the same credits without
  kept guns.
- **A saving player survives and carries the gun:** 3 matches with the attack-save policy vs with it off
  (`attackSaveMinWinChance` 0): armed survivors per lost attack round 0.095 vs 0; guns carried into the
  next buy 0.071 vs 0.
- **Ult readiness changes buy timing:** at 2000 each after a loss the team saves; with five ready
  ultimates (abilities on) it buys. With abilities off ults don't move the buy. (Holding an ult is
  modelled and recorded, `PlayerBuy.ultHeld`, but rarely chosen — see Gaps.)
- **Discipline:** the buy-vs-save gap is larger for a 0.2-discipline team than for a 1.0 one.

### Round records (for the UI)
`RoundRecord.buys[slot]`: `tier` (adds `half`, `bonus`), `plan`, `players[i]` (`creditsBefore/After`,
`spent`, `weapon`, `weaponSource` kept|bought|dropped|default, `droppedBy`, `armor`, `armorBought`,
`utility`, `loadoutValue`, `ultHeld`), `loadoutValue`, `vctTier`, `drops`, `evaluation[]` (each plan's J
and P_now). `RoundRecord.economy[slot]`: `credits` is now the **team total** (was one representative
bank), plus `players[i]` `{credits, weapon, armor, ultPoints}`. `RoundRecord.pickups[]`. The desktop
shows the new tier labels (`buy.bonus`); a per-player buy table needs the desktop engine scripts to
forward `players` / `pickups` (left to the UI session).

### Gaps
- **Mid-round weapon pickup** (floor entity in round-simulator) — engine-truth. Pickups are post-round only.
- **Ult orbs**: no orb positions in `datasets/spatial/**` yet (maps) and no `orbPickup` sim event (engine-truth).
- **Weapon menu** is the simulator's catalog: Classic, Sheriff, Spectre, Vandal, Phantom, Operator. No
  Ghost/Stinger/Bulldog/Marshal/Judge; no Operator designation; no SMG-for-round-2 nuance (the belief only
  sees loadout value, so pistol winners rifle up in round 2 instead of buying SMGs — one reason bonus
  conversion is still 0.59 vs 0.43).
- **Eco rounds never win** (0.01 vs 0.12 real): classic vs rifle duels in the simulator, plus no eco
  stacking (`EC-04`) — engine-truth.
- **Attack deficit** (v1, old engine: 0.448 / 0.419) was upstream (pistol rounds identical). On the
  recalibrated engine with v1.1: 0.503 / 0.489.
- **Defuse share is high on every tier** (full/full 0.20 vs VCT Ascent 0.18, pistol 0.24 vs 0.18): retake
  play, engine-truth. Elimination 0.677 is just inside the 0.674 bound.
- The save-worth rule ignores kill rewards earned before the save and the team's drops next round.
- Opponent's future buys in the lookahead are assumed to be full buys (a cautious read).
- Kill rewards are not projected in the lookahead (≈ +500–700 a team per round).
- Overtime keeps the old boundary rule (equipment does not carry between OT rounds).
- Ult value (1500 credits) is provisional until ability-engine values each ultimate's effect.
- Individual buy deviations (a low-discipline player breaking a save call) are not modelled; discipline
  acts through the team's future weight.
- Astra's kit cost is missing from the source table (0).

---

## Economy engine v0 library (2026-11-18)

**Owner:** Data Engineering (PV-2) · **Date:** 2026-11-18 · **Package:** `packages/economy-engine` (v0)
**Specs:** Handoff §15–16, §20.7–20.10, §29; README §19–22, P3.

The economy engine turns an economic situation into **scored candidate options** that the Action
Generator (PV-3) consumes as Resource-Cost / Expected-Utility inputs (README §13.4, §15.1). It is a
pure, deterministic TypeScript library — same input → same output, no RNG, no I/O.

## The option contract
Every module returns `EconomyOption[]`. The Action Generator reads these fields:

```ts
interface EconomyOption {
  action: string;            // "fullBuy" | "SAVE_WEAPON" | "EXIT_KILL" | ...
  currentRoundValue: number; // [-1,1] effect on winning THIS round
  futureValue: number;       // [-1,1] effect on FUTURE rounds; 0 at no-future boundaries
  economicDelta: number;     // expected credits (own - enemy)
  ultDelta: number;          // expected ENEMY ult points DENIED (positive = good)
  explanation: string;       // grounded reason, for the Decision Debugger (§21, §29)
}
```
Dispatch: `evaluateEconomy({ phase: "buy"|"save"|"exitKill", context })`.

## Modules
| Module | Entry | Purpose |
|---|---|---|
| Buy strategy | `buyOptions(BuyContext)` | eco / half / force / full candidates, scored by the economy matchup prior |
| Future value | `projectNextRoundBank`, `weaponFutureValue`, `nextRoundWinEdge` | next 1–2 rounds' economy + win edge |
| Save decision | `saveOptions(SaveContext)` / `recommendSave` | SAVE_WEAPON vs PLAY_FOR_ROUND — **multi-factor, not a threshold** |
| Ultimate economy | `makeUltState`, `applyUltEvent`, `ultDenialValue` | track charge; value point-denial / readiness |
| Exit kill | `exitKillOptions(ExitKillContext)` | chase-for-weapon-destruction EV vs hold |
| Round boundaries | `isPreResetRound`, `isMapPoint`, `weaponPreservationHasFuture` | where "future value" is zero |
| Match economy | `advanceMatchEconomy`, `advanceTeamEconomy`, `creditAward`, `retainedWeaponValue` | between-rounds state advance a Match Runner calls (credits, loss streak, equipment retention) |

## Match loop (between-rounds API)
A Match Runner (PV-3) drives a full game by, each round: (1) read each team's `TeamEconomyState`,
(2) get buy candidates via `buyOptions`, (3) simulate the round, (4) feed the result back to
`advanceMatchEconomy` to get both teams' next-round credits and loss streaks. Credit numbers reuse
`rules.ts` (`roundWinReward` 3000, loss ladder `[1900,2400,2900]`, `spikePlantReward` 300,
`killReward` 200) and `projectNextRoundBank` — `match-economy.ts` adds per-kill rewards, the
`consecutiveLosses`/`lossBonusTier` update, and equipment retention.

```ts
import {
  advanceMatchEconomy, buyOptions, retainedWeaponValue,
  type TeamEconomyState, type RoundEconomyOutcome,
} from "@pv/economy-engine";

let eco: [TeamEconomyState, TeamEconomyState] = [
  { teamId: "t0", side: "attack",  credits: 800, lossBonusTier: 0, consecutiveLosses: 0 },
  { teamId: "t1", side: "defense", credits: 800, lossBonusTier: 0, consecutiveLosses: 0 },
];

for (let roundNum = 1; roundNum <= 24; roundNum++) {
  // 1) each team picks a buy from its current credits
  const atkBuy = buyOptions({ teamCredits: eco[0].credits, roundNum, matchScore, teamIdx: 0 })[0];
  // 2) …Match Runner simulates the round and produces the outcome…
  const outcome: RoundEconomyOutcome = {
    roundNum, winnerTeamIdx: 0, plantingTeamIdx: 0,
    kills: [3, 2],
    leftoverCredits: [eco[0].credits - spentByT0, eco[1].credits - spentByT1],
  };
  // 3) advance BOTH teams' economy across the round boundary
  eco = advanceMatchEconomy(eco, outcome);
  // 4) survivors keep their weapons (0 at a half/OT reset round) — reduce next buy's effective cost
  const t0Retained = retainedWeaponValue(["vandal", "operator"], roundNum);
}
```
`advanceTeamEconomy` / `creditAward` are the per-team pieces if the runner advances teams separately.

## Where the numbers come from
- **Economy rule constants** (prices, armor, loss-bonus ladder `[1900, 2400, 2900]`, rewards, ult
  point-earning): mirror of PV-core `@pv/game-rules`, all **provisional** (`verified: false`,
  pending a patch-source pass — README §29). Mirrored in `src/rules.ts`.
- **Ultimate point requirements**: the **canonical PV-1 catalog** (`pv-research:
  tools/catalog-builder/data/ability_facts.json`, `ultPoints`, build release-13.10,
  gameplayVerified). These override PV-core's small sample where they differ — **jett 8, sage 7,
  killjoy 9, brimstone 8** (PV-3 had 7/8/8/7).
- **Win-probability priors**: PV-2's **real** derived priors (`datasets/derived/priors/`, VCT
  Reference build 2026-11-12), copied into `src/priors-fixture.ts` as a snapshot. Key values:
  full>semi 0.66, semi>eco 0.91, **eco→next-round 0.598 vs full 0.506** (the snowball behind saving).

## Key design points (per the specs)
- **Saving is not a threshold (Handoff §29).** `SAVE_WEAPON` vs `PLAY_FOR_ROUND` compares weapon
  preservation value + ult-point denial + escape risk against the current-round win chance. A low win
  probability alone does **not** force a save: with a worthless weapon (Classic) and no ult to deny,
  playing scores at least as high (tested).
- **Future value vanishes at boundaries.** `weaponFutureValue` is 0 at the last round before a half /
  OT reset (round 12, 24, or any OT round — weapons don't carry) and at **match point** (the map can
  end, so there is no future round to save for). So at match point the engine prefers playing for the
  win over saving (Handoff §20.9, tested as scenario 09).
- **Ultimate point denial (Handoff §15.2, README §21.3).** `ultDenialValue` peaks when an enemy is
  exactly one point from a ready ult and is zero once they are already charged (the point is wasted).
  Surviving credits the SAVE option's `ultDelta`; dying while contesting debits `PLAY`'s `ultDelta`.
- **Exit kill (README §22).** Weighs destroying a fleeing enemy's high-value weapon against the risk
  of feeding your own rifle and the enemy's ult.

## Status / caveats
- **v0, provisional rule numbers.** Every economy constant is `verified:false` until a patch-source
  pass flips it. The engine exposes them via `Rule<T>` so that pass is mechanical.
- **Mirrored types.** `src/shared-mirror.ts` mirrors `@pv/shared-types`; replace with real imports at
  monorepo integration. `src/priors-fixture.ts` is a snapshot; load from `datasets/derived/priors/`
  at integration.
- **Not wired into a package graph yet** (standalone package.json/tsconfig/vitest). PV-3 can import
  `evaluateEconomy` and the typed contexts directly.

## Build & test
```bash
cd packages/economy-engine
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest: 15 tests (rules, scenarios 07/08/09, buy, future, exit kill, determinism)
npm run build       # emits dist/
```
