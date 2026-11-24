# PROJECT V — Mid control (engine)

> **Off by default.** Turn on with `MatchConfig.midControl: true` (sim-batch `--mid-control`). It has not been through the real-roster gate.
> What is built, on `claude/nav-engine`. Research and the gap map it answers: [`research/MID_CONTROL.md`](research/MID_CONTROL.md).
> Rule kept: attribute × situation → a named formula that acts on belief or on a real route. No flat win bonuses.

## 1. What mid is, per map

`MapTactics.midArea` (`packages/spatial-engine/src/tactics.ts`, `deriveMidArea`) — derived from the zone data, no hand tables:

| Field | Rule |
|---|---|
| `zones` | every zone of type `mid` or with id `mid-…` that both sides can reach |
| `attackEntry`, `defenseEntry` | the mid zone each side reaches first from its spawn |
| `contest` | the mid zone with the smallest gap between the two arrivals — where the sides meet |
| `chokes` | each (mid zone, neighbour outside mid) pair, with the site that way leads to |
| `siteLinks[site]` | the fastest way from mid onto the site with the site's main entry, the other sites and both spawns shut: the second lane of a split. `null` when mid opens none |
| `attackSwitch`, `defenseRotate` | site-to-site time through mid and without it |
| `attackValue`, `defenseValue` | share of that trip mid saves, 0..1 (1 = no way round) |

| Map | Attack in | Defence in | Meet | Link A | Link B | Attack value | Defence value |
|---|---|---|---|---|---|---|---|
| Ascent | mid-top 7.6 s | mid-market 4.0 s | mid-catwalk | cubby › tree | market | 0.20 | 0.01 |
| Abyss | mid-catwalk 7.7 s | mid-top 8.4 s | mid-library | catwalk › vent › tower | bend › main | 0.00 | 0.03 |
| Breeze | mid-bottom 4.5 s | mid-nest 5.7 s | mid-top | top › pyramids | nest › arches › wall | 0.45 | 0.16 |
| Haven | mid-window 5.6 s | mid-courtyard 12.0 s | mid-courtyard | window › garden › lobby › long | courtyard (C: doors › lobby › long › cubby) | 1.00 | 0.00 |
| Icebox | mid-blue 8.6 s | mid-boiler 6.8 s | mid-blue | blue › belt › pipes › nest | boiler › hut › kitchen › hall | 1.00 | 0.38 |
| Pearl | mid-shops 3.5 s | mid-plaza 16.4 s | mid-connector | none | shops › club › ramp › main › screen | 1.00 | 0.10 |
| Split | mid-bottom 10.4 s | mid-vent 9.8 s | mid-mail | vent › tower › rafters | none | 0.17 | 0.03 |
| Sunset | mid-bottom 7.6 s | mid-top 4.0 s | mid-tiles | top › alley | courtyard › market | 0.20 | 1.00 |
| Bind, Fracture, Lotus | — | — | — | — | — | no mid zones in the data | |

Bind, Fracture and Lotus have no zone named or typed mid, so `midArea` is `null` and nothing below applies there. Whether those maps get a mid-equivalent region (Bind's teleporter lanes, Fracture's ropes, Lotus's B) is an open data question, not decided here.

Some derived links are long ways round rather than what a player would call a split lane (Icebox A, Pearl B, Haven A and C). They are what the rule returns on the current zone graph; they have not been checked against the game.

## 2. Control as a round state

`packages/team-engine/src/mid-control.ts`. One value **C ∈ [−1, +1]**: −1 the defence holds mid, +1 the attack does, 0 nobody. Both sides are read off it (`attack = max(0, C)`, `defense = max(0, −C)`); a side **holds** mid at |C| ≥ 0.4.

```
presence   w_side = bodies in mid + 0.5 · utility in mid
           v = (w_A − w_D) / (w_A + w_D)
           C ← C + (1 − e^(−Δt·s / 6 s)) · (v − C)
fights     each kill in mid:  C ← C + 0.35 · (±1 − C)      toward the killer's side
decay      nobody and nothing in mid:  C ← C · e^(−Δt / 15 s)
```

`s` is the reader's sharpness: 1 for the round record; ½ + mean `decisionMaking` of the living players for a team's own estimate (the factor its hit belief already uses). 2 v 1 in mid settles at ⅓ — outnumbering is not holding; a kill is what tips it.

The same update runs on two kinds of evidence:

| | Fed with | Where it is |
|---|---|---|
| **Truth** | every living player's zone each decision step, kills by the zone they happened in | `RoundRecord.mid` (`MidControlRecord`: final state, ms held per side, who held first, a sample every 2 s). Needs `collectStats` |
| **A team's estimate** | its own players in mid; enemies it sees there now or saw within 3 s; runners it hears there; its own utility thrown into mid; enemy utility heard there; a teammate who died in mid; an enemy who died while it was fighting there | `PlanSummary.mid.estimate` after the round, `TeamDecisionPolicy.midState()` during it, `TeamRoundTrace.evidence.midControl` per decision |

The two can disagree, and that is the point: a team that gave mid up does not know who stands in it.

**For the information layer** (`claude/amazing-mayer-2f95d0`): `midState()` returns `{ value, attack, defense, holder }` computed only from the `PolicyView`. It is an input team belief can consume as-is; when per-player knowledge and comms exist, the evidence counts in `updateMid` (`policy.ts`) are the place to swap "the team sees" for "what reached the IGL".

## 3. What control buys

Everything below is a route, a position or a timing — never a multiplier on a duel.

**Attack**

| Effect | Mechanism |
|---|---|
| Taking mid | on a contest, a party (two by default: the entry, and the lurker behind it) goes to the meeting zone and holds it watching the defenders' way in; the rest hold their lane as on any slow play |
| Hitting before the defence adjusts | mid believed held for 5 s commits the slow play at once instead of at the 40 s clock |
| Split hit | the party comes onto the named site by `siteLinks[site]` while the team comes through the main entry; the execute waits until both are staged |
| Fake through mid | at that commit, with neither site reading thin (two-site maps), the party shows the other site with probability `min(0.5, mean decisionMaking − 0.25)`; it only happens with the clock to make the show and still cross |
| Faster site switch | with mid held, time in mid no longer counts as time under the sites' eyes when the route between two zones is chosen, so the shorter way through mid wins over the way back through spawn |
| Information on both sites | not coded separately: players standing in mid see what its chokes show |
| Giving it up | the party is dead, the team believes mid lost (C ≤ −0.4), or it is a player down with no site named → the party rejoins the team, recorded as a plan revision |

**Defence**

| Effect | Mechanism |
|---|---|
| Holding mid | the mid player starts on the mid anchor, as before |
| Giving it up | the mid player starts on a site instead (fewest defenders first) |
| Rotations | a defender changing position goes round the attack's ground. Mid is added to that ground when the team believes the attack holds it, and removed when the team believes it holds mid itself — losing mid is what makes the rotation long |
| Blind on one side | not coded separately: with nobody in mid, movement through it is not seen, and the hit belief gets no evidence from mid zones |
| Short-handed | with three or fewer alive before the plant and nobody in sight, the mid player falls back to the site with the fewest defenders |
| Contest (manager only) | two players start in mid; while the team believes it holds mid, the more aggressive of them steps up to the meeting zone |

## 4. The decision

`decideMidCall` (mid-control.ts). A manager's stance is followed. Left to the IGL:

| Side | Rule |
|---|---|
| Attack | contests when the round's call is `midControl`. That call is drawn with weight `0.8 · (½ + attackValue / 0.4)` against an execute's 1 — 0.8 on Ascent (what it always was), 0.4 where mid saves nothing, 2.4 where there is no way round. Full buys only: on an eco or a partial buy the IGL plays for picks, as before |
| Defence | holds on a gun round; gives mid up on an eco (a pistol alone in mid loses the duel, and the team needs the body for the retake) |

Mid-round the IGL reads its own estimate: commit early when mid is held, split or fake as above, abandon when it is lost or the team is a player down.

Not built: a defence that chooses by itself to contest with two, and an opponent model of how often the other team takes mid.

## 5. The manager's option

`MatchConfig.teamInputs[slot].midPlans` — types in `packages/shared-types/src/mid-plans.ts`, same conventions as the plant / post-plant / retake plans (`plant-plans.ts`, engine-truth): optional fields, `"auto"` or a missing field = the IGL decides, the most specific key wins field by field.

```ts
midPlans: {
  "*":      { attack: { stance: "auto" },    defense: { stance: "giveUp" } },
  "ascent": { attack: { stance: "contest", count: 2, who: { roles: ["entry", "lurker"] } },
              defense: { stance: "contest", count: 2, who: { players: ["<playerId>"] } } },
}
```

| Field | Values |
|---|---|
| key | map id, or `"*"` for every map (the map's entry wins) |
| `stance` | `"auto"` \| `"contest"` \| `"giveUp"` |
| `count` | `"auto"` (attack 2, defence 1) or a number |
| `who` | `"auto"` \| `{ roles }` \| `{ players }` — roster player ids; roles are the engine's tactical roles. Attack: entry, lurker, support, rotator. Defence: anchor (its two most aggressive), rotator |

`resolveMidPlan(plans, mapId, side)` returns the resolved plan and `byManager` (which fields the manager set). The whole feature is behind `MatchConfig.midControl` (default `false`). Off, mid is only a label, `midPlans` is ignored, and matches are byte-identical to before it existed (checked with `match-signature.mts` against the previous commit).

**Output for Review** — `RoundRecord.decisions.plans[slot].mid` (`MidDecision`): `stance` (contest / hold / giveUp), `by` (auto / manager), `reason`, `party` (sim ids), `estimate`, `heldAtMs`, `lostAtMs`, `split`, `fake`, `rotatedAround`. Mid events are also in `plans[slot].revisions` ("mid: contest → mid: give up", "mid is held — hit before the defence adjusts"). The truth is `RoundRecord.mid`.

## 6. Real data

`vct.duckdb` holds round winners and end types but no kill events or positions, so first-kill location against round win and split-hit rates cannot be checked against VCT. The constants in §2 (6 s, 15 s, 0.35, 0.4, half a body per utility) and the 5 s commit are therefore **assumed**, not calibrated. They are `MidControlTuning` fields and can be fitted once event data exists (see research §8).

## 7. Measured

See the per-map table and the on / off comparison in [`handoff/maps-tactics.md`](handoff/maps-tactics.md).
