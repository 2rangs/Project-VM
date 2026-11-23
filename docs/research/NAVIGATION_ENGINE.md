# PROJECT V — Navigation & movement engine (NAVIGATION_ENGINE.md)

**Date:** 2026-11-20 · **Branch:** `claude/nav-engine` (from `origin/main` `8cb75cd`) · not merged, not pushed.

Players used to be points that sat on a zone's centre and hopped to the next one. They now have a real,
continuous position on the map, found by geometric pathfinding on a roadmap measured from the map geometry, and
only one piece of code — the movement executor — may change it.

| | |
|---|---|
| **Built** | Roadmap navigation on all eleven maps' data; movement executor with continuous positions; sight decided between real positions (Ascent); every tactical travel time taken from the navigator; route preference by intent; standing spots by intent; the navigation debug view in the desktop app |
| **Checked** | Every recorded position of whole real matches is on walkable floor (§5). All engine suites, desktop typecheck, build, unit, engine-contract and both Electron end-to-end runs pass |
| **Balance** | 160 matches: **8 of 8 judged metrics, attack win rate 0.521** — the target before a merge (at least 7, attack 0.47–0.55) is met, and it holds on two unseen seed ranges (8 / 8 each). The movement work alone reached 6 of 8; the last two were closed by calibrating the moving-shot model and the attack's save threshold, at the user's request (§7.2) |
| **Playable** | Ascent only. The other ten maps have roadmaps but are not playable (§9) |

Contents: 1 diagnosis · 2 approach · 3 navigation data · 4 how it works · 5 tests · 6 performance · 7 balance ·
8 errors fixed · 9 not done · 10 next · 11 reproduce.

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

## 3. Navigation data

Two files per map under `datasets/spatial/<map>/`, both derived offline from the user-provided Blender maps.

### 3.1 The roadmap — `<map>.nav.json`

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

### 3.2 Line of sight between roadmap points — `<map>.vis.json`

`tools/map-mesh/pipeline/vis_map.py` casts eye-level segments between every pair of roadmap nodes within 46 m
against the map's solid, opaque triangles (a pair is visible when either eye sees the other's eye or chest) and
stores **one bit per pair**. Ascent: 420,860 pairs tested, 73,041 visible (17.4 %), 144 KB. Only Ascent has
this file so far; the other ten would total about 2.3 MB and need each map's mesh re-extracted locally.

### 3.3 What is in git, and by whose decision

**Decided by the user on 2026-11-20:** the eleven roadmaps and the visibility tables are committed. They hold
points, segments and bits only:

- roadmap — stand points (`[x, y, floor z, clearance, zone]`, at least 2.5 m apart, about one per 6 m² of
  floor), walkable segments (`[a, b, half-width]`), one-way drops, authored links, zone anchors and the
  generator's own check figures;
- visibility — one bit per pair of roadmap points, no coordinates.

Neither holds triangles, vertex buffers, faces, materials, grid cells, voxels or a height map — no surface in
any form — and a mesh cannot be rebuilt from them. Meshes (`mesh.npz`), walk grids (`walkable.json`,
`footprint.npz`) and every other surface geometry stay outside git, generated locally under the derived
directory. The map IP is still Riot's; this is a decision about a development repository, not a redistribution
right. Recorded with its caveats in `docs/LICENSE_AUDIT.md` §2.0b.

The desktop app carries copies of Ascent's two files (`apps/desktop/src/data/sim/`).

## 4. How it works

Three layers, each with one job: choose the zones (A), find the floor (B), move the body (C).

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
(§7.4).

### B. Geometric path — the roadmap (`spatial-engine/src/navigation.ts` `Navigator.findPath`)

```ts
NavigationRequest  { actorId, start, destination, movementMode, routePreference,
                     zoneCost?, corridor?, hazards?, zoneEntryMs?, noTransitZones?, blockers?, startNodes? }
NavigationResult   { status: "SUCCESS", waypoints, pathLength, estimatedTravelMs, zones }
                 | { status: "UNREACHABLE" | "INVALID_START" | "INVALID_TARGET", reason }
```

A\* over roadmap nodes, cost in time.

- Floor outside the corridor costs 60 % more.
- A passable hazard (fire that can be waited out, a slow field) is a disc: stepping into it costs its wait
  once, skirting it costs nothing.
- Movement blockers remove nodes and edges.
- Spawn floor is priced, not forbidden: a no-transit zone costs the search 120 s — more than any detour — so it
  is crossed only when nothing else leads to the goal (the only stairs to A Rafters lie on floor the zone
  partition gives to defender spawn). The cost is never part of a reported travel time.
- A mover re-planning mid-segment may only leave through the two ends of the segment it is on, never through
  "the nearest node", which could be on the far side of a wall.

**There is no fallback.** With no path the result is UNREACHABLE with a reason, and a start or goal off the
floor is INVALID_START / INVALID_TARGET. The player does not move.

### C. Local execution — the executor (`round-simulator/src/mover.ts` `MovementExecutor`)

The only code that assigns `p.position`.

- **Own lane.** Waypoints are shifted sideways per player, never further than the segment's half-width allows
  a 35 uu body with a 10 uu margin.
- **Continuous, no tunnelling.** Each tick's movement is consumed waypoint by waypoint along validated
  segments, at run (675 uu/s) or walk (340 uu/s) speed. Position, facing and zone update every tick.
- **Zone from position.** The zone of the nearer end of the segment the player is on, among the route's zones.
  The simulator publishes it (`SpatialEngine.setPositionZones`) so perception and every policy lookup made
  from a position agree with it.
- **Facing.** A mover faces the next zone of its route, as a body rounding a corner looks into the room.
- **Bodies in the way** (`bodyAhead`). A mover follows a mover going the same way. Two movers meeting head-on:
  the lower id has the right of way, the other gives way for at most 6 ticks and then squeezes past; head-on is
  judged by where the other mover is *trying* to go. It gives way to a standing body the same way. A queue that
  has not moved at all for 3 s is passed.
- **Stacking up** (`simulator.ts` `stackedUp`). Teammates heading into the same next zone cross into it
  together: the first one at the boundary waits for teammates within 1.5 s behind it, for at most 2 s. Design
  values.
- **New orders mid-path** are planned from where the player is; a replan keeps the standing spot it was going to.
- **Blockers.** When the blocker set changes, the remaining route is revalidated; if cut, it is re-planned; if
  nothing is left the player stops, the failure is traced (`RoundResult.navTrace`, `commandTrace`), and it
  plans again when the blockers change.
- **Links.** A teleporter holds the body for its travel time and then moves it; a zipline or rope carries it
  along the link. These are the only non-walking moves, and they are explicit edges.
- **Plant and defuse need arrival.** A player still walking to its spot cannot plant or defuse.

**Standing spots by intent** (`SpotIntent`). Five players sent to one zone stand on five spots. Which spot is
decided by what the stop is for — read from the state of the round and the order's own fields, never from the
policy's labels:

| Intent | Who | Spot |
|---|---|---|
| `plant` | the spike carrier heading for a plantable zone | on the plant area, scored by distance from where its route enters the zone and by how much of the other zones can see it (`Navigator.exposure`), equally weighted. On A Site from A Main that is the least exposed of the thirty plant points (seen from 12 standing points of other zones; the area's median is 36) — 15 m in, where the callout is 11 m in |
| `at` | a defender heading for the zone the spike is planted in | the standing point nearest the spike |
| `hold` | a mover whose order says what to watch (`aimZone`) — **only with `SimConfig.coverSpots`, default off** (§7.3) | a spot that sees the watched zone and that the rest of the map sees least, near where the route enters |
| `stand` | everyone else, and everybody at round start | a free point near the zone's anchor, chosen deterministically per player |

`plantable` stays a property of the zone, and a defuse can still be done from anywhere in the spike's zone —
only the destination changed.

### D. Tactical layers plan with the same floor

**Every travel-time judgement is a navigation path cost.** All of them — `team-engine` (site choice, staging,
quiet-approach slack, spike recovery, retake approach, defuser commit, save), `action-generator` (rotation
feasibility, arriving first, chase, support arrival) and the belief model (`decision-engine/belief.ts`: how far
an unseen enemy can have got) — go through `SpatialQuery.shortestTravelTimeMs` / `findPath`. With a roadmap
loaded those answer from `Navigator.zoneTravelMs` (`spatial-engine/src/engine.ts` `navTravelMs`): the time of
the path a mover will walk between the two zones' standing points. `isReachable` follows the roadmap too.
Queries that carry hazards or blocked zones are still priced on the zone graph. `outcome-predictor` makes no
travel-time query of its own.

**Route preference by intent** (`team-engine/src/route-intent.ts`, applied to every move order at the end of
`decideWithTrace`):

| Order | Preference | Zone costs |
|---|---|---|
| Entry, execute, retake, defuser, spike recovery, rotation | FASTEST | none |
| Exit-kill chase | FASTEST, to the ground the attackers fall back to (the policy's believed escape) | none |
| Save, holding a rifle, sniper or heavy | SAFEST | the belief's `threatZones` |
| Save, holding a cheap weapon | TACTICAL | the belief's `threatZones` |
| The lurker's own lurk order (never the spike carrier) | SAFEST | `threatZones`, plus the zones teammates have announced as their route |
| A walked approach | STEALTH | the belief's `threatZones` |

The costs read `view.belief.threatZones` and teammates' own routes only — nothing in a `PolicyView` is a true
enemy position. In four traced matches: 3,027 planned paths — 2,271 FASTEST, 502 STEALTH, 251 SAFEST,
3 TACTICAL.

Two limits. Most plan orders name the *next* zone of the policy's own route, so there the preference only
decides how the floor between two neighbouring zones is crossed; it decides the whole way for save, chase,
retake and rotate orders, which name the goal. And the lurk routing applies to the lurk order only: once the
team commits, the execute waits for the lurker, and a detour there stalls the round (§7.3).

### E. Sight is decided where two bodies stand

`perception-engine/src/vision.ts` asks `Navigator.sees(positionA, zoneA, positionB, zoneB)` after its distance
and field-of-view checks, using the table of §3.2. Vision blockers keep their zone rule on top (a smoke in
either body's zone cuts the line between two different zones). Maps without the table — every map but Ascent
today — keep the zone sightline table. `PerceptionParams.vision.positionalSight = false` switches it off. The
observation / belief separation is unchanged.

### F. Vision, movement and bullet blockers are separate

| Blocker | In the engine | Blocks |
|---|---|---|
| Vision | smoke, wall (`ability-engine` `blocksVision`) → cuts zone sightlines | sight only — a smoke is walked through (tested in `smoke-exit.test.ts`) |
| Movement | `SimState.movementBlockers` → `NavBlockers` | bodies only |
| Bullets | not modelled | — |

**No ability creates a movement blocker.** The catalog records walls as vision blockers ("temporary LoS block
with destructible HP") and says nothing about whether a body can pass, so nothing was invented: the mechanism is
implemented and tested, and a verified rule can attach to it in one place.

### G. Ground patches act where they are

Fire and slow fields used to be "in a zone". With real positions that let a mover already inside the zone walk
into a burning patch unchecked. They are now discs at a real point: a body is burned while it is on the disc; a
mover stops at the **rim** and waits, goes round, or crosses (the existing rule, unchanged); the planner prices
the disc, not the zone. Doorway patches keep their zone-boundary rule.

### H. The navigation debug view (desktop developer view)

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
| I (bodies) | Two players meeting head-on pass each other; two who turn round together both get back; nobody stands still for more than 3.5 s | movement | pass (the first fails on the code before the fix in §8) |
| J | Path failure → no teleport, no straight fallback | navigation + movement (player does not move at all) | pass |
| K | Rotations at real travel times | movement (arrival within 300 ms of the plan, > 1.3× the straight line) | pass |
| L | Sight, range and footsteps from real positions | navigation + movement: sight between the two bodies' standing points, duel range between the two recorded positions; footsteps were already positional | pass |
| M | Same start / goal, different information → different route | navigation + movement | pass |
| M (real intents) | The policy's own annotation decides the route: entry FASTEST through believed danger, saver with a rifle SAFEST round it (1 believed zone crossed instead of 3, 26.8 s instead of 17.3 s), pistol saver TACTICAL, lurker off the team's lane, walked approach STEALTH; a real match's trace shows all of them and no unreachable goal | `team-engine/test/route-intent.test.ts`, `match-runner/test/route-intent.test.ts` | pass |
| N | Determinism | navigation + movement (tick for tick) | pass |
| O | Instant result equals spectated result | movement (recording tracks changes no event) | pass |
| P | Performance vs the previous engine | `perf.test.ts` | 11.6 ms / round, see §6 |
| Travel times | The tactical travel-time query equals the Navigator's cost for every Ascent zone pair (and differs from the zone graph's for > 90 % of them); spawn floor only when there is no other way; zones the roadmap cannot reach answer unreachable on every map | navigation | pass |
| Spots | The carrier stops on the plant area at a covered point and plants there; a defender sent onto the spike stops at the spike and defuses; with cover spots on, a mover told what to watch takes a spot that sees it; a replan keeps the spot; exposure equals a brute-force count | movement, navigation | pass |
| Live view | Every recorded position of two real matches (52,635 and 33,323 positions) is on the roadmap's floor (0.00 uu off), every step and its midpoint too, longest step 67.5 uu, every track continuous, a start position for all ten players | `match-runner/test/movement-floor.test.ts` | pass |
| Debug view | Roadmap drawing model and zone connectivity, plan in force through time, waypoints ahead, walked trace, replans, failures, "why" text | `apps/desktop/test/navdebug.test.ts` (unit), `test/engine-contract.test.ts` (tracks + navigation trace from the real match script), `test/e2e.electron.test.mjs` (overlay on, 22/22 zones, five rows) | pass |
| — | Local geometry only: every roadmap edge and every track position on a walkable grid cell | navigation + movement, with `PV_MAPS_DERIVED` | pass where the grid is present; skipped otherwise |

Suites at the head of the branch:

| Suite | Result |
|---|---|
| root `npx vitest run` (PV-core packages incl. team-engine) | 259 passed, 4 todo |
| `packages/combat-engine` | 21 passed |
| `packages/spatial-engine` | 265 passed, 22 skipped (local grid absent) |
| `packages/round-simulator` | 121 passed, 1 skipped (local grid absent) |
| `packages/match-runner` | 70 passed |
| `packages/perception-engine` | 22 passed |
| `apps/desktop` typecheck, build | clean |
| `apps/desktop` `test:unit` / `test:matchday` / `test:engine` | 48 / 29 / 4 passed |
| `apps/desktop` `test:e2e`, `test:e2e:series` (Electron) | both pass |

Existing tests changed because they encoded the zone-hop model: `stall-utility` (entering a zone and arriving
are now two moments; the patch is a disc), `smoke-exit` (a holder looking away no longer sees "mutually" — the
entry is outside its field of view), `trace-commands`, `contract-supplement`, `route-movement` (replaced by
`movement.test.ts`), seven scene tests that assumed two callouts see each other (now placed with sight-aware
fixtures), `molly-hazard` (the player is put on the patch explicitly), match-runner's mastery counterfactual
(seed 9 → 10: with seeds 9 and 12 the raised mastery no longer changes that game's signature; with 10 and 11 it
does), and one desktop timeline assertion that now allows one tick (its fixture predates the measured edge
times).

## 6. Performance

`perf.test.ts`, 1,000 scripted 5v5 rounds on Ascent, same machine: **11.6 ms per round** with the navigation
engine, against 15–29 ms for the zone-hop engine measured earlier the same day (the spread was machine load).
The scripted rounds are also shorter now, so this is not a like-for-like speed-up of the code; it shows that
geometric pathfinding for ten movers is not a cost problem. A path query is one A\* over ~1,300 nodes.

The policies ask the roadmap for travel times. Each (from, to, mode) answer is cached on the `Navigator`; all
462 Ascent zone pairs cost 49 ms the first time and nothing after. A 160-match validation with full team
policies (about 3,440 rounds) runs in about three minutes — roughly 55 ms per round, policies included.

## 7. Balance — 160-match validation

`tools/data-validator/scripts/sim-batch.mts --matches 160` (seeds 1..160, Ascent), judged against VCT priors.

> **Condition note (2026-11-23).** Every number in this section was measured with both teams at
> league-average ratings: `sim-batch` read team ids as `t.id`, which game-data does not have, so no
> roster was ever loaded (`--mirror` reproduces these runs exactly). With real rosters the same 160
> matches pass 6 of 8 and the attack win rate is 0.460 (seeds 1–160) / 0.484 (161–320) — see
> `SIM_BASELINE_2026-11-23.md`.
Through the whole movement work (every row of §7.4 but the last) no walking speed, duel odds or other constant
was retuned. The last step is a calibration of two constants, done at the user's request and described in §7.2.

### 7.1 Where it stands

| Judged metric | Real (VCT) | Pass band | `main` (`8cb75cd`) | Movement work only | **Head of branch (calibrated)** |
|---|---|---|---|---|---|
| Round ends by elimination | 0.714 | ± 0.04 | 0.674 FAIL | 0.711 pass | **0.704 pass** |
| Round ends by spike detonation | 0.082 | ± 0.04 | 0.108 pass | 0.094 pass | **0.106 pass** |
| Round ends by defuse | 0.160 | ± 0.04 | 0.189 pass | 0.104 FAIL | **0.148 pass** |
| Round ends by time | 0.043 | ± 0.04 | 0.030 pass | 0.092 FAIL | **0.042 pass** |
| Attack round win rate | 0.509 | ± 0.04 | 0.507 pass | 0.480 pass | **0.521 pass** |
| Opening duel won by attack | 0.437 | ± 0.04 | 0.458 pass | 0.412 pass | **0.462 pass** |
| Pistol vs pistol (attack) | 0.500 | ± 0.05 | 0.438 FAIL | 0.466 pass | **0.528 pass** |
| Full buy vs full buy (attack) | 0.500 | ± 0.05 | 0.493 pass | 0.482 pass | **0.495 pass** |
| Full buy vs eco (attack) | 0.960 | ± 0.05 | 1.000 pass | not judged | not judged — that matchup does not occur in the batch |
| **Judged passed** | | | **7 / 9** | **6 / 8** | **8 / 8** |

The target before a merge was at least 7 judged metrics with the attack win rate inside 0.47–0.55. It is met.

The calibration was done on seeds 1..160, so it was checked on seeds it had not seen:

| Seeds | Attack | Elim. | Deton. | Defuse | Time | Opening | Pistol | Full | Passed |
|---|---|---|---|---|---|---|---|---|---|
| 1..160 (calibration) | 0.521 | 0.704 | 0.106 | 0.148 | 0.042 | 0.462 | 0.528 | 0.495 | 8 / 8 |
| 161..320 | 0.535 | 0.725 | 0.098 | 0.141 | 0.037 | 0.472 | 0.512 | 0.508 | 8 / 8 |
| 321..480 | 0.519 | 0.717 | 0.099 | 0.144 | 0.040 | 0.459 | 0.494 | 0.484 | 8 / 8 |

### 7.2 Why the last two failed, and what closed them

With the movement work alone, defuse (0.104) and time expired (0.092) were outside. Sixteen matches on `main`
and on the branch at that point:

| | `main` | movement work only |
|---|---|---|
| Rounds with a plant | 63 % | 51 % |
| Mean time of the plant | 36.2 s | 37.9 s |
| Deaths before the plant, per round | 4.1 | 4.8 |
| …attackers : defenders | 817 : 540 (1.51) | 1005 : 624 (1.61) |
| Rounds the attack calls a save before planting | 21, of which 12 run out the clock | 42, of which 27 run out the clock |

With real movement there is more fighting before the spike is down — the attackers walk onto the site and the
carrier has to reach a spot and stop, where they used to arrive by a hop and start planting — and the attack
loses a little more of it. So twice as many rounds reached the man-count at which the team's policy calls a
save, and a saved round runs out the clock: fewer plants, so fewer defuses; more saves, so more time-outs.

After the plant, the duels themselves had changed character (eight matches, every duel traced, before the
fixes of §8):

| Post-plant duels | `main` | this branch |
|---|---|---|
| Both players standing | 80 % (at 0 m: both on the site's centre) | 0 % |
| Retaking defender is moving | 19 % | 93 % |
| Retaker saw first | 4 % | 60 % |
| Attack wins the duel | 55 % | 65 % |

On `main` a retaker hopped onto the site's centre and fought standing at zero range — an artefact of zone hops
that the balance had been tuned around. With real movement the side that has to come in is always "the moving
shooter", and the duel model charged it the moving penalty for the whole duel.

Those two things — the save rule and the treatment of a moving shooter — are balance calibration, outside what
the movement work was allowed to touch. The user then asked for both to be calibrated:

- **A moving shooter stops** (`combat-engine`, `accuracy.stopMs`). A shooter who is moving at contact pays the
  moving penalty until it has stopped: 700 ms after it first perceives the enemy from a run, 350 ms from a walk
  (the ratio of the two speeds), × 1.4 at movement skill 0 … × 0.6 at skill 1. Before that its shots are moving
  shots and it is a moving target; after it, standing. Short duels still end before the mover has stopped;
  long ones no longer punish it to the end. Pre-match option `movingStopScale` (Infinity = the old model).
- **The attack's save threshold is its own tunable** (`team-engine`, `attackSaveMinWinChance`, 0.09; the
  defense's `retakeMinWinChance` stays 0.15). With κ = 1 the attack now plays 1v3 and 2v5 out and saves at 1v4
  and 1v5 — real rounds run out the clock 4.3 % of the time, and the shared 0.15 gave 7–9 %.

Formulas, the outcome case of each attribute, the sweep and why 700 ms / 0.09 were chosen:
`docs/STAT_OUTCOME_MATRIX.md` §2.7, §3.6 and §6.

### 7.3 Measured and not shipped

| Option | 160-match result | Decision |
|---|---|---|
| Cover spots for every player (least-seen point of the zone) | elimination 0.606, time expired 0.126, 2 / 8 — players stopped finding each other | Dropped |
| Cover spots as a held angle (`SimConfig.coverSpots`: sees what it watches, least seen otherwise) | attack 0.457, defuse 0.114, detonation 0.079 — holders stronger on both sides of the plant | Built, **off by default** |
| "A mover that sees an enemy who has not seen it stops and shoots from a standstill" | attack 0.250, defuse 0.281, 2 / 8 | Removed as a rule. The calibrated stopping time of §7.2 is its measured form: a mover does stop, but it takes time |
| Routing every order of the lurker as a lurk | time expired 0.284, attack 0.407 — the execute waits for the lurker | Lurk routing on the lurk order only |
| Planting without having arrived at a spot | attack 0.509 instead of 0.488 at that stage, time expired 0.105 | Not kept: a player still walking is not planting |
| Angle clearing as a facing rule | not built | The data did not ask for it: before the plant the defender sees first in 6 % of duels and the attacker in 5 % |

### 7.4 How the numbers moved, stage by stage

Each row is a 160-match run of the branch at that stage.

| Stage | Attack | Elim. | Deton. | Defuse | Time | Opening | Pistol | Full | Passed |
|---|---|---|---|---|---|---|---|---|---|
| `main` | 0.507 | 0.674 | 0.108 | 0.189 | 0.030 | 0.458 | 0.438 | 0.493 | 7 / 9 |
| Executor only (zone from the roadmap cell) | 0.066 | | | | 0.418 | | | | 0 / 8 |
| + strategic corridor | 0.421 | | | | 0.138 | | | | 1 / 8 |
| + mover faces the zone it enters | 0.482 | | | | 0.119 | | | | 4 / 8 |
| + stack-up and queueing (sight still by zone) | 0.488 | 0.705 | 0.095 | 0.078 | 0.122 | 0.387 | 0.403 | 0.468 | 5 / 9 |
| + sight between real positions | 0.465 | 0.675 | 0.127 | 0.101 | 0.098 | 0.383 | 0.403 | 0.489 | 2 / 8 |
| + tactical travel times, route intents | 0.514 | 0.690 | 0.140 | 0.074 | 0.096 | 0.420 | 0.466 | 0.511 | 5 / 8 |
| + head-on deadlock fixed | 0.468 | 0.719 | 0.083 | 0.093 | 0.105 | 0.413 | 0.444 | 0.464 | 4 / 8 |
| + plant and defuse spots (movement work complete) | 0.480 | 0.711 | 0.094 | 0.104 | 0.092 | 0.412 | 0.466 | 0.482 | 6 / 8 |
| **+ moving shooter stops, attack save threshold 0.09 (head of branch)** | **0.521** | **0.704** | **0.106** | **0.148** | **0.042** | **0.462** | **0.528** | **0.495** | **8 / 8** |

What each step showed:

- **Sight by zone with real positions** made fights start from twice as far (first duel 20.5 m → 30.9 m): a
  mover was "seen" the moment its zone changed, by a holder at the far end of the next zone.
- **Sight between real positions** brought first contact back to 20.0 m. It did not by itself restore the
  balance: nearly every first duel now finds the attacker still walking (98 %, against 83 % on `main`).
- **Tactical travel times** were the gain of that step (40 matches, attack win rate: all on 55.3 %; travel times
  left on the zone graph 45.3 %; walked approaches left on FASTEST 55.5 %) — the policies' timing and the belief
  model's "how far can they be" now match the floor the players actually walk.
- **The head-on deadlock** was hiding behind "retakes fail": in a traced retake two defenders stood still for 16
  seconds, so the team went only when the clock forced it. Fixing it took detonations from 0.140 to 0.083 and
  cost the attack 4.6 points — retakes that used to stall now happen.
- **Plant and defuse spots** brought the attack back into range and lifted defuses.
- **The calibration** (§7.2) closed the last two: movers recover in long duels, so more executes reach the plant
  and more retakes reach the defuse; and the attack no longer gives up a 1v3.

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
| Routing every order of the lurker as a lurk stalled the execute that waits for it (time expired 9 % → 28 %) | 160-match validation, 40-match ablation | Lurk routing on the lurk order only; never the spike carrier |
| **Two movers meeting head-on (or turning round together) each queued behind the other and stood still for the rest of the round** | trace of a retake that never grouped; reproduced in a two-player test | Head-on judged by intended direction; a queue that does not move for 3 s is passed  |
| The spike carrier walked to the site's callout, in the open, before it could plant | comparison with `main`: plant 5 s later, 11 points fewer plants | Plant spot on the plant area, chosen for cover and entry distance  |

## 9. Not supported yet / not done

**Balance**
- The stopping time and the attack's save threshold are calibrated on Ascent (§7.2). They hold on unseen seeds,
  but they are fitted constants, not measurements, and need re-checking when another map becomes playable.
- Pistol rounds sit toward the upper edge of their band (0.494–0.528 across the three seed ranges; a stopping
  time of 800 ms pushes them out at 0.553).

**Movement behaviour**
- Cover spots are off by default (§7.3); round-start positions are "near the anchor".
- Angle clearing is not built (§7.3).
- Standing players do not shift: no shoulder-checks or repositioning after being seen.
- The exit-kill chaser runs the fastest route to the ground the attackers fall back to. It does not predict
  which exit a particular player will take.
- Route preference on plan orders acts between neighbouring zones only, because the policy hands out its own
  zone route one zone at a time (§4 D).
- Plant and defuse are still decided by zone: the carrier and the defuser *stop* at the right place, but the
  rule checks the zone, not the distance to the spike.

**Geometry and rules**
- Sight is positional on Ascent only (§3.2), and is decided between the roadmap nodes the two bodies stand at
  (≤ ~1.3 m from the body), not between exact positions. Ability effects that reveal or blind (recon, flash) and
  tracers still use zone sightlines.
- No ability creates a movement blocker (§4): the mechanism exists and is tested, the rule is not verified.
- Bullet blockers are not modelled.
- Jumping: a step up to 0.6 m is walkable; anything higher is not climbable. Jump-only routes do not exist.
- Ropes, ziplines on Icebox / Split, rotating doors, breakable walls, fall-off edges: as in `MAPS_DATA.md` §5.
  Only Bind's teleporters and Fracture's zipline are links.

**Maps**
- Only Ascent is playable, for the reasons in `MAPS_DATA.md` §6. Haven's B Site and most of Pearl are
  additionally unreachable on the roadmap (§1), and the tactical layer answers "unreachable" for them.
- The debug view, like the live view, draws Ascent (`apps/desktop/src/data/sim/`).

**Not evaluated**
- navcat was not benchmarked (§2).
- The debug view has only ever drawn priced ground patches and "no path" marks from real matches; a `blocked`
  event is drawn the same way but has not been seen outside the simulator's own tests.

## 10. Next priorities

1. Let the policies hand the navigation layer the final goal instead of one zone at a time, so SAFEST / STEALTH
   decide the whole route for plan orders too.
2. Cover spots at round start and for holders with a default watch zone — now measurable against a balance that
   passes; plant and defuse *at* a position rather than in a zone.
3. `<map>.vis.json` for the other ten maps; fix Haven B Site and Pearl in the source data so their zones
   connect.
4. Re-check the two calibrated constants (§7.2) on the next playable map.

## 11. Reproduce

```bash
PY=<python with numpy>; D=<derived dir outside the repo>

# geometry (local only, never committed) -> roadmap and visibility (committed)
$BLENDER --background --factory-startup --python tools/map-mesh/blender/extract-map.py -- --blend Ascent.blend --out-dir $D/ascent
$PY -I tools/map-mesh/pipeline/nav_map.py --map ascent --derived $D/ascent        # datasets/spatial/ascent/ascent.nav.json
for i in 0 1 2 3 4 5; do $PY -I tools/map-mesh/pipeline/vis_map.py --map ascent --derived $D/ascent --part $i/6 & done; wait
$PY -I tools/map-mesh/pipeline/vis_map.py --map ascent --derived $D/ascent --merge 6   # datasets/spatial/ascent/ascent.vis.json
rm $D/ascent/mesh.npz                                                             # 85 MB; not needed afterwards

# tests (run inside each package; PV_MAPS_DERIVED enables the local-grid checks)
PV_MAPS_DERIVED=$D npx vitest run        # packages/spatial-engine, packages/round-simulator, packages/match-runner

# balance (needs Node 22 and a Python with jsonschema)
cd tools/data-validator && PYTHON=<python> npx tsx scripts/sim-batch.mts --matches 160   # reports/sim-batch.md

# desktop
cd apps/desktop && npm run typecheck && npm run build && npm run test:unit && npm run test:engine
PLAYWRIGHT_REQUIRE_BASE=<dir with playwright>/ npm run test:e2e && npm run test:e2e:series
npm start                                 # live match → tactical map → "Navigation (developer)"
```
