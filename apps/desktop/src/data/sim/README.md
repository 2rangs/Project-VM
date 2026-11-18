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
