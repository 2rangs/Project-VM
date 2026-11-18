# @pv/perception-engine

PROJECT V perception layer (v0). Turns the omniscient `WorldState` into per-player and
per-team **Observations** while enforcing the ground-truth boundary (DECISION-004,
README §29): an AI never learns the live position of an enemy it cannot see or hear.

Standalone package (own `package.json` / `tsconfig` / Vitest). Depends on
`@pv/spatial-engine` via a `file:` link for line-of-sight and sound propagation.

## Layers

- **Vision** (`vision.ts`) — deterministic LoS: FOV cone + view distance + zone sightline
  (+ smoke blocking). Fails safe (no authored sightline → not visible).
- **Hearing** (`hearing.ts`) — running footsteps (walking is silent), gunfire, ability
  casts, spike plant/defuse, propagated over the spatial sound graph. Localised to the
  **source zone center**, never the exact coordinate; carries a confidence.
- **Memory** (`memory.ts`) — last-seen enemies persist with half-life confidence decay and
  are forgotten below a threshold (README §17.3).
- **Communication** (`communication.ts`) — teammate sightings become team reports after a
  comms delay (Handoff §24.2); a dead player's last reports are optionally retained.

## Outputs

- `PlayerObservation` — structurally identical to shared-types `ObservationState`.
- `TeamObservation` — aggregated team picture (local type; candidate for shared-types).

**The ground-truth boundary is a type boundary.** `perceive()` / `observe()` return only
Observations; `WorldState` (its `players`, `events`, live positions) is never returned or
embedded. Omniscient play is unrepresentable, not merely discouraged — asserted in
`test/leak.test.ts`.

## Integration with PV-3

PV-3's `@pv/world-state` `observeWorld(world, id, { oracle })` takes a `VisibilityOracle`
"to be implemented by the spatial-engine (PV-4)". `SpatialPerceptionOracle` is that
implementation:

```ts
const engine = new PerceptionEngine(spatial);
observeWorld(world, playerId, { oracle: engine.visibilityOracle });
```

Types are mirrored locally in `src/shared-mirror.ts` (field-for-field with
`@pv/shared-types` on branch `claude/pv-core`). On monorepo integration, delete that file
and import from `@pv/shared-types` — it is a drop-in swap.

## Usage

```ts
import { PerceptionEngine } from "@pv/perception-engine";

const engine = new PerceptionEngine(spatial);         // deterministic by default
const result = engine.perceive(world);                // { players, teams } for this tick
const obs = engine.observe(world, "player-1");         // one player's observation

// probabilistic detection (reproducible under a seed):
import { mulberry32, DEFAULT_PARAMS } from "@pv/perception-engine";
new PerceptionEngine(spatial, {
  params: { ...DEFAULT_PARAMS, vision: { ...DEFAULT_PARAMS.vision, detectionMissProbability: 0.2 } },
  rng: mulberry32(42),
});
```

All tuning numbers (FOV, view/hearing ranges, decay, comms delay) live in `src/params.ts`
as `manual-approx` values — calibrate against real data later.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (17 tests)
```
