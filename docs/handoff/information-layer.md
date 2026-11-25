# Handoff — information layer (per-player knowledge, comms, IGL fusion)

Design and formulas: [`docs/INFORMATION_LAYER.md`](../INFORMATION_LAYER.md). The first package is on main. Package 2 is on branch
`info-layer-2`.

## Status in one line

Built and unit-tested, but **default OFF** (`MatchConfig.informationLayer`). The first package scored 12/15 on the real-roster
gate (elimination 0.672). Package 2 changes the defence's information and has **not been gated yet**. With the flag off, a match
is byte-identical to main (signature test).

## What is done

**Package 1 (on main)**
- `packages/decision-engine/src/information.ts`: the `InformationLayer`, which covers:
  - per-player knowledge (sightings, sounds, damage, silence);
  - comms with delay, accuracy, load, priority, one voice per player, and a last call on death;
  - minimap spots and recon reveals;
  - IGL fusion with a Beta trust posterior per player per match (`CommsLedger`);
  - lurker and anchor "clear" calls (LURKER_ROLE L7 silence);
  - a trace.
- `packages/team-engine/src/policy.ts`: decides on the fused observation and belief when the layer is on.
- `packages/match-runner/src/teams.ts`: `rosterInfoProfiles` (attribute proxies).
- `packages/match-runner/src/match.ts`: binds the profiles each round and keeps one ledger per match.

**Package 2 (`info-layer-2`)**
1. **Double damping fixed.** Investigation result: it was a modelling error, not a design choice.
   - The perception engine's hearing confidence is pure signal strength (`1 − d/R`, `perception-engine/src/hearing.ts`), the
     read the pooled engine was calibrated on.
   - The layer then cut it twice: by `(0.6 + 0.4·awareness)` at sensing, and by `trust^callQuality` at fusion. Trust's prior is
     itself built from communication and awareness, so awareness counted twice. A caller's unreliability was also counted twice:
     once played out in the calls (wrong zone or count, partial) and again as a discount on every correct call.
   - An average defender's call reached the IGL at ≈ 0.70 of the pooled confidence, and that weakens every sound-driven
     defence read (`igl.ts`, `utility.ts`, `belief.ts`).
   - Fix:
     - `hearConfidence = min(1, cue·(1 + 0.4·(awareness − 0.6)))`, centred on the league average;
     - trust now only **ranks** claims, choosing which caller places a spot and how a conflict splits the belief. It no longer
       scales the confidence passed on.
   - The ≈ 1.4 s comms delay is a modelled effect and stays.
2. **Rotators leaving → evidence for the other site** (LURKER_ROLE L7 rotator count).
   - The layer keeps a per-enemy placement history and exposes `InformationLayer.departures(siteOf)`: per site, enemies placed
     there in the last 16.6 s, and how many were then placed off it.
   - `hit-belief.ts` takes these as optional `SiteEvidence.departures` with `k ~ Binomial(m, r_role)`, r = hit 0.10 · show 0.60 ·
     quiet 0.30, so a site being left reads as a show there and a hit on the other site.
   - Without the field, the likelihood is exactly the old one (tested).
3. **A spotted lurker slows the rotation** (LURKER_ROLE L6, defence side).
   - An enemy the IGL has placed off the likeliest hit site pins the available defender closest to it, and the call says so.
   - Rotators avoid its zone in the retake approach. When the way still runs through it, they go around (`rotate:around`), or walk
     through checking it (`rotate:check`).
4. **Round trace for Match Day.** `RoundRecord.information = { A, B }` (match-runner) carries each team's `InformationTrace` on
   every round when the flag is on:
   - per-player knowledge;
   - every callout (said vs known, timings, accuracy, dropped, last call);
   - minimap spots, trust, and `placements`.

   That is the data for the trace; there is no Match Day UI for it yet.

**Tests (package 2)**
- `packages/match-runner/test/information-layer.test.ts`:
  - **flag-off signature:** sha256 of the round records for sen vs lev, seeds 5 and 11, 8 rounds, equal to origin/main 85eadc8;
    `false` is the default.
  - **single-round replay, flag on vs off:** off has no trace. On has both teams' knowledge and comms, plays a different round,
    and is deterministic.
- `packages/decision-engine/test/information.test.ts` (+5):
  - hearing centred on the average;
  - an average caller's call reaches the IGL at the pooled 0.8, not ≈ 0.7;
  - a less-trusted caller's uncontested call is passed on as heard;
  - departures counted from the placement history; nothing that never reached the IGL counts.
- `packages/team-engine/test/information-layer.test.ts` (+4):
  - **lurker pin:** a lurker in mid means one fewer rotates and the mid defender stays; with the flag off, nothing changes;
  - **lurker on the way:** a lurker behind the sites makes the rotator go around it;
  - **departures in `hit-belief`:** leaving raises show(A) and hit(B); an empty departures field equals the old likelihood.

## Default-on

Nothing sim-facing. With the flag off, the layer is not constructed, and every package-2 path is gated on it:
- `departures` and the lurker pin are read only when the layer stepped this decision;
- the trace keys are omitted.

The signature test proves it.

## Behind a flag (default off)

| Where | Flag |
|---|---|
| Match config | `MatchConfig.informationLayer: true` |
| sim-batch | `--information` |
| Team policy (tests / direct use) | `TeamPolicyOptions.information: true` |

## Measured

Package 1 only (before the damping fix), seeds 1–160, real rosters, Ascent, layer ON, compared with main economy v1.2
(`SIM_ECONOMY_V12_2026-11-24.json`):

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

Summary: original 8 at 7/8; judged 12/15 (main 13/15).

Package 2 has not been measured: no sim batches were allowed in this package.

## Unfinished: exact next step

1. **Gate package 2** when the lock is free:
   ```bash
   sim-batch --matches 160 --information --compare docs/research/SIM_ECONOMY_V12_2026-11-24.json
   ```
   Run it through heavy-run, then repeat with `--seed-start 161`.

   What to expect:
   - the damping fix and the departures evidence strengthen the defence's read;
   - the lurker pin weakens rotations, but only when a lurker is spotted.

   The defence was about 2 points weak, so the net should move elimination up and semi vs full down.
2. **If the defence is still weak**, the next lever is the comms delay. In the pooled engine a call is heard by every teammate at
   once, but IGL take-in (≈ 390 ms) currently gates the whole rotation. Consider letting a rotator who heard the call start on it
   without the IGL's take-in. That is a design change; record it in INFORMATION_LAYER.md.
3. With 8/8 and attack in 0.47–0.55 on both seed ranges, consider flipping the default.
4. **Still open:**
   - a defence "lurk" hypothesis and pair rotation (L11);
   - the lurker choosing a lane to cut off a rotator (L6, attack side);
   - a Match Day view of `RoundRecord.information`.

## Known risks

- **Proxy attributes.** `communication` and `mapAwareness` are unrated in the dataset, so the proxies stand in for them. `clutch` has no spread in real data, so composure is a flat 0.6 for real players.
- **Calibration.** The engine's other tunables were calibrated against the pooled picture. Turning the layer on shifts balance even when every formula is sensible.
- **Signature constants.** The hashes in `packages/match-runner/test/information-layer.test.ts` are main's round records at
  85eadc8. A later main change to the default engine will rightly change them. Recompute them from the new main with the flag off
  (`sha256(JSON.stringify(runMatch(cfg).rounds))`); never recompute them from a branch with the flag on.
- **Flank rule is coarse.** Any enemy seen off the likeliest site in the last 8 s counts as a lurker, including a show on the other site. Each one pins a defender, so a 3-player show can hold three back.
- **Packaging.** `decision-engine` is consumed as a `file:` copy. After adding or changing files there, rerun `pnpm install --frozen-lockfile`, or the round-simulator and match-runner builds see the stale copy.
- **Flaky checks.**
  - `packages/round-simulator/test/perf.test.ts` fails under machine load (ScriptedPolicy; fails on main too).
  - Desktop `test:engine` once reported 1 failure before a fresh build; it passed 10/10 on two reruns after the build.
- **Not run.** Desktop `test:e2e` was not run (integrator's combined gate).
