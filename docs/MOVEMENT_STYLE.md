# Movement style and the buy phase

Before this change every player in Match Day moved the same way: the executor (`round-simulator/src/mover.ts`)
walked each one along the single best path of its zone route on one of five fixed lanes, at the same speed, and
nobody moved before the round went live (players started on the centre of their spawn, or on the setup zone the
match gave them). Two modules fix that, each behind a small hook so the mover and the round loop stay as they were.

| Module | What it does | Switch |
| --- | --- | --- |
| `round-simulator/src/buy-phase.ts` | Simulates the 30 s barrier phase (`ROUND_RULES.buyPhaseMs`) | `SimConfig.buyPhaseMs` (0 = off) · `MatchConfig.buyPhase` (default **on**) · `sim-batch --no-buy-phase` |
| `round-simulator/src/movement-style.ts` | Per-player, per-round way of carrying out the same orders | `SimConfig.movementStyle` · `MatchConfig.movementStyle` (default **on**) · `sim-batch --no-style` |

The bare `RoundSimulator` / `runMatchRound` keep both off by default, so the scenario tests are unchanged; the
match runner (and so sim-batch, the desktop and series) turns both on.

Nothing here is a flat bonus. Every field changes *where* a body is or *when* it gets there; the round's outcome
follows from those positions through the usual sight and duel models.

## 1. Movement style (`movement-style.ts`)

A `MovementStyle` is derived once per round from the player's attributes (`CombatSkills`, `TacticalTraits`), its
role in the round's first plan (`PolicyDecision.roles`) and the round seed. `u` is a seeded uniform draw per player
per round, so a player moves differently from round to round but identically on a replay of the same seed.

| Field | Formula | Used by |
| --- | --- | --- |
| `lane` | slot lane (0, ±0.35, ±0.7) + 0.5·(u − 0.5), clamped ±0.9 | executor: lateral offset inside the corridor |
| `spacing` | 1 + 2.5·trading·(0.75 + 0.5u) | executor: follow distance behind a teammate going the same way (× body gap; ≈ 1.5 m at 0.6) |
| `routeSlack` | role slack (entry 0.03, rotator 0.04, anchor 0.05, support/igl 0.06, lurker 0.16) · (0.6 + 0.8u) | route choice: how much slower an alternative zone route may be |
| `riskAversion` | 0.5 + gameSense | route score: weight on the team's believed threat |
| `routeTempMs` | 700·(1.2 − gameSense) | route choice: softmax temperature |
| `checkMs`, `checks` | 180 + 350·(1 − reaction) + 120u ms; round(1 + 2·gameSense·u′) per round | stop-and-check at a zone edge |
| `quiet` | gameSense × (lurker 1.3, anchor 1.1, support/igl/rotator 0.9, entry 0.6) | walk vs run: lurk approach, buy-phase setup |
| `buy.*` | buy time 2.5 + 4.5·(1 − gameSense)·(0.5 + u) s; wanders ⌊(1 − quiet)·3u + u⌋; wander radius 250–600 uu; set margin 1.5 + 3.5·gameSense·(0.5 + 0.5u) s | buy phase |

**Route choice.** `nearOptimalRoutes` finds the best zone route and the routes found by closing each of its
intermediate zones in turn, keeping those within `(1 + routeSlack)` of the best time. Each is scored
`time + 2500·riskAversion·Σ threat(zone) − 400·gameSense·#(zones on the way that see the goal)` (threat = the
side's belief `threatZones`, never true positions), and one is drawn by a softmax at `routeTempMs` with a uniform
fixed for (round, player, from, to) — the same request keeps the same route on every replan. A lurker's wide slack
is what takes it away from the group.

**Stop-and-check.** Before the round's first kill and while the spike is not down, a *walking* mover (a slow play,
a lurk, a careful approach — a running one is executing) reaching the edge of a zone that may hold an enemy — its
team's belief says so (threat ≥ 0.2), or the enemy could have reached it by now from the map alone (defenders from
anywhere behind their barrier, attackers from their spawn; graph run times × 1/1.5) — that no teammate already
stands in and that it has not checked yet, pauses `checkMs` there, while it has checks left. The pause is owed like a slow field's delay (`edgeProgressMs < 0`).

**Pace.** The tactical layer decides run/walk for its orders; the style only adds the quiet lurk: a lurker with
`quiet ≥ 0.5` walks the last 1500 uu of its approach while the round is calm.

Hooks: `MovementExecutor.setStyle(id, {lane, spacing})`, `MovementExecutor.routeChooser`, and in the round loop
`RoundMovementStyles.checkPauseMs` (in `canEnterZone`) and `.pace` (after a move order's `setGoal`).

## 2. Buy phase (`buy-phase.ts`)

The round's plan is made when the buy phase starts: each team policy's first decision, from exactly the state tick 0
would have seen (so the opening decision and its RNG draw are those of the old tick 0). The buy phase carries it out
behind the barriers, and tick 0 reuses that decision.

- **Barriers.** Attackers: their spawn zone. Defenders: every zone where their run from spawn takes at most
  `DEFENDER_BARRIER_SHARE` = 0.45 of the two spawns' combined run times (d / (a + d) ≤ 0.45), plus the zones the
  match sets defenders down in (their planned setup). Zones beyond it are sealed with zone blockers in a per-side
  executor, so paths and wanders stay behind the barrier. On Ascent the defenders' side is both sites and their
  backs, market, pizza, mid bottom, cubby, courtyard and A wine.
- **Setup.** Defenders go to the zone their first order names (anchor, retake spot, an early mid presence); if it lies
  beyond the barrier, to the last zone of its route on their side. A defender told what to watch takes a spot that
  sees it. Attackers stack in spawn by role at the exit their first move leaves by: the entry at the door
  (≈ 0.6 m), the lurker at its own exit (≈ 1.2 m), the support (≈ 2.2 m) and IGL (≈ 3.2 m) behind, each ± 0.8 m.
- **Script.** Everyone starts in its spawn, stands at its buy spot for `buy.buyMs`, wanders idly (walks to free
  spots within its wander radius) while that cannot make it late, then leaves for its setup so as to be set
  `buy.setMarginMs` before the barrier drops — walking there when it is quiet and has time.
- **Output.** `RoundResult.buyPhase = { durationMs, setups[], tracks? }`; with `recordTracks`, one frame per tick at
  elapsedMs −30000 … −100. `toSimGameEvents({ includeMoves })` emits `buyPhaseStart` (timeMs −30000) and the
  buy-phase moves at negative times before the round's own events.

## 3. Replay and desktop

- `@pv/replay-engine` `fromSimEventLog`: a `buyPhaseStart` gives the next round `ReplayRound.buyStartMs`.
- `apps/desktop` `mergeMatch`: each round is shifted so its buy phase fits after the previous round's gap.
- `timeline.ts`: `RoundTimeline.buyStartMs`; a round's window, tracks and playback start at its buy phase;
  `situationAt().buyPhase` and the HUD's "Buy phase" tag with the buy time counting down; the scrubber covers the
  buy phase. Jumps to the next round land on its buy phase.

## 4. Validation

See the branch's hand-over note for the 160-match numbers (real rosters, defaults).
