# PROJECT V — Navigation & movement engine (NAVIGATION_ENGINE.md)

**Date:** 2026-11-20 · **Branch:** `claude/nav-engine` (from `origin/main` `8cb75cd`) · not merged, not pushed.

Players used to be points that sat on a zone's centre and hopped to the next one. They now have a real,
continuous position on the map, found by geometric pathfinding on a roadmap measured from the map geometry, and
only one piece of code — the movement executor — may change it.

**Delivered:** Phases 1–3 (diagnosis, approach decision, the three-layer navigation), positional sight (§7b),
Phase 4 (tactical travel times are navigation path costs; route preference by intent from the team's belief,
§7c), Phase 5 (the navigation debug view in the desktop live match screen; the track shim removed, §4), the
Phase 6 tests and the 160-match validation after each step. The desktop app was typechecked, built and run:
unit, engine-contract and both Electron end-to-end suites pass, and rounds were watched in the live view.

**Balance, plainly:** 160 matches give **5 of 8 judged metrics, attack win rate 0.514** — the target before a
merge was 7 of 9 with attack 0.47–0.55, so the win rate is in range and the count is not. The three that fail
(detonation, defuse, time expired) have one measured cause, the retake after the plant (§7c). §9 lists what is
not done.

---

## 1. Diagnosis — how movement worked, and why it looked like straight lines

Pipeline on `main` before this work, with the code that implemented each step:

| Step | Where | What it did |
|---|---|---|
| Tactical objective | `team-engine/src/policy.ts` `TeamDecisionPolicy.decide` | Issues `ActionCommand { kind: "move", targetZone, moveMode }` per player |
| Target position | — | **None.** The target was a zone id; every player's destination was that zone's centre |
| Route planning | `round-simulator/src/simulator.ts` `ensurePath` → `spatial-engine` `ZoneGraph.findPath` | A\* over 22 zones; result a list of zone ids |
| Waypoints | `SimPlayer.path` / `pathIndex` | Zone ids only |
| Movement execution | `simulator.ts` `stepMovement` | Accumulated `edgeProgressMs`; when it reached the edge's time: `p.zoneId = next; p.position = { ...nextZone.position }` — a **jump** from centre to centre |
| Collision validation | — | **None at runtime.** Edges carried a validated polyline, used only for timing and for the recorded track |
| World-state position | `SimPlayer.position` | Always exactly a zone centre |
| Perception / combat / replay | `perception-engine/src/vision.ts`, `simulator.ts` `resolveEngagements`, `export.ts` `moveEvents` | Zone from `nearestZone(position)`; duel range = distance between two zone centres; replay drew `trackPosition()` (a point on the edge polyline) |

The ten failure modes asked about:

| # | Failure mode | Found? | Evidence |
|---|---|---|---|
| 1 | Movement by direction vector only | No | There was no vector at all: position was assigned, not integrated |
| 2 | Computed path ignored at execution | **Yes** | The edge polyline existed (`edge.route`) but `stepMovement` never moved `p.position` along it; only `trackPosition()` did, for display |
| 3 | Navmesh / world coordinate mismatch | No (now) | The Blender→game transform is exact (`MAPS_DATA.md` §3.1); the earlier 6.6 m affine was the mismatch and is gone |
| 4 | Straight-line fallback on path failure | **Yes** | `edgeTravelMs` fell back to the straight line between centres when two zones had no edge; 13 edges were flagged straight segments; `SpatialEngine.nearestZone` snapped any point to the nearest centre |
| 5 | Collision mesh unused in movement | **Yes** | No geometry of any kind was loaded at runtime |
| 6 | Walkable areas connected through walls | Partly | Not in the routes (ray-checked), but 13 zone-graph edges were straight "approx-links" across unconnected floor, and movers were attributed to zones through walls by nearest-centre lookup |
| 7 | Height / stairs lost | **Yes** | Ascent's zone heights were stale (A Rafters stored at the site's level); a zone hop changed z instantly |
| 8 | Tactical AI using Euclidean distance for travel | Partly | Travel *time* came from zone-graph edge times (route lengths since `d004919`); ranges and reach checks (`dist3(p.position, target.position)`) used centre-to-centre distance |
| 9 | Render transform making correct motion look straight | **Yes, originally** | Before tracks were recorded the views interpolated between zone centres |
| 10 | Skipping waypoints / teleporting | **Yes** | Every zone change was a teleport of `p.position`; a movement ability set the position to the target zone's centre |

**Root cause in one sentence:** the engine had no position between zones — `SimPlayer.position` was a zone's
centre by construction (`simulator.ts` `stepMovement`: `p.position = { ...nextZone.position }`), so everything
drawn or computed from it was a straight line between centres, and the walkable geometry that existed offline
never reached the runtime.

**Zone connectivity re-check.** The old note "21 of 22 Ascent zones connected" described the first 1.2 m grid
(B Boat House was isolated and bridged by an auto off-mesh link). On the current 0.5 m walk grid **all 22
Ascent zones are mutually reachable — 462 of 462 ordered pairs** — with no bridge. Per map (zone pairs reachable
on foot or by a drop, from the committed roadmaps):

| Map | Reachable zone pairs | Unreachable: real separation or data error? |
|---|---|---|
| Ascent | 462 / 462 | — |
| Bind | 552 / 552 (+ teleporter links) | — |
| Breeze | 506 / 506 | — |
| Fracture | 462 / 462 (+ zipline link) | — |
| Lotus | 756 / 756 | — |
| Sunset | 272 / 272 | — |
| Haven | 400 / 420 | **Data error.** B Site cannot be walked into (only dropped out of). In the game it is open floor; the art mesh leaves a gap or a blocking prop at its entrances |
| Icebox | 576 / 600 | **Real.** A Nest is reached by rope; ropes are not modelled |
| Split | 506 / 552 | **Real (ropes)** for Mid Vent; not verified for the other pairs |
| Abyss | 420 / 506 | **Unverified.** A Secret and B Danger are off the main floor; Abyss has jump gaps, so part of this may be real |
| Pearl | 506 / 650 | **Mostly data error.** Callout heights are unusable on Pearl, so several zones are snapped to the wrong floor |

## 2. Approach — compared and decided

| Criterion | Walk grid + roadmap (chosen) | PV-5 Recast NavMesh | navcat |
|---|---|---|---|
| Accuracy vs real walls | **Measured:** 0 of 52,372 roadmap edges hit solid geometry; every edge walked cell by cell | **Measured (PV-5):** 27 % of Ascent connected, 3 of 22 zones on the main component | Not measured. Same voxelisation pipeline as Recast (`rasterizeTriangles` → `buildCompactHeightfield` → `buildRegions`), so the same art-mesh problem is expected unless it is fed a cleaned surface |
| Height / multi-level | Yes: floor layers per cell, nodes carry z, stacked floors resolved by height band | Yes in principle | Yes in principle |
| Drops / special links | One-way drop edges measured; authored links (teleporter, zipline) with their own time | Off-mesh connections | `addOffMeshConnection` with `BIDIRECTIONAL` / `START_TO_END`; custom cost "not stated" in its README |
| Dynamic obstacles | Node / edge blocking with a version counter; replanning on change (tested) | Tile rebuild | Tile add / remove; "temp obstacles: not stated" |
| Performance, 10 movers | **Measured:** 11.6 ms per 5v5 round (1,000 rounds), was 15–29 ms before | Not measured | Not measured; its README says recast-navigation-js is faster at generation |
| Determinism | Yes: binary heap with index tie-break, no randomness; same seed → same tracks (tested) | Yes | "Not stated" |
| Adding a map | One script, ~6–10 s per map, all 11 maps done | Did not connect the one map tried | Unknown |
| Integration cost | None: plain JSON, ~70–200 KB per map, no dependency | WASM dependency, navmesh binary | New dependency; pure JS (MIT) |
| Can the data be committed? | Roadmap: yes (points and segments, no surfaces). The grid itself: no | No — a navmesh is the walkable surface as polygons | No — same; "fully JSON serializable" does not change what it is |

**Decision: keep the walk grid as the offline source of truth and navigate at runtime on a roadmap derived from
it.** The deciding facts are measured ones — Recast reached 27 % on this art geometry, the grid reaches 100 % on
Ascent with zero wall hits — plus one constraint: the repository may not contain a mesh or grid of the map, and
an engine whose navigation data lives outside the repository would not be self-contained or reproducible.

**navcat was verified from its repository but not run.** Read from `github.com/isaac-mason/navcat` on
2026-11-20: pure JavaScript, MIT, input is a triangle soup (`positions`, `indices`), `generateSoloNavMesh` /
`generateTiledNavMesh`, `findPath` returning `{ success, path }`, `findStraightPath`, `findNearestPoly`,
`raycast`, off-mesh connections, tiles that can be added and removed, a crowd block with agent and wall
avoidance. Its version could not be confirmed (the npm page returned 403 and the README states none). It would be
the natural next step if the project obtains geometry it may ship, or decides a navmesh may be committed: its
crowd and funnel paths are better than what a roadmap gives. It was not benchmarked here.

**What the roadmap costs.** Paths run node to node (a few metres apart), so they are slightly longer and more
angular than a true shortest path on a mesh; on Ascent the roadmap's zone-to-zone times are within 0.85–1.2× of
the measured edge routes (tested).

### Reuse of existing assets

Reused as is: the Blender extraction (`extract-map.py`), the walk grid with headroom and wall blocking, drop
links, the exact transform, the ray-check against solid triangles (`measure_map.py`, `route_map.py`,
`mapgeom.py`), the zone graph with its measured edge routes (now the strategic layer), sightlines and sound
links. New: `nav_map.py` (roadmap), `navigation.ts`, `mover.ts`. Retired at runtime: moving along `edge.route`
polylines (they remain as the zone graph's edge times and in the schematics).

## 3. The roadmap (`datasets/spatial/<map>/<map>.nav.json`)

`tools/map-mesh/pipeline/nav_map.py` builds it from the walk grid:

- **Nodes** — every zone anchor, then standable cells chosen widest-clearance-first with a 2.5 m minimum spacing
  (corridor centres and open floor come first). Each carries x, y, floor z, wall clearance and the zone whose
  floor it is on.
- **Edges** — straight segments between nodes up to 6 m apart, kept only if every grid cell the segment touches
  is a standable, walk-linked cell **and** rays at 0.7 m and 1.3 m above the floor hit no solid triangle. Each
  carries a half-width: how far a body may stray sideways and still be on floor.
- **Repair** — wherever two nodes' areas touch but no straight edge joins them, the grid path between them is
  added as a chain of bend nodes, so the roadmap reaches exactly what the grid reaches (checked for every zone
  pair on every map: 0 disagreements).
- **Drops** — one-way edges across a ledge, kept where they beat the walkable way by 30 %.
- **Links** — the authored special traversals of the zone graph (Bind's teleporters, Fracture's zipline) with
  their own travel time.

| Map | Nodes | Edges | Drops | Links | Edges hitting geometry | Size |
|---|---|---|---|---|---|---|
| Ascent | 1,328 | 4,181 | 215 | 0 | 0 | 91 KB |
| Abyss | 1,160 | 3,578 | 147 | 0 | 0 | 77 KB |
| Bind | 1,108 | 4,056 | 55 | 2 | 0 | 82 KB |
| Breeze | 2,671 | 9,884 | 262 | 0 | 0 | 207 KB |
| Fracture | 935 | 3,625 | 50 | 1 | 0 | 72 KB |
| Haven | 867 | 3,474 | 33 | 0 | 0 | 68 KB |
| Icebox | 2,119 | 6,477 | 284 | 0 | 0 | 144 KB |
| Lotus | 1,452 | 5,418 | 112 | 0 | 0 | 111 KB |
| Pearl | 1,391 | 4,547 | 150 | 0 | 0 | 96 KB |
| Split | 999 | 3,319 | 73 | 0 | 0 | 69 KB |
| Sunset | 894 | 3,813 | 27 | 0 | 0 | 73 KB |

**A decision for the integrator.** The roadmap is points and segments — no surfaces, no mesh, no grid — in the
same spirit as the edge polylines and footprint schematics already committed, but it is denser: about one point
per 6 m² of floor. If that is closer to "reproducing geometry" than the project wants in git, the eleven
`*.nav.json` files can move outside the repository; the engine loads them through one function
(`loadMapData`) and refuses to start a round without one rather than falling back.

## 4. The three layers

### A. Strategic route — the zone graph (`mover.ts` `strategicRoute`)

The zones to pass are chosen on the zone graph (`ZoneGraph.findPath`): travel time on the measured edge routes,
plus a cost per zone taken from the command's `zoneCosts` weighted by its `routePreference` (FASTEST ignores
it; TACTICAL 2.5 s, SAFEST and STEALTH 7 s per unit), minus zones sealed by a movement blocker. `zoneCosts` is
defined as the team's **belief** — the type and the request say so — and nothing in the navigation layer reads
enemy positions.

That route is a **corridor** for the next layer, and it defines the player's zone: a mover's zone is always one
of its route's zones. This matters. The geometric shortest path from B Lobby to B Site clips a corner of floor
nearest the Mid Link callout; without the corridor the carrier's zone became `mid-link`, the policy reacted,
turned it round, and it oscillated until the clock ran out — 42 % of rounds timed out and the attack won 6.6 %
(§7).

### B. Geometric path — the roadmap (`spatial-engine/src/navigation.ts` `Navigator.findPath`)

```ts
NavigationRequest  { actorId, start, destination, movementMode, routePreference,
                     zoneCost?, corridor?, hazards?, zoneEntryMs?, noTransitZones?, blockers?, startNodes? }
NavigationResult   { status: "SUCCESS", waypoints, pathLength, estimatedTravelMs, zones }
                 | { status: "UNREACHABLE" | "INVALID_START" | "INVALID_TARGET", reason }
```

A\* over roadmap nodes, cost in time. Floor outside the corridor costs 60 % more. A passable hazard (fire that
can be waited out, a slow field) is a disc: stepping into it costs its wait once, skirting it costs nothing.
Movement blockers remove nodes and edges. A mover re-planning mid-segment may only leave through the two ends
of the segment it is on, never through "the nearest node", which could be on the far side of a wall.
**There is no fallback:** with no path the result is UNREACHABLE with a reason, and a start or goal off the floor
is INVALID_START / INVALID_TARGET.

### C. Local execution — the executor (`round-simulator/src/mover.ts` `MovementExecutor`)

The only code that assigns `p.position`.

- **Own spot.** A player sent to a zone takes a standing spot there: a roadmap node of that zone near its
  anchor that nobody else holds, chosen deterministically per player. Five players sent to one zone stand on
  five spots.
- **Own lane.** Waypoints are shifted sideways per player, never further than the segment's half-width allows
  a 35 uu body with a 10 uu margin.
- **Continuous, no tunnelling.** Each tick's movement is consumed waypoint by waypoint along validated
  segments, at run (675 uu/s) or walk (340 uu/s) speed. Position, facing and zone update every tick.
- **Zone from position.** The zone of the nearer end of the segment the player is on, among the route's zones.
  The simulator publishes it (`SpatialEngine.setPositionZones`) so perception and every policy lookup made
  from a position agree with it.
- **Yielding.** A mover queues behind a mover going the same way for as long as it takes; it gives way to a
  body standing in its path (or to a lower-id mover coming head-on) for at most 6 ticks, then squeezes past.
- **Stacking up** (`simulator.ts` `stackedUp`). Teammates heading into the same next zone cross into it
  together: the first one at the boundary waits for teammates within 1.5 s behind it, for at most 2 s. Under
  zone-hopping everyone given the same order entered on the same tick; with real positions they arrive a few
  tenths of a second apart, and walking in one by one hands a holder a series of 1v1s. Design values.
- **New orders mid-path** are planned from where the player is.
- **Blockers.** When the blocker set changes, the remaining route is revalidated; if cut, it is re-planned; if
  nothing is left the player stops, the failure is traced (`RoundResult.navTrace`, `commandTrace`), and it
  plans again when the blockers change.
- **Links.** A teleporter holds the body for its travel time and then moves it; a zipline or rope carries it
  along the link. These are the only non-walking moves, and they are explicit edges.
- **Plant and defuse need arrival.** A player still walking to its spot cannot plant or defuse.

### Vision, movement and bullet blockers are separate

| Blocker | In the engine | Blocks |
|---|---|---|
| Vision | smoke, wall (`ability-engine` `blocksVision`) → cuts zone sightlines | sight only — a smoke is walked through (tested in `smoke-exit.test.ts`) |
| Movement | `SimState.movementBlockers` → `NavBlockers` | bodies only |
| Bullets | not modelled | — |

**No ability creates a movement blocker.** The catalog records walls as vision blockers ("temporary LoS block
with destructible HP") and says nothing about whether a body can pass, so nothing was invented: the mechanism is
implemented and tested, and a verified rule can attach to it in one place.

### Ground patches act where they are

Fire and slow fields used to be "in a zone". With real positions that let a mover already inside the zone walk
into a burning patch unchecked. They are now discs at a real point: a body is burned while it is on the disc; a
mover stops at the **rim** and waits, goes round, or crosses (the existing rule, unchanged); the planner prices
the disc, not the zone. Doorway patches keep their zone-boundary rule.

### The navigation debug view (desktop developer view)

`apps/desktop` live match screen → **Navigation (developer)** checkbox on the tactical map (off by default, not
persisted). It draws engine output only — nothing is re-planned in the renderer:

| Shown | From |
|---|---|
| Walkable floor: every roadmap segment at its measured width, every node at its clearance; one-way drops and links in their own colours | `src/data/sim/ascent.nav.json` (the file the engine loads) |
| Zone graph, and each zone's standing point ringed green (connected: most other zones can walk to it) or red (not) | navgraph + roadmap reachability (`matchday/navdebug.ts` `buildRoadmap`) |
| Per player of the viewed team: destination, the planned waypoints still ahead (coloured by route preference), the walked trace, every replan, every refused path | the round's `navTrace` (`RoundRecord.navTrace`, with `MatchConfig.recordTracks`) and the recorded tracks |
| Ground patches priced into a plan | `NavTraceEvent.hazards` |
| **Why this route**: one line per player — what the order is for → goal · route preference · zones avoided · length · time | `NavTraceEvent.intent / preference / avoided / pathLength / estimatedTravelMs` |

`scripts/track-shim.mts` is gone: the match scripts ask for `recordTracks` through `MatchConfig`, and the replay
export itself writes every player's starting position (a zero-length `move` at the first frame).

## 5. Tests

| Test | Requirement | Where | Result |
|---|---|---|---|
| A | Simple move | `spatial-engine/test/navigation.test.ts`, `round-simulator/test/movement.test.ts` | pass |
| B | Wall detour, never straight through | navigation (A Site → A Rafters: 16 m apart, path > 4× that) | pass |
| C | Multi-corner corridor | navigation (more than a half-turn in total) | pass |
| D | Unconnected → UNREACHABLE | navigation, every zone pair of all 11 maps | pass |
| E | Height via real slopes and drops | navigation (up: slopes only; down: a drop, 3× shorter) | pass |
| F | Goal behind a wall → longer length and time | navigation | pass |
| G | Dynamic blocker mid-move → revalidate / replan | navigation + movement (wall on Mid Bottom at 3 s; all ways sealed) | pass |
| H | Blocker removed → route available again | navigation + movement | pass |
| I | Ten players, no abnormal overlap or wall crossing | movement (24-round match: all positions on floor, < 0.2 % of living pairs within one body radius, no step longer than a run step) | pass |
| J | Path failure → no teleport, no straight fallback | navigation + movement (player does not move at all) | pass |
| K | Rotations at real travel times | movement (arrival within 300 ms of the plan, > 1.3× the straight line) | pass |
| L | Sight, range and footsteps from real positions | navigation + movement: sight between the two bodies' standing points (§7b), duel range between the two recorded positions; footsteps were already positional | pass |
| M | Same start / goal, different information → different route | navigation + movement | pass |
| M (real intents) | The policy's own annotation decides the route: entry FASTEST through believed danger, saver with a rifle SAFEST round it (1 believed zone crossed instead of 3, 26.8 s instead of 17.3 s), pistol saver TACTICAL, lurker off the team's lane, walked approach STEALTH; a real match's trace shows all of them and no unreachable goal | `team-engine/test/route-intent.test.ts`, `match-runner/test/route-intent.test.ts` | pass |
| Phase 4 | The tactical travel-time query equals the Navigator's cost for every Ascent zone pair (and differs from the zone graph's for > 90 % of them); spawn floor only when there is no other way; zones the roadmap cannot reach answer unreachable on every map | `spatial-engine/test/navigation.test.ts` | pass |
| Live view | Every recorded position of two real matches (52,635 and 33,323 positions) is on the roadmap's floor (0.00 uu off), every step and its midpoint too, longest step 67.5 uu, every track continuous, a start position for all ten players | `match-runner/test/movement-floor.test.ts` | pass |
| Debug view | Roadmap drawing model and zone connectivity, plan in force through time, waypoints ahead, walked trace, replans, failures, "why" text | `apps/desktop/test/navdebug.test.ts` (unit), `test/engine-contract.test.ts` (tracks + navigation trace from the real match script), `test/e2e.electron.test.mjs` (overlay on, 22/22 zones, five rows) | pass |
| N | Determinism | navigation + movement (tick for tick) | pass |
| O | Instant result equals spectated result | movement (recording tracks changes no event) | pass |
| P | Performance vs the current engine | `perf.test.ts` | 11.6 ms / round, see §6 |
| — | Local geometry only: every roadmap edge and every track position on a walkable grid cell | both suites, with `PV_MAPS_DERIVED` | pass here; skipped where the grid is absent |

Suites on this branch: spatial-engine 269, round-simulator 116 (115 + 1 skipped without the local grid),
match-runner 62, root 252;
`npx tsc --noEmit -p tsconfig.json` clean.

Existing tests changed because they encoded the zone-hop model: `stall-utility` (entering a zone and arriving
are now two moments; the patch is a disc), `smoke-exit` (a holder looking away no longer sees "mutually" — the
entry is outside its field of view), `trace-commands`, `contract-supplement`, `route-movement` (replaced by
`movement.test.ts`), and match-runner's mastery counterfactual (seed 9 → 10: with seeds 9 and 12 the raised
mastery no longer changes that game's score-and-calls signature; with 10 and 11 it does).

## 6. Performance

`perf.test.ts`, 1,000 scripted 5v5 rounds on Ascent, same machine: **11.6 ms per round** with the navigation
engine, against 15–29 ms for the zone-hop engine measured earlier the same day (the spread was machine load).
The scripted rounds are also shorter now, so this is not a like-for-like speed-up of the code; it shows that
geometric pathfinding for ten movers is not a cost problem. A path query is one A\* over ~1,300 nodes.

Phase 4 makes the policies ask the roadmap for travel times. Each (from, to, mode) answer is cached on the
`Navigator`; all 462 Ascent zone pairs cost 49 ms the first time and nothing after. The 160-match validation
(full team policies, 3,454 rounds) ran in 191 s — 55 ms per round, policies included.

## 7. 160-match validation

`sim-batch.mts --matches 160` (seeds 1..160), same machine and tool. **Before** = `origin/main` `8cb75cd`
(run here: 7/9, as reported). **After** = this branch. No walking speed, duel odds or other constant was retuned.

| Judged metric | Real (VCT) | Before | After | Verdict |
|---|---|---|---|---|
| Round ends by elimination | 0.714 | 0.674 | 0.705 | FAIL → pass |
| Round ends by spike detonation | 0.082 | 0.108 | 0.095 | pass → pass |
| Round ends by defuse | 0.160 | 0.189 | **0.078** | pass → **FAIL** |
| Round ends by time | 0.043 | 0.030 | **0.122** | pass → **FAIL** |
| Attack round win rate | 0.509 | 0.507 | 0.488 | pass → pass |
| Opening duel won by attack | 0.437 | 0.458 | **0.387** | pass → **FAIL** |
| Pistol vs pistol (attack) | 0.500 | 0.438 | 0.403 | FAIL → FAIL |
| Full buy vs full buy (attack) | 0.500 | 0.493 | 0.468 | pass → pass |
| Full buy vs eco (attack) | 0.960 | 1.000 | 1.000 | pass → pass |
| **Judged metrics passed** | | **7 / 9** | **5 / 9** | |

Mean round 54.0 s → 53.8 s. The attack win rate stays inside tolerance; the shape of rounds moved.

How it got here (each a 160-match run on this branch):

| State | Attack win rate | Timed out | Passed |
|---|---|---|---|
| Executor only (zone from the roadmap cell) | 0.066 | 0.418 | 0 / 8 |
| + strategic corridor, zone restricted to route zones | 0.421 | 0.138 | 1 / 8 |
| + mover faces the zone it enters | 0.482 | 0.119 | 4 / 8 |
| + stack-up and queueing (**committed**) | 0.488 | 0.122 | 5 / 9 |
| committed, without "plant needs arrival" (experiment, not kept) | 0.509 | 0.105 | 5 / 9 |

**Why the balance moved — what the data shows.** Eight matches traced on both engines (same seeds):

| First duel of the round | Before | After |
|---|---|---|
| Distance | 20.5 m | **30.9 m** |
| All duels: distance | 13.7 m | **26.9 m** |
| All duels: defender saw first | 2.4 % | **18.9 %** |
| All duels: defender was moving | 11 % | **40 %** |

1. **Fights start from twice as far.** Who sees whom is still decided by the two players' *zones*; how far
   apart they are now comes from their real *positions*. A mover is "seen" the moment its zone changes at the
   boundary, by a holder who may be standing at the far end of the next zone. Before, both were on zone centres
   (≈20 m apart, or 0 m inside one zone). Longer range favours the player who is standing still.
2. **So attackers lose more entries** (opening duel 0.458 → 0.387), lose the carrier early more often, and the
   last one or two survivors do what the policy tells outnumbered players to do: fall back to spawn and save.
   18 of 20 timed-out rounds traced were exactly that (carrier dead, spike on the floor in A Main or B Main,
   1–2 attackers holding at spawn). The timeouts are saves after a failed execute, not movers that got stuck.
3. **Fewer plants, and the ones that happen are held.** Plants fall from 29.7 % of rounds to 17.3 %; of those,
   detonations rise from 36 % to 55 % (why retakes got harder was not investigated).
4. **"Plant needs arrival"** costs the attack about 2 points (0.509 without it) and is not the cause of the
   timeouts (0.105 without it). It was kept: a player still walking is not planting.

This is the limitation listed first in §9, and it is the next thing to fix: with sight decided at real
positions (§10.2) a mover would be seen where it can actually be seen, not at the zone boundary. Nothing else
was adjusted to compensate.



### 7b. Positional sight (added after the table above)

Sight is now decided from where two bodies stand. `tools/map-mesh/pipeline/vis_map.py` casts eye-level segments
between every pair of roadmap nodes within 46 m against the map's solid, opaque triangles (a pair is visible when
either eye sees the other's eye or chest) and stores one bit per pair in `<map>.vis.json`. For Ascent: 420,860
pairs tested, 73,041 visible (17.4 %), 144 KB. `perception-engine/src/vision.ts` asks
`Navigator.sees(positionA, zoneA, positionB, zoneB)` after its distance and FOV checks; vision blockers keep
their zone rule on top (a smoke in either body's zone cuts the line between two different zones). Maps without
the file — every map but Ascent today — keep the zone sightline table. `PerceptionParams.vision.positionalSight
= false` switches it off.

160 matches with positional sight, nothing retuned:

| Judged metric | Real | `main` | Zone sight (§7) | **Positional sight** |
|---|---|---|---|---|
| Elimination | 0.714 | 0.674 | 0.705 | 0.675 |
| Spike detonation | 0.082 | 0.108 | 0.095 | **0.127** |
| Defuse | 0.160 | 0.189 | 0.078 | 0.101 |
| Time expired | 0.043 | 0.030 | 0.122 | 0.098 |
| Attack win rate | 0.509 | 0.507 | 0.488 | **0.465** |
| Opening duel (attack) | 0.437 | 0.458 | 0.387 | 0.383 |
| Pistol vs pistol | 0.500 | 0.438 | 0.403 | 0.403 |
| Full vs full | 0.500 | 0.493 | 0.468 | 0.489 |
| **Passed** | | 7 / 9 | 5 / 9 | **2 / 8** (two more miss by 0.004–0.005) |

It did what it was meant to do and it is not enough. Eight matches traced again, same seeds:

| | `main` | Zone sight | Positional sight |
|---|---|---|---|
| First duel: distance | 20.5 m | 30.9 m | **20.0 m** |
| All duels: distance | 13.7 m | 26.9 m | 19.6 m |
| First duel: attacker is moving | 83 % | 92 % | **98 %** |
| First duel: attacker pre-aimed | 4.7 % | 4.0 % | 0.6 % |
| All duels: defender saw first | 2.4 % | 18.9 % | **22.6 %** |
| Plants (share of rounds) | 29.7 % | 17.3 % | 22.8 % (real 24.2 %) |

- The range problem is gone: first contact is back at 20 m, and plants are close to the real rate.
- What remains is **who is ready when they meet**. On `main` a player "arrived" the instant it entered a zone,
  so one first duel in six found the attacker standing; now an attacker is still walking to its spot when it
  comes into view, in 98 % of first duels, and the duel model penalises a moving shooter.
- With real geometry a defender in *any* zone that actually overlooks the attacker's path sees it — from A Tree,
  A Rafters, A Window — where the zone table only had the eleven hand-authored lines. Attackers face the zone
  they are entering and nothing else, so one duel in five now starts with the defender seeing first.

Both are behaviours the movement spec names and this engine does not have yet (§9): a destination chosen for
its **cover** rather than its nearness to the callout, and **clearing angles** on the way in. They were not
attempted here, and no duel or perception constant was changed to compensate.

### 7c. Phase 4 — tactical travel times and route intents (added after §7b)

What changed:

- **Every travel-time judgement is a navigation path cost.** All of them — `team-engine` (site choice, staging,
  quiet-approach slack, spike recovery, retake approach, defuser commit, save), `action-generator` (rotation
  feasibility, arriving first, chase, support arrival) and the belief model (`decision-engine/belief.ts`, how far an
  unseen enemy can have got) — go through `SpatialQuery.shortestTravelTimeMs` / `findPath`. With a roadmap loaded
  those now answer from `Navigator.zoneTravelMs` (`spatial-engine/src/engine.ts` `navTravelMs`): the time of the
  path a mover will walk between the two zones' standing points. `isReachable` follows the roadmap too. Queries
  that carry hazards or blocked zones are still priced on the zone graph. `outcome-predictor` makes no travel-time
  query of its own.
- **Spawn floor is priced, not forbidden.** The zone partition gives the only stairs to A Rafters to defender
  spawn, so a rotating defender was refused the path (12 refusals in 105 rounds). A no-transit zone now costs the
  search 120 s — more than any detour — so it is used only when nothing else leads to the goal; the cost is never
  part of a reported travel time. Refusals in the same 105 rounds: 0.
- **Route preference by intent** (`team-engine/src/route-intent.ts`, applied to every move order at the end of
  `decideWithTrace`): entry / execute / retake / defuser / spike recovery / rotation → FASTEST; a saver holding a
  rifle, sniper or heavy → SAFEST with zone costs from the belief's `threatZones` (a cheap weapon → TACTICAL);
  the lurker's own lurk order → SAFEST, additionally priced off the zones teammates have announced as their
  route; a walked approach → STEALTH; the exit-kill chaser → FASTEST to the ground the attackers fall back to
  (the policy's existing choice of the believed escape). The costs read `view.belief.threatZones` and teammates'
  own routes only — nothing in a `PolicyView` is a true enemy position.
- In four traced matches: 3,027 planned paths — 2,271 FASTEST, 502 STEALTH, 251 SAFEST, 3 TACTICAL.

Two limits, stated plainly. Most plan orders name the *next* zone of the policy's own route, so there the
preference only decides how the floor between two neighbouring zones is crossed; it decides the whole way for
save, chase, retake and rotate orders, which name the goal. And routing *every* order of the lurker as a lurk
stalled rounds — the execute waits for the lurker — so the lurk routing applies to the lurk order only, and never
to the spike carrier (40 matches: time-expired rounds 28.8 % with it on every order, 9.1 % as shipped).

160 matches, nothing retuned:

| Judged metric | Real | `main` | Positional sight (§7b) | **Phase 4** |
|---|---|---|---|---|
| Round ends by elimination | 0.714 | 0.674 FAIL | 0.675 pass | **0.690 pass** |
| Round ends by spike detonation | 0.082 | 0.108 pass | 0.127 FAIL | **0.140 FAIL** |
| Round ends by defuse | 0.160 | 0.189 pass | 0.101 FAIL | **0.074 FAIL** |
| Round ends by time | 0.043 | 0.030 pass | 0.098 FAIL | **0.096 FAIL** |
| Attack round win rate | 0.509 | 0.507 pass | 0.465 FAIL | **0.514 pass** |
| Opening duel won by attacker | 0.437 | pass | 0.383 FAIL | **0.420 pass** |
| Pistol round (attack) | 0.500 | 0.438 FAIL | 0.403 FAIL | **0.466 pass** |
| Full buy vs full buy (attack) | 0.500 | pass | 0.489 pass | **0.511 pass** |
| **Judged passed** | | **7 / 9** | **2 / 8** | **5 / 8** |

Which part moved it (40 matches each, attack win rate): everything on 55.3 %; walked approaches left on FASTEST
55.5 %; travel times left on the zone graph 45.3 %. So the gain is the travel times — the policies' timing and
the belief model's "how far can they be" now match the floor the players actually walk — and the stealth routing
is neutral on the win rate (it lowers eliminations 70.5 % → 66.8 % when removed).

**The target (7 of 9, attack 0.47–0.55) is not met: 5 of 8, attack 0.514.** The three that fail are one thing —
what happens after the plant. Eight traced matches, 179 rounds, 104 plants:

- 64 of the 104 end with the **defenders eliminated**, 25 with a detonation, 15 with a defuse: the attack wins
  86 % of post-plant rounds.
- In 23 of the 25 detonations defenders were still alive and **no defuse was ever started**; in 13 no defender
  set foot in the site in the 45 seconds. Their orders in those rounds: 57 retake-stage, 36 retake-go, 17
  post-plant save, 16 solo retake, 13 defuser commit.
- It is the mechanism of §7b on the other side of the plant. The side that has to move is seen first from angles
  the zone table never had and fights while walking; before the plant that is the attack (now offset by better
  timing), after it that is the retaking defender, who walks one at a time into attackers standing on their
  post-plant spots. On `main` a retaker hopped onto the site centre and fought standing.
- The time-expired rounds are saves after a failed execute (§7), unchanged by Phase 4.

Nothing was adjusted to hide this. What it points at is in the movement spec and not built (§9): standing spots
chosen for cover and for the angle they hold, movers clearing the angles that overlook their path, and a retake
that enters together.

## 8. Path errors found and fixed along the way

| Error | Found by | Fix |
|---|---|---|
| A mover's zone taken from the nearest roadmap node could be a zone on the far side of a wall, and disagreed with the simulator's | `smoke-exit` duels happening before the zone change | Zone from the segment the mover is on; perception is given that zone |
| The geometric path clipped a neighbouring zone's floor and flipped the carrier's zone → oscillation, 42 % timeouts | match-runner round-end test, validation run | Strategic corridor; zone restricted to route zones |
| A mover inside a zone walked into a burning patch (the gate was at the zone boundary) | `stall-utility` | Rim gate at the disc |
| Fire priced per zone made the planner wait where it could skirt | `stall-utility` | Disc hazards in the planner |
| Re-planning from the nearest node could cross a wall | design review | Start nodes restricted to the current segment's ends |
| A Rafters stored at A Site's height; the 3D zone lookup put it on the site | navigation test | Ascent zone heights set to the measured floor |
| Pearl: two callouts on one spot gave a zero-length route | navigation test | Treated as stacked; flagged |
| A rotating defender was refused the way to A Rafters: its only stairs lie on floor the zone partition gives to defender spawn, and spawn floor was forbidden as a way through | navigation trace of four matches (12 refusals in 105 rounds) | Spawn floor is priced (used only when there is no other way), not forbidden |
| Routing every order of the lurker as a lurk stalled the execute that waits for it (time-expired 9 % → 28 %) | 160-match validation, 40-match ablation | Lurk routing on the lurk order only; never the spike carrier |

## 9. Not supported yet / not done

- **Cover, angles and a joint retake** — the behaviours §7c's remaining balance gap points at. A standing spot is
  "a free node near the zone's anchor"; nobody clears the angles overlooking its path; retakers arrive one at a
  time. There is no data for cover or held angles yet beyond the node-to-node visibility of §7b.
- **Chaser cut-off.** The chaser runs the fastest route to the ground the attackers fall back to (the policy's
  believed escape). It does not predict which exit a particular player will take.
- **Route preference on plan orders** acts between neighbouring zones only, because the policy hands out its own
  zone route one zone at a time (§7c).
- **The debug view shows Ascent.** The live view's map, zone graph and roadmap are Ascent's
  (`apps/desktop/src/data/sim/`); a series map other than Ascent is still drawn on Ascent, as before.
- **Movement blockers in the debug view.** No ability creates one, so the view has only ever drawn priced ground
  patches and "no path" marks from real matches; a `blocked` event is drawn the same way but has not been seen
  outside the simulator's own tests.
- **Sight is positional on Ascent only.** The other ten maps have no `<map>.vis.json` yet (about 2.3 MB for all
  of them; not generated while the question of what navigation data may be committed is open) and keep the
  zone sightline table. Sight is decided between the roadmap nodes the two bodies stand at (≤ ~1.3 m from the
  body), not between exact positions. Ability effects that reveal or blind (recon, flash) and tracers still use
  zone sightlines.
- **Intent-based spots.** A spot is "a free node near the zone's anchor". Cover, the angle being held, an entry
  position at the edge of a space, a plant spot on the plant area — none of that is modelled; there is no data
  for it yet.
- **Standing players do not shift.** No shoulder-checks or repositioning after being seen.
- **Ropes, ziplines on Icebox / Split, rotating doors, breakable walls, fall-off edges**: as in
  `MAPS_DATA.md` §5. Only Bind's teleporters and Fracture's zipline are links.
- **Jumping.** A step up to 0.6 m is walkable; anything higher is not climbable. Jump-only routes do not exist.
- **Bullet blockers** are not modelled.
- **Plant / defuse position.** Both are still "in the zone", not "at the spike".
- **Other maps are not playable** for the reasons in `MAPS_DATA.md` §6; Haven's B Site and most of Pearl are
  additionally unreachable on the roadmap (§1).
- **navcat was not benchmarked** (§2).

## 10. Next priorities

1. Cover and angles (§7b, §7c): choose a standing spot by what can see it, make a mover check the angles that
   overlook its path, and bring a retake in together — the measured cause of the three metrics still outside.
2. Let the policies hand the navigation layer the final goal instead of one zone at a time, so SAFEST / STEALTH
   decide the whole route for plan orders too.
3. Spot semantics (cover / angle / plant area) once there is data for them; plant and defuse at the spike.
4. `<map>.vis.json` for the other ten maps; fix Haven B Site and Pearl in the source data so their zones connect.

## 11. Reproduce

```bash
PY=<python with numpy>; D=<derived dir outside the repo>
$BLENDER --background --factory-startup --python tools/map-mesh/blender/extract-map.py -- --blend Ascent.blend --out-dir $D/ascent
$PY -I tools/map-mesh/pipeline/nav_map.py --map ascent --derived $D/ascent      # datasets/spatial/ascent/ascent.nav.json
PV_MAPS_DERIVED=$D npx vitest run     # in packages/spatial-engine and packages/round-simulator
```
