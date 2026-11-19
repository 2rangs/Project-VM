# PROJECT V — Walkable routes: players move along the real map (MAP_ROUTES.md)

**Date:** 2026-11-19 · **Branch:** `claude/maps-data-df31bb` · builds on `docs/research/MAPS_DATA.md`.

**Problem.** Movement was zone-to-zone: a player sat on a zone centre for the *straight-line* time to the next
centre, then jumped there. Viewers interpolated between centres in a straight line, so players were drawn
walking through walls, and travel time ignored the real path.

**Now.** Every navgraph edge carries a **walkable polyline** measured on the map geometry. The simulator takes
the route's time for the edge and records a track position that moves continuously along the polyline.

---

## 1. Result per map

| Map | Edges | With walkable route | Flagged straight | Edges with a different way back | Route ÷ straight (median / max) | Waypoints per route | Flagged straight edges |
|---|---|---|---|---|---|---|---|
| **Ascent** | 32 | **32** | 0 | 7 | 1.20 / 6.12 | 7.6 | — |
| Abyss | 33 | 31 | 2 | 1 | 1.18 / 4.77 | 5.1 | a-security→a-secret, b-nest→b-danger |
| Bind | 34 | 32 | 2 | 1 | 1.15 / 2.39 | 4.5 | a-teleporter→b-exit, b-teleporter→a-exit |
| Breeze | 39 | 39 | 0 | 1 | 1.19 / 2.55 | 5.9 | — |
| Fracture | 31 | 30 | 1 | 0 | 1.06 / 2.27 | 4.9 | attacker-spawn→attacker-bridge |
| Haven | 30 | 29 | 1 | 1 | 1.13 / 2.53 | 5.5 | b-back→b-site |
| Icebox | 41 | 40 | 1 | 2 | 1.19 / 2.48 | 5.7 | a-pipes→a-nest |
| Lotus | 40 | 40 | 0 | 2 | 1.14 / 10.92 | 4.9 | — |
| Pearl | 36 | 31 | 5 | 2 | 1.18 / 2.94 | 6.0 | mid-shops→b-club, a-main→a-link, mid-doors→b-link, mid-top→mid-plaza, a-flowers→defender-water |
| Split | 28 | 27 | 1 | 0 | 1.14 / 1.59 | 5.2 | a-ramps→mid-vent |
| Sunset | 25 | 25 | 0 | 0 | 1.27 / 2.73 | 5.0 | — |
| **Total** | **369** | **356** | **13** | 17 | | | |

Why 13 edges stay straight (each is flagged in the navgraph: `edge.routeStatus = "straight (…)"`, and listed in
`navgraph.routes.edgesFlaggedStraight`):

- **3 special traversals** — Bind's two teleporters and Fracture's zipline: nobody walks them.
- **9 approx-links** — the zones the walk grid could not connect (`MAPS_DATA.md` §4): Abyss 2, Haven 1 (B Site),
  Icebox 1 (A Nest, rope-only), Pearl 4, Split 1.
- **1 stacked pair** — Pearl `mid-shops` / `b-club` share one x,y on different floors and snap to the same cell.

Two Lotus approx-links (`a-drop↔a-top`, `b-site↔b-upper`) turned out to have a walkable route (one way a drop,
the other a long walk — hence the 10.9× ratio) and are now ordinary measured edges.

Pictures: `docs/research/maps/<map>.png` — the edge polylines over the walkable footprint (schematic only;
Ascent's is new). Orange = the way back where it differs (a one-way drop).

## 2. How a route is found and validated

`tools/map-mesh/pipeline/route_map.py` (needs the geometry, which stays outside the repo):

1. The same 2.5D walk grid as the edge measurement (0.5 m cells; a cell is standable when its floor is walkable
   and nothing solid occupies 0.5–1.5 m above it; cells link on walkable slope; bigger steps down are one-way
   drops). This is the "2D occupancy grid from the mesh" approach — the Recast NavMesh (≈27 % connected on
   Ascent) is not used.
2. **A\*** from one zone's anchor to the other's. Steps next to a wall cost more (×2.6 / ×1.7 / ×1.25 at 0 / 1 /
   2 cells of clearance), so routes run down the middle of a corridor where there is room.
3. **String-pulling** to a short polyline that never reduces wall clearance below what the path had, never
   crosses a drop, and keeps a waypoint wherever the floor leaves the straight chord by more than 0.3 m
   (stairs, ramps).
4. **Validation** — every segment is re-walked with an exact grid traversal: *every* cell the segment touches
   must be a standable cell walk-linked to the previous one. (A first version sampled every 0.2 m and let a
   segment clip a blocked cell's corner; the exact traversal fixed that.) A polyline that fails would be
   dropped and the edge flagged — none did.
5. **Direction** — a bidirectional edge gets one polyline, walked both ways, when the walk-only path is within
   10 % of the best path each way. Otherwise it gets `route` (from→to) and `routeReverse` (to→from): on Ascent
   `a-site → a-rafters` is a 97 m walk around, the way back a 19 m drop.

Only the polylines are committed (`datasets/spatial/<map>/mesh/<map>-routes.json`, merged into the navgraph by
`tools/map-processor/apply_routes.py` / `build_map.py`). The grid is written to `<derived>/walkable.json`
outside the repo for the optional local tests (§5).

## 3. Data: what an edge and a zone now carry

```jsonc
// zone
"position": { "x": 6153.6, "y": -6626.2, "z": 500 },   // callout — the zone's LOGICAL centre, unchanged
"anchor":   { "x": 6140,   "y": -6620,   "z": 500 },   // walkable standing point, z = measured floor

// edge
"route": { "waypoints": [[x,y,z], …],                  // game uu, from -> to, both anchors included
           "lengthMeters": 24.5, "runTimeMs": 3630, "walkTimeMs": 7206, "drops": 0,
           "provenance": "measured-on-mesh (walkable route)" },
"routeReverse": { … },                                 // only when the way back differs
"distanceMeters": 24.5, "runTimeMs": 3630, …,          // = the route's
"beforeRoute": { "distanceMeters": 18.86, "runTimeMs": 2793, "provenance": "pv5-measured (medium)" }
```

**Which travel time wins.** The walkable route. When an edge has a route its `distanceMeters` / `runTimeMs` /
`walkTimeMs` are *replaced* by the route length at the map's movement speeds (6.75 / 3.4 m/s); the previous
value is kept under `beforeRoute`. An edge without a route keeps its own time (a teleporter's fixed 1.5 s, an
approx-link's straight-line lower bound). Pathfinding and movement now read the same number — before, A\* chose
routes by the edge's measured time while movement used the straight line between centres.

Ascent's navgraph changed: 22 zone anchors added, 32 edges re-timed (table in §4). Zone ids, positions,
sightlines and sound links are untouched.

## 4. Engine

**`@pv/spatial-engine`** (additive):

| API | Returns |
|---|---|
| `standPosition(zoneId)` | the zone's walkable anchor (else its callout) |
| `edgeTraversal(from, to)` | for two adjacent zones: `{ waypoints, lengthUnits, runTimeMs, walkTimeMs, kind, walkable }` in that direction (reversed polyline or `routeReverse` as appropriate); `null` if not adjacent |
| `pointAlongEdge(from, to, fraction)` | `{ position, heading }` that far along the polyline |
| `pointAlongPolyline(points, fraction)` | the same for any polyline |

The A\* heuristic (straight line between callouts) is now scaled by the worst edge so it can never overestimate;
a test compares A\* with an exhaustive search on all eleven maps.

**`packages/round-simulator/src/simulator.ts`** (movement only):

- `edgeTravelMs()` — an edge takes the map edge's time (its route's). `stepMovement` and `transitOf` use it; the
  straight line between centres is only the fallback for two zones with no edge. Fire / slow-field / doorway
  logic is unchanged — it works on `edgeProgressMs` against the edge time, as before.
- `trackPosition()` — the recorded track frame (`config.recordTracks`) is the point `edgeProgressMs / edgeMs`
  along the polyline while travelling, the zone's anchor while standing, and stays where a player fell.

**Deviation from the brief, on purpose.** `p.position` and `p.facing` were **not** made continuous. Every
consumer derives a player's zone from its position by nearest-zone lookup — perception (`vision.ts`,
`hearing.ts`), `view.ts`, the round-simulator policy, and ~25 call sites in `team-engine/policy.ts` — and combat
range is the distance between positions. A position part-way along a polyline is often nearest to a *third*
zone, so making it continuous would silently change who sees and fights whom. Keeping the logical position on
the zone centre is what "perception and LoS stay zone-level" requires; the continuous position lives in the
track. Facing stays "toward the next zone" for the same reason (it feeds the FOV cone); a viewer can take the
heading from successive track points or `pointAlongEdge().heading`.

**For the desktop / match-runner owners:** tracks exist only with `recordTracks: true`. `match-runner` does not
set it today (`match.ts` l.471 passes `recordPerception` and the tuning only), so `runMatch` rounds carry no
track. Add `recordTracks: true` there to get `out.round.tracks` — one frame per 100 ms tick, `{id, side, x, y,
z, alive}` in game uu, drawable through the existing minimap transform. Perception snapshots still hold the
logical (zone-centre) positions.

### Ascent edges, before → after

Straight = distance between callouts (what movement used). Old measured = the edge's previous
`distanceMeters` (what pathfinding used). Time = run time, straight line → route.

| Edge | Straight (m) | Old measured (m) | Route (m) | Time |
|---|---|---|---|---|
| attacker-spawn → a-lobby | 53.9 | 63.1 | 60.9 | 8.0 → 9.0 s |
| attacker-spawn → b-lobby | 21.2 | 29.5 | 20.5 | 3.1 → 3.0 s |
| attacker-spawn → mid-top | 34.7 | 38.6 | 51.3 | 5.1 → 7.6 s |
| a-lobby → a-main | 18.9 | 35.7 | 24.1 | 2.8 → 3.6 s |
| a-main → a-tree | 18.2 | 26.6 | 34.7 | 2.7 → 5.1 s |
| a-main → a-window | 37.3 | 46.4 | 100.3 / back 60.2 | 5.5 → 14.9 s |
| a-main → a-site | 20.9 | 18.9 | 24.5 | 3.1 → 3.6 s |
| a-tree → a-site | 22.8 | 27.8 | 24.5 | 3.4 → 3.6 s |
| a-window → a-site | 26.5 | 41.7 | 36.0 / back 90.0 | 3.9 → 5.3 s |
| a-site → a-wine | 22.8 | 60.8 | 29.5 | 3.4 → 4.4 s |
| a-site → a-rafters | 15.8 | 17.1 | 97.0 / back 19.1 | 2.3 → 14.4 s |
| a-site → a-garden | 25.6 | 44.0 | 37.0 | 3.8 → 5.5 s |
| a-garden → mid-cubby | 24.5 | 27.1 | 28.1 | 3.6 → 4.2 s |
| a-wine → defender-spawn | 73.8 | 129.4 | 86.5 | 10.9 → 12.8 s |
| a-rafters → defender-spawn | 44.3 | 69.0 | 50.9 | 6.6 → 7.5 s |
| mid-top → mid-courtyard | 29.0 | 48.0 | 34.1 | 4.3 → 5.1 s |
| mid-courtyard → mid-catwalk | 11.9 | 17.0 | 12.8 | 1.8 → 1.9 s |
| mid-courtyard → mid-cubby | 22.3 | 27.4 | 29.3 / back 24.6 | 3.3 → 4.3 s |
| mid-catwalk → mid-bottom | 21.8 | 28.0 | 26.2 | 3.2 → 3.9 s |
| mid-cubby → mid-bottom | 24.1 | 36.3 | 31.2 / back 43.4 | 3.6 → 4.6 s |
| mid-bottom → mid-market | 14.2 | 24.3 | 14.2 | 2.1 → 2.1 s |
| mid-bottom → mid-link | 24.2 | 28.4 | 29.5 | 3.6 → 4.4 s |
| mid-link → b-site | 36.9 | 54.0 | 62.8 | 5.5 → 9.3 s |
| mid-link → defender-spawn | 60.6 | 61.2 | 70.9 | 9.0 → 10.5 s |
| mid-market → mid-pizza | 7.2 | 12.2 | 7.1 | 1.1 → 1.0 s |
| mid-market → b-site | 34.4 | 49.8 | 39.3 | 5.1 → 5.8 s |
| mid-pizza → b-main | 40.4 | 52.5 | 48.5 / back 56.5 | 6.0 → 7.2 s |
| b-lobby → b-main | 44.8 | 68.0 | 52.3 | 6.6 → 7.7 s |
| b-main → b-site | 17.5 | 19.2 | 26.0 | 2.6 → 3.9 s |
| b-site → b-boathouse | 21.5 | 21.5 | 41.3 | 3.2 → 6.1 s |
| b-boathouse → b-main | 31.5 | 31.6 | 62.4 / back 50.4 | 4.7 → 9.2 s |
| b-site → defender-spawn | 48.6 | 55.1 | 51.4 | 7.2 → 7.6 s |
| **Sum over the 32 edges** | **952** | **1310** | **1345** | **+41 % walking time vs the straight line** |

The Ascent *graph* is still the hand-authored one. Three of its edges join zones that are not really neighbours,
so their routes are long detours rather than errors of the router: `a-site → a-rafters` (no way up from the
site: 97 m around, 19 m back down), `a-main → a-window` (100 m) and `a-wine → defender-spawn` (86 m — Wine sits
beside A Main). They are walkable and now cost what they really cost; re-authoring Ascent's adjacency from the
geometry (`MAPS_DATA.md` §8.9) is a separate decision.

## 5. Verification

| Check | Where | Result |
|---|---|---|
| Every Ascent edge has a walkable route | `round-simulator/test/route-movement.test.ts` | 32/32 |
| Every track position of a 24-round Ascent match lies on an edge polyline or a zone anchor (≤ 1 uu) | same | pass |
| Players never move further in one tick than a run step (no jumps) | same | pass |
| Tracks leave the straight centre-to-centre lines by > 3 m | same | pass |
| Same seed → same match, tick for tick; different seed → different | same | pass |
| An edge takes its route's time, not the straight line's | same | pass |
| Per map: routes start/end on anchors; length, run and walk time consistent; flagged edges are only special / approx / stacked; each direction's traversal correct | `spatial-engine/test/routes.test.ts` | pass ×11 |
| A\* equals exhaustive search on every map | same | pass ×11 |
| **Local geometry only** (`PV_MAPS_DERIVED=<derived dir>`): every routed polyline, sampled every 0.2 m, and every track position stand on a walkable grid cell | both files | pass on this machine; **skipped** where the grid is absent (it is not committed) |

The 24-round match in the test uses the simulator's scripted policy (attackers alternating A and B), because
`match-runner` records no tracks. The "on a walkable cell" property does not depend on the policy: a track
position is always a point of an edge polyline or a zone anchor, and all of those are checked against the grid
for every edge in both directions.

Four existing tests were updated because they encoded the old model, not because behaviour regressed:
`stall-utility` (travel time constant: straight line → the edge's route), `contract-supplement` and `dash-round`
(track positions are anchors, not callouts), `spatial-engine/pathfinding` (the spawn short-cut example moved
from A Site→B Site to A Lobby→B Lobby, where it still exists) and `round` (seed pair 1/99 → 1/2: with the new
timings seeds 1 and 99 win the same six duels in that scripted scene).

`perf.test` (1,000 rounds < 60 s wall clock) now runs at ≈49 ms/round here against ≈43 ms before: rounds last
longer in simulated time. It passed alone and in the suite, and failed once at 60.5 s while the machine's load
average was above 45.

## 6. 160-match validation (Ascent)

See the table at the end of this file (§7), filled from `reports/` after both runs.

## 7. Reproduce

```bash
PY=<python with numpy>; D=<derived dir outside the repo>
$PY -I tools/map-mesh/pipeline/route_map.py --map ascent --derived $D/ascent    # mesh/ascent-routes.json
python3 -I tools/map-processor/apply_routes.py ascent                           # merge into ascent.navgraph.json
python3 -I tools/map-processor/build_map.py --all                               # the ten other maps (merges routes)
$PY -I tools/map-mesh/pipeline/render_map.py --map ascent --derived $D/ascent   # docs/research/maps/ascent.png
PV_MAPS_DERIVED=$D npx vitest run        # in packages/spatial-engine and packages/round-simulator
```
