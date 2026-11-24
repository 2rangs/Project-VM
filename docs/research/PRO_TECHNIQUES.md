# PROJECT V — Pro-level techniques catalogue

> **What this is.** The high-tier details of tactical-shooter play (VALORANT first, CS where the mechanic
> carries over). For each one: what it is, what it physically or informationally changes, which attributes
> govern it, what engine mechanism it needs (a named formula or a belief-based decision, never a flat bonus),
> where the engine stands today with code evidence, and how to test it.
> The ranked work list is in [`PRO_TECHNIQUES_BACKLOG.md`](PRO_TECHNIQUES_BACKLOG.md).
>
> **Basis.** Code audited at `a9c993a` (= `origin/claude/remaining-work-final-push-fa1459`), 2026-11-23.
> Sources: public guides, Riot patch notes and dev blogs, analyst write-ups (links per entry, paraphrased).
> Numbers marked *unconfirmed* came from secondary sources only. Verify them before they become engine facts,
> and record them as `manual-approx` / `verified:false` until then, as `game-rules` does.
>
> **요약 (한국어).** 프로 수준 디테일 68개를 9개 영역으로 정리했다. 엔진에 **구현** 11 · **부분** 32 ·
> **없음** 25. 결과에 가장 큰 영향이 있을 빈칸: (1) 교전이 한 번 붙으면 끝까지 싸우고 같은 쌍은 라운드에
> 한 번만 싸운다 — 지글·숄더 미끼·재피크/재배치가 불가능, (2) `crosshairPlacement`가 헤드샷 확률만 바꾸고
> 첫 발까지의 시간은 바꾸지 않는다, (3) 해체 절반 체크포인트(3.5초)가 규칙 데이터에만 있고 시뮬레이터는
> 0으로 되돌린다 — 탭·페이크 해체 불가, (4) 팀 단위 경제 — 개인 크레딧·무기 유지·드롭·보너스 라운드 없음.
> 이미 다른 세션이 만드는 것: 시선/크로스헤어 배치·파이 자르기·낙하 소리와 마스킹·로프/텔레포터 소리
> (engine-truth), 맵별 전술과 오브젝트 연결(maps).

## Status legend

| Mark | Meaning |
|---|---|
| ✅ implemented | The mechanism exists, is wired into matches, and moves outcomes |
| 🟡 partial | Something exists but is zone-level, a fixed value, missing the decision side, or off by default |
| ❌ missing | Nothing in the engine |
| 🔧 being built | Assigned to another session right now: **engine-truth** (gaze/crosshair placement, slicing the pie, drop/landing sound with masking, rope/teleporter fakes) or **maps** (per-map tactics with object links). Status shown is what's on `a9c993a` |

Global conditions that affect every status below:
- **Abilities are off by default** (`match-runner/src/match.ts` `enableAbilities ?? false`; the desktop app
  doesn't pass it). Every utility technique is therefore off in normal matches.
- **Positional sight on Ascent only.** Other maps fall back to zone sightlines. Smoke, plant and flash LOS are
  zone-level (status audit §D-3).
- **Attributes that are null for every player and never read:** positioning, utilityUsage, mapAwareness,
  rotations, communication, teamworkDiscipline, lurking, anchoring, weaponPreference, agentMastery
  (status audit §F). Several techniques below are their natural home.

Attributes the engine **does** read today:
- mechanical skills (combat-engine): `aim`, `reaction`, `tracking`, `firstBulletAccuracy`,
  `crosshairPlacement`, `movement`
- tactical traits (round-simulator `TacticalTraits`, `types.ts:38`): `gameSense`, `trading`, `clutch`
- profile (`shared-types/src/decision-policy.ts:160`): `aggression`, `discipline`, `decisionMaking`,
  `teamwork`

## Mechanical reference numbers (researched)

| Fact | Value | Source | Engine today |
|---|---|---|---|
| Server tick | 128 Hz | [Riot Tech Blog: 128-tick servers](https://technology.riotgames.com/node/112) | 100 ms sim tick, 500 ms decisions |
| Peeker's advantage (netcode) | ≈ 141 ms → ≈ 101 ms (60 fps, 35 ms ping) → ≈ 71 ms (144 fps) in Riot's worked example; duels "often" decided by 20–50 ms | [Riot: Peeking into VALORANT's netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode) | 180 ms flat, calibrated aggregate (`round-simulator/src/types.ts:458`) |
| Movement inaccuracy threshold | 27.5 % of max speed since patch 3.0 (was 30 %) | [Patch notes 3.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/) | Moving/stopped two-state (`combat-engine/src/skills.ts` `movingAt`) |
| Time to stop | ≈ 0.10 s to deadzone, ≈ 0.16 s to full stop; counter-strafe saves ≈ 10 ms (*unconfirmed*, attributed to a Riot dev) | [TurboSmurfs summary](https://turbosmurfs.gg/?p=7691) | `stopMs` 700 ms run / 350 ms walk, which deliberately includes aim settling (`combat-engine/src/params.ts`) |
| Operator | fire rate 0.6/s, equip 0.5 s, scoped speed 72 %, deadzone 15 % (patch 1.09) | [Patch notes 1.09](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-09) | No Operator-specific behaviour |
| Plant / spike timer / defuse | 4 s / 45 s / 7 s with a checkpoint at 3.5 s; no defuse kit | [Mobalytics spike guide](https://mobalytics.gg/blog/valorant/valorant-spike-guide/) | 4 / 45 / 7 s; checkpoint only in `game-rules/src/spike.ts:15,30`, ignored by the simulator |
| Footstep radius | Not published. Design intent: long enough to use an ability and re-equip before the runner arrives; flat fall-off on purpose | [Ask VALORANT #6](https://playvalorant.com/en-us/news/game-updates/ask-valorant-6/) | 50 m, `verified:false` (`game-rules/src/spike.ts`) |
| Ability cast audio radius (one example) | Skye Guiding Light 3250 → 1250 units (patch 3.0) | [Patch notes 3.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-3-0/) | Ability casts use the zone sound graph |
| Sounds shown on minimap | Abilities, reloads, spike interactions (patch 1.0); 3D audio (HRTF) for footsteps and reloads (2.06) | [Patch 1.0](https://playvalorant.com/news/game-updates/valorant-patch-notes-1-0/), [Patch 2.06](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-2-06) | Reload has a loudness entry but is never emitted |
| Smoke fade warning | Audio + visual cue 1.5 s before Astra/Brim/Omen smokes fade (7.08) | [Patch 7.08](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-7-08/) | No fade cue |
| One-way smokes | Omen smokes inside walls now drop to nearby ground (6.0); one-ways limited to "readable" spots | [Patch 6.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-6-0/) | Smokes are symmetric zone-pair blockers |
| Flash blind | 1–3.1 s full blind depending on agent; turning away shortens it (VCT 2023 data drop). Windups ≈ 0.5 s (Phoenix, Breach) to 1.6 s (KAY/O overhand), *unconfirmed per patch* | [Riot Data Drop VCT 2023](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023), [Dignitas flash guide](https://dignitas.gg/articles/the-ultimate-flash-guide-for-valorant-s-flash-agents) | `DEFAULT_BLIND_MS` 2000 (`team-engine/src/utility.ts:95`); blind needs facing |
| Economy | win 3000; loss 1900/2400/2900; kill 200; plant +300 to all attackers; cap 9000 | [Mobalytics economy guide](https://mobalytics.gg/blog/valorant/ultimate-economy-guide/) | Team-level, via `economy-engine` |
| Ult points | +1 per kill, own death, plant, defuse, orb | [Siege.gg](https://siege.gg/news/how-to-get-ultimate-points-in-valorant) | Kills + plant only (`match-runner/src/economy.ts:92`); not read by any decision |

Pro outcome numbers useful for checking the engine (not judged metrics today):

| Number | Value | Source | Engine (audit §E-3, mirrors) |
|---|---|---|---|
| First blood → round win | 71.4 % (Masters Berlin 2021, rib.gg data) | [Upcomer](https://www.upcomer.com/answering-valorant-masters-berlin-questions-part-1) | 72.4 % |
| Average time to plant | 52.3 s (Pacific) … 60.4 s (EMEA), VCT 2023 | [Riot Data Drop VCT 2023](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023) | Not measured; first site arrival p50 15.5–18.5 s, first kill p50 14.5 s |
| Best post-plant win rate (attack) | 74.8 % (Fnatic, VCT 2023) — an upper bound, not the average | same | A 0.728 / B 0.787 |
| Best defuse-after-plant rate | 39.1 % (Fnatic, VCT 2023) | same | Retake success not measured |
| Trade window used by analysts | 3–5 s | [Esports.net KAST](https://www.esports.net/wiki/guides/what-is-kast-valorant/) | sim-batch trade rate 0.503 (window per validator) |
| Comebacks from 2–10 at half | ≈ 3 % (VCT 2023) | Riot Data Drop VCT 2023 | Not measured |

Plant timing is the clearest gap: real pros plant around the 52–60 s mark, while the engine's early contact
(first kill p50 14.5 s) suggests it rushes. That fits the missing jiggle/default/contact play (PK-03, MR-04/05).

---

## 1. Movement and sound

### MS-01 · Shift-walk and footstep discipline ✅
- **What / when.** Walking is silent and running is loud. Pros run when the enemy already knows where they are
  or when time matters (an execute, a trade, a retake). They walk the last stretch before contact, on lurks and
  past a known listener. ([Dignitas: when to walk vs run](https://dignitas.gg/articles/when-to-walk-and-when-to-run-a-valorant-guide))
- **Changes.** Sound emission (none vs the footstep radius), speed (walk ≈ half), first-shot readiness.
- **Governed by.** discipline, gameSense; teamDiscipline (null today) for not giving a team away.
- **Mechanism.** A decision from intent and belief: run if not audible to any believed enemy, or if the clock
  can't afford walking.
- **Status ✅.** `team-engine/src/movement.ts:32` `chooseMoveMode`, `:39` `withinEarshot`; `policy.ts`
  `paceFor` / `audible` / `quietSlackMs` (`:905–936`). Walking is silent in `perception-engine/src/hearing.ts`
  `collectSoundSources` (runners only). **Gap:** no discipline error; the choice is perfect for everyone.
  Individual moves are fast if `aggression > 0.6` (STAT_OUTCOME_MATRIX §3.7).
- **Effect / test.** Already covered by CTI §9.4. Missing test: low-discipline players run when they shouldn't
  (proportional-hazard slip, like the throw model), and the defence's hit-belief reacts.

### MS-02 · Crouch ❌
- **What / when.** Crouching while spraying for accuracy, crouch-peeking under head height, crouch off-angles.
- **Changes.** Head height (the target's angular height), spray accuracy, speed.
- **Governed by.** movement, crosshairPlacement (the holder must adjust), weaponControl (unread today).
- **Mechanism.** A third move/posture mode. It changes the target's `W` in the Fitts aim model (CG-01) and the
  spray spread.
- **Status ❌.** Speeds fixed at run 675 / walk 340 uu/s (`round-simulator/src/simulator.ts:62–63`); no
  posture state.
- **Effect / test.** Small. Counterfactual: a crouching holder on a standing-height edge is hit later by a
  peeker with high crosshairPlacement.

### MS-03 · Footstep audible radius and localisation ✅ (value unverified)
- **What / when.** Everyone reads footsteps; the skill is knowing how far they carry and where they come from.
  Riot's rule is flat fall-off by design ("audible, not precisely placeable"), and stereo mixing makes front and
  back at 45° hard to separate. ([Ask VALORANT #6](https://playvalorant.com/en-us/news/game-updates/ask-valorant-6/))
- **Changes.** Belief about enemy positions.
- **Governed by.** gameSense, mapAwareness (null) for localisation.
- **Mechanism.** Distance rule: heard within `R`, confidence `1 − d/R` (localisation, not detection).
- **Status ✅.** `perception-engine/src/hearing.ts` `footstepConfidence`, `hearSounds`;
  `params.ts:94` `footstepRadiusUnits` 5000; team aggregation `round-simulator/src/view.ts:194` `teamFootsteps`.
  The 50 m radius is `verified:false`. Localisation doesn't depend on any attribute yet.
- **Effect / test.** CTI §9.4. Add: listener `mapAwareness` → zone-assignment error, so a poor listener
  sometimes calls the wrong zone.

### MS-04 · Drop / landing sound 🔧 engine-truth · ❌ on `a9c993a`
- **What / when.** Dropping off a ledge makes a landing sound even when walking, which gives away a flank. Pros
  avoid unnecessary drops when quiet, or mask them (MS-05). Whether a jump landing is audible, and at what
  radius, is *unconfirmed*: no Riot number found.
- **Changes.** A sound at the bottom of a `drop` edge.
- **Governed by.** discipline, teamwork (asking for cover noise).
- **Mechanism.** Traversing a drop emits a `landing` cue with a radius from fall height (MAP-3), into the same
  listener rule as footsteps.
- **Status ❌.** Drops are walked (`round-simulator/src/mover.ts:432`; `spatial-engine/src/navigation.ts:10`
  `NavEdgeKind`), but `hearing.ts` emits nothing for them.
- **Effect / test.** See backlog A6.

### MS-05 · Sound masking 🔧 engine-truth (drop masking) · ❌
- **What / when.** Timing a noisy action (a drop, a defuse start, a reload, footsteps) to coincide with a
  teammate's shooting or utility, so the enemy doesn't pick it out. HRTF and minimap sound circles make an
  unmasked sound easy to place. ([Patch 1.0 sound visualisation](https://playvalorant.com/news/game-updates/valorant-patch-notes-1-0/))
- **Changes.** Probability that a cue is detected.
- **Governed by.** teamwork (timing with a teammate), gameSense.
- **Mechanism.** Simultaneous masking via signal-detection theory: `P(detect) = Φ(d′ − c)`, with `d′` from the
  level difference between signal and masker at the listener (inverse-square in dB). The decision to wait for
  cover noise compares `ΔP(heard)` × the cost of being heard with the wait.
- **Status ❌.** All sources are independent; no masker term (`hearing.ts` `hearSounds`).
- **Effect / test.** Backlog A6.

### MS-06 · Jump-spot / jump-peek for info ❌
- **What / when.** A jump over or around cover for a glance (Operator checks, deep angles). Accuracy in the air
  is poor, so it's for information only. ([Sportskeeda: jiggle and jump-peeking vs the Operator](https://sportskeeda.com/valorant/jiggle-jump-peeking-valorant-a-complete-guide-peeking-operator))
- **Changes.** Exposure time = airtime; information gained.
- **Governed by.** movement, gameSense.
- **Mechanism.** The exposure-window model of PK-03 with `t_exp` = airtime at a known spot (MAP-3).
- **Status ❌.** No jump state.
- **Effect / test.** Backlog A22.

### MS-07 · Counter-strafing / stopping to shoot 🟡
- **What / when.** Stopping before the first shot (VALORANT's accuracy threshold is 27.5 % of max speed).
  Counter-strafing gains only about 10 ms over releasing the key in VALORANT, much more in CS2
  (≈ 80 ms vs 200 ms). ([TurboSmurfs](https://turbosmurfs.gg/?p=7691), [Refrag](https://refrag.gg/blog/counter-strafing-the-key-to-precision-aim-in-counter-strike-2))
- **Changes.** Time to the first accurate shot.
- **Governed by.** movement.
- **Mechanism.** Stopping time by pace, scaled by `movement`.
- **Status 🟡.** `combat-engine/src/skills.ts` `stoppedAtMs` (stop = perception + `stopMs` × lerp(1.4, 0.6,
  movement)); `params.ts` `stopMs` {run 700, walk 350}. The 700 ms is a calibrated "fight like a set player"
  time, 4× the physical ≈ 160 ms full stop. When aim time becomes explicit (CG-01), `stopMs` should shrink
  toward the physical value, because the aim settling it now stands in for will be modelled separately.
- **Effect / test.** Re-run the STAT §2.7 table with Fitts aim on: physical stop + aim ≈ old 700 ms
  behaviour, or report the shift.

### MS-08 · Fake presence (the loud show) ✅
- **What / when.** One or two players run loudly, often with utility, toward one site while the rest walk to the
  other. ([Tracker.gg: how to lurk](https://tracker.gg/valorant/articles/how-to-lurk-in-valorant))
- **Changes.** The defence's belief about which site is hit.
- **Governed by.** aggression (who shows), gameSense of the defenders reading it.
- **Mechanism.** A planned noise source. The defence reads it with a Bayesian site-role posterior.
- **Status ✅.** `team-engine/src/policy.ts:79` `FEINT_SHOW_SIZE` 2, `:183` `FEINT_SHOW_MS` 18 s, `:880`
  `showTarget`; the reader is `team-engine/src/hit-belief.ts` `updateHitBelief` with `show(s)` hypotheses;
  fake rate learnt in `opponent-model.ts`. Without utility (MR-03).
- **Effect / test.** STAT §3.8 tables.

### MS-09 · Rope / zipline / teleporter sounds and fakes 🔧 engine-truth · ❌ on `a9c993a`
- **What / when.** Bind's teleporters make a sound at both ends. Teams fake them with Omen/Yoru teleports, a
  Chamber Rendezvous cue, a Sova arrow or Killjoy bot opening the A teleporter, or a Cypher camera dart through
  it. Defenders learn to treat teleporter sounds as possibly fake. Ziplines and ropes (Icebox, Fracture,
  Breeze-type maps) make traversal noise. ([Sportskeeda fake TP guide](https://sportskeeda.com/valorant/valorant-tactical-guide-how-fake-tp-riot-games-competitive-shooter-ft-yoru-chamber), [ONE Esports: Chamber fake TP](https://www.oneesports.gg/valorant/how-to-do-chamber-fake-teleport-play/), [Patch 11.08: Yoru teleport audio](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-11-08/))
- **Changes.** Sound at the entry and exit; the defence's belief about the exit-side site.
- **Governed by.** gameSense (both sides), agentMastery (null) for the agent-based fakes.
- **Mechanism.** Traversal cues into the same hit-belief update; a fake is a planned cue without
  follow-through. The teleporter radius is *unconfirmed*.
- **Status ❌.** Traversal exists (`round-simulator/src/mover.ts:647–651`: teleporter holds then moves; rope and
  zipline carry); no sound. Edge kinds exist in data (`spatial-engine/src/types.ts:204` `EdgeKind`).
- **Effect / test.** Backlog A10.

### MS-10 · Fake plant ❌
- **What / when.** Starting a plant and cancelling it, to pull defenders or check for a reaction.
- **Changes.** A plant-start sound with no plant.
- **Governed by.** gameSense.
- **Mechanism.** A planned emission read through the same Bayes as defuse taps (PP-03).
- **Status ❌.** A plant start is a sound (`hearing.ts` `spikePlant`), but the policy never cancels on purpose.
- **Effect / test.** Small; backlog A25.

### MS-11 · Reload / equip / ability-equip sounds ❌
- **What / when.** Reloads and ability equips are audible (shown on the minimap since 1.0). Pros avoid
  reloading in earshot after a kill, and listen for an enemy reload to swing.
- **Changes.** A cue, and a window when the enemy can't shoot.
- **Governed by.** discipline.
- **Mechanism.** Reload as a timed state with a sound. Swinging into a heard reload is an exposure window where
  the enemy's ready time = remaining reload.
- **Status ❌.** `LOUDNESS.reload` exists in `hearing.ts`, but `eventSound` has no reload case and the round
  simulator has no reload state outside a duel (the combat engine reloads inside a duel only).
- **Effect / test.** Counterfactual: a swing into a heard reload wins more than the same swing on a ready
  holder.

---

## 2. Peeking and duels

### PK-01 · Peeker's advantage 🟡 (a calibrated constant)
- **What / when.** The peeker sees the holder before the holder's screen shows them, from network and render
  buffering. Riot's worked example gives ≈ 101 ms at 60 fps and 35 ms ping, ≈ 71 ms at 144 fps. Duels are
  "often" decided by 20–50 ms. ([Riot netcode blog](https://www.riotgames.com/en/news/peeking-valorants-netcode))
- **Changes.** The holder's reaction start.
- **Governed by.** Nothing about the player; the server and connection. Holders counter with off-angles,
  distance from the corner and crossfires.
- **Mechanism.** `Δ_peek = server buffering + client interpolation + render delay`, from tick, frame time and
  latency. Pros play on LAN with high-refresh screens, so it's toward the low end.
- **Status 🟡.** `round-simulator/src/simulator.ts:1255` (stationary holder vs moving opponent →
  `cfg.peekerAdvantageMs`), `types.ts:458` = 180 ms. That's about 2× Riot's figure, because it's calibrated
  on aggregate outcomes and absorbs effects with no model yet (aim time, CG-01). It's the one non-derived duel
  term left in STAT §2.4.
- **Effect / test.** When CG-01 lands, split it: netcode term from Riot's formula (LAN, 128 tick, 144+ fps →
  ≈ 60–75 ms) plus whatever the aim model produces. Accept if the judged metrics hold without re-inflating the
  constant.

### PK-02 · Angle advantage, holding deep vs close, off-angles 🟡
- **What / when.** Who sees whom first around a corner is geometry: the player farther from the corner sees
  first. Off-angles are spots the peeker doesn't expect, so the peeker's crosshair is somewhere else. Defenders
  use both to offset peeker's advantage. ([Boostroom defence guide](https://boostroom.com/blog/defense-guide-strong-site-setups-rotations-and-information-control))
- **Changes.** First sight; the peeker's aim distance `D`.
- **Governed by.** positioning, anchoring (null today), crosshairPlacement for the peeker.
- **Mechanism.** Corner geometry, already a formula: `Δt = (half-width / strafe speed) · (1 − peekerDist /
  holderDist)` (`round-simulator/src/situational.ts:82`). Off-angles go through the Fitts aim model (CG-01):
  `D` = the angle between where the peeker expected the holder (its prior over spots) and where the holder is.
- **Status 🟡.** The geometry is real, but the peeker's corner distance is fixed at 300 uu
  (`simulator.ts:73` `PEEK_CORNER_DISTANCE`). Holder distance is the 3D distance minus that. No named spots,
  so no off-angle choice (MAP-1). Holder aim per anchor is a fixed table (`team-engine/src/policy.ts:111`
  `DEFENSE_AIM`).
- **Effect / test.** Backlog A2/A15. Counterfactual: a holder on an off-angle vs the default spot, against a
  peeker whose prior puts 80 % on the default spot.

### PK-03 · Jiggle peek ❌
- **What / when.** A quick in-and-out strafe showing a sliver of the body, for information or to bait a shot.
  It's the standard way to check for an Operator. ([EarlyGame jiggle guide](https://earlygame.com/valorant/how-to-jiggle-peek), [ProSettings peeking](https://prosettings.net/blog/how-to-peek-in-valorant/))
- **Changes.** A short exposure window; information without committing to a duel.
- **Governed by.** movement, gameSense, discipline (not over-peeking).
- **Mechanism.** Exposure-window duel: the holder fires only if `readyDelay < t_exp`, with hit chance scaled
  by visible body fraction. A duel can end in a disengage.
- **Status ❌.** A duel runs until a kill or 12 s (`combat-engine/src/engine.ts` loop `while (bothAlive())`,
  `params.ts` `timeBudgetMs` 12000). Each pair fights at most once per round (`simulator.ts:228` `engaged`,
  `:1094`).
- **Effect / test.** Large. Backlog A1.

### PK-04 · Shoulder peek / baiting the Operator ❌
- **What / when.** Show a shoulder on purpose to draw an Operator shot, then swing while it re-chambers
  (0.6 shots/s since 1.09 ≈ 1.67 s between shots). Not against rifles. ([Sportskeeda](https://sportskeeda.com/valorant/jiggle-jump-peeking-valorant-a-complete-guide-peeking-operator), [Patch 1.09](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-09))
- **Changes.** The Op's next-shot time; the follow-up swing's exposure.
- **Governed by.** movement and gameSense (the baiter); discipline (the Op holder not biting).
- **Mechanism.** PK-03 plus the weapon's cycle time from data, and the holder's fire/hold decision scaled by
  discipline.
- **Status ❌.** No disengage; no weapon cycle in the decision layer.
- **Effect / test.** Backlog A1.

### PK-05 · Wide swing vs tight peek 🟡
- **What / when.** A committed wide strafe beats a holder whose crosshair sits tight on the corner, especially
  after jiggles have trained it to expect a sliver. Sequence: jiggle for info → shoulder to bait → wide to
  fight. ([Boostroom peeking](https://boostroom.com/blog/peeking-like-a-pro-jiggle-shoulder-and-wide-swings-explained))
- **Changes.** Where the peeker appears relative to the holder's crosshair (`D`); angular speed across the
  holder's view (tracking load).
- **Governed by.** movement, aggression; holder's tracking.
- **Mechanism.** The angle formula already takes strafe speed and distances. Add the swing's start
  point (wide = farther from the corner) and Fitts `D` from the holder's gaze point. Decision: wide when
  expecting a close or tight-aimed holder and with a trade behind.
- **Status 🟡.** Peek distance fixed (`simulator.ts:73`); speed by run/walk only (`:1109`). Moving-target
  penalty uses `tracking` (`combat-engine/src/skills.ts` `hitChance`).
- **Effect / test.** Counterfactual in A1/A2 scenes.

### PK-06 · Dry peek vs utility peek 🟡
- **What / when.** Swinging without utility is a gamble against a set holder. Flashes or smokes turn it into a
  play. Riot nerfed the Operator specifically for dry-peek strength. ([Patch 1.09](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-09))
- **Changes.** Who sees first; the holder's blind.
- **Governed by.** utilityUsage (null), teamwork (timing with the flasher).
- **Mechanism.** Smoke exit and flash are in the duel math. Dry peeks by holders are the throw hazard.
- **Status 🟡.** Smoke exit `simulator.ts:1114–1120` + `situational.ts` `smokeExitDelayMs`; flash blind feeds
  combat (`simulator.ts:1255`, `combat-engine/src/skills.ts` `readyDelayMs`); timed flash purpose
  `team-engine/src/utility.ts:93`. Post-plant dry peeks: `policy.ts:265` `throwChance`. **All utility is off
  by default.**
- **Effect / test.** CTI §8.2 table (0.10 → 1.00 with a flash). Run it on abilities-on real rosters.

### PK-07 · Re-peek vs re-position ❌
- **What / when.** After a kill, a miss or a jiggle, the enemy aims at the angle you just used. Change the
  angle or the timing, or fall back for the trade. ([Sportskeeda: clearing angles](https://sportskeeda.com/valorant/valorant-peeking-guide-how-clear-angles-effectively-2023))
- **Changes.** Whether the enemy is pre-aimed; time spent.
- **Governed by.** gameSense, discipline, decisionMaking.
- **Mechanism.** After an exchange, both sides have `w = 1` on each other's spot (info decay, STAT §2.2). The
  same angle hands the enemy pre-aim (`D ≈ 0`). Decide by expected win minus time cost.
- **Status ❌.** No disengage, no second engagement per pair (`simulator.ts:228`, `:1094`).
- **Effect / test.** Backlog A1.

### PK-08 · Trade spacing / refrag distance 🟡
- **What / when.** The second player follows close enough to refrag before the killer resets, far enough not to
  be caught in the same spray. Analysts count a trade if the killer dies within ≈ 3–5 s.
  ([Esports.net KAST](https://www.esports.net/wiki/guides/what-is-kast-valorant/))
- **Changes.** Time between the entry's death and the trader's swing.
- **Governed by.** trading, teamwork.
- **Mechanism.** `T_trade = holder TTK + re-acquire time`; spacing `d` such that `d/v ≤ T_trade` and the second
  player is off the entry's line.
- **Status 🟡.** Support trails the entry by 1200 ms × `tighten` (`team-engine/src/teamwork.ts:12,35`), with
  `tighten = max(0.3, 1.5 − teamwork)`. A same-line teammate counts 0.2 of a gun (`simulator.ts:70`). One duel
  per player per tick enables trades over ticks (`simulator.ts` comment above `busy`). `trading` stretches the
  info half-life (STAT §2.2), not the spacing.
- **Effect / test.** Backlog A4.

### PK-09 · Slicing the pie 🔧 engine-truth · ❌ on `a9c993a`
- **What / when.** Clear a corner gradually from the far side, so only one possible holder spot is exposed at a
  time. ([Win.gg: peek corners](https://win.gg/news/how-to-peek-corners-in-valorant-like-a-pro/))
- **Changes.** One holder at a time (no crossfire on the clearer); the clearer's crosshair is already where
  each new sliver appears.
- **Governed by.** movement, crosshairPlacement, mapAwareness.
- **Mechanism.** A series of first contacts with Hick–Hyman `n = 0` (`situational.ts:27`) and small Fitts `D`,
  paid for in time (arc length / walk speed).
- **Status ❌.** Movers face the next zone's centre (`mover.ts:713` `facingFor`); peek resolved at a fixed
  300 uu (`simulator.ts:73`).
- **Effect / test.** Backlog A7.

### PK-10 · Double peek / swinging together 🟡
- **What / when.** Two attackers swing at once from different angles, so one holder can't kill both.
- **Changes.** The holder's choice reaction time (two targets).
- **Governed by.** teamwork.
- **Mechanism.** Hick–Hyman on the holder: each extra angle adds `b · log2(n+1)`.
- **Status 🟡.** The crossfire term counts a moving enemy ≥ 30° off the duel line as a full gun, same line as
  0.2 (`simulator.ts:44–56`, `crossfired`). The stack-up rule makes teammates cross a boundary together
  (`STACK_*`, `simulator.ts` top). No deliberate double-swing decision; arrivals are capped mechanically at
  3.0 s (audit §D-2).
- **Effect / test.** Counterfactual: 2-man swing at 30°+ separation vs single file into one holder.

---

## 3. Crosshair and gaze

### CG-01 · Crosshair placement (head height, pre-placed on the edge) 🔧 engine-truth · 🟡
- **What / when.** Keep the crosshair at head height on the edge where an enemy will appear, so only a tiny
  adjustment is needed. ([ProSettings](https://prosettings.net/blog/how-to-peek-in-valorant/))
- **Changes.** Time from seeing to shooting; first-shot head-shot chance.
- **Governed by.** crosshairPlacement; reaction for perception.
- **Mechanism.** Fitts's law: `aim time = a + b · log2(1 + D/W)`, `D` = crosshair-to-target angle,
  `W` = head width at range. crosshairPlacement shrinks `D`.
- **Status 🟡.** `crosshairPlacement` affects only `headshotChance` (`combat-engine/src/skills.ts`,
  lerp 0.05 → 0.45). Time to first shot ignores it (`readyDelayMs`). That may be part of why real rosters
  tilt toward defence (audit §E-2 hypothesis).
- **Effect / test.** Backlog A2.

### CG-02 · Pre-aiming / prefiring known spots 🟡
- **What / when.** Aiming at (or firing into) a common spot before clearing it, when a holder is expected
  there.
- **Changes.** `D ≈ 0` for that spot; sometimes the first shot lands before the holder reacts.
- **Governed by.** crosshairPlacement, mapAwareness.
- **Mechanism.** A spot-level prior over holder positions (MAP-1, opponent model). Prefire is worth it when
  `P(holder at spot)` is high enough that firing first beats the cost of revealing your position.
- **Status 🟡.** Pre-aim is a yes/no flag (`simulator.ts:1246`: saw first, standing, not casting, not
  crossfired) worth a fixed 30 ms reaction (`combat-engine/src/params.ts` `preAimMs`) and +0.15 first-shot hit
  (`preAimFirstShotBonus`). A fresh call (`w ≥ 0.5`) denies the holder's pre-aim (`simulator.ts:1086`). No
  spot-level prior; no prefire.
- **Effect / test.** Backlog A2/A15.

### CG-03 · Gaze direction and checking order 🔧 engine-truth · 🟡
- **What / when.** Where each player is looking at every moment, and the order in which angles are checked
  when entering: closest threat first, then deeper.
- **Changes.** Who is in the FOV, aim distance `D`, surprise.
- **Governed by.** mapAwareness, gameSense, movement (turn speed).
- **Mechanism.** Gaze as state with a bounded turn rate. Check order sorted by
  `P(enemy at spot | belief) × P(they see first)`.
- **Status 🟡.** Facing = command `aimZone` / `targetZone` / default entry choke (`simulator.ts:957–977`).
  Movers face the next zone's centre (`mover.ts:713`). FOV ±55° (`perception-engine/src/params.ts:78`). No turn
  rate, no ordered checks.
- **Effect / test.** Backlog A7.

### CG-04 · Sector splitting inside the team ❌
- **What / when.** "I clear left, you clear right": teammates divide angles so none is checked twice or missed.
  ([Mobalytics crossfires](https://mobalytics.gg/blog/valorant-crossfires-bait-and-switch/))
- **Changes.** Coverage of angles; each player's `D` is small for their sector.
- **Governed by.** teamwork, communication (null).
- **Mechanism.** Set cover over threat-ranked spots, minimising the largest uncovered threat.
- **Status ❌.** Facing is set per player alone (`simulator.ts:957`).
- **Effect / test.** Backlog A16.

---

## 4. Utility

### UT-01 · Flash timing, pop-flash, turning away 🟡
- **What / when.** A pop-flash has a short windup and pops as it comes round the corner, so it can't be dodged.
  Turning away shortens the blind. Riot: full blinds last 1–3.1 s by agent.
  ([Riot Data Drop VCT 2023](https://playvalorant.com/en-us/news/dev/valorant-data-drop-vct-2023), [Dignitas](https://dignitas.gg/articles/the-ultimate-flash-guide-for-valorant-s-flash-agents))
- **Changes.** Who is blinded, for how long, and when.
- **Governed by.** utilityUsage (null), teamwork; the victim's reaction.
- **Mechanism.** Blind at `t_cast + windup`. A defender who hears the cast cue and can turn within the windup
  takes a reduced blind.
- **Status 🟡.** Flash is timed from the teammate's arrival (`team-engine/src/utility.ts:93`
  `FLASH_HOLD_MARGIN_MS`, `:95` `DEFAULT_BLIND_MS`). It blinds only those facing it (CTI §8.2). Defenders don't
  react to a heard flash (ability-realism hand-over). Flash LOS is zone-level (audit §D-3).
- **Effect / test.** Backlog A19.

### UT-02 · Smoke timing and playing the smoke's edge 🟡
- **What / when.** Smokes go up for the execute, not early (14–19 s durations). Holders play the smoke's edge,
  where pushers appear, and attackers use the 1.5 s fade cue.
  ([THESPIKE: instant smoking](https://www.thespike.gg/valorant/beginner-guides/is-instant-smoking-in-valorant-bad), [Patch 7.08](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-7-08/))
- **Changes.** Sightlines; who sees first coming out.
- **Governed by.** utilityUsage (null), positioning (null).
- **Mechanism.** Smoke exit gives the watching holder first sight. The delay is the corner formula in the
  limit `peekerDist → 0`.
- **Status 🟡.** `simulator.ts:1114–1120`, `situational.ts` `smokeExitDelayMs`; cover smokes timed by
  `utility.ts:101` `SMOKE_CAST_LEAD_MS`. Smokes are zone-pair blockers placed at zone centres
  (`ability-engine/src/engine.ts`, audit §D-3). No fade cue.
- **Effect / test.** CTI §8.2 table.

### UT-03 · One-way smokes ❌
- **What / when.** A smoke placed so the holder sees feet or a body through a gap while the peeker sees
  nothing. Since patch 6.0 only on ledges and similar geometry.
  ([Patch 6.0](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-6-0/))
- **Changes.** Asymmetric sight.
- **Governed by.** utilityUsage, agentMastery (both null).
- **Mechanism.** Needs positional smoke volumes with height, so sight between two points can be blocked one
  way. Data: one-way spots (MAP-6).
- **Status ❌.** Smokes block symmetric zone pairs.
- **Effect / test.** Backlog A20 / MAP-6.

### UT-04 · Lineups ❌ (casts go to zones, no lineup library)
- **What / when.** Fixed throw positions that land utility precisely from safety: recon darts, post-plant
  mollies, shock darts.
- **Changes.** Utility placement accuracy; caster exposure.
- **Governed by.** utilityUsage, agentMastery (null).
- **Mechanism.** A lineup is a (throw point, landing point) pair. A cast from a lineup has zero placement error
  and the caster's exposure is that of the throw point.
- **Status ❌.** Casts target zones; reachability is `team-engine/src/utility.ts:236` `withinReach`; landing
  is the zone centre (`ability-engine/src/engine.ts`).
- **Effect / test.** Backlog MAP-2, A13.

### UT-05 · Stacking utility vs chaining it 🟡
- **What / when.** Stacking: several pieces at once for an execute. Chaining: one after another to stall.
- **Changes.** Total delay or concealment.
- **Governed by.** teamwork, utilityUsage.
- **Mechanism.** Stall purposes chain one denial at a time; cover and blind follow each teammate's exposure.
- **Status 🟡.** `team-engine/src/utility.ts:265–271` `stallWants` (one denial at a time); cover and blind per
  exposure. No execute-level stacking plan.
- **Effect / test.** Counterfactual: 2 smokes + flash in one window vs spread over 6 s.

### UT-06 · Baiting utility / tracking what's left ❌
- **What / when.** Show presence to draw the defenders' utility, then hit where it's been spent.
  ([Mobalytics: how to retake](https://mobalytics.gg/blog/valorant/valorant-how-to-retake/))
- **Changes.** The execute faces less utility.
- **Governed by.** gameSense, decisionMaking.
- **Mechanism.** A belief over each enemy's remaining charges, decremented by observed casts (`AbilityCue`).
- **Status ❌.** Casts are observed as cues, but nothing counts them.
- **Effect / test.** Backlog A14.

### UT-07 · Saving utility for the retake / post-plant ❌
- **What / when.** Defenders who give up a site keep utility for a coordinated retake. Attackers keep mollies
  for the defuse.
- **Changes.** When utility is used.
- **Governed by.** utilityUsage (null), discipline.
- **Mechanism.** Option value: cast now only if `V_now > P(later phase) · V_later`.
- **Status ❌.** `team-engine/src/utility.ts` casts whenever a purpose is met; there's no budget across
  phases.
- **Effect / test.** Backlog A13.

### UT-08 · Mollying the spike / post-plant lineups 🟡 (the effect exists, the decision doesn't)
- **What / when.** A molly or shock on the spike from safety forces the defuser off. Mollies last ≈ 4–8 s
  (*unconfirmed per patch*); a defuse is 7 s, or 3.5 s past the checkpoint.
  ([Mobalytics spike guide](https://mobalytics.gg/blog/valorant/valorant-spike-guide/))
- **Changes.** Defuse progress.
- **Governed by.** utilityUsage, agentMastery.
- **Mechanism.** On a defuse-start cue, cast to the spike zone from a lineup (MAP-2).
- **Status 🟡.** Standing in fire interrupts a plant or defuse (CTI §8.3), but no purpose targets the spike
  at defuse time.
- **Effect / test.** Backlog A13.

### UT-09 · Recon timing ✅ (abilities on)
- **What / when.** Recon just before contact so the information is fresh when the entry appears.
- **Changes.** Team intel on the enemies revealed.
- **Governed by.** utilityUsage.
- **Mechanism.** Info half-life (STAT §2.2): thrown so the call is younger than one half-life at contact.
- **Status ✅.** `team-engine/src/utility.ts:106` `RECON_LEAD_MS`; recon as a frozen snapshot (CTI §8.2). LOS
  zone-level.
- **Effect / test.** CTI §8.2 (+ fresh recon 0.10 → 0.45).

---

## 5. Economy

### EC-01 · Buy calls (full / half / force / eco) 🟡
- **What / when.** Buys follow the loss-bonus ladder (1900 / 2400 / 2900) and the +300 plant bonus. Planting
  while losing a round still helps the next buy. ([Mobalytics economy](https://mobalytics.gg/blog/valorant/ultimate-economy-guide/))
- **Changes.** Weapons, armour, utility per round.
- **Governed by.** The team (IGL); decisionMaking.
- **Mechanism.** Optimise `P(win now) + γ · E[P(win later) | credits after]`.
- **Status 🟡.** Team-level thresholds (`match-runner/src/economy.ts:47` `decideBuy`: Vandal+armour, else
  Spectre+light, else Classic). Coach call override `:68`. No per-player credits; the `economy-engine` value
  evaluator isn't wired (audit §F). Force-buy attack win rate 0.110, far below the semi-vs-full baseline ≈ 0.32
  (audit §E-3).
- **Effect / test.** Backlog A5.

### EC-02 · Bonus round ❌
- **What / when.** After a pistol win, keep the pistols/SMGs and buy light. The losers often save.
- **Changes.** Weapons carried into round 2.
- **Mechanism.** Per-player inventory carried by survivors (EC-03), then the EC-01 objective.
- **Status ❌.** Weapons don't carry over (STAT §3.6 limitation).

### EC-03 · Weapon drops, saved guns, picking up guns ❌
- **What / when.** A rich player drops a rifle for a poor one. Survivors keep weapons. Players pick up better
  weapons from the dead.
- **Changes.** Per-player loadouts.
- **Governed by.** teamwork.
- **Mechanism.** Per-player credits and inventory; drop when the second rifle's marginal value beats the
  dropper's own armour/utility.
- **Status ❌.** No individual credits (audit §C: `view.ts` TODO). The spike can be picked up
  (`simulator.ts:474`), weapons can't.
- **Effect / test.** Backlog A5.

### EC-04 · Eco stacking / eco rush ❌ (the opposite is coded)
- **What / when.** On an eco, attackers stack one site or rush short range where SMGs and shotguns win.
- **Changes.** Contact distance; numbers at the point of contact.
- **Governed by.** The team; aggression.
- **Mechanism.** Range choice from `P(win duel | weapons, distance)`, tabulated from the combat model.
- **Status ❌.** An eco attack plays `default` (`team-engine/src/igl.ts:166`: "gather info, play for picks").
- **Effect / test.** Backlog A9.

### EC-05 · Ult economy and orbs 🟡
- **What / when.** +1 point per kill, own death, plant, defuse or orb. Teams route past orbs and time ults for
  key rounds. ([Siege.gg](https://siege.gg/news/how-to-get-ultimate-points-in-valorant))
- **Changes.** When ultimates are available.
- **Governed by.** The team; agentMastery.
- **Mechanism.** Ult points by rule. Orb pickup as a contested action with an exposure cost. Ultimates enter
  the round plan's value.
- **Status 🟡.** `match-runner/src/economy.ts:92`: kills + plant only (misses deaths, defuses, orbs). No
  decision reads them. Ultimates are in the ability slots (`match-runner/src/abilities.ts:26`), with
  availability in `ability-engine/src/availability.ts`.
- **Effect / test.** Backlog A21.

### EC-06 · Mid-round save / exit ✅
- **What / when.** A losing attack saves its guns rather than fight 1v4. A losing retake saves.
- **Changes.** Survivors and the next round's buy.
- **Governed by.** discipline, decisionMaking (the hero threshold uses aggression).
- **Mechanism.** Lanchester square law, `P = A² / (A² + κD²)`, against thresholds.
- **Status ✅.** `team-engine/src/policy.ts:653` `commitAttackSave`, `:1607` `postPlantSave`, `:253`
  `lanchesterWinChance`. The saved weapon doesn't carry over (EC-03), so the economic effect is missing.
- **Effect / test.** STAT §3.1, §3.6.

### EC-07 · Hunting exit kills ✅
- **What / when.** Defenders who've won the round hunt saving attackers for economic damage, at some risk.
- **Mechanism.** The throw hazard: `λ = λ₀ · exp(3z)`.
- **Status ✅.** `policy.ts:1351` `commitDefenseChase`, `:265` `throwChance`.

---

## 6. Mid-round calls

### MR-01 · Rotations off information ✅ defence · 🟡 attack
- **What / when.** Rotate on what you hear and see, in proportion to how sure you are.
- **Changes.** Defender distribution.
- **Governed by.** decisionMaking (sharpness τ), rotations (null).
- **Mechanism.** Bayesian posterior over site roles (hit / show / quiet); send `round(P(hit) × available)`.
- **Status.** Defence ✅: `team-engine/src/hit-belief.ts:123` `updateHitBelief`, `:177` `rotationCount`;
  `policy.ts:1234` `decideDefenseRotation`. Attack 🟡: heard cues add a capped weight to the site read
  (`igl.ts:74` `enemySiteBias`), but rotations away aren't read (footstep hand-over, "not done").
- **Effect / test.** STAT §3.8; backlog A11.

### MR-02 · Lurk timing 🟡
- **What / when.** The lurker matches the team's pace and hits defenders while they're facing the main group.
  Lurking every round makes you predictable.
  ([Alviran: lurking and defaulting](https://alviran.net/blog/valorant-lurking-defaulting-map-control-guide-2026/), [WeCoach](https://wecoach.gg/blog/article/how-to-lurk-in-valorant-like-a-pro))
- **Changes.** A pinch on rotators or on the site at the moment of the execute.
- **Governed by.** lurking (null), discipline.
- **Mechanism.** Arrive at `t_execute_contact + T_trade` on the flank, quietly.
- **Status 🟡.** Lurker = the lowest-aggression player. It holds the opposite approach until the site is
  chosen, then rejoins (STAT §3.5; `policy.ts:744` notes on the commit clock). The audit found no independent
  lurk paths and never ≥ 3 occupied zones at 30 s (§E-5).
- **Effect / test.** Backlog A12.

### MR-03 · Faking with utility 🟡
- **What / when.** A fake is more believable with utility thrown at the shown site (and draws utility, UT-06).
- **Status 🟡.** Fakes run on noise only (MS-08). Utility purposes don't include "show"
  (`utility.ts:108` `UtilityPurpose` = stall/cover/blind/scout).
- **Mechanism.** A "show" purpose: utility thrown where the hit-belief likelihood of `show` vs `hit` is most
  moved per charge spent.

### MR-04 · Default spread 🟡
- **What / when.** Early-round information gathering across the map, before calling a site. Early = info,
  mid = convert to a hit, fake or punish, late = needs players, spike and utility together.
  ([Alviran](https://alviran.net/blog/valorant-lurking-defaulting-map-control-guide-2026/), [Red Bull IGL tips](https://www.redbull.com/au-en/igl-valorant-tips-guide))
- **Changes.** Map control; information; the rotations it catches.
- **Governed by.** discipline, mapAwareness.
- **Mechanism.** Lanes chosen to maximise information coverage under a duel-risk limit.
- **Status 🟡.** `policy.ts:700` `commitSlowPlan`, `:766` `slowLane`, `:174` `SLOW_COMMIT_CLOCK_MS`. Audit:
  only 23 attacker routes and ≤ 2 occupied zones at 30 s (§E-5).
- **Effect / test.** Backlog A18. Pro plant times of 52–60 s are the check.

### MR-05 · Contact play vs slow play 🟡
- **What / when.** Contact: walk silently until first contact, then go fast with utility.
- **Mechanism.** One switch in `paceFor`: quiet until a contact or heard cue, then fast.
- **Status 🟡.** Quiet/fast intents exist (STAT §3.7) but aren't triggered by first contact.

### MR-06 · Playing a man advantage 🟡
- **What / when.** After the opening kill, the attack takes space without contact and avoids even duels. The
  short-handed defence gives up contested angles for a retake. First blood → 71.4 % round win in pro play
  ([Upcomer, Masters Berlin](https://www.upcomer.com/answering-valorant-masters-berlin-questions-part-1)); the
  engine gives 72.4 %.
- **Mechanism.** Re-evaluate tempo with Lanchester at the new numbers.
- **Status 🟡.** Lanchester is used for saves/retakes only (`policy.ts:253`, `:653`, `:1590`).
- **Effect / test.** Backlog A4.

### MR-07 · Clock management ✅
- **What / when.** Commit early enough to plant; burn time when ahead; don't fake when there's no clock.
- **Mechanism.** Clock slack terms on every timed choice.
- **Status ✅.** `policy.ts:170` `EXECUTE_TIME_MARGIN_MS`, `:747` `slowCommitClockMs`, `:905` `quietSlackMs`;
  fake feasibility by clock in hit-belief (STAT §3.8, `φ` term).

### MR-08 · Spike-carrier rules 🟡
- **What / when.** The carrier doesn't entry, stays tradable, plants under cover, and gives the spike to a
  teammate if needed.
- **Mechanism.** The carrier's route of least exposure; plant spot selection by cover.
- **Status 🟡.** `policy.ts:1042` `commitSpikeCarrier` (commit to the objective, plant only on the plan's
  site). The plant spot is a covered point on the plant area (nav hand-over). Plants are still zone-level
  (audit §D-3). No hand-off.

### MR-09 · Mid-round re-call (IGL reconsider) ✅
- **Mechanism.** Reconsider on new evidence with a commit lock.
- **Status ✅.** `team-engine/src/igl.ts:197` `reconsider`, `policy.ts:185` `PLAN_COMMIT_MS`.

---

## 7. Defender setups

### DF-01 · Setups and stacks ✅
- **What / when.** 2-1-2 and similar; stack a site after reading a pattern. Each defensive round is a hold, a
  delay or a retake. ([Boostroom](https://boostroom.com/blog/defense-guide-strong-site-setups-rotations-and-information-control), [Hotspawn](https://www.hotspawn.com/valorant/guide/how-to-play-defenders-in-valorant-2025))
- **Status ✅.** `match-runner/src/defense-setups.ts` (setups from the PV-2 dataset); `igl.ts:125`
  `selectStrategy` (stackA/B/C from this round's read or the opponent's tendencies). Ascent-derived positions
  on other maps (maps hand-over). 🔧 maps: per-map tactics.

### DF-02 · Retake vs hold (giving the site) 🟡
- **Mechanism.** Retakes use Lanchester plus the least-exposure approach (STAT §3.1, §3.2).
- **Status 🟡.** Post-plant retake ✅ (`policy.ts:1563` `retakeGo`, `:1544` `retakeStageOf`). A pre-plant
  "play for retake" setup (deliberately light site, utility kept) ❌.
- **Pro check.** Fan analyses put pro retake success around 34–40 % ([Blix](https://blix.gg/?p=19962)), Riot's
  best team 39.1 % defuse-after-plant (VCT 2023).

### DF-03 · Early aggressive info plays 🟡
- **Status 🟡.** `aggroPush` has a fixed weight 1 against `defaultHold` 2 (`igl.ts:151`), and its players
  scatter at random (STAT §7).
- **Mechanism.** Push when `value(info) − P(die) · value(player) > 0`. Backlog A20.

### DF-04 · Crossfires ✅ (in the duel math) · 🟡 (in placement)
- **What / when.** Two defenders cover one entry from different angles, or one baits into the other's view.
  ([Mobalytics crossfires](https://mobalytics.gg/blog/valorant-crossfires-bait-and-switch/))
- **Mechanism.** Hick–Hyman: `+b · log2(n+1)`, `b` = 60 ms/bit, scaled by gameSense
  (`situational.ts:27`; `simulator.ts:1044` `crossfired`).
- **Status.** Duel effect ✅; placement comes from setup data, not designed per site.

### DF-05 · Off-angles and adapting after an opponent's pattern ❌
- **What / when.** Once attackers have shown how they clear a site, holders move to spots they don't check.
- **Mechanism.** A mixed strategy over named spots, updated by fictitious play on observed checks.
- **Status ❌.** The opponent model is site-level only (`team-engine/src/opponent-model.ts`). Fixed aim per
  anchor (`policy.ts:111`). Backlog A15 + MAP-1.

### DF-06 · Anti-eco positioning ❌
- **What / when.** Against an eco, avoid close range and stack areas; play long angles together.
  ([Mobalytics Haven guide](https://www.mobalytics.gg/blog/valorant-haven-map-guide/))
- **Status ❌.** No belief about the enemy's buy; holds don't change. Backlog A9.

### DF-07 · Anchor discipline (don't die first, delay) 🟡
- **Status 🟡.** Pre-plant holds convert peeks to holds (`policy.ts:1107` `commitDefenseHold`); stall utility
  (abilities on). `anchoring` (null) isn't read.

---

## 8. Post-plant

### PP-01 · Post-plant positions 🟡
- **What / when.** Alone: plant hidden so the defuser walks into your aim. With teammates: plant open and
  crossfire the spike, with one on the spike and one on the flank.
  ([Dignitas post-plant](https://dignitas.gg/articles/playing-post-plant-in-valorant-strategies-and-tips), [Strafe](https://www.strafe.com/articles/read/valorant-plant-defend-spike-guide/))
- **Status 🟡.** Holders near the spike aim at the plant zone (`policy.ts:590–613`
  `commitPostPlantContest`). No off-site positions or plant choice by team size; plants are zone-level.
  Post-plant attack win A 0.728 / B 0.787 vs pro best-team 74.8 % (audit §E-3; Riot VCT 2023).

### PP-02 · Playing for time vs for the kill ✅
- **Mechanism.** The throw hazard penalises leaving a winning post-plant hold (STAT §3.3).
- **Status ✅.** `policy.ts:265` `throwChance`, `:626` `throws`.

### PP-03 · Half-defuse checkpoint, taps and fake defuses ❌
- **What / when.** A tap makes the same sound as a real defuse start, to bait a peek. A half defuse banks the
  3.5 s checkpoint. Attackers have to read tap vs real. ([Mobalytics spike guide](https://mobalytics.gg/blog/valorant/valorant-spike-guide/), [Metabot](https://metabot.gg/en/valorant/guides/valorant-spike-plant-defuse-postplant))
- **Governed by.** gameSense, clutch; attackers' discipline.
- **Mechanism.** The checkpoint rule; a Bayes read of tap vs real.
- **Status ❌.** `game-rules/src/spike.ts:15,30` has `defuseHalfwayMs`. The simulator resets progress to 0
  (`round-simulator/src/simulator.ts:1332`, `:1344`). Backlog A3.

### PP-04 · Stick defuse ❌ · PP-05 · Ninja defuse ❌
- **Mechanism.** Stick if `P(finish before death) > P(win after stopping)`. Ninja if the belief says nobody
  sees the spike and the walk is silent.
- **Status ❌.** The defuser starts only after the group retake (`policy.ts:1563` `retakeGo`). Backlog A17.

### PP-06 · Grouped retake ✅
- **Status ✅.** Least-exposure approach, stage, go together (STAT §3.2; `policy.ts:1544–1590`).

---

## 9. Clutch, comms, adaptation

### CL-01 · Clutch behaviour 🟡
- **What / when.** Isolate 1v1s, use the timer, deny information (walk, fake taps).
  Pro example: 16.2 % clutch success for a top player in 2025 ([THESPIKE](https://www.thespike.gg/valorant/news/the-numbers-behind-the-best-analyzing-valorant-s-2025-mvp-performances/7435)).
- **Status 🟡.** Reaction shift `(0.6 − clutch) · 250 ms` when last alive vs 2+ (`situational.ts`
  `clutchReactionMs`, STAT §2.3). No clutch behaviour. Backlog A23.

### CL-02 · Communication quality 🟡
- **What / when.** Calls with count, place and damage ("one B main, lit 50"). In the first second of contact,
  listen rather than talk. ([GuildOrder comms](https://guildorder.com/games/valorant/guides/comms-and-callouts), thin source)
- **Mechanism.** Delay, position noise and count accuracy from `communication`.
- **Status 🟡.** Fixed 600 ms delay for everyone, exact positions (`perception-engine/src/params.ts:104`,
  `communication.ts`); `communication` null. Backlog A8.

### CL-03 · Information denial ❌
- **What / when.** Not shooting utility that reveals you, not running, staying off known spots after being
  spotted.
- **Mechanism.** The choice to reveal is priced by the opponent's belief change (the inverse of reading noise).
- **Status ❌.** Shared by MS-01 (walk decision) and A1 (reposition); no separate decision.

### CL-04 · Anti-stratting and mid-series adaptation 🟡
- **What / when.** Teams counter the opponent's habits within and across maps; tactical timeouts.
  ([Win.gg timeouts](https://win.gg/news/how-to-call-a-tactical-timeout-in-competitive-valorant/))
- **Status 🟡.** Dirichlet tendencies with decay (`team-engine/src/opponent-model.ts`), scouting priors and
  game plans (STAT §5.1), coach orders at timeouts (`match-runner/src/session.ts`, `orders.ts`). The audit
  measured no effect from opponent memory (§F). Site level only. Backlog A24.

### CL-05 · Timeouts and momentum 🟡
- **Status 🟡.** Timeouts carry orders (`session.ts`). There's no momentum model, which is correct by the
  design rule: a "momentum bonus" would be a flat bonus. Riot's comeback numbers (≈ 3 % from 2–10 down) are a
  check on whether economy alone reproduces them.

---

## Count by status (68 entries)

| | ✅ | 🟡 | ❌ |
|---|---|---|---|
| Movement and sound (11) | 3 | 1 | 7 |
| Peeking and duels (10) | 0 | 6 | 4 |
| Crosshair and gaze (4) | 0 | 3 | 1 |
| Utility (9) | 1 | 4 | 4 |
| Economy (7) | 2 | 2 | 3 |
| Mid-round (9) | 2 | 7 | 0 |
| Defender setups (7) | 1 | 4 | 2 |
| Post-plant (6) | 2 | 1 | 3 |
| Clutch / comms / adaptation (5) | 0 | 4 | 1 |
| **Total** | **11** | **32** | **25** |

(DF-04 is counted as partial, MR-01 as partial, MS-03 as implemented, PP-04/05 as two missing entries.)
