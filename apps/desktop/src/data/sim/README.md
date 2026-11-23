# Simulation inputs — copied from PV-4 (round-simulator engines)

Verbatim copies, bundled so the desktop's real Match Runner can build the engines
offline. **Do not edit** — re-copy if upstream changes.

| file | source (integration branch) |
|---|---|
| `ascent.navgraph.json` | `datasets/spatial/ascent/ascent.navgraph.json` (PV-4) |
| `coordinate-system.json` | `datasets/spatial/ascent/coordinate-system.json` (PV-4) |
| `weapons.json` | `packages/round-simulator/test/fixtures/weapons.manual-approx.json` (PV-4, manual-approx) |

The round simulator (`@pv/round-simulator`) + its spatial/combat/perception/
ability engines are imported from source via Vite aliases; these JSON files are
their data inputs. All are navgraph-derived / manual-approx estimates.

`ascent.nav.json` is the map's navigation roadmap (`datasets/spatial/ascent/ascent.nav.json`): the round
simulator moves players on it and will not start a round without one. Re-copy it together with
`ascent.navgraph.json` whenever either changes in `datasets/spatial/ascent/`.

`ascent.vis.json` is the measured line of sight between the roadmap's nodes
(`datasets/spatial/ascent/ascent.vis.json`): who sees whom is decided by where two bodies stand. The in-app
round simulator is given it together with the roadmap (`src/shared/real-sim.ts`); the live match view also
reads `ascent.nav.json` to draw the walkable floor in its navigation (developer) overlay.
