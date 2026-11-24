# Handoff — information layer (per-player knowledge, comms, IGL fusion)

Branch `claude/amazing-mayer-2f95d0`. Design and formulas: [`docs/INFORMATION_LAYER.md`](../INFORMATION_LAYER.md).

## Status in one line

Built and unit-tested, but **default OFF**. It has not passed the real-roster gate (12/15, elimination 0.672), so the
default game is the calibrated pooled engine, unchanged.

## What is done

- `packages/decision-engine/src/information.ts`: the `InformationLayer`, which covers:
  - per-player knowledge (sightings, sounds, damage, silence);
  - comms with delay, accuracy, load, priority, one voice per player, and a last call on death;
  - minimap spots and recon reveals;
  - IGL fusion weighted by recency × confidence × trust^callQuality, with a Beta trust posterior per player per match (`CommsLedger`);
  - lurker and anchor "clear" calls (LURKER_ROLE.md L7);
  - a trace.
- `packages/team-engine/src/policy.ts`: `TeamDecisionPolicy` decides on the fused observation and belief when the layer is on.
- `packages/match-runner/src/teams.ts`: `rosterInfoProfiles` (proxies: communication ← trading, awareness ← impact, composure ← clutch, callQuality ← mean(impact, clutch)). `match.ts` binds the profiles each round and keeps one ledger per match.
- `packages/round-simulator/src/view.ts`: teammates carry `blindRemainingMs`.
- `packages/round-simulator/src/simulator.ts`: `RoundResult.information` holds both sides' traces. It appears only when the layer is on and tracing or perception is on.
- Tests:
  - `packages/decision-engine/test/information.test.ts` (13): unreported info never reaches the team; the IGL's own senses are instant; a burst drops calls; wrong count and wrong zone; the last call; trust; the lurker clear counterfactual.
  - `packages/team-engine/test/information-layer.test.ts` (5): counterfactuals showing that pooled vs called, late vs sharp caller, wrong count, wrong zone and slow vs quick IGL each change when the defense rotates or where it goes.

## Default-on

Nothing sim-facing. With the flag off, the engine follows exactly the pre-layer code path:
- the layer is not constructed;
- `blindRemainingMs` is only read by the layer;
- the trace key is omitted.

## Behind a flag (default off)

| Where | Flag |
|---|---|
| Match config | `MatchConfig.informationLayer: true` |
| sim-batch | `--information` |
| Team policy (tests / direct use) | `TeamPolicyOptions.information: true` |

## Measured

Seeds 1–160, real rosters, Ascent, layer ON, compared with main economy v1.2 (`SIM_ECONOMY_V12_2026-11-24.json`):

| Metric | Real | Main v1.2 | Layer on |
|---|---|---|---|
| Elimination | 0.714 | 0.681 ✓ | **0.672 ✗** (pass needs ≥ 0.674) |
| Detonation | 0.082 | 0.090 | 0.091 ✓ |
| Defuse | 0.160 | 0.191 | 0.198 ✓ |
| Time | 0.043 | 0.038 | 0.039 ✓ |
| Attack win | 0.509 | 0.512 | 0.536 ✓ (in band 0.47–0.55) |
| Opening duel (atk) | 0.437 | 0.451 | 0.449 ✓ |
| Pistol vs pistol | 0.500 | 0.463 | 0.453 ✓ |
| Full vs full | 0.500 | 0.489 | 0.506 ✓ |
| Semi vs full | 0.319 | 0.349 ✓ | **0.397 ✗** |
| Semi vs eco | 0.928 | 0.995 ✗ | 0.990 ✗ (fails on main too) |

Summary:
- original 8: **7/8**;
- judged: **12/15** (main 13/15);
- seeds 161–320 not run.

Reading: the defense is about 2 points weaker, and attackers on a semi buy beat full defenses more often. That fits defenders
learning of a hit later than they did in the pooled engine, where every sound was known team-wide at once.

## Unfinished: exact next step

1. **Diagnose delay vs confidence.** I queued a zero-delay diagnostic and cancelled it at wrap-up, so it has no result. Two
   candidates, both in `information.ts`:
   - **Delay.** At average attributes a footstep call takes about 1.4 s longer to reach the IGL: reaction ≈ 400 ms, speech ≈ 570 ms,
     IGL take-in ≈ 390 ms.
   - **Confidence damping.** A heard sound's confidence is multiplied by `(0.6 + 0.4·awareness)` at sensing and then by
     `trust^callQuality` at fusion. That is ≈ 0.70 × the pooled value, and it feeds the sound evidence in `igl.ts`, `utility.ts` and
     `belief.ts`.

   To run the test: temporarily set `callReactionMs`, `speechMs`, `iglProcessingMs` and `minimapGlanceMs` to 0 and run
   `sim-batch --matches 160 --information` through heavy-run. Rerun `pnpm install --frozen-lockfile` first, because the
   packages depend on each other as `file:` copies.
   - If balance recovers, the delays are the cause.
   - If it does not, look at the confidence damping. Likely fix: trust should rank conflicting claims rather than scale
     absolute confidence, so normalise `trust^q` by the prior.
2. Get 8/8 with attack in 0.47–0.55 on seeds 1–160, confirm on 161–320, then consider flipping the default.
3. Still open from LURKER_ROLE.md: rotator-count evidence (L7 rest), lurker as defender route risk (L6), defence lurk
   hypothesis (L11).

## Known risks

- **Proxy attributes.** `communication` and `mapAwareness` are unrated in the dataset, so the proxies stand in for them. `clutch` has no spread in real data, so composure is a flat 0.6 for real players.
- **Calibration.** The engine's other tunables were calibrated against the pooled picture. Turning the layer on shifts balance even when every formula is sensible.
- **Packaging.** `decision-engine` is consumed as a `file:` copy. After adding or changing files there, rerun `pnpm install --frozen-lockfile`, or the round-simulator and match-runner builds see the stale copy.
- **Pre-existing failure.** `packages/round-simulator/test/perf.test.ts` fails under machine load. It uses ScriptedPolicy, which this work does not touch, and it fails on main too.
- **Tests not run with the flag on.** Desktop `test:e2e` was not run on this branch (wrap-up; the integrator runs the combined gate). The flag is off by default, so desktop behaviour is unchanged.
