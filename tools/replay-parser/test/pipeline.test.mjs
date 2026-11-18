// PROJECT V — PV-6 replay parser: unit tests (node:test, no deps).
// Runs the extract -> normalize -> abilities stages against the SYNTHETIC
// fixtures and asserts the decode, time-axis, round-split and provenance logic.
// Run: node --test tools/replay-parser/test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractRawFromLines, extractRawFromFile } from '../src/extract.mjs';
import { normalize } from '../src/normalize.mjs';
import { extractAbilities } from '../src/abilities.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DECODE = path.join(DIR, 'fixtures', 'decode-full.synthetic.txt');
const CHANNELS = path.join(DIR, 'fixtures', 'channels.synthetic.jsonl');

const decodeText = fs.readFileSync(DECODE, 'utf8');

test('extract: decodes samples, guids, map url and ignores info/comment noise', () => {
  const raw = extractRawFromLines(decodeText);
  assert.equal(raw.meta.sampleCount, 5, '5 movement samples');
  assert.equal(raw.mapUrl ?? raw.meta.mapUrl, '/Game/Maps/Ascent/Ascent');
  assert.deepEqual([...raw.meta.uniqueGuids].sort((a, b) => a - b), [100, 200]);
  // two OldPhase=2 markers = two round starts
  assert.equal(raw.phaseEvents.filter((p) => p.phase === 2).length, 2);
  assert.equal(raw.bombStates.length, 4);
});

test('extract: sample tuple carries game coords, source tick, and decoded Yaw', () => {
  const raw = extractRawFromLines(decodeText);
  // schema: [sourceTimestamp, guid, x, y, z, yawDeg]
  assert.deepEqual(raw.sampleSchema, ['sourceTimestamp', 'guid', 'x', 'y', 'z', 'yawDeg']);
  const first = raw.samples[0];
  assert.equal(first[0], 2);          // sourceTimestamp (128Hz tick)
  assert.equal(first[1], 100);        // guid
  assert.equal(first[2], 100);        // X (uu)
  assert.equal(first[3], 200);        // Y
  assert.equal(first[4], 50);         // Z
  assert.equal(first[5], 90);         // yaw from mv.Yaw (NOT RotationInput.Z=0)
});

test('extract: streaming file path matches in-memory path', async () => {
  const a = extractRawFromLines(decodeText);
  const b = await extractRawFromFile(DECODE);
  assert.deepEqual(b.samples, a.samples);
  assert.equal(b.meta.sampleCount, a.meta.sampleCount);
});

test('normalize: ms time axis + round split from BombGameState wall clock', () => {
  const raw = extractRawFromLines(decodeText);
  const n = normalize(raw, { mapName: 'Ascent', synthetic: true, retrievedAt: '2026-11-18T00:00:00.000Z' });

  assert.equal(n.rounds.length, 2);
  assert.equal(n.rounds[0].startTimeMs, 0);
  assert.equal(n.rounds[1].startTimeMs, 35000); // interpolated 45s wall - 10s anchor
  assert.equal(n.rounds[0].endTimeMs, 35000);
  assert.equal(n.rounds[1].endTimeMs, null);

  assert.equal(n.positions.length, 5);
  const r1 = n.positions.filter((p) => p.roundNum === 1);
  const r2 = n.positions.filter((p) => p.roundNum === 2);
  assert.equal(r1.length, 4);
  assert.equal(r2.length, 1);

  const p0 = n.positions[0];
  assert.deepEqual(p0.worldPos, { x: 100, y: 200, z: 50 });
  assert.equal(p0.facingDeg, 90);
  assert.equal(p0.matchTimeMs, 0);
  assert.equal(p0.roundTimeMs, 0);
  assert.equal(p0.alive, null, 'alive is not decoded from .vrf');

  // round 2 sample: roundTimeMs resets relative to its own start
  const r2p = n.positions[4];
  assert.equal(r2p.roundNum, 2);
  assert.equal(r2p.matchTimeMs, 35000);
  assert.equal(r2p.roundTimeMs, 0);
});

test('normalize: players carry team + ProfileName, redaction drops the name', () => {
  const raw = extractRawFromLines(decodeText);
  const open = normalize(raw, { synthetic: true });
  const a = open.players.find((p) => p.profileName === 'SynthPlayerA');
  assert.ok(a, 'ProfileName present when not redacted');
  assert.equal(a.teamIdx, 0);

  const red = normalize(raw, { synthetic: true, redactProfileNames: true });
  assert.ok(red.players.every((p) => p.profileName === null), 'all ProfileNames redacted');
  assert.equal(red.players.find((p) => p.playerId === '256').teamIdx, 0, 'team survives redaction');
});

test('normalize: provenance separates synthetic from decoded', () => {
  const raw = extractRawFromLines(decodeText);
  const synth = normalize(raw, { synthetic: true });
  assert.equal(synth.meta.provenance.synthetic, true);
  assert.equal(synth.meta.provenance.evidenceType, 'simulated');
  assert.equal(synth.meta.provenance.verificationLevel, 0);
  assert.equal(synth.meta.provenance.sourceId, 'pv-synthetic-replay');

  const real = normalize(raw, { synthetic: false, sourceVrf: 'example.vrf' });
  assert.equal(real.meta.provenance.synthetic, false);
  assert.equal(real.meta.provenance.evidenceType, 'decoded');
  assert.equal(real.meta.provenance.verificationLevel, 3);
  assert.equal(real.meta.frame, 'game-world-uu-zup');
});

test('abilities: decodes ability spawns offline, infers team, skips world actors', () => {
  const raw = extractRawFromLines(decodeText);
  const channels = fs.readFileSync(CHANNELS, 'utf8');
  const ab = extractAbilities(channels, raw);
  // 3 ability actors (smoke, molly, wall); BaseReplayController + SomeWorldActor skipped
  assert.equal(ab.spawns.length, 3);
  const classes = ab.spawns.map((s) => s.cls).sort();
  assert.deepEqual(classes, ['Patch_Phoenix_MolotovFire_C', 'Smoke_Production_Astra_C', 'Wall_Fortifying_Sage_C']);
  for (const s of ab.spawns) assert.ok(s.team === 0 || s.team === 1 || s.team === -1);
});
