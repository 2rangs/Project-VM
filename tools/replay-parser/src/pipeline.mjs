// PROJECT V — PV-6 replay parser: normalize + abilities CLI driver.
//
//   node pipeline.mjs <raw.json> <channels.jsonl> <normalized.json> [mapName] [sourceVrf]
//
// Reads the raw object from extract.mjs and the parser's channels.jsonl, writes
// normalized.json (and abilities.json next to it). Set REDACT=1 to drop
// ProfileNames (privacy). Patch via GAME_PATCH env; matchId via MATCH_ID env.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalize } from './normalize.mjs';
import { extractAbilities } from './abilities.mjs';

const [, , rawPath, channelsPath, outPath, mapName, sourceVrf] = process.argv;
if (!rawPath || !outPath) {
  console.error('Usage: node pipeline.mjs <raw.json> <channels.jsonl> <normalized.json> [mapName] [sourceVrf]');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const sha256 = fs.existsSync(rawPath)
  ? crypto.createHash('sha256').update(fs.readFileSync(rawPath)).digest('hex')
  : null;

const normalized = normalize(raw, {
  matchId: process.env.MATCH_ID || null,
  mapName: mapName || null,
  gamePatch: process.env.GAME_PATCH || null,
  sourceVrf: sourceVrf || null,
  redactProfileNames: process.env.REDACT === '1',
  sha256,
});

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(normalized));
console.error(
  `normalize: players=${normalized.meta.counts.players} rounds=${normalized.meta.counts.rounds} ` +
  `positions=${normalized.meta.counts.positions} -> ${outPath}`,
);

if (channelsPath && fs.existsSync(channelsPath)) {
  const ab = extractAbilities(fs.readFileSync(channelsPath, 'utf8'), raw);
  const abOut = path.join(path.dirname(outPath), 'abilities.json');
  fs.writeFileSync(abOut, JSON.stringify(ab));
  console.error(`abilities: spawns=${ab.meta.spawnCount} (skipped=${ab.meta.skipped}) -> ${abOut}`);
}
