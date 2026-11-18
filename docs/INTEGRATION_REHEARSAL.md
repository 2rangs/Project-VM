# PROJECT V — Integration Rehearsal (phase 5)

A **local, throwaway dry-run** of `docs/INTEGRATION_PLAN.md`, done by PV-3 to surface hidden
problems before the orchestrator's final merge. **Nothing here was pushed to any remote
branch** — the rehearsal ran in a detached `git worktree` at `/tmp/pv-rehearsal` and was
discarded. Only this report + the pv-core fixes it prompted are committed (to `claude/pv-core`).

Branch commits merged (per INTEGRATION_PLAN order): pv-core `51a9541`, pv-spatial `94fa92f`
(incl. round-simulator, combat/ability/perception), pv-data `0eb7010` (economy-engine),
pv-research `2886c81`, pv-replay `06b46d66` (replay-engine), pv-mapmesh `5840e6d`.

## Result summary

| Step | Result |
|---|---|
| Merge 6 branches | ✅ **Zero conflicts** — fully additive (confirms the collision analysis) |
| Scope rename `@project-v/*`→`@pv/*` | ✅ 25 refs; **but** quoted path-segment `"@project-v"` in a test is missed by a `@project-v/` sed |
| Remove npm lockfiles + `pnpm install` | ✅ workspace links all 17 packages |
| Root `tsc` over all packages | ❌ ~60 strictness errors in sibling code (not type-incompat) |
| Per-package typecheck (own tsconfig) | ✅ siblings pass under their own configs |
| Root `vitest` over all packages | ⚠️ 39/47 files pass; 8 "fail" are runner/path issues, not logic |
| Per-package test (own runner) | ✅ round-simulator 9/9 (vitest), replay-engine 11/11 (node:test) |
| **E2E** scenario→sim→EventLog→replay | ✅ runs, deterministic (same seed → identical hash) |
| **E2E** PV-3 TeamDecisionPolicy via real spatial adapter | ✅ emits commands; no WorldState in input |
| **Coordinate check** | ❌ confirmed wrong (see F1) |

## Findings & fix requests

Owner = the session whose path must change. PV-3 fixes its own; the rest are relayed by the
orchestrator (I did not edit other branches' files).

### F1 — Coordinate frame mismatch (owner: PV-3 fixed + PV-4/PV-6 to supply transform) — HIGH
PV-2 `minimapUnits` are the **VLR 2D-replay minimap PIXEL frame** (scenarios observed
x≈170..825; PV-4 reports vlr range x≈92..973, y≈117..844), **not** normalized×1000. In the
E2E, feeding `minimapUnits/1000` into PV-4's valorant-api transform mapped **all
attacker-spawn players to `b-main`**. 
- **PV-3 (done):** `spatial-adapter.ts` now takes an injectable `minimapToGame`; the ×1000
  scale path is demoted to a labelled fallback. `normalization.ts` updated.
- **Needed:** at integration, inject PV-6's verified vlr-pixel↔game transform (3001 samples,
  inclusion 1.0) — or PV-4's `fromPv2Scenario` conversion once it reads positions.

### F2 — DecisionPolicy contract granularity (owner: PV-4 round-simulator) — HIGH
`round-simulator@94fa92f` `DecisionPolicy` is **per-player, per-tick**:
`decide(ctx: DecisionContext): ActionCommand`, and `ctx` has no teammates. PV-3's
`TeamDecisionPolicy` is **team, per-round**: `decide(view: PolicyView, rng): PolicyDecision`
(needs the whole team view). They cannot be wired directly. The orchestrator says PV-4 is
already aligning to PV-3's contract — this rehearsal confirms the pushed version predates it.
**Request (PV-4):** adopt `PolicyView`/`PolicyDecision` (call `decide` once per round, cache
per-player commands for the tick loop), OR include `teammates` + a round-level hook so a
team planner can run. PV-3 will adjust `decision-policy.ts` if PV-4 proposes a variant.

### F3 — `fromPv2Scenario` ignores positions/belief (owner: PV-4 round-simulator) — MED
`fromPv2Scenario` spawns every player at `attacker-spawn`/`defender-spawn` and drops
`position`, `health`, `belief`. So scenarios 02/03/06/10 (observed enemies, post-plant) lose
their distinguishing state. **Request (PV-4):** map `position` through the F1 transform and
carry health/armor/spike/belief, so the 10 scenarios drive distinct rounds.

### F4 — Root single-tsconfig strictness (owner: PV-3 / integration) — MED
pv-core's root `tsconfig.json` (`strict` + `noUncheckedIndexedAccess`) compiled over
`packages/*/src` fails ~60 times in combat/economy/perception/replay code that passes under
each package's own looser tsconfig. **Resolution:** the integrated repo should typecheck
**per package** (`pnpm -r typecheck`), not via one root `tsc`. PV-3's root `tsconfig.json`
should narrow its `include` to pv-core packages, or the root typecheck script switch to
`pnpm -r typecheck`. (No sibling code change required.)

### F5 — Mixed test runners (owner: integration policy) — MED
replay-engine (PV-6) uses Node's built-in `node:test`; pv-core/spatial/data use **vitest**.
A single root `vitest` reports replay files as "No test suite found". **Resolution:** run
`pnpm -r test` so each package uses its own runner; do NOT rely on one root vitest glob.
PV-3's root `vitest.config.ts` `include` should be scoped to pv-core packages.

### F6 — Scope rename must cover path-segment strings (owner: PV-4) — LOW
`round-simulator/test/fixtures/setup.ts` builds a path with `"@project-v"` as a **quoted
segment** (`resolve(..., "node_modules", "@project-v", "combat-engine", ...)`), which a
`s#@project-v/#@pv/#` rename misses → ENOENT. Also, reaching into a dependency's `test/`
dir via `node_modules` is fragile. **Request (PV-4):** rename to `@pv` and/or load the
weapons fixture from the package's own path. (In a pnpm workspace the symlinked path works
once renamed.)

## E2E numbers (rehearsal, synthetic Ascent round)

**Scripted policy (PV-4 `ScriptedPolicy`), 20 seeds, `makeSyntheticRound`:**
`attackWin = 5/20 (25%)`, round-end reasons `{ timeExpired: 11, elimination: 9 }`
(no detonations/defuses — the scripted plant rarely completes under contest). Determinism:
same seed → identical EventLog hash.

**PV-3 `TeamDecisionPolicy` (via the real spatial-engine adapter), scenario_01:**
`strategy = bExecute`, 5 commands (one per alive teammate), policy input carried no
WorldState. NB: the strategy is computed over **mis-mapped** zones (F1), so it is not yet a
fair comparison — re-run after F1/F2/F3 land. A head-to-head attack-win / round-end
comparison vs. the scripted policy is **blocked on F2** (team policy cannot yet drive the
tick loop) and should be the first post-integration acceptance metric.

## Plan updates applied
`docs/INTEGRATION_PLAN.md` §Normalization updated with the VLR-pixel finding (F1) and the
per-package typecheck/test resolution (F4/F5); risks list updated with F2/F3/F6.

## Validation harness note
PV-2's `tools/data-validator/.../sim_harness.py` + `docs/VALIDATION_BASELINES.md` +
`datasets/derived/priors/side_map_baselines.json` exist; wiring the simulator's aggregate
outcomes to that harness is a post-integration step (needs the EventLog→harness feed and the
F2 fix so the real policy, not the scripted stand-in, produces the numbers compared to the
baselines).
