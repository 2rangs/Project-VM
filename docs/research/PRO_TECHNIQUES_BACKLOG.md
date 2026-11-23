# PROJECT V — Pro-technique backlog

> Companion to [`PRO_TECHNIQUES.md`](PRO_TECHNIQUES.md) (the catalogue: what each technique is, sources,
> code evidence). This file holds only the **missing and partial** items, ranked and grouped by owner.
> Base commit audited: `a9c993a` (= `origin/claude/remaining-work-final-push-fa1459`). Written 2026-11-23.
> Docs only; no engine code was changed.

## How to read this

- **ID** matches the catalogue entry (`MS-` movement & sound, `PK-` peeks & duels, `CG-` crosshair & gaze,
  `UT-` utility, `EC-` economy, `MR-` mid-round, `DF-` defender setups, `PP-` post-plant, `CL-` clutch / comms /
  adaptation).
- **Impact** (1–5): how much the item moves realism and match outcomes. 5 = changes a judged metric or a
  known anomaly in `STATUS_AUDIT_2026-11-23.md` §E (early contact, 19.7 % flawless rounds, force-buy 0.11,
  24–0 strongest-vs-weakest, defuses too few on real rosters). 1 = cosmetic.
- **Cost**: S (≤ 1 day, one module), M (2–4 days or two modules), L (a week or more, or needs new data).
- **Rank** = impact ÷ cost, adjusted by dependencies. Order within a group is the suggested build order.
- Every mechanism must be a named formula or a decision over the team's belief. **No flat bonuses.** Each
  acceptance list ends with a counterfactual test (change one condition, check the direction **and** the
  size) plus a 160-match check on **real rosters** (`sim-batch` default since `6bfb689`). Report the batch
  numbers; don't tune constants to make them pass (HANDOFF §5 P0).
- 🔧 = already being built by another session. These are listed so the owner can check them against the
  acceptance criteria, not to be built twice.

## Summary table (all owners, ranked)

| Rank | ID | Item | Owner | Impact | Cost | Status now |
|---|---|---|---|---|---|---|
| 1 | PK-03/04/07 | Disengage and re-engage: jiggle, shoulder bait, re-peek vs reposition | engine-truth | 5 | L | missing |
| 2 | CG-01/02 | Crosshair placement → time to first shot (Fitts) | engine-truth 🔧 | 5 | M | partial |
| 3 | PP-03 | Half-defuse checkpoint, defuse taps and fakes | engine-truth | 4 | S | missing |
| 4 | PK-08 + MR-06 | Trade spacing and man-advantage tempo | engine-truth | 4 | M | partial |
| 5 | EC-01/02/03 | Per-player credits, kept weapons, drops, bonus rounds | engine-truth (match-runner) | 5 | L | partial |
| 6 | MS-04/05 | Landing sounds and masking | engine-truth 🔧 | 3 | M | missing |
| 7 | PK-09 + CG-03 | Slicing the pie, gaze and checking order | engine-truth 🔧 | 4 | M | partial |
| 8 | CL-02 | Comms quality from the `communication` attribute | engine-truth | 3 | S | partial |
| 9 | EC-04 + DF-06 | Eco stacking and anti-eco range choice | engine-truth | 4 | M | partial |
| 10 | MS-09 | Rope / zipline / teleporter sounds and fakes | engine-truth 🔧 + maps | 2 | M | missing |
| 11 | MR-01 (attack) | Attack reads the defence's noise | engine-truth | 3 | S | partial |
| 12 | MR-02 | Lurk timing (pinch at execute) | engine-truth | 3 | M | partial |
| 13 | UT-07/08 | Utility budget across phases; post-plant molly on the spike | engine-truth | 3 | M | missing |
| 14 | UT-06 | Bait utility and track the enemy's remaining utility | engine-truth | 3 | M | missing |
| 15 | DF-05 + spots | Off-angle mixing and adapting holds to opponent checks | engine-truth + maps | 3 | L | missing |
| 16 | CG-04 | Sector splitting inside the team | engine-truth | 2 | M | missing |
| 17 | PP-04/05 | Stick and ninja defuse decisions | engine-truth | 2 | S | missing |
| 18 | MR-04/05 | Default spread and contact play | engine-truth | 3 | M | partial |
| 19 | UT-01 | Pop-flash windup and turning away from a heard flash | engine-truth | 2 | S | partial |
| 20 | UT-03 | One-way smokes | maps + engine-truth | 2 | L | missing |
| 21 | DF-03 | Early info plays by belief (replace fixed aggroPush weights) | engine-truth | 2 | M | partial |
| 22 | EC-05 | Ult points into decisions; ult orbs | engine-truth + maps | 2 | M | partial |
| 23 | MS-06 | Jump-spot and jump-peek | engine-truth | 2 | M | missing |
| 24 | CL-01 | Clutch behaviour: isolate, use the clock, deny info | engine-truth | 2 | M | partial |
| 25 | CL-04 | Anti-strat at spot and timing level | engine-truth | 2 | L | partial |
| 26 | MS-10/11, MS-02 | Fake plant; reload/equip sounds; crouch | engine-truth | 1 | S | missing |
| — | UI-1…UI-6 | Showing all of the above in the match screen and review | matchday UI | — | — | missing |
| — | MAP-1…MAP-6 | Spot, lineup, drop and traversal data per map | maps | — | — | missing |

---

## A. engine-truth — `round-simulator`, `combat-engine`, `perception-engine`, `team-engine`, `ability-engine`, `match-runner` (economy)

### A1. PK-03 / PK-04 / PK-07 — Disengage and re-engage (jiggle, shoulder bait, re-peek vs reposition)
**Impact 5 · Cost L · status: missing.** A duel is fought until somebody dies or 12 s pass
(`combat-engine/src/engine.ts:75` `while (bothAlive())`), and each enemy pair fights at most once per round
(`round-simulator/src/simulator.ts:228` `engaged`, `:1094` `engaged.add`). So nobody can take a peek for
information, get out, bait a shot or come back on a different angle. This is very likely part of why first kills
come so early (p50 14.5 s) and why rounds snowball (19.7 % flawless). See the audit, §E-3/E-6.

Mechanism:
- **Exposure window.** A peek is a planned exposure of `t_exp` ms (jiggle ≈ strafe out and back; shoulder ≈
  only the body half-width shows). The holder can shoot only if `readyDelayMs(holder) < t_exp`. That is the
  existing reaction model in `combat-engine/src/skills.ts` `readyDelayMs`, with the shot's hit chance scaled
  by the visible body fraction. No new constants beyond the exposure geometry (body half-width 35 uu, strafe
  speed).
- **Disengage.** A duel may end without a kill when a fighter's line of sight ends: it steps back behind
  cover. The combat loop needs a per-fighter `exposedUntilMs`.
- **Information gained.** A jiggle that sees an enemy writes team intel (`recordIntel`) with confidence from
  the exposure (seen for `t_exp`). A jiggle that draws a shot creates a gunfire cue and reveals the shooter.
- **Re-peek vs reposition (decision).** After a disengage, both sides know roughly where the other is:
  information weight `w = 1` on that spot. Re-peeking the **same** angle hands the enemy a pre-aim, because its
  crosshair is already on the known spot (CG-01). Repositioning costs travel time. Decide by comparing expected
  duel win probability: `P(win | re-peek, enemy pre-aimed)` vs `P(win | new angle) − λ·Δt`, where `λ` is the
  value of time from the round clock (the same slack term as `quietSlackMs`). `gameSense` and `discipline`
  scale how often the better option is picked (logit choice with temperature from `decisionMaking`).
- **Operator bait (PK-04).** The holder's decision to fire at a shoulder: an Op holder who fires and misses
  pays the bolt-cycle time before the next shot (0.6 shots/s since patch 1.09 ≈ 1.67 s). Firing probability falls with `discipline`. Once the Op has
  fired, the follow-up swing gets an exposure window equal to the re-chamber time.
- Remove the "one engagement per pair per round" rule. Keep a per-pair cooldown equal to the time to re-acquire
  (reaction + Fitts aim time), so a pair can't fight twice in the same tick.

Acceptance:
- [ ] Counterfactual, same seeded scene (Ascent A main vs one A-site holder): jiggle-then-swing vs a straight
      dry swing. The jiggle arm has the attacker win more and the holder pre-aimed less, and the gap
      **shrinks** as the holder's `reaction` rises. Report both numbers.
- [ ] Counterfactual: after a disengage, re-peek the same angle vs move to the second entry. The same angle
      loses more often when the enemy's `trading`/info half-life is long.
- [ ] An Op holder with `discipline` 0.9 fires at shoulder peeks less often than one with 0.3 (≥ 2×), measured
      over ≥ 500 scripted peeks.
- [ ] 160 matches, real rosters: first-kill p50 moves **later** than 14.5 s, flawless rounds fall below
      19.7 %, and the trade rate (sim-batch `man_advantage.trade`) is reported. No judged metric is lost by more
      than its CI. If one is, report it and its cause; don't retune `stopMs` or the peeker constant to hide it.
- [ ] `RoundRecord` carries `disengage` and `rePeek` events (for UI-2).

### A2. CG-01 / CG-02 — Crosshair placement sets time to first shot 🔧 (engine-truth gaze work)
**Impact 5 · Cost M · status: partial.** `crosshairPlacement` changes only the head-shot probability
(`combat-engine/src/skills.ts` `headshotChance`). Pre-aim is a yes/no flag: you saw first, you're standing,
you're not in a crossfire (`simulator.ts:1246`). Pre-aim reaction is a fixed 30 ms (`params.ts` `preAimMs`).

Mechanism (Fitts's law):
`aim time = a + b · log2(1 + D / W)`
- `D` = the angle between where the player's crosshair is and where the enemy appears. It comes from gaze
  (CG-03): which point of the exposed edge the player is watching, and at what height.
- `W` = the angular width of the head at that range.
- `crosshairPlacement` shrinks the expected `D`: a well-placed crosshair sits on the edge at head height, so
  `D` is the residual error `σ_D · (1 − crosshairPlacement)`. `reaction` stays the perception term.
- Pre-aim stops being a flag. It becomes `D ≈ 0` because you placed on the spot the enemy came from.
- `a`, `b`: take from the published Fitts / aim-trainer literature and record them as `manual-approx` with
  the source. Don't fit them to win rates.

Acceptance:
- [ ] Unit: with `D = 0` the aim time equals `a`. Doubling `D/W` adds ≈ `b` per bit.
- [ ] Counterfactual: two equal players. One watches the edge where the enemy appears, the other watches
      30° off it. The first fires first in ≥ 80 % of 1,000 seeded duels, and the gap grows with range (smaller W).
- [ ] Counterfactual: raising `crosshairPlacement` from 0.4 to 0.8 changes first-shot time and **duel win rate**,
      not only head-shot share.
- [ ] Real-roster 160 matches: report attack win rate before and after. The audit's open hypothesis is that
      better aim stats favour the holder (§E-2). This item should show whether that's true.
- [ ] Split `peekerAdvantageMs` (180 ms, `types.ts:458`, a calibrated aggregate) into the netcode term from
      Riot's own breakdown (≈ 71–101 ms at 35 ms ping; LAN at 144+ fps is lower) and what the aim model now
      produces. Accept only if the judged metrics hold without re-inflating the constant (catalogue PK-01).
- [ ] Re-check `stopMs` (700/350 ms, which stands in for aim settling): with aim time explicit it should move
      toward the physical ≈ 160 ms full stop (catalogue MS-07). Report the batch either way.

### A3. PP-03 — Half-defuse checkpoint, taps and fake defuses
**Impact 4 · Cost S · status: missing.** The rule exists in data: `game-rules/src/spike.ts:15,30`
`defuseHalfwayMs`, the checkpoint at half the defuse. The simulator resets progress to 0 on any interruption
(`simulator.ts:1332`, `:1344`). Defenders never "tap" the spike to bait a peek.

Mechanism:
- **Rule.** Progress at or after the 3.5 s checkpoint (half of 7 s) is kept when the defuser lets go
  (Mobalytics spike guide; matches `defuseHalfwayMs`. Mark it verified once checked in-game).
- **Decision — tap.** A defuser who believes attackers are holding the spike from cover starts a defuse to
  force a reaction. The defuse sound is a cue (`hearing.ts` `spikeDefuse`). The attackers' best response is to
  peek, which hands the defuser's teammates a pre-aim on the peeker (CG-01). Tap if
  `P(attacker peeks | tap) · ΔP(win | they peek into us)` exceeds the clock cost of the tap.
- **Decision — attackers' answer.** Peek on the defuse sound, or wait for the second sound past the
  checkpoint. The posterior over "real defuse vs tap" uses the same Bayes form as `hit-belief.ts`: the
  likelihood of a tap rises with defenders alive and with the clock left.

Acceptance:
- [ ] Rule test: defuse to 3.6 s, leave, return; it finishes 3.4 s later. Defuse to 3.4 s, leave; it starts from 0.
- [ ] Counterfactual: post-plant 2v2, attackers hidden off-site. With taps allowed, attackers peek earlier, and
      the defence's retake win rate rises. Report the size of the change.
- [ ] 160 matches real rosters: defuse share (judged, VCT 0.160) is reported. Real-roster runs currently sit
      below it (HANDOFF §3: 0.136).

### A4. PK-08 + MR-06 — Trade spacing and man-advantage tempo
**Impact 4 · Cost M · status: partial.** The support follows the entry to the same zone 1.2 s × `tighten`
behind (`team-engine/src/teamwork.ts:12,35`). A same-line teammate counts as 0.2 of a gun
(`simulator.ts:70`). No tempo change after a man advantage: the Lanchester formula (`policy.ts:253`) is used
only for save and retake.

Mechanism:
- **Trade window.** `T_trade = holder's time to kill the entry + holder's re-acquire time` (reaction + Fitts
  re-aim onto the next target, A2). The second player sets its distance `d` behind the entry so that
  `d / v ≤ T_trade` (close enough to refrag). It also needs `d ≥ spray-transfer distance`: far enough that one
  spray doesn't take both, which means at least one body width off the entry's line. `trading` sets how
  accurately the player keeps that spacing (σ of the error).
- **Man-advantage tempo.** After a kill, re-run the team's choice between taking duels and playing slow with
  the Lanchester win chance at the new numbers. The attack is up when `P_slow = A²/(A²+κD²)` already beats the
  value of an early duel. It then takes space without contact (quiet intent, utility first), and duels only when
  its own pre-aim edge holds. A defence that's down a player gives up contested angles for a retake (DF-02).
  `discipline` and `aggression` enter as the throw hazard does (`policy.ts:265`).

Acceptance:
- [ ] Counterfactual: support at `d` inside vs outside the trade window. The trade rate differs, in the
      expected direction, by more than the seed noise of 1,000 scripted entries.
- [ ] Counterfactual: 5v4 after an opening kill. The attack's second contact comes later than in a 5v5 with
      the same plan.
- [ ] 160 matches real rosters: report `man_advantage` 5v4 (sim 0.765) and the trade rate (0.503). Don't tune
      either to a target.

### A5. EC-01 / EC-02 / EC-03 — Per-player credits, kept weapons, drops, bonus rounds
**Impact 5 · Cost L · status: partial.** Buying is decided per team from one bank (`match-runner/src/economy.ts:47`
`decideBuy`: full / force / eco). Weapons are not carried between rounds (STAT_OUTCOME_MATRIX §3.6). There's
no drop and no bonus round. The force-buy attack win rate is 0.110 against a real-world semi-vs-full rate of
about 0.32 (audit §E-3). Saves are modelled as behaviour only.

Mechanism:
- Per-player credits and inventory, carried over when the player survives (official rules: kill/plant/loss-bonus
  values are already in `game-rules`/`economy-engine`).
- **Buy as an optimisation.** Choose the team's loadouts to maximise
  `P(win this round) + γ · E[P(win next rounds) | credits after]`. The existing `economy-engine` value evaluator
  is unused (audit §F) and can supply the value term. `γ` comes from the scoreline, not a flat number.
- **Drops.** A rich player buys for a poor one when the marginal value of the second rifle beats that of the
  rich player's armour or utility (the same objective).
- **Bonus round.** Winners of a pistol keep their weapons, and the objective above decides whether to buy on top.
- **Picking up weapons.** A survivor picks up an enemy's weapon when its value is higher than what it holds
  (needs a weapon-on-floor entity; spike pickup already exists at `simulator.ts:474`).

Acceptance:
- [ ] Unit: survivors keep their weapon into the next round. Loss bonus follows the rule table.
- [ ] Counterfactual: same match state with and without a drop from the richest player. Rifle count rises and
      the round win probability is reported.
- [ ] 160 matches real rosters: report eco / half / force / bonus win rates against the VCT baselines in
      `VALIDATION_BASELINES.md`. The force-buy anomaly (0.110) moves toward the real range, or the cause
      is explained.

### A6. MS-04 / MS-05 — Landing sounds and sound masking 🔧 (engine-truth drop work)
**Impact 3 · Cost M · status: missing on `a9c993a`.** Drop edges are walked (`round-simulator/src/mover.ts:432`
one-way segments; `spatial-engine/src/navigation.ts:10` `NavEdgeKind`). Footsteps are the only movement sound
(`perception-engine/src/hearing.ts` `collectSoundSources`). There's no landing event and no masking.

Mechanism:
- **Landing.** Traversing a `drop` edge emits a `landing` sound at the bottom. Its audible radius comes from the
  fall height (data: per-edge height from the nav graph). Walking doesn't silence a landing from a height above
  the threshold. Confirm the threshold in-game; record it as `manual-approx` until then.
- **Masking.** Model detection with signal detection theory. A cue is detected with probability
  `Φ(d′ − c)`, where `d′ = (L_signal − L_mask) / σ` at the listener. The masker is any louder sound at the
  listener within the same window: gunfire, abilities, the spike. Distances use the same 3D rule as footsteps;
  levels follow inverse-square falloff in dB.
- **Decision.** A dropper waits for cover noise (a teammate's shots, utility) when
  `P(heard alone) − P(heard masked)` times the cost of being heard beats the wait. `teamwork` lets a teammate
  provide cover fire on call.

Acceptance:
- [ ] Unit: a drop with no other sound is heard inside its radius. The same drop in the same tick as a nearby
      Vandal burst is detected less often (report the probabilities).
- [ ] Counterfactual: the B-main drop on a map that has one, with and without cover fire. The defence's
      hit-belief for that site differs, in the expected direction.
- [ ] The landing cue reaches `PolicyView.observation.audibleEvents` with kind `landing`, and the team policy's
      `gatherEvidence` counts it.

### A7. PK-09 + CG-03 — Slicing the pie, gaze and checking order 🔧 (engine-truth gaze work)
**Impact 4 · Cost M · status: partial.** Facing exists (`simulator.ts:957–977` hold/aim zone; `mover.ts:713`
`facingFor` faces the next zone's centre). The field of view is ±55° (`perception-engine/src/params.ts:78`).
Sight between positions is real on Ascent (`perception-engine/src/vision.ts:53`). Peeks are resolved with a
fixed 300 uu corner distance (`simulator.ts:73`). There is no turn rate, no ordered check and no angle-by-angle
clearing.

Mechanism:
- **Slice.** Approaching a corner, the mover advances along an arc that exposes one candidate holder spot at a
  time. Each slice is a separate first-contact with `n = 0` extra guns in the Hick–Hyman term
  (`situational.ts:27`) and a small `D` (A2), because the clearer watches exactly the newly exposed sliver.
  Cost: time, from arc length divided by walk speed.
- **Checking order.** The clearer sorts candidate spots by threat
  `P(enemy there | belief) × P(they see me first)` and checks the highest first. `mapAwareness` (currently
  null for all players, audit §F) sets how close that order is to the belief-optimal one.
- **Turn rate.** Gaze changes at a bounded angular speed (from the `movement`/`reaction` skills), so you can't
  watch two edges at once. That gives the Hick–Hyman `n` a physical meaning.

Acceptance:
- [ ] Counterfactual: clearing a two-spot site entrance by slicing vs a straight run-in. Slicing wins more
      duels and takes longer. Report both.
- [ ] Counterfactual: with the threat order reversed (`mapAwareness` 0.2 vs 0.9), the clearer meets the
      likelier spot later and loses more.
- [ ] Real-roster 160 matches: arrival-gap distribution (audit §D-2, now capped at exactly 3.0 s) and
      first-kill time are reported.

### A8. CL-02 — Communication quality from the `communication` attribute
**Impact 3 · Cost S · status: partial.** Comms are a fixed 600 ms delay for everyone
(`perception-engine/src/params.ts:104`; `communication.ts`), with exact positions. `communication` is null for
every player and not read (audit §F).

Mechanism: per-player delay `t_c ~ LogNormal(μ(communication), σ)`. The called position is the true one plus
Gaussian noise `σ_pos(communication)`. The called enemy count is right with probability `p(communication)`.
Dead players' last calls are kept (already supported). Low comms raise the information error that the
Bayesian readers (`hit-belief.ts`, `infoWeight`) already handle. No new duel constant.

Acceptance:
- [ ] Unit: delay and noise follow the attribute monotonically.
- [ ] Counterfactual: same match, team A comms 0.9 vs 0.3. Refrag rate and rotation timing differ in the
      expected direction.
- [ ] The attribute is filled from a source or generated, and shown in the UI (data side: HANDOFF §5 P1 item 8).

### A9. EC-04 + DF-06 — Eco stacking and anti-eco range choice
**Impact 4 · Cost M · status: partial.** On an eco the attack plays `default` (`team-engine/src/igl.ts:166`),
which is the opposite of the usual pro answer: stack one site or rush close range. Defenders don't adjust to
the enemy's buy.

Mechanism:
- **Range choice.** From the combat model, compute `P(win duel | own weapon, enemy weapon, distance)` (the
  `combat-engine/src/montecarlo.ts` harness can tabulate it). A team picks routes and holds that put expected
  contacts where that curve favours it. Ecos with SMGs and shotguns go short and stacked. Rifles against an
  eco play long and back off close corners.
- **Enemy buy belief.** The enemy's buy is inferred from the score, the loss streak and the last round's
  survivors (all public). The prior is the economy rules. Agent-selection data isn't needed.

Acceptance:
- [ ] Counterfactual: same defence on a full buy vs an attack on an eco. With range choice, the defence's
      average contact distance rises and its eco-round win rate rises. Report both.
- [ ] 160 matches real rosters: eco-round attack win rate against the VCT baseline.

### A10. MS-09 — Rope / zipline / teleporter sounds and fakes 🔧 (engine-truth) + maps data
**Impact 2 · Cost M · status: missing.** Traversal exists (`mover.ts:647–651`: a teleporter holds then moves;
a zipline/rope carries). No sound is emitted, so no fake is possible.

Mechanism: traversal emits a sound at the entry and at the exit, at the radius the map data gives (MAP-4). A
fake is a planned emission with no follow-through, chosen by the same rule as the fake show (`FEINT_SHOW_SIZE`,
`policy.ts:79`). The defence reads it through `hit-belief.ts`: a teleporter sound adds evidence to the
**exit**-side site under both `hit` and `show`, with likelihoods set by the opponent model's fake rate.

Acceptance:
- [ ] Unit: a Bind teleporter traversal emits two cues, at both ends, in the same tick window.
- [ ] Counterfactual: a fake teleporter cue vs none. The defence's P(hit) at the exit site rises, and falls
      back once no follow-up evidence arrives (the existing 5 s release rule).

### A11. MR-01 — The attack reads the defence's noise
**Impact 3 · Cost S · status: partial.** Defence rotations are Bayesian (`team-engine/src/hit-belief.ts`,
`policy.ts:1234` `decideDefenseRotation`). The attack's site read uses heard cues only as a weight in
`enemySiteBias` (`igl.ts:74`), and running rotators don't tell it which site emptied (footstep hand-over note,
"not done").

Mechanism: mirror `hit-belief.ts` for the attack. Hypotheses per site: `held(n)`, `rotating-away`,
`stacked`. Likelihoods come from heard rotations (runners leaving a site's area), the defence's observed setup
tendency (`opponent-model.ts`) and the clock. A slow plan (`commitSlowPlan`, `policy.ts:700`) commits to the
site with the lowest expected defenders.

Acceptance:
- [ ] Counterfactual: a slow-play attack hears 2 runners leaving A toward B, vs nothing. It commits to A
      more often (report the rate).
- [ ] 160 matches real rosters: site choice still near 50/50 overall. Report the per-site attack win rates
      (now A 0.483 / B 0.559 on mirrors).

### A12. MR-02 — Lurk timing (pinch at execute)
**Impact 3 · Cost M · status: partial.** A lurker is assigned (lowest `aggression`, policy §3.5). It holds the
far side and rejoins when the site is chosen. The audit found no independent lurk paths (§E-5).

Mechanism: the lurker times its flank to arrive within the defence's trade window of the execute's first
contact: `t_arrive = t_execute_contact + T_trade` (A4), using the planned path times. It stays quiet (walk)
inside any defender's audible radius (`movement.ts:39` `withinEarshot`). If the execute is called off, it
becomes an information post. The null attribute `lurking` scales the timing error σ.

Acceptance:
- [ ] Counterfactual: execute with a timed lurk vs the lurker rejoining. Rotators get caught from behind more
      often (report kills on rotators).
- [ ] Audit metric: share of rounds with ≥ 3 occupied zones at 30 s is > 0 (now 0).

### A13. UT-07 / UT-08 — Utility budget across phases; post-plant molly on the spike
**Impact 3 · Cost M · status: missing.** `team-engine/src/utility.ts` casts whenever a purpose fires (stall,
cover, blind, scout); there's no plan to keep utility for later. A fire patch already interrupts a plant or
defuse (CTI §8.3), but nobody aims one at the spike at defuse time.

Mechanism:
- **Option value.** Cast now only if `V_now > P(later phase happens) · V_later`. `V` is the purpose's effect
  on win probability, priced with the same time/exposure terms the purposes already use. A post-plant molly's
  `V_later` = P(defuse is stopped) × P(round won | defuse stopped).
- **Post-plant molly.** On a defuse-start cue (heard or seen), the attacker with a fire/slow ability and a
  throw to the spike zone casts it. Lineup data (MAP-2) says from where it can be thrown without being seen.

Acceptance:
- [ ] Counterfactual: a post-plant with one molly kept vs spent pre-plant. Defuse completion drops when kept.
- [ ] Abilities-on 160 matches real rosters: report detonation and defuse shares. Abilities-on currently
      overshoots attack (0.695 on mirrors); report, don't retune.

### A14. UT-06 — Bait utility and track the enemy's remaining utility
**Impact 3 · Cost M · status: missing.** Nothing counts the enemy's utility spent, and no plan draws it out.

Mechanism: keep a belief over each enemy agent's remaining charges. The prior is the round's loadout (public
by agent). Each observed cast decrements it (cast cues are already observed, `AbilityCue`). The execute value
rises when the expected stall utility on the target site is low. Fakes (MR-03) are worth more when they draw
casts, which adds a term to the fake's choice.

Acceptance:
- [ ] Unit: belief decrements on observed casts, never below 0.
- [ ] Counterfactual: the defence has spent 2 stall abilities on a fake. The execute commits to the other site
      more often, and its entry delay through fire is lower.

### A15. DF-05 — Off-angle mixing and adapting holds 🤝 maps
**Impact 3 · Cost L · status: missing.** The opponent model learns site tendencies only
(`team-engine/src/opponent-model.ts`). Holders use one aim per anchor zone (`DEFENSE_AIM`, `policy.ts:111`).

Mechanism: treat a holder's spot as a mixed strategy over the named spots (MAP-1). Update the weights by
fictitious play: lower the weight of a spot each time the attackers pre-aim or utility it (observed), and raise
it for spots they didn't check. The attacker's check order (A7) uses the same spot list with its own counts.
`positioning`/`anchoring` (null today) scale how much a holder deviates from the default spot.

Acceptance:
- [ ] Counterfactual over a 24-round match: attackers who always clear spot X first make the defence's use of
      X fall (report the curve).
- [ ] Defender death rate on its first contact falls in later rounds vs the same scripted attack.

### A16. CG-04 — Sector splitting inside the team
**Impact 2 · Cost M · status: missing.** Each player's facing is set alone (`simulator.ts:957`).

Mechanism: when two or more teammates enter or hold together, assign each candidate angle to one player by
minimising the largest uncovered threat mass (a small set-cover problem over A7's threat-ranked spots). A
player checks only its sector, which keeps its `D` small (A2). Uncovered angles keep the surprise term.
`teamwork` sets how often the split holds.

Acceptance:
- [ ] Counterfactual: a 2-man entry with split sectors vs both watching the same edge. Fewer deaths to the
      second angle (report).

### A17. PP-04 / PP-05 — Stick and ninja defuse
**Impact 2 · Cost S (after A3) · status: missing.** The defuser starts only after the group retake
(`retakeGo`, `policy.ts:1563`).

Mechanism:
- **Stick.** Keep defusing under fire if `P(finish before death) > P(win after stopping)`. `P(finish)` uses the
  attackers' expected time to kill the defuser (combat model) against the time left on the defuse; checkpoint
  rules come from A3.
- **Ninja.** Start a defuse with no retake if the team believes no attacker sees the spike (belief from
  sightings and sound) and the walk there is silent (`withinEarshot`).

Acceptance:
- [ ] Counterfactual: 1v1 post-plant, attacker far from the spike and facing away vs close and watching. Ninja
      attempts happen only in the first case.

### A18. MR-04 / MR-05 — Default spread and contact play
**Impact 3 · Cost M · status: partial.** The slow plan holds lanes (`commitSlowPlan`, `policy.ts:700`;
`slowLane` `:766`), but the audit found at most 2 occupied zones at 30 s and only 23 distinct attacker routes
(§E-5).

Mechanism:
- **Default.** Spread to the set of lanes that maximises information coverage (each lane's probability of
  catching a rotation, from the belief) under a risk limit, so no lane is held where `P(lose duel)` exceeds the
  value of its information.
- **Contact.** Walk (quiet intent) until first contact or a heard cue, then switch the whole team to fast and
  utility. That's one trigger in `paceFor`, not a new strategy.

Acceptance:
- [ ] Audit metrics: distinct attacker routes and zones occupied at 30 s rise. Report both. First-kill
      timing distribution.

### A19. UT-01 — Pop-flash windup; turning away from a heard flash
**Impact 2 · Cost S · status: partial.** Flashes blind only those facing (CTI §8.2) and are timed to the
teammate's arrival (`utility.ts:93`). Defenders don't react to a heard flash (ability-realism hand-over). Windup
isn't tied to the agent's real throw.

Mechanism: the blind applies at `t_cast + windup`. A defender who hears the cast cue turns away when the
reaction from cue to turn (reaction + turn rate, A7) is less than the windup. A pop-flash has a short windup,
so it can't be dodged. Blind duration is scaled by how far the flash is from the centre of view (official
behaviour; verify per agent).

Acceptance:
- [ ] Counterfactual: same flash with a 0.3 s vs a 1.0 s windup. The defender is blinded far less often with
      the long one.

### A20. DF-03 — Early info plays by belief
**Impact 2 · Cost M · status: partial.** `aggroPush` has a fixed weight of 1 in 3 against `defaultHold`
(`igl.ts:151`, STAT §7) and its players scatter at random.

Mechanism: choose to push for information when `value(info) − P(die) · value(player)` > 0. Value of info =
the expected gain in the rotation decision (the change in P(correct rotation) under `hit-belief`), and
`P(die)` comes from expected contacts at that time on that lane (attackers' arrival distribution from the
opponent model).

Acceptance:
- [ ] The push rate depends on the opponent's measured early tempo (report the curve over a series).

### A21. EC-05 — Ult points into decisions; ult orbs (with maps for orb positions)
**Impact 2 · Cost M · status: partial.** Ult points are counted (`economy.ts:92`) for kills and plants only;
the rule is +1 per kill, own death, plant, defuse and orb (Siege.gg). No decision reads them. There are no orbs.

Mechanism: ultimates enter the buy/plan objective (A5) as utility with a known effect. Orbs are a contested
pickup: take one if the expected exposure cost is lower than the value of the ult point.

### A22. MS-06 — Jump-spot and jump-peek
**Impact 2 · Cost M · status: missing.** Mechanism: an exposure window equal to the airtime at a known spot
(MAP-3), using A1's exposure model. Information is gained over that window, and the holder's chance of a shot
comes from `readyDelayMs` against the airtime. Moving in the air means full moving inaccuracy for the jumper,
which is official behaviour.

### A23. CL-01 — Clutch behaviour
**Impact 2 · Cost M · status: partial.** The clutch trait shifts reaction by `(0.6 − clutch) · 250 ms`
(`situational.ts` `clutchReactionMs`, STAT §2.3). There's no clutch behaviour.

Mechanism: the last player alive ranks options by isolation. It prefers paths where expected contacts arrive
one at a time (`n = 0` in Hick–Hyman), uses the clock (defuse fake, plant timing), and denies information
(walks, holds still). `clutch` scales the quality of the choice through the same logit choice as A1.

### A24. CL-04 — Anti-strat at spot and timing level
**Impact 2 · Cost L · status: partial.** Site tendencies are Dirichlet with decay plus scouting priors
(`opponent-model.ts`; STAT §5.1). Opponent memory had no measurable effect in the audit's ablation (§F).

Mechanism: extend the categorical tendencies to (a) first-contact time bins per lane, (b) utility per site,
(c) spot use (A15). Counter-strategies are then the best response to the posterior. Timeouts (`session.ts`)
can reset the decay weight.

Acceptance:
- [ ] Ablation: memory on vs off over 24-round matches between scripted-habit teams. A measurable win-rate
      difference, unlike the audit's null.

### A25. Small items — MS-10 fake plant, MS-11 reload/equip sounds, MS-02 crouch
**Impact 1 · Cost S each.**
- Fake plant: a plant start is already a sound (`hearing.ts` `spikePlant`). Allow a cancelled plant as a
  planned emission, read by the defence through the same Bayes as taps (A3).
- Reload sounds: `LOUDNESS.reload` exists but nothing emits it (`hearing.ts` `eventSound` has no reload case).
- Crouch: a third move mode with its own speed (official), smaller head height (changes `W` in A2) and better
  spray accuracy.

---

## B. maps — spatial data (`datasets/spatial/**`, `packages/spatial-engine/**`, `tools/map-*`)

These are data for the mechanisms above. They follow the maps session's existing provenance fields
(`*.provenance`, `dataQuality`).

| ID | Data | Needed by | Acceptance |
|---|---|---|---|
| MAP-1 | **Named holding spots** per site, including off-angles: position, the edges each one sees, and the cover it has (half-body / full) | A2, A7, A15, A16; also gives `behindCover` a value (now fixed 0, `simulator.ts:1273`) | ≥ 6 spots per site on Ascent with provenance. Every spot is on the nav floor and sees its listed edges by `nav.sees` |
| MAP-2 | **Lineup throw points**: from-position → landing for molly/recon/smoke on each site's default plants and key chokes, by ability family | A13, UT-04, UT-08 | Ascent first. Each lineup has a source note. The landing point is plantable or a choke zone. The throw position is not visible from the landing site |
| MAP-3 | **Drop edges with fall height; jump spots** | A6, A22 | Every `drop` edge has a height. Jump spots carry the airtime and what they see |
| MAP-4 | **Traversal sound radii** for teleporters, ropes and ziplines (entry and exit) | A10 | Values recorded with `verified:false` until measured in-game |
| MAP-5 | **Default plant spots** (default / safe / open) per site, as points | A3, A13, A17 | Points inside `isPointPlantable`. Also lets plants stop being zone-level (audit §D-3) |
| MAP-6 | **One-way smoke spots** (smoke centre, the side that sees out) | UT-03 | Only after smokes are positional (HANDOFF §5 P1 item 5). Until then this is a list with no engine use |

Per-map tactics with object links are already the maps session's work. MAP-1 and MAP-5 should join that
schema rather than start a new file.

---

## C. matchday UI — showing it (`apps/desktop` match screen and review)

The point: a manager has to **see** these techniques to value the attributes behind them.

| ID | Display | Depends on | Acceptance |
|---|---|---|---|
| UI-1 | **Gaze cones** on the tactical map (each player's facing and FOV, from the sim, not the zone overlay) | A2, A7 | The cone matches `SimPlayer.facing` per frame. It uses the sim's positional sight, not `renderer/matchday/visibility.ts:47` zone sightlines (audit §D-3 mismatch) |
| UI-2 | **Duel cards** in review: who saw first, pre-aim D, crossfire guns, angle term, jiggle/re-peek | A1, A2 | Every term is read from `engagementTrace` (`simulator.ts:1166–1170` already records several) |
| UI-3 | **Sound rings**: footsteps, landings, traversals, defuse taps, masked / unmasked | A6, A10, A3 | The ring radius equals the sim rule. Masked cues are drawn differently |
| UI-4 | **Comms feed**: called positions with their noise and delay | A8 | Each call shows its delay. Wrong calls are visible in review |
| UI-5 | **Plan timeline**: fake, lurk timing, man-advantage tempo switch, utility kept for later | A4, A12, A13 | Reasons come from the plan revisions the policy already writes |
| UI-6 | **Economy panel**: per-player credits, drops, kept weapons | A5 | Matches the round record. Drops are attributed giver → receiver |

---

## D. Data we don't have, and where it could legally come from

| Data | Used for | Possible sources | Notes |
|---|---|---|---|
| Exact sound radii (run, landing, teleporter, rope, defuse) | MS-03/04/09, PP-03 | Riot patch notes and dev blogs (where they state ranges); **own measurement in a custom game** (two accounts, measure distances on the in-game map) | Self-measured facts are ours to use. Record `verified:true` only after measurement. The 50 m footstep value is `verified:false` (`game-rules/src/spike.ts`) |
| Pro positions over time (10 players, per tick) | Calibrating A1, A4, A7, A15, A18 | **Riot Open Access via GRID** (free, non-commercial, delayed; positions not confirmed in the public description, `GRID_ACCESS.md` §4); commercial GRID licence; `.vrf` replays the user captures (`vrf-capture-guide.md`) | Application is the user's decision (`GRID_ACCESS.md`). Third-party stat sites' ToS usually forbid scraping |
| Event timings: first contact, plant time, trade delay, retake success | Batch metrics in HANDOFF §5 P0 item 2 | GRID Open Access event feeds; rib.gg / vlr.gg summaries **as reference only** (check ToS before storing); own VOD coding of public broadcasts (facts we observe and record ourselves) | VOD coding: record only our own measurements (timestamps, counts), never copy commentary or images |
| Named spots, lineups, one-ways | MAP-1/2/6 | Own measurement in custom games; community guides as **pointers** only (they're compilations with their own copyright; re-derive positions ourselves) | Keep provenance per spot (`provenance` field) |
| Ability windups, flash durations, smoke durations | UT-01, UT-02 | Riot patch notes and agent pages; `valorant-api.com` catalog (licence unconfirmed, `LICENSE_AUDIT.md`) | Many values in `CONTINUOUS_TACTICAL_INTELLIGENCE.md` §8.7 are still `manual-approx` |
| Player attributes not in any public rating (`communication`, `positioning`, `lurking`, `anchoring`, `mapAwareness`, `utilityUsage`) | A8, A12, A15, A7, A13 | Derive from event data where possible (e.g. lurking from position data; utility usage from GRID ability events). Otherwise generated, as for regens | Audit §F: all null today. Either source them or hide them in the UI |

---

## E. Suggested order for engine-truth

1. **A3** (checkpoint/taps): small, rule-level, aimed at the real-roster defuse shortfall.
2. **A2 + A7** 🔧 (gaze, Fitts, slicing): already in progress. Make sure they meet the acceptance lists here.
3. **A1** (disengage/re-engage): the largest realism gap. Build it on top of A2's aim-time model.
4. **A4** (trade spacing, man-advantage tempo): needs A2's re-acquire time.
5. **A8** (comms) and **A11** (attack reads noise): small, use what already exists.
6. **A5** (per-player economy): large, but fixes the eco/force anomalies. It also unlocks A9.
7. The rest by rank, after each step's real-roster 160-match report.

Constraints that apply to all of them: one heavy run at a time (`heavy-run.sh`), report on real rosters,
abilities-off and abilities-on both, and don't edit another session's in-flight files.
