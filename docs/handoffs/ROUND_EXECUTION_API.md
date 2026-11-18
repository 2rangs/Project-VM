# Round-Execution API — `@pv/round-simulator` → PV-3 Match Runner

Status: v0 · 2026-11-18 · owner PV-4 (Spatial/Simulation) · consumer PV-3 (`pnpm sim:match`)

The Match Runner owns the **match** loop (score, side swap, economy / buy phases). The
round-simulator owns **one round**. `runMatchRound(input)` is the single, documented seam
between them: give it both teams for one round, get back the result plus everything needed to
set up the next round.

```ts
import { runMatchRound } from "@pv/round-simulator";
const out = runMatchRound(input);
```

## Input (`MatchRoundInput`)

| field | meaning |
| --- | --- |
| `spatial`, `weapons`, `abilities` | the engines/catalogs, built once per match and reused each round |
| `policies` | `{ attack, defense }` — each a PV-3 `DecisionPolicy` (team-level `decide(view, rng)`) |
| `attackers`, `defenders` | `MatchRoundTeam` — the roster **with loadouts** (see below) |
| `seed` | the one source of this round's determinism |
| `spikeCarrierId?` | which attacker holds the spike (default: first attacker) |
| `mapId? matchId? roundId? roundNumber?` | labels for the event log / replay |
| `config?` | round-loop tuning (`tickMs`, `roundTimeMs`, timers, `combatCalibration`, `recordTracks`); `seed` is taken from the top-level `seed` |

Each `MatchRoundPlayer` carries `{ id, agentId, skills?, spawnZoneId?, loadout }`.
`PlayerLoadout` = `{ weaponId, armor?, abilities?, ultimatePoints?, ultimateCost? }`, and each
`RoundAbilityLoadout` = `{ abilityId, slot?, charges }` where `slot` is `"basic" | "signature"
| "ultimate"`. Mark the ult with `slot: "ultimate"` so its cast is tracked for ult-point
accounting. Economy is passed per team as `MatchRoundTeam.economy` (a `TeamEconomyState`) and
is surfaced to the policy via `PolicyView.economy`.

So the input is exactly: **both teams' rosters · loadouts · economy state · policies · seed.**

## Output (`MatchRoundOutput`)

| field | meaning |
| --- | --- |
| `winner`, `reason` | `"attack"`/`"defense"`, and `elimination`/`spikeDetonation`/`spikeDefused`/`timeExpired` |
| `events` | the full ordered **EventLog** (`SimEvent[]`): the replay/validation source |
| `survivors` | `{ attack: PlayerId[], defense: PlayerId[] }` |
| `players` | per-player `PlayerRoundOutcome[]` (all 10) |
| `round` | the raw low-level `RoundResult` (roster, optional position `tracks`) |
| `endedAtTick`, `endedAtElapsedMs` | when the round ended |

`PlayerRoundOutcome` gives the Match Runner what it needs for the **next** round:

- **survival** — `alive`, `died`, `kills`.
- **equipment preservation** — `weaponRetained` (a survivor keeps their weapon; a dead player's
  is `null`, i.e. dropped), `armorRetained` (remaining shield; 0 if dead), `abilitiesRemaining`
  (`{ abilityId, charges }[]`, survivors only).
- **ultimate-point changes** — `ultimatePointsStart`, `ultimatePointsEarned`,
  `ultimatePointsSpent`, `ultimatePointsEnd`, `ultimateUsed`.

So the output is exactly: **round result · EventLog · survival + equipment-preservation ·
ultimate-point changes.**

## Rules & boundaries

- **Determinism (DECISION-010).** Identical input (same rosters, loadouts, seed, policies) ⇒
  byte-identical output. Covered by `test/match-round.test.ts`.
- **Ultimate-point awards come from PV-1**, not from this package: the values are
  `@pv/game-rules` `ULTIMATE_POINT_RULES` (`pointForKill/Death/SpikePlant/SpikeDefuse`). Orbs
  are not modelled by the sim, so orb points are 0. Points are capped at `ultimateCost`; a cast
  consumes `cost` points. If the real award rules change, they change in `@pv/game-rules`.
- **Economy rules are the Match Runner's job.** This API reads `economy` and reports
  preservation/survival; it does **not** compute buys, loss bonus, or refunds. Apply those
  between rounds.
- **Non-lethal damage is not modelled.** Duels are lethal-or-nothing, so a survivor took no
  damage and keeps full armor. When the combat engine models chip damage, `armorRetained` will
  reflect it with no API change.
- **What this does internally:** assembles a `SimState` (spawn placement, spike carrier), runs
  the deterministic tick loop (`RoundSimulator.runRound`), then reads final player state + the
  event log back out. No global state; safe to call in a loop across a match.

## Perception recording (PV-6 fog-of-war + belief heatmap)

Set `config.recordPerception: true` (off by default — it costs per-decision work) to get a
per-team observation/belief time series in `RoundResult.perception` / `MatchRoundOutput`. It is
**observation and belief only, never ground truth** (DECISION-004), kept separate from the
ground-truth `tracks`.

- Shape matches PV-6's `@pv/replay-engine` `PerceptionTrack[]` field-for-field (one track per
  team): `{ teamIdx, side, intervalTicks, snapshots: [{ tMs, roundNum, observedEnemies,
  beliefZones, sounds }] }`. `observedEnemies` are last-seen contacts (`zone`, `pos`,
  `lastSeenMsAgo`, `currentlyVisible`); `beliefZones` are the real `buildBelief` hypotheses
  folded to `{ zone, p∈[0,1] }`; `sounds` are audible cues localized to a zone.
- `teamIdx` is **side-based for a single round** (0 = attack, 1 = defense) with `side` set; the
  match merger remaps to the real team index using `side` + that round's attacker. `tMs` is
  round-relative — the match merger offsets it onto the match timeline (as with event `timeMs`).
- Sampling interval is `config.perceptionIntervalTicks` (defaults to `decisionIntervalTicks`).
- `toPv6ReplayFormat(result, meta)` folds the track into `meta.perception`, so PV-6 wires it as
  `fromSimEventLog(log.events, log.meta)` and renders the fog view + heatmap. Pass an explicit
  `meta.perception` to override (e.g. a match-level merge of all rounds).

## Command trace (policy debugging — `traceCommands`)

Set `config.traceCommands: true` (off by default) to get `RoundResult.commandTrace` /
`MatchRoundOutput.round.commandTrace`: a flat, time-ordered `CommandTraceEvent[]` showing what
each player was told to do and what actually happened. Built for debugging why a policy's intent
doesn't turn into round events (e.g. plants that never fire). Each event has `{ tick, elapsedMs,
playerId, phase, command?, targetZone?, fromZone?, toZone?, abilityId?, result? }`:

- `phase: "issued"` — a command was received. `command` is its kind; `result` is `"active"` or
  `"deferred"` (held by `executeAtMs`). Deduped per distinct command, so re-issuing the same
  command every decision logs once.
- `phase: "move"` — a zone-hop executed (`fromZone`→`toZone`, `targetZone` = the move goal).
- `phase: "arrived"` — the player reached the end of its path (`toZone`).
- `phase: "plant"` — a plant command was evaluated. `result`: `"started"` | `"planting"` |
  `"notPlantableZone"` | `"notCarrier"` | `"dead"` (deduped per distinct reason).
- `phase: "ability"` — a useAbility command: `result` `"used"` | `"noSlot"` | `"unavailable"` |
  `"noSpec"`.
- `phase: "defuse"` — a defuse command: `result` `"started"` | `"defusing"` | `"notOnSpikeZone"`
  | `"notPlanted"` | `"dead"`.

Typical use: filter `commandTrace` by a player id to see its issued commands vs its moves and
arrivals; filter `phase === "plant"` to see, per tick, whether a plant was attempted and why it
was rejected. Deterministic with the seed. Works through `runMatchRound` via `config`.

`traceCommands` also fills `RoundResult.engagementTrace: EngagementRecord[]` — the first-contact
state of every duel, which decides opening duels: `{ attackerId, defenderId, attackerZone,
defenderZone, distanceMeters, attackerSawDefender, defenderSawAttacker, firstSight
("attacker"|"defender"|"mutual"), attackerPreAim, defenderPreAim, attackerMoving, defenderMoving,
attackerFlashedMs, defenderFlashedMs, winnerSide }`. Take the earliest entry per round for the
opening duel; tally `firstSight`, `*Moving`, `*PreAim` and `winnerSide` to explain a policy's
opening-duel win rate (a defender caught `moving` shoots far worse than one holding still).

## Hold facing (`aimZone`) and opening-duel calibration

A stationary player now aims at the zone it is watching, and that facing drives perception's FOV
cone and combat pre-aim — a holder sees the entry it watches instead of staring at a stale
direction. `ActionCommand.aimZone` (added, optional, also in `@pv/shared-types`) sets it
explicitly; on a `hold`/`peek` without it the simulator falls back to `targetZone`; with neither
it defaults to the **enemy entry choke** (the neighbour on the shortest path from the enemy's
starting zone). **Policies should set `aimZone` to the real expected threat** — the default
choke only matches a head-on push, so a defender covering a flank/mid should name that zone.

Because holders now get mutual sight at first contact (not attacker-surprise), the opening-duel
calibration was re-derived: `SimConfig.peekerAdvantageMs` (default 210) models the entry
attacker's initiative (a holder reacts late to a moving peeker even on mutual sight), and
`ASCENT_OPENING_DUEL_CALIBRATION.hitChanceScale` is now 0.50. Together they put the ScriptedPolicy
attacker opening-duel win at ~0.45 (real 0.437, CI [0.420, 0.454]). The SAME calibration applies
to every policy — pass `combatCalibration: ASCENT_OPENING_DUEL_CALIBRATION`; `peekerAdvantageMs`
is a default, overridable per run.

## Minimal example

```ts
const out = runMatchRound({
  spatial, weapons, abilities,
  policies: { attack: attackPolicy, defense: defensePolicy },
  attackers: { players: atkRoster, economy: atkEcon },  // atkRoster: MatchRoundPlayer[]
  defenders: { players: defRoster, economy: defEcon },
  seed: matchSeed ^ roundNumber,
  roundNumber,
});
// feed out.players into the next buy phase; append out.events to the match replay
```

Lower-level access (`RoundSimulator`, `buildPolicyView`, `makeSyntheticRound`) remains exported
for tests and single-round experiments; `runMatchRound` is the recommended match-loop entry.
