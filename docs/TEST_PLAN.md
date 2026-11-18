# PROJECT V — Test Plan (through PV-3 phase 2)

## Running

```bash
pnpm install
pnpm test        # vitest run — all packages
pnpm typecheck   # tsc --noEmit over all packages
```

Current status: **91 passed, 4 todo** across 10 files (see §4 for the todos). Every test is
deterministic; the same seed/scenario yields identical results (DECISION-010).

## 1. Foundation (phase 1)

| Area | File | Checks |
|---|---|---|
| Seeded RNG | `simulation-core/test/rng.test.ts` | same seed → same sequence; stream separation / order independence; serialize round-trip |
| Clock | `simulation-core/test/clock.test.ts` | fixed integer-ms ticks; Hz construction |
| Event log | `simulation-core/test/event-log.test.ts` | monotonic seq; JSON round-trip; kind filter |
| World state | `world-state/test/world-state.test.ts` | frozen construction; immutable updates; serialize round-trip; World→Observation boundary |
| Game rules | `game-rules/test/rules.test.ts` | loss-bonus ladder; spike/ultimate helpers; all values `verified:false` |

## 2. Scenario loading — TASK 006

`world-state/test/scenario.test.ts`: reconstruct `WorldState` from PV-2 DecisionContext
JSON; teamIdx→TeamId; minimapUnits→Vector3; loadout→inventory/abilities; spike mapping;
provenance retention (synthetic flag); deterministic serialize round-trip; structural/enum
validation; and an **enum drift guard** cross-checking loader enums against the copied PV-2
schema files.

## 3. Belief + generation + debugger — TASK 007 / 008

| Area | File | Checks |
|---|---|---|
| Belief v0 | `decision-engine/test/belief.test.ts` | point mass when fresh; diffusion with staleness; `advance`/`observe`; determinism |
| Action gen | `action-generator/test/generate.test.ts` | layered candidates; §19 evaluation outputs; carrier-gated execute feasibility; plant feasibility; determinism; utility ordering |
| Debugger | `decision-debugger/test/report.test.ts` | all report sections; SYNTHETIC surfaced; numbers from the model; CLI runs |

## 4. Handoff §20 scenario matrix — `decision-debugger/test/scenarios.test.ts`

| # | Scenario | Status | Assertion / reason |
|---|---|---|---|
| 01 | Basic attack | ✅ | both site executes feasible; strategic selected |
| 02 | Observed info | ✅ | belief shows only the 1 observed enemy, not full truth (DECISION-004) |
| 03 | Fake (defender read) | ✅ | defenders rotate either way on observed info; no truth leak |
| 04 | Time pressure | ✅ | B execute excluded `insufficientTime`; A execute feasible |
| 05 | Plant | ✅ | carrier on A site can plant |
| 06 | Post-plant | ✅ | post-plant hold feasible; strategic selected |
| 07 | Operator save | ✅ partial / `todo` | SAVE generated & feasible; **preservation VALUE** needs economy engine (P3) |
| 08 | Ult denial | ✅ partial / `todo` | SAVE generated; **enemy-ult valuation** needs ultimate engine (P3) |
| 09 | Match point | ✅ partial / `todo` | SAVE generated; **no-future-round value** needs save/match-value engine (P3) |
| 10 | Exit kill | ✅ partial / `todo` | exit-kill candidate generated; **chase-vs-keep-rifles VALUE** needs economy engine (P3) |

`todo` items are `it.todo(...)` in Vitest — they are **not** reported as passing. They mark
work that requires the P3 economy/ultimate/save engines, which are outside this phase.

## 5. Determinism

Each engine is a pure function of its inputs. Tests assert `analyze(s).result` equals a
second `analyze(s).result`, and the RNG tests assert seed-stability and cross-stream order
independence. No test depends on wall-clock time or external services.

## 6. Fixtures & provenance

Scenario and schema fixtures under `packages/*/test/fixtures/` are **verbatim copies** of
PV-2 (`origin/claude/pv-data @ fe24694`); each fixtures dir has a README recording the
origin path and commit, and the copies are not edited. The Ascent `SpatialQuery` stub /
placeholder mirrors PV-4 zone ids (`origin/claude/pv-spatial @ 4a1cf0d`) and is replaced by
the real engine adapter at final integration.
