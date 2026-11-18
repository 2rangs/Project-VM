// Generate an ANONYMIZED Replay from a decoded .vrf (PV-6 replay-parser output),
// for local viewing/screenshots. Output is NOT committed (gitignored real-*.json).
//
//   node --experimental-strip-types scripts/gen-real-replay.ts <raw.json> <out.json>
//
// raw.json is tools/replay-parser extract output. We run normalize (REDACTED)
// then fromReplayParser, attaching the PV-4 Ascent transform so it projects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fromReplayParser } from '../../../packages/replay-engine/src/convert-parser.ts';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const [rawPath, outPath] = process.argv.slice(2);
if (!rawPath || !outPath) { console.error('usage: gen-real-replay.ts <raw.json> <out.json>'); process.exit(1); }

// normalize.mjs is plain ESM JS in tools/replay-parser
const { normalize } = require('../../../tools/replay-parser/src/normalize.mjs');
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const normalized = normalize(raw, { mapName: 'Ascent', redactProfileNames: true, sourceVrf: 'local-sample.vrf' });

const transform = JSON.parse(fs.readFileSync(
  path.resolve(here, '../../../packages/replay-engine/test/fixtures/ascent-coordinate-system.json'), 'utf8',
)).transform;

const replay = fromReplayParser(normalized, { coordinateTransform: transform, tickRateHz: 128 });
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(replay));
console.error(`real replay: source=${replay.meta.source} players=${replay.players.length} tracks=${replay.tracks.length} -> ${outPath}`);
