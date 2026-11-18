# PROJECT V — DATA SCHEMA

**Owner:** Data Engineering agent (PV-2) · **Date:** 2026-11-18 · **Status:** v0.1

This document defines PROJECT V's common data model (Handoff §12, §24.2; README §13–14). It is the
human-readable companion to the machine schemas in [`datasets/schema/`](../datasets/schema/)
(JSON Schema draft 2020-12), which are the **source of truth for the Simulation agent's TypeScript
types (PV-3)**.

Two rules run through everything:

1. **CONFIRMED vs FUTURE.** Each table below marks whether a field is *CONFIRMED* (populated from a
   real, verified source today) or *FUTURE* (in the schema, needed later, not yet from real data).
   Missing real values are left `null`/absent — **never imputed or zero-filled** (README §5.1, §35).
2. **Real vs synthetic.** Every record carries `provenance.synthetic`. Real data lives under
   `datasets/normalized/`, synthetic under `datasets/synthetic/`; the two are never mixed. The
   `tools/data-validator` enforces this.

## Conventions
- **Field names: `camelCase`.** **Units are explicit** in every schema description.
- **Positions (v2, canonical):** game-world **Unreal units (uu)** — the `gameWorldPosition` def
  (`{x, y, z, frame: "game-world-uu"}`), the frame the Spatial agent (`datasets/spatial/`) and the
  PV-4 navgraph use. Synthetic Ascent states also carry a `zoneId` (Ascent navgraph zone) and set
  `formatVersion: 2`. The validator checks every synthetic `zoneId` against
  `datasets/synthetic/ascent/ascent_zones_ref.json` and that its position sits within 800 uu of the
  zone's representative point.
  - **`minimapUnits` is DEPRECATED** (the legacy `vector2` def, VLR minimap frame ≈ 0..1000). It was
    the v1 frame and caused a coordinate-mismatch bug in PV-3; new data must use `gameWorldPosition`.
- **Time:** round combat clock counts **down** from `100000 ms` (buy phase excluded, matching
  vctstats `ROUND_SECONDS=100`); after the plant the spike timer governs (`SPIKE_SECONDS=45000 ms`).
- **Team index:** a match fixes `teamIds[0]=team0`, `teamIds[1]=team1`; rounds/stats reference teams
  by this `teamIdx` (0/1). `side`/`attackingTeamIdx` say who attacks each round.

## Verified real sources behind "CONFIRMED"
| Source | What it backs | Access | Verify level |
|---|---|---|---|
| **VCT Reference** `vct.duckdb` | Match / Map / Round / Player / Team / round-economy / map stats | downloadable DuckDB, free incl. commercial | **L2** (data read) |
| **vctstats** (`bernielaird/vctstats`, MIT) | *method* for Event / Position / per-player economy via vlr.gg 2D-replay logs | code read (raw data not redistributed) | **L2** (code read) |

> ⚠️ **vlr.gg ToS bars the vctstats method.** vctstats' *code* is MIT, but its data source is vlr.gg
> 2D-replay scraping, and vlr.gg's Terms of Service (https://www.vlr.gg/terms, verified by PV-Spatial)
> **prohibit automated access and redistribution** (personal/non-commercial only). PROJECT V therefore
> treats the vlr `locs` shape as a *reference for the schema only* and **does not implement or commit a
> vlr scraper or any vlr-derived data.** Real Layer-B positions must come from an authorized path
> (Riot/GRID official feeds with a key, or vrfkit/ValorantReplayParser on self-captured VRF files).

Details and evidence: [`docs/handoffs/PV-2-data.md`](handoffs/PV-2-data.md).

---

## Entity overview
```
Match 1──* Map 1──* Round 1──* Event 1──* Position(player snapshot)
  │           │         └─ startEconomy (team-level, CONFIRMED)
  │           └─ playerMapStats (per player, CONFIRMED)
  ├─ teamIds → Team
  └─ players → Player
WorldState / DecisionContext  (reconstructed instant + BeliefState)  ← Economy, Position, Event feed in
Provenance  (attached to every record)
```

---

## Match — `match.schema.json`  (VCT Reference `matches`)
| Field | Unit / type | Status | Source |
|---|---|---|---|
| `matchId` | string | CONFIRMED | matches.match_id (= vlr match number) |
| `sourceUrl`, `event`, `eventId`, `season`, `seriesStage`, `seriesRound` | — | CONFIRMED | matches.* |
| `utcTimestamp` | ISO-8601 UTC | CONFIRMED | matches.utc_timestamp |
| `patch` | string | CONFIRMED | matches.patch (interpret era rules, README §10) |
| `format`, `region`, `isInternational` | — | CONFIRMED | matches.* |
| `teamIds[2]` | string[2] | CONFIRMED | team0_id, team1_id |
| `score[2]` | int[2] | CONFIRMED | score0, score1 |
| `veto[]` | string[] | CONFIRMED | matches.veto |
| `maps[]` | gameId[] | CONFIRMED | maps.game_id |
| `coverage.*` | bool | CONFIRMED | fetched_overview/performance/economy |

## Map — `map.schema.json`  (VCT Reference `maps`, `player_map`)
| Field | Unit / type | Status | Source |
|---|---|---|---|
| `gameId`, `matchId`, `mapName` | — | CONFIRMED | maps.* |
| `pickedByTeamIdx` | 0/1 | CONFIRMED | maps.picked_by_team |
| `durationText` | "MM:SS" | CONFIRMED | maps.duration (coarse; per-tick timing FUTURE) |
| `score[2]` | int[2] | CONFIRMED | maps.score0/1 |
| `performanceAvailable`, `economyAvailable` | bool | CONFIRMED | gate stats on these (README §5.1) |
| `playerMapStats[]` | object | CONFIRMED | player_map (rating/acs/adr/kills/…/clutches, split all/atk/def) |
| `rounds[]` | roundId[] | CONFIRMED | rounds |

`playerMapStats` splits (`all`/`atk`/`def`) mirror VCT Reference's `_all/_atk/_def` columns exactly.

## Round — `round.schema.json`  (VCT Reference `rounds`)
| Field | Unit / type | Status | Source |
|---|---|---|---|
| `roundId` (`gameId:roundNum`), `gameId`, `roundNum` | — | CONFIRMED | rounds.* |
| `winnerTeamIdx` | 0/1 | CONFIRMED | rounds.winner_team |
| `team0Side` | attack/defense | CONFIRMED | rounds.side |
| `attackingTeamIdx` | 0/1 | CONFIRMED (derived) | from side |
| `outcome` | elimination/bomb_detonated/defuse/time_expired | CONFIRMED | rounds.outcome |
| `startEconomy.loadoutValue[2]`, `.bank[2]` | credits | CONFIRMED* | loadout_t0/t1, bank_t0/t1 — *present on ~82% of rounds; `null` when not recorded |
| `plantSite` | A/B/C | **FUTURE** | 2D-replay logs (not in VCT Reference) |
| `events[]` | eventId[] | **FUTURE** (real) / populated (synthetic) | 2D-replay logs |

## Player — `player.schema.json`  (VCT Reference `players`)
| Field | Status | Source |
|---|---|---|
| `playerId`, `handle`, `country`, `sourceUrl` | CONFIRMED | players.* — merge by stable id, **never by handle** (README §13.2) |

## Team — `team.schema.json`  (VCT Reference `teams`)
| Field | Status | Source |
|---|---|---|
| `teamId`, `name`, `country`, `sourceUrl` | CONFIRMED | teams.* |

## Economy — `economy.schema.json`
| Field | Unit / type | Status | Source |
|---|---|---|---|
| `teamEconomy.bank`, `.loadoutValue` | credits | CONFIRMED (round level) | VCT Reference rounds snapshot |
| `teamEconomy.lossBonusTier`, `.buyType` | tier 0–4 / enum | **FUTURE** (derived/inferred) | rules + replay |
| `playerLoadout.credits/weaponId/armor` | credits / id / enum | **FUTURE** (real) / synthetic | vlr 2D-replay buy panel (method verified in vctstats) |
| `playerLoadout.ultimatePoints`, `.ultimateCost` | ult points | **FUTURE** (real) / synthetic | buy panel / per-agent per-patch (verify, README §21) |

## Event — `event.schema.json`   **FUTURE for real data / populated for synthetic**
Shape mirrors the real vlr 2D-replay log event observed in vctstats (`t/type/by/vid/pos/from/locs`).
| Field | Unit / type | Notes |
|---|---|---|
| `eventId` (`roundId:eventNum`), `roundId`, `eventNum` | — | ordering key |
| `type` | kill/plant/defuse/spike_death/environment_death/round_start/round_end | kill/plant/defuse directly observed; *_death derived (victim is own killer in log) |
| `timeMs` | ms since barriers dropped | real log is "M:SS" → ×1000 |
| `actorPlayerId`, `victimPlayerId`, `actorTeamIdx`, `victimTeamIdx` | — | — |
| `weapon`, `site`, `afterDetonation` | — | from kill feed / `boom` index |
| `pos`, `fromPos` | gameWorldPosition (uu) | event + shooter location |
| `positions[]` | Position[] | **all-player snapshot at the event** (the `locs` array) |

> **Availability:** VCT Reference gives no events/positions. The vlr.gg 2D-replay logs hold this data
> for some matches (China and others have none), but vlr.gg's ToS **prohibit automated access and
> redistribution** — so this path is **not** usable for the project. Authorized real-data routes are
> Riot/GRID official feeds (API key required) and self-captured VRF replays via vrfkit. Until one is
> secured, Layer B is supplied as labelled synthetic data.

## Position — `position.schema.json`   **FUTURE for real data / populated for synthetic**
One entry of a `locs` snapshot: `playerId`, `x`, `y` (minimapUnits), `facingDeg` (0–360), `alive`,
optional `worldPos` (vector3, game units — only with a true 3D source). Positions are **event-triggered
(sparse)**, not continuous ticks.

## WorldState / DecisionContext — `world-state.schema.json`   **synthetic today**
Reconstructed instant (Handoff §12, README §14) + the deciding team's `BeliefState`. Enforces
DECISION-004: the AI's `belief.visibleEnemies` are observed/inferred only, never copied from truth.
Contains `worldState` (players with position/health/armor/loadout, spike, teamEconomy, matchScore,
optional `plantZones`), `decidingTeamIdx`, and `belief` (visibleEnemies, heardSounds,
knownEnemyAliveCount, tacticalHypotheses with confidence). Tick-accurate reconstruction **from real
matches is FUTURE**; the 10 Handoff §20 scenarios in `datasets/synthetic/scenarios/` are synthetic
samples of this shape and are what PV-4 consumes.

## Provenance — `provenance.schema.json`  (README §13.3)
Attached to every record. Key fields: `sourceId`, `sourceUrl`, `gamePatch`, `retrievedAt`,
`evidenceType` (observed/decoded/derived/inferred/simulated), `confidence`, `verified`,
`verificationLevel` (0–3), **`synthetic`** (the real/synthetic separator), `sha256`, `notes`.

---

## ID mapping (cross-source, README §13.2)
PV ids are currently the VCT Reference stable integer ids, stringified: `matchId` = vlr match number;
`gameId` = maps.game_id; `playerId`/`teamId` = players/teams ids. When a second source (vlr API,
replay decode) is added, map its ids onto these via an explicit crosswalk — **do not merge on name
strings** (handle changes, transfers, duplicate names). A `crosswalk`/`registry` layer is the
Source-Registry agent's (PV-1) responsibility (`datasets/registry/`, not written here).

## Open schema questions for later agents
- Authoritative coordinate transform + plant/spawn/nav zones → **Spatial agent** (`datasets/spatial/`).
- Per-patch economy & ultimate constants → **Game-rules** work (README §10, §19, §21); current
  synthetic constants are placeholders (`patch: synthetic-approx`).
- Real `Event`/`Position` (Layer B) → via an **authorized** source only (Riot/GRID official feeds with
  a key, or vrfkit on self-captured VRF). **Not** vlr.gg scraping (ToS-barred).
