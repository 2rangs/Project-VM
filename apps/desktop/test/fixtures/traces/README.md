# Decision trace fixtures — REAL output from PV-3's pipeline

These are **authentic `DecisionTrace` JSON** produced by running PV-3's
`@pv/decision-debugger` (`analyzeDecisionContext`) over the PV-2 synthetic
scenarios. They are **not** hand-authored — the exclusion reasons and prediction
numbers are the pipeline's own computed values (Handoff §21).

- **Source branch:** `origin/claude/pv-core`
- **Source package:** `packages/decision-debugger` (`src/trace.ts` → `DecisionTrace`)
- **Inputs:** `packages/decision-debugger/test/fixtures/scenarios/scenario_01.json`
  and `scenario_04.json` (themselves verbatim copies of PV-2
  `origin/claude/pv-data` synthetic scenarios).
- **Generated on:** 2026-11-18 by PV-6, via:
  ```
  npx tsx -e 'import {analyzeDecisionContext} from "@pv/decision-debugger"; …' scenario_0N.json
  ```
  (cloned pv-core to /tmp, `pnpm install`, ran the pipeline; the pv-core repo was
  not committed here.)

| file | scenario | notable |
|---|---|---|
| `trace-scenario-01.json` | basic attack (round start) | 39 generated, 1 excluded, selected `A_EXECUTE` |
| `trace-scenario-04.json` | time shortage | 27 generated, **5 excluded with time-budget reasons**, selected `A_EXECUTE` |

**SYNTHETIC:** `provenance.synthetic = true`. Not a real VCT match; never present
as real pro data. Do not edit — re-generate from the source pipeline if the
upstream schema changes.
