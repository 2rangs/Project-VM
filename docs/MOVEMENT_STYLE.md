# Movement style and the buy phase

Before this change every player in Match Day moved the same way: the executor (`round-simulator/src/mover.ts`)
walked each one along the single best path of its zone route on one of five fixed lanes, at the same speed, and
nobody moved before the round went live (players started on the centre of their spawn, or on the setup zone the
match gave them). Two modules fix that, each behind a small hook so the mover and the round loop stay as they were.

| Module | What it does | Switch |
| --- | --- | --- |
| `round-simulator/src/buy-phase.ts` | Simulates the 30 s barrier phase (`ROUND_RULES.buyPhaseMs`) | `SimConfig.buyPhaseMs` (0 = off) · `MatchConfig.buyPhase` (default **on**) · `sim-batch --no-buy-phase` |
| `round-simulator/src/movement-style.ts` | Per-player, per-round way of carrying out the same orders | `SimConfig.movementStyle` · `MatchConfig.movementStyle` (default `BUY_PHASE_ONLY_STYLE`: buy-phase script only) · `sim-batch --style` / `--no-style` |

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
| `spacing` | 1 + 1.0·trading·(0.75 + 0.5u) | executor: follow distance behind a teammate going the same way (× body gap; ≈ 1 m at 0.6). A follower whose full step would close the gap takes the longest of ¾, ½, ¼ of it that keeps the gap (standing the whole tick instead made a stack move at half speed) |
| `routeSlack` | role slack (entry 0.03, rotator 0.04, anchor 0.05, support/igl 0.06, lurker 0.16) · (0.6 + 0.8u) | route choice: how much slower an alternative zone route may be |
| `riskAversion` | 0.5 + gameSense | route score: weight on the team's believed threat |
| `routeTempMs` | 700·(1.2 − gameSense) | route choice: softmax temperature |
| `checkMs`, `checks` | 180 + 350·(1 − reaction) + 120u ms; round(1 + 2·gameSense·u′) per round | stop-and-check at a zone edge |
| `quiet` | gameSense × (lurker 1.3, anchor 1.1, support/igl/rotator 0.9, entry 0.6) | walk vs run: lurk approach, buy-phase setup |
| `buy.*` | buy time 2.5 + 4.5·(1 − gameSense)·(0.5 + u) s; wanders 1 + ⌊(1 − quiet)·2u + u⌋; wander radius 250–600 uu; set margin 1.5 + 3.5·gameSense·(0.5 + 0.5u) s | buy phase |

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
`quiet ≥ 0.5` walks the last 1500 uu of its own approach while the round is calm — not while it carries the spike,
and not when its order sends it where a teammate is going too (it is joining the execute).

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
- **Setup.** Every player ends the buy phase on its own standing spot in the setup the plan gives it — defenders in the
  zone the match sets each down in (the map's derived defender starts: anchors on the sites, the mid presence),
  attackers in their spawn — the same spot the round's executor would have put it on, facing where its first order
  points (a defender: the zone it is to watch or go to; an attacker: the exit its first move leaves by). The live
  round starts from the positions the duel calibration was fitted on; the buy phase is how the players get there.
  Measured and dropped (160 / 60 matches, real rosters): walking each defender all the way to its first order's
  target and onto a held angle (attack 0.43–0.46, opening duel 0.39–0.40), and a role stack at the attackers' exit —
  in the doorway, the five leave in single file.
- **Exact arrival.** Each player's setup spot is held for it in the buy-phase executor (nobody else buys, wanders
  or stands there), the final move is an exact `at` (no 100 uu tolerance), and every half second a player not yet
  running there checks the run from where it stands (× 1.25 + 1 s) and leaves at once if it would be late. With the
  live parts off, the round is then the very round without a buy phase (60/60 identical; before: 25/300 players
  off their spot, 9/20 pistol rounds different — the integrator's "buy phase costs pistol").
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

Numbers, flags and what is open: `docs/handoff/movement.md`. Default: buy-phase script only (`BUY_PHASE_ONLY_STYLE`); the live parts are behind `movementStyle: true` / `sim-batch --style`.
