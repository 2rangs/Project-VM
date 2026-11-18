# PROJECT V — Machine Schemas (`datasets/schema/`)

JSON Schema (draft 2020-12) definitions for PROJECT V's normalized data model. These are the
machine-readable counterpart to [`docs/DATA_SCHEMA.md`](../../docs/DATA_SCHEMA.md) and are the
**source of truth for the Simulation agent's TypeScript types (PV-3)**.

## Conventions
- **Field names are `camelCase`.**
- **Units are explicit** in every numeric field's `description` (`ms`, `credits`, `minimapUnits`,
  game units `uu`, degrees, ult points, …).
- Cross-file references use relative `$ref` (e.g. `provenance.schema.json`,
  `common.schema.json#/$defs/vector2`). A resolver that registers every file by its `$id`
  (its filename) is in `tools/data-validator`.
- `additionalProperties: false` everywhere, so unknown fields are caught.

## Files
| Schema | Entity | Real-source backing |
|---|---|---|
| `common.schema.json` | shared defs (vector2/3, enums) | — |
| `provenance.schema.json` | Provenance + `synthetic` flag | README §13.3 |
| `team.schema.json` | Team identity | VCT Reference `teams` |
| `player.schema.json` | Player identity | VCT Reference `players` |
| `match.schema.json` | Match (series) | VCT Reference `matches` |
| `map.schema.json` | Map/game + per-player map stats | VCT Reference `maps`, `player_map` |
| `round.schema.json` | Round + start economy snapshot | VCT Reference `rounds` |
| `economy.schema.json` | Team economy + player loadout | VCT Reference `rounds` (team-level); replay buy panel (player-level, FUTURE) |
| `event.schema.json` | In-round event | vlr 2D-replay logs (FUTURE for real; synthetic now) |
| `position.schema.json` | Per-player position+facing | vlr 2D-replay `locs` (FUTURE for real; synthetic now) |
| `world-state.schema.json` | WorldState + BeliefState (DecisionContext) | synthetic (reconstruction is FUTURE) |

## Coordinate & time frames
- **Positions**: `minimapUnits` — the VLR 2D-replay minimap frame (origin top-left, x→right, y→down),
  floats ~0..1000. This is the same frame real `locs` data uses, so synthetic and real positions are
  directly comparable. The authoritative minimap↔game-world transform belongs to the **Spatial agent**
  (`datasets/spatial/`, not produced here).
- **Time**: round combat clock counts down from `100000 ms` (buy phase excluded, matching vctstats
  `ROUND_SECONDS=100`); after the plant the spike timer governs (`SPIKE_SECONDS=45000 ms`).
