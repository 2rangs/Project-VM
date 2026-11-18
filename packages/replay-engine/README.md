# @pv/replay-engine

PROJECT V — one **replay format** that carries both decoded real `.vrf`
trajectories and simulation-engine output, plus a small engine to load,
interpolate and seek it. The viewer (and any future analysis) reads this format
and never needs to know whether a round was played or simulated (Handoff §24.5,
Phase 11 "Replay Recorder").

## Format (see `src/types.ts`)

```
Replay
├─ meta         mapId, patch, source (real|synthetic|simulated), seed, matchId,
│               tickRateHz, coordinateTransform (PV-4 world→minimap), provenance
├─ players[]    id (ANON player_N), teamIdx, agentId?, displayName? (anon only)
├─ rounds[]     roundNum, startMs, endMs
├─ tracks[]     per player: keyframes [{ tMs, pos{x,y,z}, facingDeg, state }]
└─ events[]     { tMs, kind, actorId?, victimId?, pos?, data }
                kinds: roundStart|roundEnd|kill|plant|defuse|abilitySpawn|abilityExpire|shot|hit
```

Conventions: ms times; positions in VALORANT world units (uu ≈ 1 cm, Z-up).
World→minimap is PV-4's transform, carried in `meta.coordinateTransform` — the
engine applies it (`coordinate.ts`) but never owns it.

### Interpolation rules (one source of truth)

| channel | rule |
|---|---|
| position | linear between bracketing keyframes |
| facing | shortest-arc angular lerp (`lerpAngleDeg`) |
| state (alive/dead) | step / carry-forward |
| outside keyframe span | clamp to the endpoint, snapshot flagged `extrapolated` |

## API

```ts
import { loadReplay, stateAt, roundAt, eventsInRange, replayBounds } from '@pv/replay-engine';

const replay = loadReplay(json);          // validate + sort
const { startMs, endMs } = replayBounds(replay);
const snap = stateAt(replay, 12_000);     // { tMs, roundNum, players:[{pos,facingDeg,state}] }
```

Playback speed is **not** an engine concept: a player advances a clock and calls
`stateAt` more or less often. The computed state is identical at a given `tMs`
regardless of speed (DECISION-010).

## Converters

```ts
import { fromReplayParser } from '@pv/replay-engine'; // tools/replay-parser output → Replay (source 'real')
import { fromSimEventLog }  from '@pv/replay-engine'; // @pv/shared-types GameEvent[] → Replay (source 'simulated')
```

`fromReplayParser` keys tracks by actorGuid and mints anonymous `player_N` ids —
it never copies ProfileName. `fromSimEventLog` maps the PV-core event union
(move→keyframes, kill/plant/defuse/abilityUse→events) structurally, so this
package needs no cross-branch build dependency.

## Test

```bash
cd packages/replay-engine
npm test        # node --experimental-strip-types --test (no build, no extra deps at runtime)
npm run typecheck
```

Requires Node ≥ 22.6 (native TypeScript type stripping). `test/fixtures/` holds
a copy of PV-4's Ascent coordinate transform (source noted in the file) and the
tests also load the viewer's shipped synthetic replay to keep one source of truth.
