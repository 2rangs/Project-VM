# Integration rehearsal harness (PV-3)

Re-runnable harness for the **local, push-forbidden** integration rehearsal (phase 5/6).
It is **not** part of pv-core's build/test — it only runs inside a merged integration tree
(it imports sibling-branch packages `@pv/round-simulator`, `@pv/replay-engine`). Kept here so
the orchestrator / a future run can re-execute it mechanically once all branches merge.

## What `round2-harness.ts` does
Plugs PV-3's `TeamDecisionPolicy` into PV-4's aligned `round-simulator` (which now calls
`policy.decide(view, rng)` with a `PolicyView`) and compares it against the built-in
`ScriptedPolicy` over N seeds: attack win-rate + round-end reason distribution, plus a
determinism check (same seed → identical EventLog hash).

## How to run (in a throwaway merged worktree — never push the merge)
```bash
# from a clone of this repo
git worktree add --detach /tmp/pv-rehearsal origin/claude/pv-core
cd /tmp/pv-rehearsal
for b in pv-spatial pv-data pv-replay; do git merge --no-edit origin/claude/$b; done
# wiring (see docs/archive/INTEGRATION_PLAN.md §2): scope rename + drop npm locks
grep -rl '@project-v/' packages --include=*.ts --include=*.json | xargs -r sed -i 's#@project-v/#@pv/#g'
grep -rl '"@project-v"' packages --include=*.ts | xargs -r sed -i 's#"@project-v"#"@pv"#g'
find packages -name package-lock.json -delete
# the harness needs these as workspace deps of integration-adapters (dev):
#   @pv/round-simulator @pv/replay-engine @pv/team-engine @pv/decision-engine @pv/world-state @pv/simulation-core
pnpm install
cp docs/archive/integration-rehearsal/round2-harness.ts packages/integration-adapters/test/e2e2.rehearsal.test.ts
pnpm exec vitest run packages/integration-adapters/test/e2e2.rehearsal.test.ts
```

## Round-2 proper (blocked on PV-2 scenario v2)
When PV-2 pushes scenario v2 (game world units + zone ids), replace `makeSyntheticRound`
with `fromPv2Scenario(spatial, scenarioV2)` and feed the EventLog into PV-2's
`pv-validate-sim` harness (`--era patch>=9` and `all` when available) to compare the
scripted vs TeamDecisionPolicy acceptance metrics against the side/map baselines.

## Notes / findings baked into the harness
- `SpatialQuery` is used in **game world units** (identity `minimapToGame`); the sim's
  `PolicyView` positions are already game uu.
- The sim's `PolicyView.teammates` is currently a perception SUBSET (no credits/inventory/
  abilities); `normalizeView()` backfills them so PV-3's policy can run. Remove once PV-4
  fills the contract's teammate fields.
- `ScriptedPolicy` constructor is `(spatial, opts)` as of pv-spatial f9f274f.
