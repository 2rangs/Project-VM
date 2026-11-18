# @project-v/spatial-engine

PROJECT V spatial engine — Ascent v0. Standalone TypeScript package (own
`package.json` / `tsconfig` / Vitest; does **not** depend on the root monorepo
config). When PV-3's monorepo lands it will be picked up by the `packages/*`
workspace glob; local types in `src/types.ts` are candidates to move into
`shared-types` then.

## What it provides

- **Coordinate transform** — game-world ↔ minimap (`MapCoordinateSystem`), verified against
  valorant-api values (axis-swapped, all Ascent callouts land in `[0,1]`).
- **Zone graph** — 22 Ascent callouts / 32 edges, A* pathfinding with run/walk travel time,
  shortest-time and reachability queries.
- **Zone lookup** — by id, by type, nearest-to-position.
- **Plant judgment** — `isPlantableZone`, point-in-polygon `isPointPlantable` / `plantZoneAt`.
- **Visibility** — authored line-of-sight pairs with smoke blocking.
- **Sound** — attenuation-BFS `audibleZones` approximation.

## Data provenance

Node **positions** come from valorant-api (real). The adjacency graph, plant polygons,
sightlines and sound links are hand-authored (`provenance: "manual-approx"`). There is **no**
measured collision mesh or navmesh yet. See `docs/research/spatial-sources.md` and
`docs/handoffs/PV-4-spatial.md`.

## Usage

```ts
import { createEngine, loadEngineFromFiles } from "@project-v/spatial-engine";

// from pre-loaded JSON (browser/worker safe):
const engine = createEngine(navgraphJson, coordinateSystemJson.transform);

// or from disk (Node):
const engine = loadEngineFromFiles(
  "datasets/spatial/ascent/ascent.navgraph.json",
  "datasets/spatial/ascent/coordinate-system.json",
);

engine.findPath("attacker-spawn", "a-site", "run"); // { path, distanceMeters, timeMs, ... }
engine.isPointPlantable({ x: 6150, y: -6600, z: 500 }); // true
engine.hasLineOfSight("a-main", "a-site", { smokedPairs: [["a-main", "a-site"]] }); // false
```

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (18 tests)
```

Regenerate the dataset from source (run from repo root):

```bash
node tools/map-processor/verify-transform.mjs
node tools/map-processor/build-ascent.mjs
```
