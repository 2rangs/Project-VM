# PROJECT V — Architecture (Simulation Core)

> **Status (2026-11-20).** This document describes the simulation-core foundation — four packages — and the two
> rules everything else is built on: the information boundary (§4) and determinism (§5). Those still hold as
> written. The repository has since grown to nineteen packages and a desktop app; for the whole system as it is
> now (package map, dependency graph, the order a round is computed in, data flow, processes) see
> `docs/ARCHITECTURE.integrated.md`. §1 and §2 below show the core's own layout, not the whole monorepo.
>
> Scope of this document: the P0 simulation-core foundation delivered by the PV-3
> (Simulation Core) agent. It covers the four packages that package work owns and how
> they fit the structure in Handoff §17 and §23. It is **not** the whole-game
> architecture; downstream engines (spatial, perception, decision, combat, economy,
> ultimate, replay, desktop app) are later work and are referenced only where this
> core defines a seam they must plug into.

## 1. Monorepo layout

```
project-v/
├── package.json            # root scripts + devDeps (owned by PV-3)
├── pnpm-workspace.yaml      # packages/*
├── tsconfig.base.json       # shared compiler options
├── tsconfig.json            # root typecheck project (all packages)
├── vitest.config.ts         # single root test runner
└── packages/
    ├── shared-types/        # state/event/action/provenance TYPES (no runtime logic)
    ├── simulation-core/     # seeded RNG, fixed-tick clock, event log
    ├── game-rules/          # patch-versioned rule DATA (rounds/spike/economy/ultimate)
    └── world-state/         # world construction, immutable updates, serialize, observe
```

The other engines of Handoff §23 (spatial, perception, combat, ability, round simulator, match runner, …) have
since been added under `packages/` and are left out of this tree on purpose: this document covers the core. The
workspace glob is `packages/*`, so they were picked up without a root change.

Tooling: **pnpm** workspaces + **Vitest** + **TypeScript** (strict). Node ≥ 20.

### Build-less package consumption

Packages expose `"exports": "./src/index.ts"` and are consumed **directly from source**:
pnpm symlinks resolve `@pv/*` to each package's `src/index.ts`, and both Vitest (via its
esbuild transform) and `tsc` (via `"moduleResolution": "bundler"`) read TypeScript across
package boundaries with no build step. This keeps the dev loop to `install → test →
typecheck`. A bundling/emit step is a packaging concern for the Electron app agent and is
deliberately not added yet.

## 2. Dependency graph

```
shared-types  (leaf; pure types + tiny constructors)
      ▲   ▲
      │   └──────────────┐
simulation-core       game-rules
      ▲
      │
world-state  (depends on shared-types + simulation-core)
```

No cycles. `shared-types` is the single source of truth for the shapes every package
exchanges. `game-rules` depends only on `shared-types`. `world-state` depends on
`simulation-core` for the deterministic primitives it will use when folding events.

## 3. Package responsibilities

### 3.1 `@pv/shared-types`
Types only (Handoff §12, README §14/§15):
- **Identity** (`ids.ts`): branded `MatchId`/`PlayerId`/… so identities are never merged
  by raw strings (Handoff §13.2). Constructors `asPlayerId(...)` mint them.
- **State**: `WorldState`, `PlayerState`, `SpikeState` (ground truth, Handoff §12.1/12.2);
  `ObservationState`/`ObservedEnemy` (perceived, §12.3); `BeliefState` (inferred, §12.4).
- **Events** (`events.ts`): the `GameEvent` discriminated union — the only mutation channel.
- **Action schema** (`action-schema.ts`): `ActionSchema`, `DecisionContext`,
  `CandidateAction`, `FeasibilityResult` (README §15.2/15.3).
- **Provenance** (`provenance.ts`): `EvidenceType`/`Provenance` so an estimate is never
  stored as a fact (README §29).

### 3.2 `@pv/simulation-core`
Deterministic primitives (DECISION-010):
- **`SeededRng` / `RngStream`** — SplitMix64 with **stream separation**: each named stream
  (`"combat"`, `"movement"`, …) is an independent generator derived from the root seed, so
  reordering or adding draws in one stream never shifts another. This is the mechanism that
  makes order-independence (Handoff §30-O) hold.
- **`SimulationClock`** — fixed integer-ms ticks; render speed is decoupled from judged
  outcome (DECISION-010).
- **`EventLog`** — append-only, monotonic-`seq`, serialisable; the canonical replay record
  (Handoff §17 Event System / Replay Recorder seam).

### 3.3 `@pv/game-rules`
Patch-versioned **data**, not logic (README §19.1, Handoff §10/§16):
- `RuleValue<T>` wraps every number with `source`, `patch`, and `verified`.
- Rounds, spike, economy, weapons, ultimate tables + small pure helpers
  (`lossBonusFor`, `canPlantWithin`, `isUltimateReady`, …) that the Action Generator's
  constraint stage will call.
- **Every value ships `verified: false`** — this agent did not perform live source
  verification. See `GAME_RULES.md`.

### 3.4 `@pv/world-state`
World lifecycle + the information boundary:
- `createWorldState` / `createPlayerState` — valid, **deep-frozen** state (TASK 006).
- Immutable updates (`patchPlayer`, `advanceTick`, `appendEvents`, …) — every helper
  returns a new frozen world, enabling snapshot/branch for counterfactual sim (README §25).
- `serializeWorld` / `deserializeWorld` — versioned, lossless JSON round-trip (Handoff §24.4).
- **`observeWorld` — the World→Observation boundary** (see §4).

## 4. The information boundary (DECISION-004 / README §29)

The hardest architectural rule in this project is that an AI must not read ground truth it
could not perceive. This core enforces it **structurally**, not by convention:

- `WorldState` is omniscient and is meant to be read only by the simulation itself.
- Decision code consumes **`ObservationState`**, produced solely by `observeWorld(world,
  playerId, { oracle })`.
- An `ObservedEnemy` is a strict subset of `PlayerState`: last-seen position + coarse
  `HealthBand`, and **no** fields for live position, exact HP, inventory, velocity or
  intent. The leak is therefore not representable in the type a decision maker holds.
- Line-of-sight/sound is delegated to a pluggable `VisibilityOracle`. In the running game the
  round simulator produces observations through `@pv/perception-engine` (field of view, range,
  line of sight between real positions, smoke, hearing) and hands policies a `PolicyView` built
  from them — the same boundary, implemented by the engines that came later. The default `BLIND_ORACLE` reveals nothing, so a mis-wire
  **under-informs** the AI rather than leaking truth — it fails safe.

```
WorldState ──observeWorld(oracle)──▶ ObservationState ──(belief update, later)──▶ BeliefState
  (ground truth)                       (perceived only)                            (inferred)
```

`BeliefState` (position distributions, tactical hypotheses) is defined in `shared-types`
but its *population* — observation→belief decay/spread (README §17.3) — is the Perception/
Decision agents' work, not this core's.

## 5. Determinism model (DECISION-010)

Three ingredients reproduce a round exactly:
1. the **initial `WorldState`** (serialisable),
2. the **RNG seed** (`SeededRng` + named streams), and
3. the **ordered `EventLog`**.

Because updates are immutable and the clock is integer-ms, replaying the same events on the
same initial state yields byte-identical results regardless of playback speed. Order
independence across concerns is guaranteed by per-stream RNG isolation, verified in
`packages/simulation-core/test/rng.test.ts`.

## 6. Conventions

- **camelCase** field names; **milliseconds** for all durations/timestamps; **VALORANT
  world coordinate units** for positions (minimap conversion is a spatial-engine concern).
- These match the dataset conventions requested for the Data agent (PV-2); any divergence
  from `datasets/schema/` is to be recorded as a mapping in `docs/handoffs/PV-3-core.md`.

## 7. What this core deliberately does NOT do

No action generation, no constraint solving, no combat/movement resolution, no economy
decision logic, no spatial queries, no ML. Those consume the types and primitives here and
are the next agents' scope (Handoff §18 P1+). The seams are: `ActionSchema.generate` for the
Action Generator, `VisibilityOracle` for the spatial engine, and `EventLog` for the
simulation loop / replay.
