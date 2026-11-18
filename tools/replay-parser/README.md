# PROJECT V — Replay Parser (PV-6)

Linux pipeline that turns a VALORANT `.vrf` replay into normalized **Layer-B**
position + round data for PROJECT V.

```
.vrf ──[ValorantReplayParser --verbose --full]──► decode-full.txt + channels.jsonl
                                                        │
                        src/extract.mjs  ───────────────┤  (decode-full.txt → raw.json)
                                                        │
                        src/pipeline.mjs ───────────────┘  (raw.json + channels.jsonl →
                                                             normalized.json + abilities.json)
```

- **Input:** a `.vrf` from `%LOCALAPPDATA%\VALORANT\Saved\Demos\` (see
  [`../../docs/research/vrf-capture-guide.md`](../../docs/research/vrf-capture-guide.md)).
- **Output:** `normalized.json` — game-world positions (Unreal uu ≈ cm, Z-up),
  a millisecond time axis, per-round split, and provenance on every record.
- No Riot auth, no `pvp.net`, no API keys. The decode runs fully offline; the
  only optional network use is the *viewer's* valorant-api asset fetch, which
  this data pipeline does **not** perform.

## Why this exists

The upstream project ([`talhakoek/ValorantWebReplayer`](https://github.com/talhakoek/ValorantWebReplayer))
is **Windows-only** and its `scripts/extract-stream.mjs` targets a browser
viewer. PV-6 re-implements the extract stage for Linux as pure, testable
functions and adds a normalization stage that aligns the output with the
PROJECT V data schema (`datasets/schema/`, owned by PV-2). See
[`../../docs/research/replay-parser.md`](../../docs/research/replay-parser.md)
for the parser evaluation and the Linux build results.

## One-command run (with a real `.vrf`)

1. Get the parser binary (build it once — see
   [`../../docs/research/replay-parser.md`](../../docs/research/replay-parser.md)
   §"Linux build") and drop it at `tools/replay-parser/bin/ValorantReplayParser`
   (gitignored), or point `PARSER` at it.
2. Run:

```bash
# privacy-safe default: REDACT=1 drops player ProfileNames
PARSER=/path/to/ValorantReplayParser REDACT=1 \
  tools/replay-parser/run.sh /path/to/replay.vrf Ascent
# → tools/replay-parser/output/<replay>/normalized.json
```

Env flags: `REDACT=1` (drop ProfileNames), `GAME_PATCH="Patch 11.xx"`,
`MATCH_ID=...`, `KEEP_DECODE=1` (keep the multi-hundred-MB `decode-full.txt`).

## Stages as libraries

```js
import { extractRawFromFile } from './src/extract.mjs';
import { normalize }          from './src/normalize.mjs';
import { extractAbilities }   from './src/abilities.mjs';

const raw = await extractRawFromFile('decode-full.txt');
const data = normalize(raw, { mapName: 'Ascent', redactProfileNames: true });
```

## Output shape (`normalized.json`)

| Section | Key fields |
|---|---|
| `meta` | `mapName`, `frame: "game-world-uu-zup"`, `counts`, `provenance` |
| `players[]` | `playerId`, `teamIdx`, `profileName` (nullable/redactable), `competitiveTier` |
| `rounds[]` | `roundNum`, `startTimeMs`, `endTimeMs`, `startSampleIdx` |
| `positions[]` | `roundNum`, `actorGuid`, `sourceTimestamp` (128Hz tick), `matchTimeMs`, `roundTimeMs`, `worldPos{x,y,z}`, `facingDeg`, `alive` (always `null` — not in `.vrf`) |

**Coordinate boundary:** positions are game-world units. The authoritative
world→minimap (0..1000) transform that the PV-2 `position.schema.json` expects
is owned by the Spatial agent (PV-3, `datasets/spatial/`); this pipeline does
**not** fabricate minimap x/y.

## What `.vrf` does NOT contain

Real RiotIDs, agent icons, KDA/score, killer↔victim attribution, true aim
direction, and health/armor/credits/weapon are **not** in the file (anonymous
mode). They require Riot `match-details` and are out of scope here. `alive` is
therefore emitted as `null`, never inferred-as-false.

## Tests

```bash
cd tools/replay-parser && npm test      # node --test, no dependencies
```

Tests run the extract → normalize → abilities stages against **synthetic**
fixtures (`test/fixtures/`, clearly marked). No real `.vrf` is required or
committed.
