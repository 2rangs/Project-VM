# PROJECT V — TASK HANDOFF

**Agent:** PV-3 (Simulation Core)
**Date:** 2026-11-18
**Branch:** `claude/pv-core`
**Scope:** Handoff P0 foundation — TS monorepo + `shared-types`, `simulation-core`,
`game-rules`, `world-state`. No Electron app; `spatial-engine` (PV-4) not created.

---

## 1. 작업 목표 (Goal)

Stand up the deterministic simulation-core foundation (Handoff §18 P0): a pnpm/Vitest
TypeScript monorepo and the four packages that hold the engine's state types, deterministic
primitives, patch-versioned rules, and the World→Observation boundary — so the next agents
(Action Generator, Decision Debugger) have a typed, tested base to build on.

## 2. 완료한 작업 (Done — actually implemented & tested)

- **Monorepo scaffold**: `pnpm-workspace.yaml` (`packages/*`), root `package.json`
  (scripts: `test`, `typecheck`), `tsconfig.base.json` + root `tsconfig.json` (strict,
  `moduleResolution: bundler`, build-less source consumption), `vitest.config.ts`,
  `.gitignore`.
- **`@pv/shared-types`**: branded ids; `WorldState`/`PlayerState`/`SpikeState`;
  `ObservationState`/`ObservedEnemy`; `BeliefState`; `GameEvent` union; `ActionSchema`/
  `DecisionContext`/`CandidateAction`/`FeasibilityResult`; `Provenance`; economy state;
  `Vector2/3`.
- **`@pv/simulation-core`**: `SeededRng`/`RngStream` (SplitMix64, **stream-separated,
  order-independent**), `SimulationClock` (fixed integer-ms ticks), `EventLog`
  (monotonic-seq, serialisable).
- **`@pv/game-rules`**: `RuleValue<T>` + rounds/spike/economy/weapons/ultimate tables and
  pure helpers. **All values `verified: false`** (see `docs/GAME_RULES.md`).
- **`@pv/world-state`**: `createWorldState`/`createPlayerState` (deep-frozen), immutable
  updates, versioned serialize round-trip, and **`observeWorld` (World→Observation
  boundary)** with a pluggable `VisibilityOracle` (default `BLIND_ORACLE` fails safe).
- **Tests**: 45 tests across 5 files — RNG determinism + order independence, clock,
  event-log round-trip, economy/spike/ultimate rules, world immutability + serialize
  round-trip + observation boundary.

## 3. 변경한 파일 (Files)

```
package.json, pnpm-workspace.yaml, pnpm-lock.yaml, tsconfig.base.json, tsconfig.json,
vitest.config.ts, .gitignore
packages/shared-types/{package.json,tsconfig.json,src/*.ts}        # 9 src modules + index
packages/simulation-core/{package.json,tsconfig.json,src/*.ts,test/*.ts}
packages/game-rules/{package.json,tsconfig.json,src/*.ts,test/*.ts}
packages/world-state/{package.json,tsconfig.json,src/*.ts,test/*.ts}
docs/ARCHITECTURE.md, docs/GAME_RULES.md, docs/handoffs/PV-3-core.md
```
Files NOT touched (other agents' ownership): `README.md`, `Handoff.md`, `datasets/`,
`tools/`, `packages/spatial-engine/` (PV-4).

## 4. 데이터 출처 (Data sources)

No external data was downloaded or verified in this session. Rule numbers are provisional
defaults citing (unverified) Riot/community sources listed in `docs/GAME_RULES.md §4`.
No synthetic data is presented as real match data (README §19, Handoff §31).

## 5. 실행 방법 (How to run)

```bash
pnpm install      # Node >= 20, pnpm 10.x (esbuild build script is allow-listed)
pnpm test         # vitest run
pnpm typecheck    # tsc --noEmit over all packages
```
Packages are consumed from source (`exports: ./src/index.ts`); there is no build step.

## 6. 검증 방법 (Verification)

Deterministic unit tests. Reproducibility is asserted directly: identical seed → identical
sequence; interleaved/extra draws in one RNG stream do not shift another (Handoff §30-O);
`deserialize(serialize(world))` deep-equals `world`; frozen state mutation throws.

## 7. 테스트 결과 (Results — actually executed)

```
pnpm typecheck → clean (exit 0)
pnpm test      → Test Files 5 passed (5); Tests 45 passed (45)
  game-rules/rules.test.ts ............ 12
  simulation-core/rng.test.ts ......... 10
  simulation-core/clock.test.ts ....... 6
  simulation-core/event-log.test.ts ... 5
  world-state/world-state.test.ts ..... 12
```

## 8. 현재 미완료 사항 (Not done — out of this scope)

Action Generator, Constraint Solver, Belief population (observation→belief decay),
Perception/vision, Combat, Economy *decision* logic, Save/Ultimate decision engines, the
spatial engine (PV-4), the Electron app, and any real data ingestion. These are P1+
(Handoff §18) and consume this core.

## 9. 알려진 문제 (Known issues)

- **All `game-rules` values are `verified: false`** — provisional, must be verified.
- `BeliefState` is defined but not populated; `observeWorld` currently returns empty
  belief-feeding structures (teammateReports/knownMapChanges are `[]`) — intentional
  skeleton.
- `VisibilityOracle` default is blind, so with no spatial engine wired in, AI sees nothing
  (fail-safe, not a bug).
- `exactOptionalPropertyTypes` is off to keep optional-field ergonomics simple; revisit if
  stricter optionality is wanted.

## 10. 설계 결정 (Design decisions)

- **Build-less source consumption** (bundler resolution + pnpm symlinks) keeps the loop to
  install/test/typecheck and avoids premature packaging config (Handoff §29).
- **Stream-separated RNG** is the chosen mechanism for order-independent determinism
  (DECISION-010 / §30-O) — far simpler than a global draw-order discipline.
- **Observation as a type boundary**: `ObservedEnemy` omits ground-truth fields so
  omniscient play is unrepresentable, not merely discouraged (DECISION-004 / README §29).
- **Rules as `RuleValue<T>`** with mandatory provenance (Handoff §10) rather than bare
  constants.
- **Branded ids** to prevent name-string identity merges (Handoff §13.2).

## 11. 라이선스 및 권한 (Licenses)

No third-party data bundled. Rule values are factual numbers cited to public pages; confirm
redistribution terms when the Data agent imports actual datasets.

## 12. 다음 권장 작업 (Next recommended tasks, in priority order)

1. **Action Generator prototype** (TASK 007, README §19 first deliverable): implement a few
   `ActionSchema`s whose `generate(context)` emits `CandidateAction`s for an Ascent
   scenario; use `game-rules` helpers (`canPlantWithin`, `lossBonusFor`, …) in the
   constraint stage; **exclude** physically impossible actions via `FeasibilityResult`
   (README §15.3), do not merely down-score them.
2. **Decision Debugger** (TASK 008, README §21): print generated vs. excluded actions with
   reasons, consuming only `DecisionContext`/`ObservationState`.
3. **Spatial engine** (PV-4): implement `VisibilityOracle` + pathing so `observeWorld`
   becomes meaningful and `noPath`/`insufficientTime` feasibility is real.
4. **Verify `game-rules`** against primary sources; flip `verified` flags (`docs/GAME_RULES.md §5`).

## 13. 작업 재개 지점 (Where to start)

- Read `docs/ARCHITECTURE.md`, then this file.
- Open `packages/shared-types/src/action-schema.ts` (the contract to implement next) and
  `packages/world-state/src/observation.ts` (how decision code should read the world).
- Run `pnpm install && pnpm test && pnpm typecheck` to confirm the baseline.
- Create a new `packages/action-generator/` package depending on `@pv/shared-types`,
  `@pv/world-state`, `@pv/game-rules`; the workspace glob picks it up automatically.

---

## Appendix A — API usage examples (for the Action Generator / Decision Debugger agent)

### A.1 Build a (synthetic) Ascent world and read it as an observation

```ts
import {
  createWorldState, createPlayerState, observeWorld, type VisibilityOracle,
} from "@pv/world-state";
import {
  asAgentId, asMapId, asMatchId, asPatchVersion, asPlayerId, asRoundId, asTeamId, vec3,
} from "@pv/shared-types";

const A = asTeamId("team-a"), D = asTeamId("team-b");

const world = createWorldState({
  matchId: asMatchId("synthetic-001"),      // SYNTHETIC — not a real VCT match
  roundId: asRoundId("synthetic-001:r-1"),
  roundNumber: 1,
  mapId: asMapId("ascent"),
  patchVersion: asPatchVersion("synthetic-0"),
  timeRemainingMs: 100_000,
  players: [
    createPlayerState({ id: asPlayerId("a1"), teamId: A, side: "attack",  agentId: asAgentId("jett"), position: vec3(0, 0, 0) }),
    createPlayerState({ id: asPlayerId("d1"), teamId: D, side: "defense", agentId: asAgentId("sage"), position: vec3(120, 40, 0), health: 40 }),
  ],
});

// Decision code must consume an ObservationState, never the raw world:
const oracle: VisibilityOracle = { canSee: (obs, tgt) => obs.id === asPlayerId("a1") };
const obs = observeWorld(world, asPlayerId("a1"), { oracle });
// obs.visibleEnemies[0] = { playerId: "d1", healthBand: "low", ... }  (no exact HP/position leak)
```

### A.2 Deterministic RNG with isolated streams (use ONE stream per concern)

```ts
import { SeededRng } from "@pv/simulation-core";

const rng = new SeededRng("match:synthetic-001");
const combat = rng.stream("combat");       // draws here never shift "movement"
const movement = rng.stream("movement");

combat.nextFloat();                        // e.g. duel roll
movement.nextInt(0, paths.length);         // e.g. path choice
// Re-running with the same seed reproduces both sequences exactly (DECISION-010).
```

### A.3 Record events and advance the world immutably

```ts
import { EventLog } from "@pv/simulation-core";
import { advanceTick, appendEvents, killPlayer } from "@pv/world-state";
import { asEventId, asPlayerId } from "@pv/shared-types";

const log = new EventLog();
const kill = log.record({                  // seq assigned automatically
  kind: "kill", id: asEventId("e1"), tick: world.tick, timeMs: world.timeRemainingMs,
  victim: asPlayerId("d1"), killer: asPlayerId("a1"), assists: [], cause: "weapon",
  weaponId: null,
});
let next = appendEvents(world, [kill]);
next = killPlayer(next, asPlayerId("d1"));
next = advanceTick(next, 50);              // original `world` is untouched (frozen)
```

### A.4 Use rules in the constraint stage (and respect provenance)

```ts
import { canPlantWithin, lossBonusFor, isUltimateReady } from "@pv/game-rules";

const canPlant = canPlantWithin(world.timeRemainingMs);     // feasibility, README §15.3
const nextEco  = lossBonusFor(3);                           // 2900 (provisional)
const hasUlt   = isUltimateReady("jett", player.ultimatePoints);
// NOTE: game-rules numbers are verified:false. Do not present an outcome computed from
// them as a verified analysis value (README §21, §29).
```

### A.5 Serialize a world for logging / replay

```ts
import { serializeWorld, deserializeWorld } from "@pv/world-state";
const json = serializeWorld(world, /*pretty*/ true);
const back = deserializeWorld(json);        // deep-equals world
```

## Appendix B — datasets/schema mapping note (for the Data agent, PV-2)

Core conventions: **camelCase** fields, **ms** durations, **VALORANT world units** for
positions, **integer** credits, lowercase slug `key`/`agentKey`/weapon keys (to be mapped to
valorant-api UUIDs). If `datasets/schema/*.json` diverges (field names, units, id forms),
record the mapping here as a table so neither side silently reshapes the other's data
(Handoff §13.2/§24.2). No mapping entries yet — `datasets/schema/` was not present/owned by
this agent.

---

# PROJECT V — TASK HANDOFF (PV-3 phase 2)

**Agent:** PV-3 (Simulation Core) · **Date:** 2026-11-18 · **Branch:** `claude/pv-core`
**Scope:** Handoff TASK 006 → 007 → 008 toward the Ascent Decision Prototype (§19), via
dependency inversion onto PV-4 (no cross-branch merge).

## 1. 작업 목표
Build the situation-aware decision core: reconstruct a WorldState from PV-2 scenarios
(TASK 006), maintain a partial-observation Belief State, generate & evaluate tactical
action candidates (TASK 007), and expose a Decision Debugger report (TASK 008) — without
merging the spatial/perception branches.

## 2. 완료한 작업 (tested)
- **TASK 006** `@pv/world-state loadDecisionContext`: PV-2 DecisionContext JSON → internal
  WorldState (validation, unit mapping, provenance retention, deterministic round-trip).
- **Belief State v0** `@pv/decision-engine`: zone probability distributions that diffuse
  with staleness (README §17.3); type boundary — ObservationState + SpatialQuery only, no
  WorldState (DECISION-004). Per-decider DecisionContext assembly.
- **TASK 007** `@pv/action-generator`: 4-layer generation from state (not a fixed list),
  constraint validation excluding impossible actions with reasons, and §19 evaluation
  (feasibility/time/cost/risk/utility), rule-based (no ML).
- **TASK 008** `@pv/decision-debugger`: structured trace + Markdown/text report (Handoff
  §21) + runnable CLI; numbers are the model's own.
- **Seams** in `@pv/shared-types`: `SpatialQuery`, `ObservationProvider`,
  `TeamDecisionContext`.

## 3. 변경한 파일
```
packages/shared-types/src/{spatial-query,observation-provider,scenario-context}.ts (+index)
packages/world-state/src/scenario.ts (+index); test/scenario.test.ts; test/fixtures/*
packages/decision-engine/**            (new package: belief.ts, context.ts, + tests/stub)
packages/action-generator/**           (new package: generate.ts, evaluate.ts, types.ts, + tests)
packages/decision-debugger/**          (new package: pipeline, trace, report, cli, placeholder, + tests/fixtures)
docs/DECISION_MODEL.md, docs/TEST_PLAN.md, docs/handoffs/PV-3-core.md (this section)
```

## 4. 데이터 출처
- Scenarios + schemas: `origin/claude/pv-data @ fe246942167b3a1261e88782375c65f650eec6c9`,
  `datasets/synthetic/scenarios/*.json` + `datasets/schema/*.json` — copied verbatim into
  `packages/*/test/fixtures/` (READMEs record origin + commit; copies unedited; SYNTHETIC
  flag preserved).
- Spatial API shape mirrored from `origin/claude/pv-spatial @ 4a1cf0d3da28d942c739b56c800e6ed835200644`,
  `packages/spatial-engine` (read-only; not merged). Ascent zone ids reused in the stub.

## 5. 실행 방법
```bash
pnpm install && pnpm test && pnpm typecheck
pnpm --filter @pv/decision-debugger debug <abs-path>/scenario_04.json   # CLI report
```

## 6. 검증 방법 / 7. 테스트 결과
`pnpm typecheck` clean; `pnpm test` → **91 passed, 4 todo** (10 files). Handoff §20
scenarios 01–10 are end-to-end tests; 07/08/09 and the exit-kill valuation of 10 are
`it.todo` (need P3 economy/ultimate engines) — not faked. Determinism asserted end-to-end.

## 8. 현재 미완료 사항
Economy/save/ultimate VALUE models (the valuation half of save / ult-denial / exit-kill);
real spatial-engine + perception-engine adapters; richer tactical decomposition; belief
from a temporal observation sequence (only single-snapshot + advance/observe now).

## 9. 알려진 문제 / 한계
- `game-rules` values remain `verified:false`; generator weights are provisional heuristics.
- Positions are minimapUnits throughout (z=0); world-unit conversion is deferred to the
  spatial adapter.
- Ability slot→signature mapping is agent-specific and left null in v0.
- The CLI uses an Ascent placeholder SpatialQuery until PV-4 is integrated.

## 10. 설계 결정
Dependency inversion via `SpatialQuery`/`ObservationProvider` (interfaces in shared-types,
stub/placeholder for now) so PV-3 progresses without merging PV-4. Executes are
carrier-gated for feasibility. Belief kept strictly downstream of ObservationState to make
omniscient play unrepresentable. Economic valuation explicitly deferred, not stubbed as
real.

## 11. 라이선스 및 권한
No third-party data bundled; fixtures are this project's own synthetic data (clearly
flagged). No external services called.

## 12. 다음 권장 작업
1. **Spatial/Perception adapters** (PV-4 integration): implement `SpatialQuery` over the
   real `SpatialEngine` (+ minimap↔world transform) and `ObservationProvider` over
   perception-engine; swap the placeholder/stub.
2. **Economy / Save / Ultimate engines (P3)**: supply the value models that turn the
   generated SAVE / EXIT_KILL / ult-aware actions into real valuations; flip the §20
   07–10 `todo`s into assertions.
3. **Weight calibration** via repeated simulation (Handoff §20.5).
4. **Combat/movement resolution** to execute selected actions and advance the world.

## 13. 작업 재개 지점
- Read `docs/DECISION_MODEL.md` and `docs/TEST_PLAN.md`, then this section.
- Entry points: `packages/world-state/src/scenario.ts` (loader),
  `packages/decision-engine/src/belief.ts`, `packages/action-generator/src/generate.ts`,
  `packages/decision-debugger/src/pipeline.ts`.
- `pnpm install && pnpm test && pnpm typecheck`, then run the CLI on a scenario to see a
  full trace.

## Appendix — PV-2 DecisionContext → internal mapping (field/unit)
| PV-2 (world-state.schema.json) | internal (@pv/shared-types) | note |
|---|---|---|
| `teamIdx` 0/1 | `TeamId` `team-0`/`team-1` | branded id |
| `attackingTeamIdx` + `teamIdx` | `PlayerState.side` | derived |
| `position` vector2 (minimapUnits) | `Vector3 {x,y,z:0}` | `coordinateSpace:"minimapUnits"` |
| `facingDeg` | `facing` unit `Vector2` | minimap frame |
| `spike.status` | `SpikePhase` | carried/dropped/planted/defused/detonated |
| `loadout.weaponId/armor/abilityCharges/ultimate*` | `InventoryState`/`AbilityInventory` | ammo not modeled; signature null |
| `teamEconomy.bank/lossBonusTier` | `TeamEconomyState.credits/lossBonusTier` | `consecutiveLosses≈tier` |
| `belief.*` | `ObservationState` + `BeliefState` | observed/inferred only (DECISION-004) |
| `provenance.*` | `ScenarioProvenance` | synthetic flag preserved |
