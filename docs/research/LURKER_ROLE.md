# PROJECT V — The lurker role (research and gap map)

> Research only; no engine code changed. Written 2026-11-24 on top of `origin/main` (93fce88 merged).
> Sibling of [`PRO_TECHNIQUES.md`](PRO_TECHNIQUES.md) (MR-02 lurk timing, MR-01, MS-01, PK-08 are the related entries)
> and [`PRO_TECHNIQUES_BACKLOG.md`](PRO_TECHNIQUES_BACKLOG.md) (A11, A12).
> Design rule from the user: every behaviour is attribute × situation → a named formula, acting on **team belief**, never a flat bonus.

## 0. Summary

The user's framing is right and the sources agree with it: a lurker is the team's **second attack** (a pinch that
arrives while defenders are looking at the main group) and also **blocks variables** (rotations, flanks, late info,
retake routes). The sources say that success is mostly *pressure*, not kills: delayed rotations, a defender pinned to
watch the flank, spent defender utility.

**Public numbers are almost absent.** No source gives lurk rate, lurker kill share, time-of-kill, trade rate or win
rate with a lurk. What exists: Riot's average plant times (52–60 s), one casual guide's "wait about 30 s", and a
proxy we can compute ourselves from `vct.duckdb` (attack-side first-kill share, §6). Anything else below that has a
number is marked *assumption*. The lurk model therefore needs stated priors and later our own demo data (§8).

**Engine today:** a lurker exists and is *placed* (far-site hold, then collapse), but it has no decision of its own:
it never hits alone, never cuts a rotation, its sightings are ordinary team intel, and nothing in the buy phase
differs. Coverage in §7 (14 behaviours): 3 covered, 4 partly covered, 7 missing.

## 1. Sources used

Read in full: Tracker.gg [how to lurk](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant) and
[best lurking agents](https://tracker.gg/valorant/articles/best-lurking-agents-in-valorant) (May 2023, may be stale);
WeCoach [lurk guide](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro);
Dignitas [guide with Theia](https://dignitas.gg/articles/snake-your-way-to-radiant-a-guide-to-lurking-ft-theia);
ONE Esports [nAts](https://www.oneesports.gg/valorant/how-to-lurk-like-a-pro-from-nats-guide/);
N4G [lurking guide](https://n4g.com/articles/valorant-lurking-valorant-guide);
THESPIKE [team roles](https://www.thespike.gg/news/competitive-team-roles-in-valorant/142);
VLR [agents for lurking](https://www.vlr.gg/411100/ranking-agents-for-lurking) (opinion thread);
Hotspawn [defenders](https://www.hotspawn.com/valorant/guide/how-to-play-defenders-in-valorant-2025);
three Japanese analyses on note.com ([countering lurks](https://note.com/charm_tiger6920/n/n2dc1d6fd231a?hl=en-US),
[what is a lurk](https://note.com/charm_tiger6920/n/n03afe40f5940?hl=en),
[not just flanking](https://note.com/volga4753/n/n4dee4ad352aa?hl=en));
Riot [VCT 2023 data drop](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023),
[Ask VALORANT #6](https://playvalorant.com/en-us/news/game-updates/ask-valorant-6/) (footsteps).
Snippet only (not verified by opening): Lootbar, Alviran, Turtle Beach, EarlyGame, MetaSRC, THESPIKE plant times.
All are coach/community material, not measurements. Pages were summarised by a small model; treat details as
paraphrase-level.

**Named pros.** Only nAts (Gambit, slows the round, gathers info, acts late; described as an influence on Korean teams) and
Marved (lurk-and-flank timings with smokes; snippet, unconfirmed) have a supporting source. No lurk breakdown was found for
Chronicle, Derke, Less, Jinggg or Boaster; do not cite them as lurk sources. The duckdb proxy in §6 is the only thing we have on them.

## 2. Second attack

| Behaviour | What the sources say | Numbers |
|---|---|---|
| **Wait for pressure** | Do not move until teammates have presence on a site; then advance slowly and wait again. Pushing mid at round start usually gets the lurker killed by whoever holds the other site. [Dignitas](https://dignitas.gg/articles/snake-your-way-to-radiant-a-guide-to-lurking-ft-theia) | none |
| **Pinch on contact** | Go in while defenders are busy with the team's fight on the other side. [WeCoach](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro). The flank is reactive: listen for gunfire, ability and rotation sounds, then enter from behind. [note.com](https://note.com/charm_tiger6920/n/n2dc1d6fd231a?hl=en-US) | no timer in any source; pinch window after first contact is an *assumption* |
| **Pincer structure** | ~3 players hold main, 1 hits from the side → crossfire; effectively a collapse of area control. [note.com](https://note.com/charm_tiger6920/n/n2dc1d6fd231a?hl=en-US) | author's example |
| **Punish early rotations** | Catch early flankers and rotators → numbers advantage. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant); nAts strikes when enemies rotate. [ONE Esports](https://www.oneesports.gg/valorant/how-to-lurk-like-a-pro-from-nats-guide/) | none |
| **Alone vs wait** | Either take the open far site and push toward defender spawn (high risk), or hold mid and wait for rotations. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant) | none |
| **Do not fight before the team** | A lurk that engages first breaks the plan and leaves an isolated player. [note.com](https://note.com/volga4753/n/n4dee4ad352aa?hl=en) | none |

## 3. Variable blocking

| Behaviour | Source summary |
|---|---|
| **Cut rotations without fighting** | Value is making the enemy worry about the back: delayed rotations, a defender pulled onto the flank, an easier main push. [note.com](https://note.com/volga4753/n/n4dee4ad352aa?hl=en) |
| **Presence is a block** | A lurker simply holding a spot stops free rotation. Success = the enemy slows, commits extra players or hesitates. [note.com](https://note.com/charm_tiger6920/n/n03afe40f5940?hl=en) |
| **Non-kill outcomes count** | Baiting a rotation, forcing a flank watcher, making the enemy spend abilities. [note.com](https://note.com/volga4753/n/n4dee4ad352aa?hl=en) |
| **Split attention** | A living lurker forces defenders to watch the retake and the lurker at once; survival is the key. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant) |
| **Idle lurker = 4v5** | A lurker in a zero-information spot costs the team a player. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant) (framing, not measured) |
| **Post-plant flank / choke** | Flank when the retake starts; second most-cited engage point. [Dignitas](https://dignitas.gg/articles/snake-your-way-to-radiant-a-guide-to-lurking-ft-theia). Context only: best team post-plant win rate 74.8 % (Fnatic, VCT 2023, [Riot](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023)) is not a lurk statistic. |
| **Cleaning up rotators / the one left behind** | The "rotation kill": a lone or paired defender caught in transit; the author attributes it to rotating alone. Fix on defence: rotate in groups of 2+. [note.com](https://note.com/charm_tiger6920/n/n2dc1d6fd231a?hl=en-US) |
| **Defence-side lurk** | Push out of a main once absent enemies are confirmed so teammates can rotate; fits post-plant-heavy teams. Avoid against teams that flank often or default hard. [Dignitas](https://dignitas.gg/articles/snake-your-way-to-radiant-a-guide-to-lurking-ft-theia) |

## 4. Information flow

- **What it reports:** enemy count (especially rotators), utility used, and *silence* (no sounds may mean rotation,
  repositioning or an anti-lurk setup). Share enemy positions live without revealing own plan. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant), [WeCoach](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro)
- **How it changes the call:** few defenders on the lurker's side → push or collapse; many rotating past → buy time or switch the hit; the far site
  looks open → call a rotate. No source gives a decision tree; these are the consistent implications.
- **Loop of a good lurker:** nAts tracks which agents hold which areas after each round and stays close enough to hear commits and rotations.
  Trap deactivation (Killjoy/Cypher/Chamber going silent) is also read as "they moved". [ONE Esports](https://www.oneesports.gg/valorant/how-to-lurk-like-a-pro-from-nats-guide/), [N4G](https://n4g.com/articles/valorant-lurking-valorant-guide)
- **Defenders read the lurker by sound.** Riot tuned footsteps to be clearly audible with a flat distance curve and stereo mixing, so direction is coarse. [Riot](https://playvalorant.com/en-us/news/game-updates/ask-valorant-6/).
  Grenade and smoke throws are audible; scoping and picking up items are not. [Tracker.gg](https://tracker.gg/valorant/articles/which-sounds-can-your-enemies-hear)
  Walk/crouch ranges (15 m / 12 m) came from a headset-marketing page and are disputed: *unconfirmed*.
- **Round-start announcement** that a lurk is on, so the team adjusts. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant)

## 5. Timing, risk and counters

**Clock.**
- One casual guide: wait ≈ 30 s, then adapt to pace. [N4G](https://n4g.com/articles/valorant-lurking-valorant-guide) — *single source; treat as a prior*.
- Reference clock: average plant 52.3 s (VCT Pacific) to 60.4 s (EMEA), VCT 2023. [Riot](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023) A pinch has to land before the plant; **our inference: engage window ≈ 25–55 s**.
- Give up and collapse when the team is struggling to take the site, is about to be outnumbered, or the defence is countering the flank. [WeCoach](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro) A late clock is worth less to a lurk. [note.com](https://note.com/charm_tiger6920/n/n2dc1d6fd231a?hl=en-US)

**What gets a lurker killed for nothing:** pushing out too early, fighting before the team, pushing deep every round (predictable; nAts changed his
approach once teams copied it), being spotted, baiting without a plan, and **isolation** (nobody can trade a lurker). [N4G](https://n4g.com/articles/valorant-lurking-valorant-guide), [WeCoach](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro), [ONE Esports](https://www.oneesports.gg/valorant/how-to-lurk-like-a-pro-from-nats-guide/)

**How defenders counter:**
- rotate in pairs; one owner per lane (main, mid, flank); a dedicated player watching backward; 2-man holds on common push paths; leave an anchor
  while others rotate; a tripwire hit on the usual flanker implies the rest of the team is elsewhere (Hotspawn, note.com above);
- swing at the same time as a teammate so the lurker is traded and out-gunned; push the line to catch it from behind; flash/molly/recon to dislodge it;
- starve the lurker of sound (quieter, better-timed rotations);
- traps and a quiet off-angle anchor; teleports and smokes beat traps. [Tracker.gg](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant)
- If the defence leaves early for five-man retakes there is nothing for a solo lurk to catch (Lootbar, snippet only).

## 6. Picking the lurker, and data we have

**Traits (qualitative):** wins isolated duels, patient, reasons about what the enemy believes. [THESPIKE](https://www.thespike.gg/news/competitive-team-roles-in-valorant/142), [ONE Esports](https://www.oneesports.gg/valorant/how-to-lurk-like-a-pro-from-nats-guide/)
**Agents (opinion, conflicting):** Cypher, Killjoy, Viper, Omen, Astra, Chamber; Yoru and Jett occasionally; initiators and Sage poor. Weapon: hit-and-run Spectre/Ghost on eco-ish rounds (WeCoach).
**How often by map/side:** no source. Only "do not lurk every round".

**Own data, `vct.duckdb`** (2,930 matches, 2021-03 to 2026-10, 69,086 player-maps with attack splits; read-only). It has **no positions or event times**, so
it cannot give lurk rate, lurk timing or lurker kills. A usable proxy is *attack-side first-kill share* (fk_atk / kills_atk): an entry/duelist is high, a player who
fights later in the round is low. League average 0.133 (p25 0.0, median 0.111, p75 0.214 at ≥ 8 attack kills).

| Player (attack side, ≥ 30 maps) | maps | FK share | attack KAST | attack rating | plants |
|---|---|---|---|---|---|
| d4v41 | 431 | 0.097 | 75.2 | 1.06 | 639 |
| Boaster | 394 | 0.115 | 71.9 | 0.91 | 667 |
| Chronicle | 446 | 0.118 | 72.3 | 1.09 | 648 |
| Less | 290 | 0.119 | 71.7 | 1.12 | 131 |
| f0rsakeN | 432 | 0.152 | 73.1 | 1.05 | 561 |
| Derke | 392 | 0.236 | 69.2 | 1.03 | 316 |

| Attack side by agent (n ≥ 1500 player-maps) | FK share | FD share | KAST |
|---|---|---|---|
| Fade, Breach, Sova, Astra | 0.076–0.080 | 0.09–0.098 | 72–72.6 |
| Omen | 0.094 | 0.116 | 72.9 |
| Viper, Killjoy, Cypher | 0.110–0.118 | 0.127–0.131 | 67.6–70.8 |
| Chamber | 0.178 | 0.179 | 67.8 |
| Yoru / Raze / Neon / Jett | 0.198–0.233 | 0.23–0.273 | 67.6–69.2 |

Reading, with care: Boaster, Chronicle and Less sit well below average FK share, consistent with players who fight after the team has made contact; Derke is the opposite.
Cypher, Killjoy and Viper attackers have lower KAST (67.6–70.8 vs 72+ for initiators/controllers) — a hint that lone-side play is less often traded, which
matches the "isolated" description. **This is correlation on a proxy, not proof of lurking**; do not use these as lurk labels. Useful uses: a prior for who is
a *late-contact* player, and a sanity target for the sim (attack-side FK share by role).

## 7. Gap map against our engine

Evidence on `origin/main` unless noted. `movement-style.ts` exists only on branch `claude/infallible-wing-679e6e` (not on main); values below are from
there and from the task description (route slack 0.16, quiet factor 1.3, last 1500 uu walked).

| # | Behaviour | Status | Evidence / what is missing |
|---|---|---|---|
| L1 | Designate a lurker | ✅ | `team-engine/src/igl.ts:259` `assignRoles`: least aggressive of the whole roster, designated once, only if the strategy is `lurk…` or ≥ 4 alive; not replaced when dead. Trait choice uses `aggression` only (§9 L1) |
| L2 | Hold the far side during a slow play, collapse on commit | ✅ | `team-engine/src/policy.ts` `commitPlanMovement` (`lurk` closure, ~l.826): staging zone of the far site, quiet pace; rejoins after commit |
| L3 | Quiet approach, route freedom | 🟡 | branch-only `movement-style.ts`: route slack 0.16, quiet ×1.3, final 1500 uu walked. Fixed role constants, not a decision |
| L4 | Pinch on the execute (arrive at contact + trade window) | ❌ | the lurker rejoins when the site is chosen and the execute *waits for it* (`policy.ts` staging rule): the opposite of a pinch. Backlog A12 |
| L5 | Hit alone vs wait vs collapse decision | ❌ | no per-player choice; the only transition is the plan commit |
| L6 | Rotation cutting (intercept rotators, hold a lane) | ❌ | defenders rotate by `hit-belief.ts` and `commitDefenseRotation`; the lurker is not an input to their route risk and never targets a rotator |
| L7 | Lurker's info feeds belief specially | ❌ | sightings go into team intel like anyone's (comms delay 600 ms, `perception-engine/src/params.ts:104`). No "silence" evidence, no count of rotators, no `report` that moves the IGL call |
| L8 | Attack reads the lurk's absence / defence's rotation | 🟡 | `igl.ts:74` `enemySiteBias` adds heard cues with a cap; "rotating away" is not read (footstep hand-over, backlog A11) |
| L9 | Collapse timing / give-up rule | 🟡 | `slowCommitClockMs` forces the team commit; no rule for "team is losing the main fight → join", no lurk clock |
| L10 | Post-plant flank / choke watcher | ❌ | `commitPostPlantContest` (policy.ts ~l.590) holds near the spike; no lane/choke assignment for a lurker |
| L11 | Defender counter-lurk (rotate in pairs, anchor, off-angle, read sound) | 🟡 | defence reads noise for hit/show (`hit-belief.ts`) but has no "lurk" hypothesis, no pair rotation, no anti-lurk anchor |
| L12 | Role-based buy-phase setup (lurker on SMG/Ghost, saves utility, stays back) | ❌ | `decideBuy` is team-level (`match-runner/src/economy.ts:47`); buy phase scripts are role-free on main |
| L13 | Predictability / repeated-lurk penalty, opponent counter-learning | ❌ | `opponent-model.ts` learns site tendencies only; no lurk-rate tendency |
| L14 | Duel physics for a lone lurker (no trade, isolated) | ✅ | falls out of the duel model: no support → no refrag (`simulator.ts` crossfire/trade terms) |

## 8. Proposed formulas (attribute × situation, no flat bonuses)

Notation: `B` = team belief (hit-belief posterior, believed enemy positions); `t_c` = time since first team contact; `T_trade` = the trade window of PK-08 (holder TTK + re-acquire time);
`ρ(·)` = logit choice with temperature from `decisionMaking` (as in backlog A1). Inputs in *italics* are attributes; **null today** attributes (`lurking`, `mapAwareness`, `communication`) need to be sourced or generated first.

**L1 Pick the lurker.** Score `S_i = w₁·(1−aggression_i) + w₂·clutch_i + w₃·discipline_i + w₄·aim_i·(1−firstKillRate_i)`, take the top *k* (k = 1 normally, 0 when ≤ 3 alive); weights from the sources' trait list (solo duels, patience), **not** fitted to win rate. Role history from `vct.duckdb` (§6) can seed a `lurking` attribute: `lurking_i = z(−attackFKshare_i) · z(clutch_i)`.

**L5 Alone-vs-wait-vs-collapse (per decision step).** Expected value of each option from belief:
`V(hit alone) = P(win duel | n defenders on that lane, B) · value(info+kill) − P(lose) · value(player)`,
`V(wait) = information gain at the lane · (1 − p_exposed)`, `V(collapse) = Lanchester gain from a 5th gun on the objective = A²/(A²+κD²)` difference with and without the lurker.
Pick by `ρ(V)`. The lane's defender count is the belief mass `Σ_h P(enemy in lane)`; *discipline* lowers the chance of hitting early, *clutch* and *aim* raise `P(win duel)`.

**L4 Pinch trigger.** Start moving when `P(hit on site s) ≥ θ` or first team contact is heard/known; arrive at `t_pinch = t_contact + T_trade·(1 ± ε)` where `ε ~ N(0, σ_lurk)`, `σ_lurk` shrinks with *lurking* and *teamwork*. Walk (quiet) inside any believed defender's earshot radius (`movement.ts:39` `withinEarshot`), run only when quiet slack is negative. Replaces "rejoin and wait".

**L6 Rotation cutting.** Treat each defender route as a risk: `risk(route) = Σ_z P(lurker covers z) · P(lurker wins | pair or single)`; the lurker picks the lane maximising `P(rotator alone) · value(kill) + delay value`, where delay value = reduction in `P(rotate in time)` from `hit-belief.rotationCount`. The defence's `routeCost` already takes belief threat; feed it the lurker's *seen/heard* presence so a spotted lurker really delays rotations.

**L7 Lurker as information source.** Report events with delay `t_c(communication)` and noise from backlog A8, plus two new evidence types: `silence` (no cue on the lurker's lane for τ → update `P(lane empty)` by a likelihood of "they rotated" vs "anti-lurk") and `rotatorCount` (n heard runners leaving a site → feeds `hit-belief` as show-vs-hit evidence for the *other* site). The IGL's `reconsider` weighs the report by the reporter's `mapAwareness` (listening quality).

**L9 Give-up / collapse clock.** Collapse when `ΔP_win(collapse) − ΔP_win(stay) > 0` using Lanchester at current numbers, or when the clock forces: `T_remaining ≤ travel + plant + margin` (the existing execute rule), or the team lost ≥ 2 in the main fight (A²/(A²+κD²) drops below the attack-save threshold). Prior from sources: engage window ≈ 25–55 s (assumption); never "wait forever".

**L10 Post-plant.** Choose a position on the retake's least-exposed approach (reuse `retake` exposure computation from the defence side): the lurker watches the choke with highest `P(retaker passes)`. Value falls if a defender is believed to cover that choke.

**L11 Defence counter.** Add a `lurk` hypothesis to the hit-belief: evidence = single running footsteps on a far lane, a hit trap, silence. Response proportional to belief like rotations: `round(P(lurk)·available)` goes to anchor/pair-rotate; `decisionMaking` sets τ. Rotators move in pairs when `P(lurk) > θ` (cost: slower rotation by pair formation time).

**L12 Buy phase.** Role-specific purchase as part of the buy objective (backlog A5): the lurker's marginal value of a rifle is lower (fights alone, few duels) and of utility/armour higher; on an eco round the lurker keeps utility. Not a flat rule: it follows from the per-role duel-count prior (§6 FK share) in the team objective.

**L13 Predictability.** Each lurk is an observation in the opponent model (Dirichlet with decay, `opponent-model.ts`): `P(lurk | side, map)`. Defender counter weight `∝ confidence`. Same mechanism as site tendency; no new constant besides the prior pseudo-count.

## 9. Tests (counterfactuals)

1. **Pinch vs wait:** same execute, lurker arrives at `t_contact + T_trade` vs rejoins at staging. Pinch gives more defender deaths on the site and a higher plant rate; report both.
2. **Rotation cut:** defender pair rotates through the lurker's lane vs a lane the lurker doesn't cover. Rotation arrives later or loses a player; arrival time distribution shifts by more than seed noise (1,000 scripted rotations).
3. **Info:** the lurker's `silence` report on vs off → IGL swaps to the lurker's side more often when the far site is empty.
4. **Isolation cost:** a lurk that hits alone into 2 defenders loses more than into 1; the pick-vs-collapse decision (L5) reduces such hits when `discipline` is high.
5. **Defence counter:** with `P(lurk)` responding, a lurk repeated every round loses its early-round win rate over a 24-round match (predictability).
6. **Report batch (real rosters, 160 matches):** attack win rate, plant rate, attack-side FK share by role (target: lurker well below the 0.133 league average), first-kill timing, and rotation-arrival times. Don't retune combat constants to hit these.

## 10. Data we do not have

| Missing | Used for | Possible legal source |
|---|---|---|
| Lurk rate by map and side, lurker kill share, kill-time distribution, lurker trade rate | priors for L4, L5, L9, L13 | own VOD coding of public broadcasts (record timestamps and counts ourselves); GRID Open Access event/position feed if it carries positions (not confirmed, `docs/research/GRID_ACCESS.md` §4) |
| Per-player role labels | `lurking` attribute, L1 | derive from positions once available; until then the §6 FK-share proxy |
| Defender rotation timings (when a rotation starts, arrives) | L6, L11 | same as above |
| Footstep/landing radii (walk, crouch) | L6, L7 sound reading | own in-game measurement; the 50 m run radius is `verified:false` (`game-rules/src/spike.ts`) |

## 11. Who owns what

- **engine-truth** (`team-engine/src/igl.ts`, `policy.ts`, `hit-belief.ts`, `opponent-model.ts`; round-simulator for movement-style when merged): L1, L4–L11, L13 and the A12/A11 backlog items they extend.
- **match-runner economy** (A5): L12.
- **data/maps:** the lurk-lane spot data (named holding spots and lanes, MAP-1) and any positional dataset in §10.
- **UI:** show the lurk in the plan timeline and gaze/sound overlays (UI-1, UI-3, UI-5): lurker route, report events, and "pinch at contact + 4.2 s" annotation.
