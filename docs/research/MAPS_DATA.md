# PROJECT V — Spatial datasets for the ten other maps (MAPS_DATA.md)

**Date:** 2026-11-19 · **Branch:** `claude/maps-data-df31bb` · **Scope:** data + loading only.
The engine still *plays* only Ascent; §6 lists what must be generalised before any of these maps can be played.

> **Update (same day):** every edge now also carries a measured **walkable route** and the simulator moves
> players along it — see `docs/research/MAP_ROUTES.md`. Edge lengths/times in §1 are the route's since then;
> two Lotus approx-links became measured edges.

Ten new folders — `datasets/spatial/{abyss,bind,breeze,fracture,haven,icebox,lotus,pearl,split,sunset}/` —
follow Ascent's schema and load through one registry call:

```ts
import { loadMap, MAPS, MAP_IDS } from "@pv/spatial-engine";
const engine = loadMap("haven");      // SpatialEngine
MAPS.haven.sites;                     // ["A", "B", "C"]
```

**One-line switch for the match runner** (`packages/match-runner/src/setup.ts`, owned by another session — not edited here):
`export function loadSpatial(mapId = "ascent"): SpatialEngine { return loadMap(mapId); }` (import `loadMap` from `@pv/spatial-engine`).

---

## 1. Per-map result

| Map | Sites | Zones | Edges (walk / drop / special / approx) | Sightlines | Sound links | Callouts over walkable floor | Callout z − floor (median / MAD, m) | Zones on main walk component | Main walkable area (m²) |
|---|---|---|---|---|---|---|---|---|---|
| *Ascent (hand-authored graph + 15 geometry-derived adjacencies; route-timed)* | A/B | 22 | 47 (all with a measured route) | 11 | 6 | — | — | — | — |
| *Ascent re-measured with this pipeline (control, not shipped)* | A/B | 22 | 27 walk-adjacent pairs, 8 drop pairs | ≈38 at the same rule | — | 22/22 | 0.00 / 0.00 | 22/22 | 6198 |
| Abyss | A/B | 23 | 33 (26 / 5 / 0 / 2) | 31 | 32 | 23/23 | −1.23 / 0.27 | 21/23 | 5582 |
| Bind | A/B | 24 | 34 (31 / 1 / 2 / 0) | 28 | 31 | 24/24 | 0.00 / 0.00 | 24/24 | 6277 |
| Breeze | A/B | 23 | 39 (36 / 3 / 0 / 0) | 35 | 39 | 23/23 | +2.82 / 1.30 | 23/23 | 12602 |
| Fracture | A/B | 22 | 31 (28 / 2 / 1 / 0) | 33 | 31 | 22/22 | 0.00 / 0.00 | 22/22 | 5306 |
| Haven | **A/B/C** | 21 | 30 (27 / 2 / 0 / 1) | 28 | 29 | 21/21 | 0.00 / 0.00 | 20/21 | 5131 |
| Icebox | A/B | 25 | 41 (32 / 8 / 0 / 1) | 48 | 38 | 25/25 | 0.00 / 0.00 | 24/25 | 7829 |
| Lotus | **A/B/C** | 28 | 40 (38 / 2 / 0 / 0) | 49 | 39 | 28/28 | +0.67 / 0.42 | 28/28 | 7930 |
| Pearl | A/B | 26 | 36 (29 / 2 / 0 / 5) | 34 | 36 | 26/26 | +0.68 / 1.08 | 22/26 | 5783 |
| Split | A/B | 24 | 28 (25 / 2 / 0 / 1) | 36 | 28 | 24/24 | 0.00 / 0.00 | 23/24 | 5461 |
| Sunset | A/B | 17 | 25 (24 / 1 / 0 / 0) | 13 | 24 | 17/17 | +4.00 / 1.00 | 17/17 | 5613 |

"Mesh connectivity achieved" = the *zones on main walk component* column: how many callouts stand on the single
connected walkable surface the pipeline found. (Ascent's first NavMesh attempt reached ~27 % of the map and 3/22
zones; the 2.5D grid here reaches 22/22 on Ascent and 224/233 across the ten new maps.) Zones the measured
graph could not reach from both spawns — the nine off the main component and three reachable only one-way —
get **flagged straight-line links** (`kind: "approx-link"`, `manual-approx`), listed in §4: 12 at first, 10 after
the route stage found a real route for two of them on Lotus.

Schematic of every graph over the walkable footprint: `docs/research/maps/<map>.png` (graph only — no game art).

### Travel time, spawn → site (run, from the validation test)

| Map | Site | Attackers | Defenders | | Map | Site | Attackers | Defenders |
|---|---|---|---|---|---|---|---|---|
| **Ascent** | A | 16.2 s | 10.4 s | | Icebox | A | 16.8 s | 8.9 s |
| **Ascent** | B | 14.6 s | 7.6 s | | Icebox | B | 16.2 s | 16.6 s |
| Abyss | A | 10.9 s | 11.7 s | | Lotus | A | 14.5 s | 8.4 s |
| Abyss | B | 18.3 s | 12.8 s | | Lotus | B | 9.1 s | 6.4 s |
| Bind | A | 27.6 s | 11.3 s | | Lotus | C | 15.9 s | 12.3 s |
| Bind | B | 33.3 s | 12.0 s | | Pearl | A | 22.0 s | 11.9 s |
| Breeze | A | 17.3 s | 11.2 s | | Pearl | B | 17.1 s | 12.7 s |
| Breeze | B | 17.3 s | 17.4 s | | Split | A | 15.7 s | 10.2 s |
| Fracture | A | 11.9 s | 6.7 s | | Split | B | 14.4 s | 12.3 s |
| Fracture | B | 10.9 s | 8.7 s | | Sunset | A | 17.6 s | 15.1 s |
| Haven | A | 14.3 s | 8.7 s | | Sunset | B | 17.6 s | 14.6 s |
| Haven | B | 18.3 s | 12.1 s | | | | | |
| Haven | C | 13.7 s | 12.7 s | | | | | |

(Route-timed. Before the routes Ascent read 17.4 / 12.7 s and 17.3 / 8.2 s on its older measured edges.)

Test bounds: attackers 6–40 s, defenders 1.5–30 s. A zone-graph route runs callout-to-callout, so it is longer
than the tightest real path; Bind's attacker times (28–33 s) are the visible case and should be eyeballed.

---

## 2. Sources and what was taken from each

| Input | Source | Committed? |
|---|---|---|
| Callouts (name, super-region, x/y/z) and minimap transform | `https://valorant-api.com/v1/maps`, fetched **2026-11-19** (HTTP 200, 90,168 bytes, sha256 `24708a7f…a90095` for the full response) | Yes — per map, verbatim: `valorant-api-<map>.raw.json` (same practice as Ascent) |
| Map geometry | User-provided `.blend` scenes, Blender 4.2.23 headless, **outside the repo** | **No.** Only counts, distances, visibility fractions and the schematic PNGs are committed |

The scenes are art geometry with **no collision layer** (as recorded for Ascent). Walkability and occlusion are
therefore inferred from visible meshes; that is the root of every caveat below.

## 3. How each relation was obtained (provenance of every edge class)

Pipeline: `tools/map-mesh/blender/extract-map.py` (one triangle soup per scene) →
`tools/map-mesh/pipeline/measure_map.py` (numbers under `datasets/spatial/<map>/mesh/`) →
`tools/map-processor/build_map.py` (navgraph; pure JSON→JSON, runs without geometry).

| Relation | Provenance | How |
|---|---|---|
| Zone id / name / super-region / x,y | **valorant-api** (decoded) | One zone per callout. Id rule `tools/map-processor/mapzones.py`: `a-site`, `mid-top`, `attacker-spawn`, `defender-arches`, `c-site` on three-site maps |
| Zone z | **measured-on-mesh** | Floor height under the callout. The API z is the floor only on Ascent, Bind, Fracture, Haven, Icebox, Split; elsewhere it is a rounded label height (Sunset: all −200) |
| Zone type | **manual-approx** | By callout name (table in `mapzones.py`, following Ascent's precedents). `plantable` = the `<letter> Site` callouts; spawns are `transit: false` |
| Blender→game transform | **measured-on-mesh** | §3.1 |
| Travel edge `kind: "walk"` | **measured-on-mesh** | §3.2 |
| Travel edge `kind: "drop"` (one-way) | **measured-on-mesh** | §3.2 |
| Travel edge `kind: "teleporter"` / `"zipline"` | **manual-approx** | Authored in `<map>.authoring.json`; length = straight line, time = estimate |
| Travel edge `kind: "approx-link"` | **manual-approx** | Straight-line **lower bound** for a zone the walk grid did not connect |
| Sightline existence + `visibility` | **measured-on-mesh** | §3.3 |
| Sightline `type`, `smokeable` | **derived-by-rule** | §3.3 |
| Sound links | **derived-by-rule** | §3.4 |
| Plant polygons | **derived-by-rule** | Callout-centred 12 m square. **Not the real plant boundary** |
| Doors, ropes, rotating doors… | see §5 | mostly *not* representable yet |

### 3.1 Coordinate transform (Blender ↔ game)

All eleven scenes are the same plain export: **game_uu = 100 · (x, −y, z)** of the Blender coordinates — uniform
scale, a Y flip, no rotation, no offset. Ascent's earlier 6.6 m-RMS affine was an artefact of fitting to coarse
region centroids; the relation is exact. Evidence, per map (`mesh/<map>-blender-to-game-transform.json`):

1. **Callout-on-floor test** — all 24 axis-aligned candidates (3 scales × 8 flips/swaps) are scored by how many
   callouts stand on a floor. On the six maps whose callout z *is* the floor height the chosen candidate puts
   every callout over a floor, and most of them at the callout's exact height — callouts within 5 cm of the floor,
   chosen vs runner-up candidate: Ascent 19 vs 2 (of 22), Bind 20 vs 1 (of 24), Fracture 21 vs 6 (of 22), Haven
   20 vs 4 (of 21), Icebox 17 vs 10 (of 25), Split 23 vs 3 (of 24). The remaining callouts sit over stairs,
   ledges or props.
2. **Named-region check** (`datasets/spatial/transform-landmark-check.json`, script
   `tools/map-mesh/align/landmark_check.py`) — the scenes name collections by region (`…_AtkSpawn`, `…_ASite`).
   Mean distance from those collections' bounding-box centres to the matching callouts, chosen orientation vs
   the best other flip: Abyss 20 / 44 m, Bind 16 / 54, Breeze 22 / 75, Fracture 18 / 69, Haven 12 / 54,
   Icebox 25 / 86, Lotus 9 / 54, Pearl 15 / 55, Split 47 / 91, Sunset 18 / 58. Region-level only, but it
   independently fixes the orientation on the five maps where test 1 cannot (**Abyss, Breeze, Lotus, Pearl,
   Sunset** have label-height callout z).
3. **Shift sensitivity** — recorded in each transform file: moving the map 4–8 m drops the number of callouts
   at floor height sharply on the exact-z maps (e.g. Split 24 → 17.5 → 12).

Stated tolerance: on the six exact-z maps the transform reproduces the median callout height within 0.01 m; on the other
five there is **no callout-level residual available** — the transform is the same export convention, confirmed
at region level only. The minimap transform (valorant-api, `coordinate-system.json`) round-trips every zone
within 1e-6 uu (tested).

### 3.2 Travel edges

A 2.5D walk grid (0.5 m cells) is rasterised from all up-facing triangles; a cell is standable only if nothing
solid occupies 0.5–1.5 m above it (voxelised from every triangle, so walls standing on a continuous floor slab
do block). Neighbouring cells link when the height change fits a ~50° slope (also a 0.6 m step); a larger step
*down* up to 5 m is a one-way **drop** link. Foliage, wires, decals and similar dressing are removed by
object/material name.

- **Zone cell** = walkable cells closer on foot to that callout than to any other (geodesic Voronoi).
- **Walk edge A–B** exists when the two cells touch; its length is the shortest path that stays inside the two
  cells (grid geodesic). Pairs are added shortest-first and skipped when the graph already connects them
  within 10 %.
- **Drop edge A→B** is added when a drop link joins the cells and beats the walkable route by ≥ 25 %.
- Run time = length / 6.75 m/s, walk time = length / 3.4 m/s (Ascent's movement model).

Known bias: 8-neighbour grid paths overestimate straight walks by up to ~8 % (same as Ascent's
`pv5-measured-edges`). Jump-only routes and anything needing a rope are not found.

### 3.3 Sightlines

Each zone gets 12 eye points (its callout cell plus seeded samples of its own cell within 9 m on foot, eye
height 1.6 m). `visibility` = fraction of the 144 eye-to-eye segments not hit by any solid, opaque triangle
(exact segment/triangle tests; clear glass is see-through). Symmetric by construction.

- **Exists** when visibility ≥ 0.02. Chokes score low by nature (Ascent control: B Main↔B Site 0.05).
- **`smokeable`** — Ascent's flags were hand-set; its single non-smokeable line (Rafters↔A Site) is also its
  most open one in the control run (0.74; all others ≤ 0.42). Rule: `smokeable = visibility < 0.6`.
- **`type`** — hand-set on Ascent and not read by any engine code. Rule: `direct` when both zones are lanes
  (main / mid / site / lobby / spawn), else `angle`; this reproduces 10 of Ascent's 11 labels.

**Ascent control** (`docs/research/maps/ascent-control/`): 8 of Ascent's 11 hand-authored sightlines are
measured visible (0.03–0.74); three measure 0.00 (`a-window↔a-site`, `mid-link↔b-site`, `b-boathouse↔b-site`).
The same rule yields ≈38 sightlines on Ascent against 11 hand-authored — **the geometry-derived maps carry
roughly 3× denser sightline sets than the Ascent the simulation was balanced on.**

### 3.4 Sound graph

Ascent's six sound links and their attenuations (0.2 / 0.3 / 0.4) were **hand-set**; no rule is documented
(`ascent.source.json` marks them `manual-approx`). The rule used here was reverse-fitted and reproduces all six:
`≤ 25 m → 0.2`, `≤ 50 m → 0.3`, `> 50 m or through a door → 0.4`, on the edge's travel length. One link per
travel connection (teleporters excluded), so no zone is isolated. Consequence: Ascent has 6 links, the new maps
24–39; with the engine's 0.01 audibility threshold a gunshot carries much further on them than on Ascent.

---

## 4. Measured versus approximated, per map

| Map | Approx-links (straight-line lower bound) | Other approximations specific to the map |
|---|---|---|
| Abyss | `a-security↔a-secret`, `b-nest↔b-danger` | Callout z is a label height (floor ≈ 1.2 m below) |
| Bind | — | 2 teleporter edges are authored (endpoints from game knowledge, 1.5 s travel is an estimate) |
| Breeze | — | Callout z unusable (200 / 1100 nominal) → on stacked floors the snapped level may be wrong |
| Fracture | — | Attacker zipline edge authored (straight line at run speed) |
| Haven | **`b-back↔b-site`** | **B Site itself** is not on the main walk component — its only walk access is this approx-link (plus measured drops *out* of it) |
| Icebox | `a-pipes↔a-nest` | A Nest is rope-only in game; 8 drop edges found |
| Lotus | — (`a-drop↔a-top`, `b-site↔b-upper` now have a measured route) | Callout z is a label height |
| Pearl | `mid-shops↔b-club`, `a-main↔a-link`, `mid-doors↔b-link`, `mid-top↔mid-plaza`, `a-flowers↔defender-water` | **Weakest map**: 4/26 zones off the main component; callout z unusable; B Club / Mid Shops share one x,y on different floors |
| Split | `a-ramps↔mid-vent` | Ropes not modelled |
| Sunset | — | Callout z unusable (all −200); fewest callouts (17) |

Every such record is tagged in the navgraph (`edge.provenance`, `edge.kind`, `dataQuality.approxLinks`).

## 5. Map mechanics

Represented in the graph:

| Map | Mechanic | How |
|---|---|---|
| All | One-way drops the geometry shows | `bidirectional: false`, `kind: "drop"`, measured length |
| Bind | Two one-way teleporters | `kind: "teleporter"`, own travel time, no sound link |
| Fracture | Zipline between the two attacker sides | `kind: "zipline"`, bidirectional |

**Not representable yet** (also listed per map in `navgraph.mechanics` with `represented: false`):

| Map | Mechanic | What the engine would need |
|---|---|---|
| Abyss | Fall-off edges (no outer walls), jump gaps | Lethal boundary / fall hazard on edges; jump edges with risk |
| Bind | Teleporter audio cue heard map-wide, exit doors | A map-wide sound event on teleporter use |
| Breeze | Mid wood doors / A hall mechanical door, one-way chute | `DoorInfo` once a human confirms the gated zone pair |
| Fracture | Attackers start on **both** sides; ropes (A Rope, B Tower) | A second attacker start; rope edges with ascend time and an "on rope" state |
| Haven, Lotus | **Three sites** | §6 |
| Icebox | Vertical ropes (A Nest, B Yellow, Mid Boiler), horizontal zipline on A | Rope / zipline edges with their own speed and exposure |
| Lotus | Two rotating doors (closed by default, slow, loud), breakable wall A Link↔B | Timed door state + sound cue; a destructible edge with hit points |
| Split | Ropes (A Sewer, Mid Vent, B Tower) | Rope edges |
| Sunset | Switch-operated breakable door at B Market | `DoorInfo` once a human confirms the gated zone pair |

No door was attached to an edge on the new maps: `DoorInfo` (as on Ascent) is supported by the builder
(`doors` in `<map>.authoring.json`), but which measured edge each door gates was not verified, so none is claimed.
All mechanic descriptions above are from general game knowledge, **not verified against a patch**.

---

## 6. Ascent-specific assumptions that must be generalised before another map can be played

Not fixed here (other sessions own these files). ⚠ = breaks on **three-site maps (Haven, Lotus)**.

| # | File | Symbol / line | Assumption |
|---|---|---|---|
| 1 | `packages/match-runner/src/setup.ts` | `loadSpatial()` | Hard-coded `datasets/spatial/ascent` |
| 2 | `packages/match-runner/src/match.ts` | `DEFENDER_SPAWNS` (l.53) | Defender start zones `a-site, a-site, b-site, b-site, mid-courtyard` — `mid-courtyard` exists only on Ascent, Haven and Sunset; no C ⚠ |
| 3 | `packages/match-runner/src/match.ts` | site-letter helper (l.247–250) | `a-`/`b-` id prefixes only → `c-*` zones map to no site ⚠ |
| 4 | `packages/match-runner/src/defense-setups.ts` | `ascent-defense.json` loads (l.42, l.62) | Defender setups exist for Ascent only |
| 5 | `packages/match-runner/src/orders.ts` | `AttackStrategyOrder` | `aExecute` / `bExecute` / `midControl` / `stackA` / `stackB` — no C ⚠; `midControl` needs a mid |
| 6 | `packages/match-runner/src/abilities.ts` | standard comp | "A standard Ascent comp" |
| 7 | `packages/match-runner/src/cli.ts` | `map: args.map ?? "ascent"` | Flag exists but is not wired to loading |
| 8 | `packages/team-engine/src/policy.ts` | `SMOKE_TARGETS` (l.64) | Ascent zone ids (`a-main`, `a-rafters`, `a-wine`, `b-boathouse`, `mid-top`) |
| 9 | `packages/team-engine/src/policy.ts` | `DEFENSE_AIM` (l.70) | Ascent zone ids |
| 10 | `packages/team-engine/src/policy.ts` | `SAVE_FALLBACK_ZONE` (l.78) | `defender-spawn` (holds on every map here) |
| 11 | `packages/team-engine/src/policy.ts` | `siteLetter()` (l.118–121), `site(letter: "A" \| "B")` (l.543), plan switch (l.306–307) | A/B only ⚠ |
| 12 | `packages/team-engine/src/igl.ts` | `siteOfZone()` (l.56–59), weights (l.141–143), swing A↔B (l.187–191) | A/B only ⚠; "stacked A → go B" has no third option |
| 13 | `packages/team-engine/src/opponent-model.ts` | `SiteKey = "A" \| "B"` (l.18) | ⚠ |
| 14 | `packages/team-engine/src/player-policy.ts` | `EXECUTE_STRATEGIES` (l.20) | `aExecute`, `bExecute`, `fakeAtoB`, `fakeBtoA` ⚠ |
| 15 | `packages/shared-types/src/decision-policy.ts`, `belief.ts` | `TeamStrategy` union (l.106–108 / l.27–29) | Strategy ids name sites A and B ⚠ |
| 16 | `packages/round-simulator/src/policy-contract.ts` | `TeamStrategy` (l.96) | same ⚠ |
| 17 | `packages/round-simulator/src/policy.ts` | l.43, l.82 | default `a-site`; `site === "b-site" ? "bExecute" : "aExecute"` ⚠ |
| 18 | `packages/round-simulator/src/scenario.ts` | l.54–79, l.107; `mapId: "ascent"` (l.70, l.112) | Hard-coded start zones incl. `mid-courtyard` |
| 19 | `packages/round-simulator/src/match-round.ts` | l.144–145 | `attacker-spawn` / `defender-spawn` ids (hold on every map; Fracture needs a second attacker start) |
| 20 | `packages/round-simulator/src/export.ts` | l.94 | `map: "Ascent"` |
| 21 | `packages/round-simulator/src/calibration.ts`, `types.ts` (l.365), `team-engine/policy.ts` (l.96, l.841) | calibration constants | Tuned on 160 Ascent matches / Ascent VCT baselines; sightline and sound density differ on the new maps (§3.3, §3.4) |
| 22 | `packages/action-generator/src/generate.ts` | `zonesByType("mid")` (l.102–103), `MID_CONTROL` (l.178) | **Bind, Fracture, Lotus have no `mid` zone** (no "Mid" super-region in the callouts). Icebox's mid callouts are Blue / Boiler / Pallet; `mid-pallet` and `mid-blue` are typed `mid` by a manual override |
| 23 | `packages/world-state/src/scenario.ts` | l.255–257 | Text → `aExecute` / `bExecute` / `midControl` ⚠ |
| 24 | `packages/decision-debugger/src/ascent-placeholder.ts`; `test/fixtures/ascent-stub.ts` in action-generator, team-engine, decision-engine | whole file | Ascent stubs |
| 25 | `apps/desktop/src/renderer/zones.ts`, `shared/real-sim.ts`, `shared/ascent-transform.ts`, `renderer/useMatchSession.ts`, `renderer/platform.ts`, `main/index.ts`, `renderer/data.ts` | `ascent.navgraph.json` import, `ASCENT_TRANSFORM`, `mapDisplayName: 'Ascent'`, `ascent-tactics` / `ascent-comps` | Desktop is Ascent-only; its decision parser maps a zone to a site by `/^([a-z])-/`, which *does* handle `c-` |
| 26 | `packages/spatial-engine/src/pathfinding.ts` | `ZoneGraph.heuristicMs` | **Fixed here (additive):** a teleporter is faster than its straight line; the heuristic is now scaled so A* stays optimal. Ascent is unaffected (scale stays 1) |
| 27 | `datasets/derived/tactics/`, `datasets/derived/comps/`, `datasets/synthetic/setups/` | Ascent (+ Lotus skeleton) only | Tactics KB, comps and defender setups per map are missing. `lotus-zone-vocabulary.json`'s temporary ids match the new Lotus zone ids except the spawns (`attacker-spawn` / `defender-spawn` here) |

Per-map blockers beyond the table: **Haven, Lotus** — everything marked ⚠; **Bind, Fracture, Lotus** — #22;
**Fracture** — two-sided attack (#19); **every map** — #2, #4, #8, #9, #21, #27.

---

## 7. Validation

`packages/spatial-engine/test/maps.test.ts` (157 tests in the package, all passing) fails on bad data. Per map:
registry identity; unique lowercase-hyphen ids; both spawns, non-transit; exactly the registry's sites, each
plantable with a polygon containing its callout; edges reference real zones with positive, consistent
lengths/times and a provenance; one-way edges only of kind drop/teleporter; **every zone reachable from both
spawns**; spawn→site run times within bounds (table in §1); sightlines unique and symmetric, smoke flag
honoured; no isolated sound node; minimap transform round-trip < 1e-6 uu; zones = the API callouts at their
x/y; the Blender transform is the plain export with ≥ 85 % of callouts over walkable floor; no geometry
committed. Ascent: loads through the registry byte-identically to its file; its 25 existing tests pass
unchanged. `npx tsc --noEmit -p tsconfig.json` clean; root `vitest` 168 passed.

## 8. What a human should double-check

1. **Open the ten PNGs** against the in-game minimaps — the fastest way to catch a wrong link.
2. **Haven B Site** and **Pearl** (five approx-links): the walk grid did not connect them; replace the
   approx-links with real adjacencies.
3. **Stacked-floor callouts on Breeze, Pearl, Sunset** (callout z unusable): confirm each zone sits on the
   intended level (e.g. Pearl `b-club` vs `mid-shops`).
4. **Bind teleporter endpoints and travel time**, **Fracture zipline** — authored from memory.
5. **Zone types** (`position` vs `connector`) — a naming convention, not a measurement.
6. **Sightline and sound density vs Ascent** (§3.3, §3.4) before trusting any balance number on a new map.
7. **Plant polygons** are placeholders.
8. **Doors/ropes** (§5): none encoded.
9. **Ascent itself**: the control run disagrees with the hand-authored graph in places — `a-wine` sits beside
   A Main (20 m, visibility 0.92), not on the defender side (the dataset links it to `defender-spawn` at
   129 m); `a-window` overlooks Garden, not A Site; Rafters→A Site is a one-way drop. Ascent's data was not
   touched; this is a follow-up for its owners. Its stored callout z also differs from today's API in places
   (e.g. Garden 400 vs 570.4).
10. The valorant-api callouts carry **no patch stamp** (`patchVersion: UNVERIFIED`), and the `.blend` scenes
    are of unknown patch — map reworks (Breeze, Icebox, Lotus, Pearl, Split) may not match between the two.

## 9. Reproduce

```bash
BL=/path/to/Blender; PY=/path/to/Blender.app/Contents/Resources/4.2/python/bin/python3.11   # any python with numpy
D=/path/outside/the/repo/derived
$BL --background --factory-startup --python tools/map-mesh/blender/extract-map.py -- --blend Bind.blend --out-dir $D/bind
$PY -I tools/map-mesh/pipeline/measure_map.py --map bind --derived $D/bind     # ~30–160 s per map
python3 -I tools/map-processor/build_map.py bind                                # or --all; needs no geometry
$PY -I tools/map-mesh/pipeline/render_map.py --map bind --derived $D/bind       # docs/research/maps/bind.png
python3 -I tools/map-mesh/align/landmark_check.py > datasets/spatial/transform-landmark-check.json
```
