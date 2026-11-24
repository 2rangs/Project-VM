# PROJECT V — Plant spots, post-plant and retakes (research and gap map)

> Research only; no engine code changed. Written 2026-11-24 on `origin/main` 7073bac.
> Engine-truth's plant-spot work lives on `claude/peaceful-agnesi-b01f91` (not merged): `docs/ENGINE_TRUTH.md` §12,
> `round-simulator/src/plant-spot.ts`, `shared-types/src/plant-plans.ts`, `team-engine/src/policy.ts` (`retakeApproach`, `retakeDecisionFor`).
> Gap statuses below are against **that branch (aca57b7)**, because it is where this is being built; "main" means 7073bac.
> Related: [`PRO_TECHNIQUES.md`](PRO_TECHNIQUES.md) PP-01…PP-06, [`LURKER_ROLE.md`](LURKER_ROLE.md) L10, [`MID_CONTROL.md`](MID_CONTROL.md).
> Design rule: attribute × situation → named formula; the AI acts on team belief; no flat bonuses.

## 0. Summary

1. **Why spots differ:** every source reasons the same way. A plant is good when the planter's team can cover the defuse
   area from *off the spike* with a crossfire, the defuse circle is small, and the attackers have angles the defenders
   can't cover on the way in. Hidden/safe plants suit a short-handed team (defenders must walk into your aim);
   open plants suit a team with numbers (crossfire the defuser).
2. **The numbers we can get are coarse.** `vct.duckdb` has no events, plant coordinates or man-advantage, so post-plant win
   rate by man-advantage / time left / site **cannot** be computed from it. What it gives: outcome by map (§6).
   Engine-truth already did the aggregate comparison (12.3: defuse per plant 0.295, plant rate 0.685).
3. **Engine (peaceful-agnesi branch):** plant spot candidates (default / safe / open + cover-R + near-E), a utility-style choice, per-guard posts,
   manager options for hold/flank-watch/utility/outnumbered/retake. Missing: lineups, sound-based tap reading,
   half-defuse checkpoint, stick/ninja, a save rule for the attack after the plant, positional smokes, retake utility order.

## 1. Sources

Third-party guides only; none is pro-match data. Treat spot opinions as coach consensus.
- Dignitas [best plant spots per map](https://dignitas.gg/articles/the-best-plant-spots-for-every-map) (undated; Ascent, Haven, Bind, Split, Icebox, Breeze),
  [post-plant meta](https://dignitas.gg/articles/analyzing-the-post-plant-meta-in-valorant),
  [playing post-plant](https://dignitas.gg/articles/playing-post-plant-in-valorant-strategies-and-tips)
- Boostroom [post-plant guide](https://boostroom.com/blog/post-plant-guide-best-positioning-timing-and-utility-to-secure-the-round)
- Metabot [plant/defuse/post-plant](https://metabot.gg/en/valorant/guides/valorant-spike-plant-defuse-postplant)
- Mobalytics [how to retake](https://mobalytics.gg/blog/valorant/valorant-how-to-retake/) (search snippet only; page not readable), [Lotus changes](https://mobalytics.gg/blog/valorant/lotus-map-changes/)
- Riot [VCT 2023 data drop](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023)
- Upcomer on [vstats.gg plant spots](https://upcomer.com/this-nifty-valorant-tool-reveals-the-best-spike-plant-for-every-single-map/) (all ranks)
- Programming Insider [map tier list](https://programminginsider.com/valorant-maps-ranked-complete-tier-list-for-v25-act-6/) and Cogconnected [maps](https://cogconnected.com/?p=375366) (third-party stats, internally inconsistent; *unconfirmed*)
- Sportskeeda [Sunset Sage-wall plants](https://sportskeeda.com/valorant/best-sage-wall-spike-plant-locations-valorant-s-sunset) (snippet)

The current map pool is uncertain: sources disagree on when Ascent/Lotus/Split rotate out. Check patch notes before treating a map as live.

## 2. Plant spots and why teams choose them

| Map | Spots named by the sources | Reasoning (paraphrased) |
|---|---|---|
| Ascent | A: Generator (bad), Dice, Tree. B: Boxes (bad), Corner, Back, Market | Dice is covered from Wine / A Main / Tree room but needs Rafters cleared; Tree is rare so can surprise; B Corner is covered from Stairs and Lane but wall-bangable; B Back needs defender spawn control; B Market needs both Market and spawn |
| Haven | A Default, A Long; B Middle, B Left; C Default (bad), C Long, C Garage | A Default is safe from spawn and covered from Short/Long on the right side; B Left has a small defuse circle and is safe from A Link; C Long's small circle against the boxes needs a spawn watcher |
| Bind | A Truck, Triple (bad), Open; B Default (bad), B Mid | A Open is the best from Showers but needs a Sage wall or a B fake; B Default is easy to hide in so defenders must push far |
| Split | A Default (bad), Corner, Bottom, Heaven; B Default (bad), B Main, B Corner | A Corner is safe from Heaven with a small circle; B Main is best when the site is clear; B Corner needs Heaven control |
| Icebox | A Default (bad), Generator, Belt, Top; B Default, Corner, Mid, Top | Generator and Belt have limited defuse circles; B Default is a known wallbang |
| Breeze | A Default (far-right pyramid), B Default (bottom-left pillar), B Mid | far corners shrink the defuse circle and shield from spawn |
| Sunset | B corner near B Main, in front of pillar; A beside green boxes / behind box | B is hard to retake with good post-plant; leave the site after planting (guide level) |
| Lotus | A Default, B default box, C Default / Bend | C near C Mound is strong for post-plant; C Bend became easier to retake after a rework |
| Pearl, Abyss, Fracture, Corrode | not found | only the aggregate numbers in §6 |

Cross-source themes (Metabot, Boostroom): open plant when you have numbers; hidden plant when short-handed; utility-based plants are
predictable and get pre-aimed; a default plant is fast and safe but weaker for the post-plant; the safest plant is easier to tap from cover.
**Plant timing:** average time to plant 52.3 s (VCT Pacific) to 60.4 s (EMEA) in VCT 2023 (Riot).
**Spot vs outcome (all-rank, confounded):** Ascent B Default 67.65 % to Lane/Boathouse 76.93 %; Bind A Dice 61.85 % to A Short 69.97 %. The Upcomer article warns teams plant where they are pressured. Engine-truth measured safe 0.751 / near 0.681 / default 0.512 post-plant attack wins in sim (12.3).

## 3. Post-plant

| Behaviour | Source summary |
|---|---|
| Timers | plant 4 s (can't shoot), detonation 45 s after plant, defuse 7 s with a 3.5 s checkpoint (progress saved). Under about 8 s left a clean full defuse is unlikely, so defenders half-defuse; under about 4 s left with the site uncleared, retakers often do better saving (Metabot) |
| Deny the half | pushing a defuser off before the checkpoint resets the 7 s; past it, the next attempt is short, so denying the half is the main goal (Boostroom) |
| On vs off spike | utility sits near the spike (triggers on defuse) or is thrown from lineups far away; teams usually play back from the spike (Dignitas). Staying put is safer if the plant is hidden or no denial tool is left (Boostroom) |
| Crossfire | two angles overlapping on the defuse area so a peeker trades only one; best at 2v1 (Dignitas) |
| Utility | Viper Snakebite called the strongest post-plant tool; Killjoy Nanoswarm triggers on a defuse; Sova shock/Hunter's Fury; Astra wells. One article's figure: Nanoswarm + Snakebites delay about 24 s (≈8 + ≈16) — *unverified against patch notes* (Dignitas post-plant meta) |
| Flank guard | one player on site slows the approach; another guards the flank, often with an alarm bot or turret; Version1 at Masters Reykjavik is the cited example (Dignitas) |
| Time vs kills | stay on angles and use the clock; leave only to take space, fix a numbers deficit or disrupt the retake (Dignitas, Metabot) |
| Tap / fake defuse | the first tap is often bait; punish only if the half can be denied with a trade behind you, else utility or reposition; after the half, a coordinated denial throw or synchronised swing, not a panic peek (Boostroom). Don't reload on the spike; hold utility for the last 10 s (Metabot) |
| Retreat / save | reset the setup if a teammate dies instead of trading straight back; no clean attacker save rule found. Also unconfirmed: *attack saves after the plant* |

## 4. Retakes

| Behaviour | Source summary |
|---|---|
| Entry, trade | one useful ability before first contact, wait for a teammate when possible, trade the first fight (Mobalytics, snippet) |
| Stack vs split | enter from more than one lane when possible (closest source to a pincer); no per-map pincer found |
| Utility order | two waves: first to slow the attackers, second saved for the defuse window; smokes cut strong angles or land at the defuse; info tools reveal attackers (Boostroom). Tap to 3.5 s, dodge the molly or trade, return (Metabot) |
| When to save | too little time, bad weapons, no utility, too many attackers, no teammate to trade, plus plant position, map control and economy (Mobalytics) |
| Plant spot changes the retake | Sunset B hard to retake with good post-plant positions; Haven B hard to defend after a plant; Lotus C hard but C Bend eased by a rework; Pearl A has three retake paths (Cogconnected, Mobalytics) |

## 5. Numbers

| Number | Value | Source |
|---|---|---|
| Best team attack post-plant win / defuse after plant | 74.8 % / 39.1 % (Fnatic, VCT 2023; best-in-event, not averages) | [Riot](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023) |
| League defuse rate of planted spikes | ≈30.3 % (VCT Intl. League), ≈31.5 % (Challengers) (snippet; attack post-plant ≈ 70 % is inference) | [THESPIKE stats](https://thespike.gg/valorant-stats/maps) |
| Abyss attacker post-plant | A 74.41 %, B 66.08 %; Pearl A 69.47 %, B 74.01 %; Haven A/B/C 74.74 / 70.77 / 70.81 % (different source) | third-party, *unconfirmed* |
| Time to plant | 52.3 s … 60.4 s | Riot |
| Retake rate by man-advantage; by time left | **not found** | — |

## 6. Our own data (`vct.duckdb`, 156,767 rounds with an outcome, read-only)

The `rounds` table records the **winning side**, the end type (`bomb_detonated`, `defuse`, `elimination`, `time_expired`), buys and banks. It has no plant event,
no site, no kill/time data, so **post-plant win by man-advantage, time left or site cannot be derived**. A planted round is only identifiable when it ended by
detonation or defuse; planted rounds ending by elimination are indistinguishable from unplanted ones. What we can give:

| Map | rounds | attack win | detonation | defuse | time expired | defuse / (det + defuse) |
|---|---|---|---|---|---|---|
| Haven | 22,856 | 0.520 | 0.111 | 0.207 | 0.024 | 0.651 |
| Ascent | 22,010 | 0.473 | 0.083 | 0.173 | 0.037 | 0.676 |
| Split | 19,394 | 0.493 | 0.099 | 0.169 | 0.043 | 0.631 |
| Bind | 18,655 | 0.507 | 0.110 | 0.196 | 0.034 | 0.641 |
| Lotus | 16,485 | 0.524 | 0.108 | 0.226 | 0.026 | 0.677 |
| Icebox | 14,500 | 0.518 | 0.095 | 0.228 | 0.025 | 0.706 |
| Breeze | 10,933 | 0.510 | 0.105 | 0.201 | 0.027 | 0.656 |
| Fracture | 8,790 | 0.514 | 0.100 | 0.194 | 0.028 | 0.660 |
| Sunset | 8,107 | 0.493 | 0.102 | 0.210 | 0.029 | 0.674 |
| Pearl | 6,956 | 0.498 | 0.110 | 0.227 | 0.039 | 0.673 |
| Abyss | 3,595 | 0.541 | 0.125 | 0.246 | 0.026 | 0.663 |
| **All** | 156,767 | 0.505 | 0.103 | 0.201 | 0.031 | 0.662 |

Reading: among rounds that reach detonation or defuse, the defence wins ≈ 63–71 % by defuse depending on map (Icebox highest, Split lowest), i.e. the plant is
worth far more than the post-plant label suggests, and the map spread is 7 pp. Engine-truth's separate pass (ENGINE_TRUTH §12.3, 129,128 rounds) gives plant rate 0.685, defuse/plant 0.295, detonation/plant 0.155 —
the data for a per-map post-plant check is therefore the defuse/(det+defuse) column. **To get man-advantage and time-left numbers we need an event source**
(GRID Open Access, own VOD coding; see `GRID_ACCESS.md`).

## 7. Gap map (against `claude/peaceful-agnesi-b01f91`)

| # | Behaviour | Status | Evidence / missing |
|---|---|---|---|
| P1 | Spot candidates per site (default/safe/open; cover-R, near-E) derived per map | ✅ | `round-simulator/src/plant-spot.ts` `plantSpotsOf`, ENGINE_TRUTH §12.1; `spatial-engine/src/spots.ts`; all 11 maps derived, no authored data |
| P2 | Spot choice by game sense: hidden, support, delay, time cost | ✅ | §12.1: `U(c) = g·(hidden+support+delay)/3 − reach/slack` |
| P3 | Plant by team size (open when numbers, hidden when short-handed) | 🟡 | `support` term counts living teammates who see the spot, but `hidden` and `support` are weighted equally for everyone; sources make the choice depend on *numbers*. Formula below |
| P4 | Guard posts, off-spike holding, crossfire on the defuser | ✅ | `guardPostFor`; flank watch when alive − 1 ≥ retake entries |
| P5 | Gaze: guards face the first-seen retake point | 🟡 | gaze is OFF (needs 0.47–0.55 attack before default, §12.4) |
| P6 | Flank guard role | 🟡 | `flankWatch` rule exists; no agent-/utility-based alarm role (Killjoy bot, Cypher trap) |
| P7 | Lineup mollies/shocks on the spike from off-site | ❌ | §12.2: "trajectory lineup not modelled"; the sim drops ground utility on the spike zone. Needs lineup data (MAP-2) |
| P8 | Hold last ground utility until a defuse starts | ✅ | `utility: auto` rule |
| P9 | Half-defuse checkpoint (3.5 s) | ❌ | simulator still resets defuse progress; `game-rules/src/spike.ts` has it. Backlog A3 |
| P10 | Taps / fake defuses and reading them | ❌ | no tap action, no Bayesian tap-vs-real read for attackers |
| P11 | Play-for-time vs kills (hold vs throw) | ✅ | throw hazard, `policy.ts` (`throwChance`) |
| P12 | Attack outnumbered → retreat to an entry | ✅ | `outnumbered` = retreat when Lanchester < `retakeMinWinChance` |
| P13 | Attack save after the plant | ❌ | EC-06/A: "after the plant no save"; sources give no clean rule either |
| P14 | Retake: least exposed approach, stack/split from per-defender cost | ✅ | `retakeApproach` with `pointSight` to the spike position (ENGINE_TRUTH §12.1) |
| P15 | Retake utility order (slow wave, defuse-window wave) | 🟡 | utility purposes (stall/cover/blind/scout) exist with abilities off by default; no retake-phase ordering |
| P16 | Give up and save by Lanchester + clock; manager override | ✅ | §12.2 `save: auto/never/{maxManDeficit,minSpareMs}` |
| P17 | Plant spot changes the retake | ✅ | entry watched ⇒ stack/split from min-cost approach (derived from spot) |
| P18 | Stick defuse, ninja defuse | ❌ | backlog A17 |
| P19 | Sound masking of the plant/defuse | ❌ | A6 |
| P20 | Smokes that cut the defuse (positional) | ❌ | smokes are zone-level, audit §D-3 |

## 8. Proposed formulas (attributes × situation)

Notation: `A`, `D` = alive attackers/defenders; `B` = team belief; `g` = gameSense; `T_det` = detonation time left; `T_def` = defuse time left;
`ρ` = logit choice (temperature from `decisionMaking`), as in `PRO_TECHNIQUES_BACKLOG.md` A1.

**P3 Plant by numbers.** Keep engine-truth's candidates, add a *numbers weight* `λ(A,D) = A/(A+D)`:
`U(c) = g·[(1−λ)·hidden(c) + λ·support(c) + delay(c)]/… − reach/slack`. With A ≥ D the planter prefers `support`; short-handed it prefers `hidden`, which is what Metabot and Boostroom say.
The weight comes from the same Lanchester numbers used elsewhere; no new constant.

**P9/P10 Half-defuse and taps (defender).** After the checkpoint the defuse needs only `T_def − 3.5 s` more. Tap if `P(attackers hold from cover | B)·ΔP(win | they peek into a teammate's pre-aim) > clock cost`.
**Attacker read:** posterior `P(real | sound) ∝ P(sound|real)P(real)` with `P(tap)` rising with defenders alive and with `T_det`; peek on a real defuse only at the checkpoint (second sound).

**P7 Lineup post-plant utility.** A lineup is (throw point, landing point). Cast when a defuse-start cue or defender evidence is on the spike and the caster stands at a lineup throw point; expected value
`V = P(defuse stopped)·P(win | stopped) − P(exposure of the throw point)·value(player)`. Throw points need data (§9).

**P13 Attack save after plant.** Save when `P(win | stay) = A_eff²/(A_eff²+κD²) < θ_save` *and* `T_det − (time to reach a safe zone) > 0`, where `A_eff` includes the post-plant holder edge `κ` and the number of defuse angles covered; `θ_save` below the engine's `retakeMinWinChance`.
Retakers' save in 3–4 s windows follows the existing clock rule (`minSpareMs`).

**P15 Retake utility order.** Two phases: `slow` at the entry's first sight (flash/smoke/recon chosen by purpose) and `defuse` (held until `T_def` is within 3.5 s of completion or a half is banked). Choose the phase for each charge by the option-value rule of backlog A13.

**P6 Flank guard role.** Pick the guard = argmax over alive attackers of `awareness·(1−aggression)` (an alarm-bot or trap holder gets a bonus term equal to its warning-time gain), assigned to the entry with the lowest guard sight.

## 9. Tests (counterfactuals)

1. P3: same planter, 5v2 vs 2v5; the spot kind should flip from support-heavy to hidden-heavy; report the post-plant win rate of each.
2. P9: defuse banked past the checkpoint then interrupted vs reset; report retake win rate change on a fixed 2v2 post-plant.
3. P10: taps allowed vs not; attackers who peek on the first tap lose more.
4. P7: a molly lineup vs a zone cast; defuse completion rate falls with the lineup.
5. P15: retake with the second wave held vs spent at entry.
6. 160 matches real rosters: defuse/plant (VCT 0.295), detonation/plant (0.155), plant rate (VCT 0.685, sim 0.56), and per-map defuse/(det+defuse) (§6 column).

## 10. Data we don't have

| Data | Use | Possible source |
|---|---|---|
| Post-plant win by man-advantage / time left / site; retake success by numbers | calibrate P3, P9, P13, P16 | GRID Open Access event feed if it carries kills and plant events; own VOD coding; vlr.gg/rib.gg as reference (check ToS) |
| Plant spot coordinates and which spot was used | validate spot choice | same; the sim's spots are derived, VCT has none (ENGINE_TRUTH §12.3) |
| Lineup throw/landing points per site | P7 | own in-game measurement in custom games; community lineup sites as pointers only |
| Spot-level reasoning for Pearl, Abyss, Fracture, Corrode | spot validation | coach articles are missing; own analysis |

## 11. Owners

- **engine-truth:** P3, P6, P7, P9, P10, P13, P15, P18 (on top of the §12 plant-spot work).
- **maps:** lineup data (MAP-2), named spots (`spots.ts` already derives them), spot-level hand overrides.
- **UI:** show the plant spot kind and planned post-plant/retake plan in Review (already in the manager options, §12.2), tap/half markers.
