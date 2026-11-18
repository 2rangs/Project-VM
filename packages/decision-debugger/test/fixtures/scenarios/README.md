# Scenario fixtures (copied — do not edit)

These are **verbatim copies** of the PV-2 (Data agent) synthetic decision contexts.

- **Origin branch:** `origin/claude/pv-data`
- **Origin commit:** `fe246942167b3a1261e88782375c65f650eec6c9`
- **Origin path:** `datasets/synthetic/scenarios/scenario_01.json … scenario_10.json`
- **Copied on:** 2026-11-18 by PV-3 (Simulation Core)

## Rules
- **Do not modify these copies.** If the upstream scenarios change, re-copy them and
  update the commit hash above.
- These are **SYNTHETIC** data (`provenance.synthetic = true`,
  `evidenceType = "simulated"`). They are **not** real VCT matches and must never be
  presented as such (Handoff §31, README §19).
- Schema: `datasets/schema/world-state.schema.json` (a `DecisionContext`: ground-truth
  `worldState` + `decidingTeamIdx` + the deciding team's `belief` + `provenance`).

## Scenario map (Handoff §20)
| File | Scenario | In-scope for PV-3 phase 2? |
|---|---|---|
| 01 | Basic attack | yes — candidate generation |
| 02 | Observed info | yes — belief ≠ truth |
| 03 | Fake (defender read) | yes — defender decides on observed info only |
| 04 | Time pressure | yes — infeasible B rotation excluded |
| 05 | Plant | yes — plant only inside plant zone |
| 06 | Post-plant | yes — post-plant hold candidates |
| 07 | Operator save | **todo** — needs economy/save engine (P3) |
| 08 | Ult denial | **todo** — needs ultimate engine (P3) |
| 09 | Match point | **todo** — needs save/match-value engine (P3) |
| 10 | Exit kill | partial — candidates generated; economic valuation is todo |
