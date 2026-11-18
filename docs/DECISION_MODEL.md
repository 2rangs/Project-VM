# PROJECT V — Decision Model (phase 2)

How the simulation turns a situation into evaluated action candidates, and the seams that
let it be built without merging the spatial/perception branches. Covers the packages added
in PV-3 phase 2: the scenario loader (`@pv/world-state`), Belief State v0
(`@pv/decision-engine`), the Action Generator (`@pv/action-generator`), and the Decision
Debugger (`@pv/decision-debugger`).

## 1. Pipeline

```
DecisionContext JSON (PV-2)             datasets/schema/world-state.schema.json
        │  loadDecisionContext (world-state)   — validate, unit-map, keep provenance
        ▼
TeamDecisionContext  (WorldState + decidingTeam + Observation + Belief + provenance)
        │  buildTeamBelief (decision-engine)   — ObservationState + SpatialQuery only
        ▼
TeamBeliefModel      (per-enemy zone probability distributions)
        │  generateActions (action-generator)  — + SpatialQuery + enemyPressure
        ▼
GenerationResult     (feasible[] evaluated, excluded[] with reasons, selected)
        │  buildTrace / renderMarkdown (decision-debugger)
        ▼
Decision report (Handoff §21)
```

Everything is a pure function of its inputs → deterministic (DECISION-010). The same
scenario yields byte-identical results and reports.

## 2. Dependency inversion (no cross-branch merge)

The spatial and perception engines live on PV-4's branch and are **not merged**. The
decision packages depend only on two interfaces in `@pv/shared-types`:

- **`SpatialQuery`** — mirrors the real `SpatialEngine` API (`findPath`,
  `shortestTravelTimeMs`, `isReachable`, `hasLineOfSight`, `visibleZonesFrom`,
  `isPlantableZone`, `audibleZones`, `nearestZone`). Tests use a small Ascent stub; the CLI
  uses an Ascent placeholder; final integration supplies a thin adapter over the real
  engine (minimap↔world conversion lives in that adapter).
- **`ObservationProvider`** — mirrors PV-4's perception-engine (WorldState + team →
  ObservationState). In phase 2 the scenario's `belief` block provides the observation
  directly; the interface is the seam for when perception-engine is integrated.

A third seam, **`EconomyEvaluator`** (also in `@pv/shared-types`), inverts the dependency
onto PV-2's `economy-engine` (buy strategy, save value, ultimate economy, future-round
value). The Action Generator does NOT compute economic value itself: when an evaluator is
supplied it values SAVE/EXIT_KILL; otherwise it uses a provisional heuristic and labels the
rationale as delegated. Reconcile this interface with PV-2's economy-engine at integration.

Coordinate frame throughout the decision layer is **minimapUnits** (PV-2's scenario
frame); see `TeamDecisionContext.coordinateSpace`.

## 3. Belief State v0 (`@pv/decision-engine`)

Enemy positions are **probability distributions over zones** that spread with time since
the last sighting (README §17.3):

- a freshly observed enemy → point mass at its zone;
- as staleness grows, mass diffuses to every zone reachable within that time (via
  `SpatialQuery.shortestTravelTimeMs`), weighted so nearer zones stay likelier;
- `advanceTeamBelief(Δt)` diffuses further; `observeTeamBelief(obs)` re-collapses re-seen
  enemies.

**Type boundary (DECISION-004):** the belief module imports/accepts only
`ObservationState` + `SpatialQuery`. It cannot read `WorldState`, so it is structurally
impossible to seed a belief from omniscient ground truth. `enemyPressureOnZone` exposes the
aggregated belief to the generator's risk model.

## 4. Action generation (`@pv/action-generator`)

Four layers (Handoff §13.2), all **generated from state**, never chosen from a fixed list
(README §29):

| Layer | What it produces | Driven by |
|---|---|---|
| Strategic | team goals: `A/B_EXECUTE`, `MID_CONTROL`, `DEFAULT`, `FAKE_*`, `LURK`, `SAVE`; defense `DEFAULT_HOLD`, `AGGRO_PUSH`, `ROTATE_*`, `RETAKE`; post-plant `POST_PLANT_HOLD`, `EXIT_KILL` | side, spike phase, alive counts, reachable sites |
| Tactical | target zones + routes for each goal | `SpatialQuery` paths/travel times |
| Individual | `MOVE`, `HOLD`, `PEEK`, `USE_ABILITY`, `PLANT`, `DEFUSE`, `SAVE_RETREAT` per alive player | player zone, abilities, spike state |
| Parameters | concrete zone / route / ability slot / timing | current world |

### Constraint validation (README §15.3)
Physically impossible actions are **excluded with reasons**, not merely down-scored:
`insufficientTime`, `noPath`, `missingAbility`, `wrongSpikeState`/`blocked` (non-plantable),
`notEnoughPlayers`, `outOfRange`. Example: an execute's plant is **carrier-gated**
(requiredTime = carrier travel + 4 s plant), so an 8 s round excludes a B rotation while an
A execute stays feasible (Scenario 04).

### Evaluation (§19 outputs) — rule/utility, no ML (DECISION-005)
Each feasible action gets: **Feasibility**, **Required Time**, **Resource Cost**,
**Estimated Risk**, **Expected Utility**, plus a rationale.
- Risk = `1 − exp(−k·pressure)` over the target zone and zones with line of sight to it
  (believed enemy pressure), plus a man-disadvantage term.
- Utility = base objective value − risk penalty − time penalty.
- All weights live in `evaluate.ts WEIGHTS` and are **provisional** (`verified:false` in
  spirit) — to be calibrated by simulation later (Handoff §20.5).

### Decision policy
Feasible actions are sorted by utility (deterministic tie-break by id); the team-level
**selected** action is the best feasible *strategic* one, with an explanation.

## 5. What is intentionally NOT modeled yet (needs P3 engines)

The economic/value half of several decisions is out of this phase's scope and is clearly
deferred, not faked:
- **Save value** (equipment preservation, next-round buy, future win prob) — Handoff §20.
- **Ultimate-point denial / enemy ult valuation** — README §21.
- **Exit-kill trade value** (chase the Operator vs. keep rifles) — Handoff §22.

These actions ARE generated and feasibility-checked; their valuation is delegated to the
`EconomyEvaluator` seam (PV-2's economy-engine). Without an evaluator the generator uses a
provisional heuristic and says so in the rationale. The corresponding scenario assertions
(07, 08, 09, and the valuation half of 10) are `it.todo` — to be verified by the
economy-engine (PV-2) at integration.

## 6. Decision Debugger (`@pv/decision-debugger`, Handoff §21)

Builds a structured `DecisionTrace` and renders Markdown/text showing world state, what the
team observed/believes, every generated action, the excluded ones **with reasons**, the
per-action prediction numbers, and the selected action + reason. Every number is the
generator's own computed value (Handoff §21). SYNTHETIC provenance is surfaced so a report
is never mistaken for real match analysis. Run:

```bash
pnpm --filter @pv/decision-debugger debug <path/to/scenario.json> [--format text]
```
