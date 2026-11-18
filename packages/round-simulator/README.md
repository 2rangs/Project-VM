# @pv/round-simulator

PROJECT V round simulator (v0). A **deterministic fixed-tick 5v5 round loop** that wires
PV-4's spatial, perception, combat and ability engines together (Handoff §17, README §28.1,
Phase 10). Decision-making is behind the `DecisionPolicy` interface so PV-3's Decision
Engine can drop in later.

Standalone package; uses the four engines via `file:` links.

## Tick loop (order)

1. **decisions** (every N ticks) — each live player's `DecisionPolicy.decide(ctx)`.
2. **movement** — discrete zone-hop along a spatial A* path (run/walk edge time).
3. **abilities** — `useAbility` commands → ability-engine (availability-checked).
4. **perception** — `perceive(world)` → observations.
5. **engagement** — enemies with mutual/one-sided visibility fight via combat `resolveDuel`
   (seeded per engagement); one duel per player per tick so kills can be traded.
6. **spike** — plant / defuse progress, interruption, detonation timer.
7. **end conditions** — elimination / detonation / defuse / time expired.

## DecisionPolicy — PV-3's contract (the ground-truth boundary)

Implements PV-3's **team-level** contract (`@pv/shared-types` `decision-policy.ts`, mirrored
in `src/policy-contract.ts`):

```ts
decide(view: PolicyView, rng: RandomSource): PolicyDecision
```

- **`PolicyView`** — the deciding team's observable state: `teammates` (own-team `PlayerState`
  only), `observation`, `belief`, `economy`, public `spike` and round facts. **No `WorldState`
  and no enemy ground truth** — enemies come only through `observation`/`belief` (DECISION-004).
  Built by `buildPolicyView()`; asserted leak-free in `test/leak.test.ts`.
- **`PolicyDecision { strategy, roles, commands: ActionCommand[] }`** — commands carry
  `playerId`, `kind` (move/hold/peek/useAbility/plant/defuse/save), `targetZone`, `moveMode`,
  `abilityId`, `executeAtMs`.
- The map is a **construction dependency** (`SpatialQuery`, provided by `SpatialQueryAdapter`
  over PV-4's `SpatialEngine`), not per-decision input.
- `RandomSource` is PV-3's seedable interface (`SeededRandomSource`, mulberry32-backed).

`ScriptedPolicy(spatial, opts)` is a **simple stand-in, NOT the final AI**: attackers push a
site and plant; defenders hold an anchor and rotate/defuse. PV-3's `TeamDecisionPolicy` drops
in via the same interface.

## Determinism (DECISION-010)

Same initial state + seed ⇒ byte-identical event log. RNG is seeded per engagement
(`deriveSeed(seed, tick+pair)`) so one duel's rolls can't shift another's. Playback speed and
adjudication are independent.

## Output & replay

`RoundResult` carries the `SimEvent[]` log, winner/reason, survivors, and (with
`config.recordTracks`) per-tick `TrackFrame[]`. `toRoundReplay()` emits a neutral
`ROUND_REPLAY_V0` structure for PV-6; `toPv6ReplayFormat()` is a labelled stub until PV-6's
`replay-engine` is published. Positions are world units — convert to minimap with
spatial-engine's transform. See `src/replay.ts` for the export format to hand PV-2's
`tools/data-validator`.

## Scenarios

`makeSyntheticRound(spatial)` builds a synthetic 5v5 on real Ascent zones (manual-approx test
scaffold). `fromPv2Scenario()` structurally imports PV-2's `datasets/synthetic/scenarios/`
(copied fixture `test/fixtures/pv2-scenario-01.json`) — but PV-2's coordinate space differs
from PV-4 zones, so only structured fields are carried and players are placed at spawns; a
shared coordinate agreement is needed for true positions.

## Known v0 limits

Instant 1v1 duel resolution (no sustained tracking); no spike pickup after a carrier dies; no
utility-driven decisions (scripted policy only). The engine accepts any `DecisionPolicy`.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (9 tests; perf logs ms/round for 1,000 rounds)
```
