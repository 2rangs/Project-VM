# PROJECT V — Integration Result

Branch `claude/pv-integration`, assembled by PV-3 (integration lead). Real merge (not a
rehearsal); push to this branch only — main is merged by the orchestrator after review.

## Merge (zero conflicts, additive)
Base `origin/main 7e215ac`, then:
`pv-core f17e684` → `pv-spatial 61d6205` → `pv-data 4f9bf56` → `pv-research 8c7bac5` →
`pv-replay c353166` (**squash**, drops civilian-ProfileName history) → `pv-mapmesh 02038a7`.
17 packages. (pv-data advanced to ea024f6 after freeze; the pinned 4f9bf56 was used.)

## Wiring (per INTEGRATION_PLAN)
- `@project-v/*` → `@pv/*` (imports + quoted path segments).
- Removed sibling npm `package-lock.json`; regenerated root `pnpm-lock.yaml`.
- Root `tsconfig`/`vitest` scoped to PV-core packages; siblings run via `pnpm -r`
  (F4/F5: siblings keep looser tsconfig + mix vitest/node:test runners).
- `economy-engine`: added a local `vitest.config` (was inheriting the narrowed root config).
- `perception-engine/test/leak.test.ts`: `as unknown as` cast for strict typecheck
  (PV-4 file; wiring-only, no behaviour change).
- integration-adapters mirrors (spatial/combat/economy/ability/perception) were **kept** for
  this first pass — they already compile and pass; swapping to direct `@pv/<engine>` imports
  is a follow-up that does not block green (TODO, INTEGRATION_PLAN §2c).

## Build & test (all run; no skips/hiding)
- `pnpm -r typecheck`: **17/17 packages clean**.
- PV-core (root vitest, incl. E2E): **128 passed, 4 todo**.
- Siblings (`pnpm -r test`): spatial 3, economy 20, combat 5, perception 6, ability 8,
  round-simulator 8, replay 11 — **all pass**.
- Python: `data-validator` 11 passed, `catalog-builder` 18 passed (1 skipped).
- **Known env gap (not an integration defect):** `tools/data-collector` pytest fails
  collection — `ModuleNotFoundError: duckdb` (optional dep not installed in this container).

## E2E acceptance (integrated pipeline)
`packages/integration-adapters/test/e2e.integration.test.ts` — scenario/synthetic round →
**PV-3 TeamDecisionPolicy** (belief filled via `buildBeliefState`) → **round-simulator**
(f9f274f+ aligned: `buildPolicyView` + `decide(view,rng)`) → EventLog → **PV-6 replay
format** → **replay-engine** convert. **4/4 pass:**
- terminates to a terminal reason; **deterministic** (same seed → identical EventLog);
- EventLog converts to a replay;
- policy input carries **no WorldState** (DECISION-004 held by the contract).

Comparison over 20 seeds (synthetic round, NO_ABILITIES):

| Policy | Attack win | Round-end reasons |
|---|---|---|
| ScriptedPolicy (PV-4) | 5/20 | timeExpired 11, elimination 9 |
| **TeamDecisionPolicy (PV-3)** | **7/20** | elimination 9, timeExpired 11 |

(Directional, not a correctness claim. Full acceptance vs PV-2 side/map baselines awaits
scenario v2 in game-units + the EventLog→`pv-validate-sim` feed — TODO.)

## PRE_MERGE_AUDIT (PV-1 checklist, 6 items)
- **[A] ValorantWebReplayer (MIT)** — `extract.mjs` references the license; full MIT text in
  `docs/THIRD_PARTY_NOTICES.md` §1/§5. ✅
- **[B] recast-navigation (MIT) + Recast/Detour (zlib)** — notices + full texts (§2/§5). ✅
- **[C] ValorantReplayParser (MIT, external tool)** — noticed (§1). ✅
- **[D] pv-replay history squash** — done at merge. ✅
- **[E] screenshot-real.png** — orchestrator visually verified (anon labels only). ✅
- **[F] VCT Reference attribution** — in notices §3 (data sources). ✅
- `docs/THIRD_PARTY_NOTICES.md` finalized (de-drafted, license texts embedded).

## Secrets / PII grep (completion criterion)
On the merged tree (excl. node_modules/.git): **secrets 0**, `.env`/`.pem`/`.key` **0**,
civilian RiotID `name#tag` **0**. (Pro handles / team names are an allowed, user-approved
class — re-review NIL/trademark before any commercial release.)

## Remaining TODO (non-blocking; parallel sessions)
- integration-adapters mirror → real-engine import swap (§2c).
- `apps/*` (desktop, replay-viewer) + `tools/*` are outside the `packages/*` workspace glob;
  add when wiring the desktop/viewer.
- Match Runner (match-level sim + CLI `sim:match`) — PV-3's engine-completion task.
- Scenario v2 (game-units) + `pv-validate-sim` acceptance metric.
- `duckdb` for the data-collector Python tests (env).
