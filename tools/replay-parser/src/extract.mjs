// PROJECT V — PV-6 Replay Parser: extract stage (Linux)
//
// Reimplementation of talhakoek/ValorantWebReplayer scripts/extract-stream.mjs,
// ported to run on Linux and refactored so the core parser is a pure function
// that unit tests can call directly (no external binary, no filesystem).
//
// INPUT  : the verbose dump produced by `ValorantReplayParser <x.vrf> --verbose --full`
//          (a ~0.1-1+ GB text file of `Chindex=N<TAB>Type=T<TAB>Fields=[...]` lines,
//          interleaved with `info:` logger noise which is ignored).
// OUTPUT : a raw, replay-native intermediate (see extractRaw() return shape).
//          Game-world coordinates (Unreal uu, ~cm, Z-up) are preserved verbatim.
//          Normalization to the PROJECT V schema (ms time axis, round split,
//          provenance) happens in normalize.mjs — this stage only decodes.
//
// Differences vs the upstream extract-stream.mjs (intentional, documented):
//   1. Facing: upstream read `mv.RotationInput.Z` which is 0 in real dumps; the
//      real per-move yaw lives in `mv.Yaw` (degrees). We prefer `mv.Yaw`, then
//      fall back to RotationInput.Z, so facing is actually populated.
//   2. We keep the per-move `Timestamp` (128Hz round-reset tick) on every sample
//      so the normalizer can expose README §8.4 `source_tick`.
//   3. ProfileName is captured but can be redacted downstream (privacy).
//
// This file is first-party PROJECT V code (not the cloned upstream); tests import
// extractRaw() directly.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const EXTRACT_VERSION = '1.0.0';

const LINE_RE = /^Chindex=(\d+)\tType=([^\t]+)\tFields=(\[.*\])$/;
const MAPURL_RE = /^MapUrl=(.+)$/;

// Shape of the accumulator so extractRaw (streaming) and parseLines (array) share logic.
function newAccumulator() {
  return {
    samples: [],            // [sourceTimestamp, guid, X, Y, Z, yawDeg]
    playerStateByCh: {},    // ch -> {PlayerId, ProfileName, ...}
    teamByCh: {},           // ch -> team int
    phaseEvents: [],        // {phase, sampleIdx}
    bombStates: [],         // {t (wall seconds), sampleIdx}
    guidsSeen: new Set(),
    mapUrl: '',
    movementLines: 0,
    movementMoves: 0,
  };
}

// Pure: feed one already-trimmed text line into the accumulator.
export function consumeLine(acc, line) {
  const m = line.match(LINE_RE);
  if (!m) {
    const mu = line.match(MAPURL_RE);
    if (mu) acc.mapUrl = mu[1].trim();
    return;
  }
  const ch = +m[1];
  const type = m[2];
  let fields;
  try { fields = JSON.parse(m[3]); } catch { return; }

  if (type === 'ReplaysClientReceiveRemoteCharacterUpdatesSingleArrayNoAutonomous') {
    acc.movementLines++;
    const rc = (fields.find((f) => f.Name === 'RemoteCharacterUpdates') || {}).Value || [];
    for (const u of rc) {
      const guid = u.ShooterCharacterNetGuidValue;
      if (guid === undefined || guid === null) continue;
      const cds = u.ComponentDataStream;
      if (!cds || !cds.Moves) continue;
      acc.guidsSeen.add(guid);
      for (const mv of cds.Moves) {
        if (!mv.Position) continue;
        acc.movementMoves++;
        // Prefer decoded degrees (mv.Yaw); fall back to RotationInput.Z.
        let yaw = 0;
        if (typeof mv.Yaw === 'number') yaw = mv.Yaw;
        else if (mv.RotationInput && typeof mv.RotationInput.Z === 'number') yaw = mv.RotationInput.Z;
        acc.samples.push([
          mv.Timestamp | 0,
          guid,
          round1(mv.Position.X),
          round1(mv.Position.Y),
          round1(mv.Position.Z),
          round2(yaw),
        ]);
      }
    }
  } else if (type === 'BombPlayerState') {
    const obj = (acc.playerStateByCh[ch] = acc.playerStateByCh[ch] || {});
    for (const f of fields) obj[f.Name] = f.Value;
  } else if (type === 'BombTeamComponent') {
    const tf = fields.find((f) => f.Name === 'Team');
    if (tf) acc.teamByCh[ch] = tf.Value;
  } else if (type === 'ClientGamePhaseEnded') {
    const of = fields.find((f) => f.Name === 'OldPhase');
    if (of) acc.phaseEvents.push({ phase: of.Value, sampleIdx: acc.samples.length });
  } else if (type === 'BombGameState') {
    const tf = fields.find((f) => f.Name === 'ReplicatedWorldTimeSecondsDouble');
    if (tf && typeof tf.Value === 'number') {
      acc.bombStates.push({ t: +tf.Value.toFixed(3), sampleIdx: acc.samples.length });
    }
  }
}

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }

// Turn a finished accumulator into the raw output object.
function finalize(acc) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of acc.samples) {
    if (s[2] < minX) minX = s[2];
    if (s[2] > maxX) maxX = s[2];
    if (s[3] < minY) minY = s[3];
    if (s[3] > maxY) maxY = s[3];
  }
  const players = {};
  for (const ch in acc.playerStateByCh) {
    players[ch] = { ...acc.playerStateByCh[ch], team: acc.teamByCh[ch] };
  }
  return {
    meta: {
      extractVersion: EXTRACT_VERSION,
      mapUrl: acc.mapUrl,
      movementLines: acc.movementLines,
      movementMoves: acc.movementMoves,
      uniqueGuids: [...acc.guidsSeen],
      bounds: acc.samples.length ? { minX, maxX, minY, maxY } : null,
      sampleCount: acc.samples.length,
      phaseEventCount: acc.phaseEvents.length,
      bombStateCount: acc.bombStates.length,
    },
    // sample tuple: [sourceTimestamp, guid, X, Y, Z, yawDeg]
    sampleSchema: ['sourceTimestamp', 'guid', 'x', 'y', 'z', 'yawDeg'],
    players,
    phaseEvents: acc.phaseEvents,
    bombStates: acc.bombStates,
    samples: acc.samples,
  };
}

// Pure, in-memory variant for tests: parse an array (or \n-joined string) of lines.
export function extractRawFromLines(lines) {
  const acc = newAccumulator();
  const arr = Array.isArray(lines) ? lines : String(lines).split('\n');
  for (const line of arr) consumeLine(acc, line);
  return finalize(acc);
}

// Streaming variant for real (large) decode-full.txt files.
export async function extractRawFromFile(srcPath) {
  const acc = newAccumulator();
  const rl = readline.createInterface({
    input: fs.createReadStream(srcPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) consumeLine(acc, line);
  return finalize(acc);
}

// CLI: node extract.mjs <decode-full.txt> <out.json>
async function main() {
  const src = process.argv[2];
  const dst = process.argv[3];
  if (!src || !dst) {
    console.error('Usage: node extract.mjs <decode-full.txt> <raw.json>');
    process.exit(1);
  }
  if (!fs.existsSync(src)) {
    console.error(`source not found: ${src}`);
    process.exit(1);
  }
  const raw = await extractRawFromFile(src);
  fs.mkdirSync(path.dirname(path.resolve(dst)), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(raw));
  console.error(
    `extract: samples=${raw.meta.sampleCount} guids=${raw.meta.uniqueGuids.length} ` +
    `rounds(phase2)=${raw.phaseEvents.filter((p) => p.phase === 2).length} ` +
    `bombStates=${raw.meta.bombStateCount} -> ${dst}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
