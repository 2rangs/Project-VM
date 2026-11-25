# PROJECT V — The information layer

*Each player knows only what they sensed. The team knows what was called. The IGL decides on what it combined.*

One engine, but every team decision is built from each player's information one piece at a time.

| Piece | Code |
|---|---|
| Per-player knowledge, comms, minimap, IGL fusion, trust | `packages/decision-engine/src/information.ts` (`InformationLayer`) |
| The team policy decides on the fused picture | `packages/team-engine/src/policy.ts` (`TeamDecisionPolicy.informed`, `setInfoProfiles`, `informationTrace`) |
| Player attributes → information attributes | `packages/match-runner/src/teams.ts` (`rosterInfoProfiles`); `match.ts` binds them each round, with one `CommsLedger` per match |
| Blind state on teammates, trace hook | `packages/round-simulator/src/view.ts` (`blindRemainingMs`), `simulator.ts` (`RoundResult.information`) |
| Tests | `packages/decision-engine/test/information.test.ts`, `packages/team-engine/test/information-layer.test.ts` |

## 1. What changed

Before: `buildPolicyView` pooled every player's sight and hearing into one `ObservationState`, and the IGL decided on it. The moment
anyone sensed something, the whole team knew it, exactly and at once.

Now, with the layer on, `TeamDecisionPolicy` passes the view through `InformationLayer.step` first and replaces `view.observation` and `view.belief`
with the IGL's fused picture. Everything downstream works unchanged: strategy, reconsider, hit belief, rotations, slow-plan
commit, pace, and utility. Only what reaches it is different. A view with no per-player observations (a scenario-built view)
passes through unchanged. The layer is off by default; `TeamPolicyOptions.information: true` (or `MatchConfig.informationLayer`) turns it on.

The pipeline runs once per decision (every 500 ms):

```
per player:  sense ─► knowledge items ─► call queue (one voice, lethal first) ─► delivered call
team:        minimap spots / recon reveals ─────────────────────────────────┐
IGL:         own senses (instant) + calls taken in + minimap noticed ───────┴─► claims & contacts ─► fuse ─► observation + belief
```

## 2. Attributes

| Attribute | Source (match-runner `rosterInfoProfiles`) | Unrated |
|---|---|---|
| `communication` | `communication` rating, else `trading` (a trade is a teammate acting on your call) | 0.6 |
| `awareness` | `mapAwareness` rating, else `impact` (the same gameSense proxy the duel layer uses) | 0.6 |
| `composure` | `clutch` | 0.6 |
| `callQuality` | mean(`impact`, `clutch`) (the decisionMaking proxy) | 0.6 |

The dataset rates neither `communication` nor `mapAwareness` today (`career/src/model.ts` UNRATED_KEYS), so the proxies apply.
`clutch` has no spread in the real data, so composure is 0.6 for real players and differs only for generated ones.

The **IGL** is the living player with the highest `callQuality` (ties: id). If the IGL dies, the next one takes the call and the
team's picture carries over.

## 3. Formulas

Times are on the round clock (ms since the round's first decision; it keeps running after the plant). Every coefficient below is a
named constant in `information.ts`. They are manual approximations that set the shape of each formula. Outcomes vary only through
the attributes and the situation.

### 3.1 Sensing (per player)

| Sensed | Confidence | Notes |
|---|---|---|
| Enemy in sight | `1 − 0.4·(d/4500)²·(1 − awareness)` | lethal if `d ≤ 1500` units or the player took damage this step |
| Sound (footsteps, landing, spike, reload…) | `hearConfidence = min(1, cue·(1 + 0.4·(awareness − 0.6)))` | the cue is the perception engine's signal strength (`1 − d/R`), the read the pooled engine was calibrated on; awareness moves it around the league average (0.6). One item per (kind, zone); footsteps carry the count of distinct sources |
| Shot / ability cue (team-level in the view) | same as sound | handed to the closest living teammate by run time, the one who heard it best |
| Damage taken | `0.7 + 0.3·awareness` | localised to the nearest gunfire cue; lethal |
| Silence (lurker / anchor only) | `0.6 + 0.4·awareness` | nothing sensed for `3000 + 4000·(1 − awareness)` ms → "clear" over the player's zone and its neighbours |

### 3.2 Calls (per player)

Load: `L = 0.8·inFight + 0.6·blinded + 0.25·(items − 1)`. Here `inFight` means an enemy is in sight or the player took damage, and
`blinded` means the round simulator reports flash time left.

| Quantity | Formula |
|---|---|
| reaction before speaking | `(200 + 500·(1 − comm))·(1 + L·(1 − composure))` ms |
| speaking one call | `SPEECH[kind]·(1.25 − 0.5·comm)` ms (sighting 450, footstep 600, gunfire 450, utility 550, spike 500, damage 400, clear 400, last call 800) |
| one voice | calls are serialised, with a 100 ms breath in between. Order is priority: last call 5 › damage 4 › lethal 3 › sighting/spike 2 › gunfire 1.5 › footsteps/utility 1 › other 0.5 › clear 0.3 |
| stale | a call that could not START within 3000 ms of the sensing is never made (`dropped`) |
| P(wrong) | `0.2·(1 − (comm + awareness)/2) + 0.15·L·(1 − composure)`. The error is a wrong zone (a neighbouring zone) or, for countable calls, a wrong count (+1 three times in four) |
| P(partial) | `0.4·L·(1 − comm)`. The count is dropped; a sighting loses who it was and becomes a body at a zone |
| re-calling | the same item is called again only once it is going stale (sighting 4 s, footsteps 2 s, gunfire 3 s, clear 6 s), or when there is more news (moved zone, more of them) and at least 1 s has passed |
| death | in-flight calls finish; queued calls are lost; one **last call** goes out (the most important recent item, with the count of enemies known, or "dead at <zone>" as a gunfire contact). After that the player is silent |

Every draw is a hash of (round, player, item, time), so a call's luck never depends on another call, and the policy's own RNG
stream is untouched.

### 3.3 Minimap (team)

An enemy in any teammate's sight is spotted on every minimap (the game rule), and recon reveals likewise. The IGL notices a new
spot after `glance = (300 + 1200·(1 − awareness_IGL))·(1 + L_IGL)` ms and then tracks it while it stays spotted. Sound, damage,
counts and silence never appear on the minimap. They come only by voice.

### 3.4 IGL fusion

| Quantity | Formula |
|---|---|
| taking in a delivered call | `(150 + 600·(1 − callQuality))·(1 + L_IGL·(1 − composure_IGL))` ms after delivery |
| claim weight | `w = 0.5^(age/5000) · confidence · trust^callQuality`. The minimap and the IGL's own senses have trust 1. It RANKS claims (which caller places an enemy or a sound, how a conflict splits the belief); it never scales the confidence passed on. A sharp IGL goes with its reliable callers when they disagree; a weak one goes with whoever is freshest |
| conflict | per enemy, the team picture uses the heaviest claim. The belief keeps every live claim as a weighted hypothesis, and the existing diffusion (`buildBeliefState`: staleness → spread over travel time) runs on top |
| forgetting | a claim is dropped below recency 0.1 (≈ 16.6 s). Footstep contacts are current for 3 s, other sounds for 10 s |
| several callers, one spot | the heaviest claim places it; footsteps take the largest count any caller gave; its confidence is the caller's heard confidence |
| departures | per site, of the enemies the IGL placed on its side in the last 16.6 s (`DEPARTURE_WINDOW_MS`, the forgetting horizon), how many it has since placed off it (`InformationLayer.departures`, from the placement history) |
| clear | claims and contacts placed in a cleared area before the clear call are dropped, and so are belief hypotheses there |

**Trust** in a reporter is a Beta posterior:

- prior mean `m0 = 0.5 + 0.4·(comm + awareness)/2 + role` (lurker, anchor +0.05), prior strength 6;
- updated by the match `CommsLedger`. A sighting call is *confirmed* when a minimap / IGL sighting of the same enemy within
  ±1.5 s puts it in the called zone or a neighbouring one, and *refuted* otherwise. A sound call is confirmed by a sighting nearby
  within 3 s; an unseen sound is never counted as a lie. A clear call is refuted when an enemy is spotted in the cleared area
  within 3 s after it;
- the ledger is keyed by the real player id and shared by both side policies, so the track record follows the player across the
  half.

## 4. What each attribute does

| Attribute ↑ | Outcome |
|---|---|
| communication | calls start sooner and are shorter; fewer wrong and partial calls; a burst of information drops fewer calls; higher trust prior |
| awareness | sharper sound / far-sight confidence; fewer wrong calls; shorter silence window (calls "clear" sooner); as IGL, notices minimap spots sooner; higher trust prior |
| composure | load (a fight, a flash, a burst) slows and degrades calls less; as IGL, takes in calls mid-fight faster |
| callQuality | the IGL acts sooner on a delivered call and weighs callers by their track record (`trust^q`); also picks who is IGL |

## 5. Role value from information

- **Lurker**: what they see is on the minimap. What they hear (rotations, utility, the defender who stayed) reaches the IGL by
  voice. Their **silence** is information too: after their silence window they call their lane clear. That removes stale sightings
  of defenders there from the IGL's picture (`enemySiteBias` drops for that site), which feeds the slow-plan site choice
  (`commitSlowPlan`) and the swing (`reconsider`). This is how "the far site looks open" becomes a call. It follows
  `docs/research/LURKER_ROLE.md` §4 (on branch `claude/suspicious-jones-8af005`), L7.
- **Anchor**: the same mechanism on defence. Early footstep calls from the anchor are the evidence `hit-belief.ts` rotates on, and
  they arrive only once called. A silent anchor clears their site of stale claims.
- Info roles get a small trust prior (+0.05): they are posted to watch that ground.

- **Rotators leaving** (LURKER_ROLE L7 rotator count): `hit-belief.ts` takes the layer's departures as evidence per site,
  `k ~ Binomial(m, r_role)` with r = hit 0.10 · show 0.60 · quiet 0.30. A hit's players stay, a show's leave to join the hit, so bodies
  seen leaving a site raise show(s) and, through the hit(t)+show(s) states, the hit on the other site. Only what reached the IGL
  counts: a wrong call can fake a departure, an unseen one is not counted.
- **A spotted lurker slows the rotation** (LURKER_ROLE L6): an enemy the IGL has placed off the likeliest hit site (another site's
  side or mid, seen in the last 8 s) pins one defender. The available player closest to it stays (`decideDefenseRotation`), and
  the call records "lurker spotted at Z: P stays". Rotators take the retake approach that avoids its zone. When the way still runs
  through it, they go around it (`rotate:around`, the next zone of the route that avoids it), or, with no way around, walk through
  it checking it, aimed at it (`rotate:check`).

Not done yet (LURKER_ROLE L11 and L6 attack side): a defence "lurk" hypothesis in hit-belief (single runners on a far lane,
silence), pair rotation, and the lurker choosing a lane to cut a rotator off.

## 6. Replay / debug

`TeamDecisionPolicy.informationTrace()` returns an `InformationTrace`:

- `igl`: who held the call, from when;
- `knowledge[playerId]`: each player's knowledge items as they formed (key, kind, enemy, zone, count, sensed-at, confidence, lethal);
- `comms`: every call. Each one has who, what was said vs what was known (`zone`/`knownZone`, `count`/`knownCount`), sensed /
  started / delivered / IGL-took-in times, `accuracy` (`exact | wrongZone | wrongCount | partial`), `lethal`, `lastCall`, `dropped`;
- `minimap`: spots and reveals with the time the IGL noticed them;
- `trust`: each reporter's trust at the round's end.

- `placements[enemyId]`: where the IGL placed each enemy, in order (zone, time, source) — what departures are read from.

`RoundRecord.information = { A, B }` (match-runner) carries both teams' traces on every round when
`MatchConfig.informationLayer` is on. That is the data for Match Day's "who called what"; there is no Match Day view of it yet.
`RoundResult.information = { attack, defense }` (round-simulator) carries them when `traceCommands` or `recordPerception` is on
and a side runs the layer. The team
trace (`TeamRoundTrace.evidence`) also records the IGL and the number of current calls behind each decision. Match Day can show
"who called what" from `comms`.

## 7. Validation

**The layer is OFF by default** (`MatchConfig.informationLayer`, `sim-batch --information`, `TeamPolicyOptions.information`).

Layer ON, seeds 1–160, real rosters:
- original 8: 7/8. Elimination is 0.672 against a pass mark of 0.674.
- attack win rate: 0.536.
- judged metrics: 12/15. Main is 13/15; semi vs full worsened from 0.349 to 0.397.
- seeds 161–320: not run.

These numbers predate the second package (double-damping fix, departures, lurker pin), which has not been gated yet.
With the flag off the match is byte-identical to main: `packages/match-runner/test/information-layer.test.ts` checks the hashes.

Full table, diagnosis and next step: [`docs/handoff/information-layer.md`](handoff/information-layer.md).
