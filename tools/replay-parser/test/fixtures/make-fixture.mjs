// PROJECT V — PV-6: generator for the SYNTHETIC decode-full fixture.
//
// Produces decode-full.synthetic.txt: a few dozen lines in the exact
// `Chindex=N<TAB>Type=T<TAB>Fields=[...]` format that ValorantReplayParser
// emits with --verbose --full, SO THE EXTRACT STAGE CAN BE UNIT-TESTED WITHOUT
// a real .vrf. Every value here is fabricated. This is NOT a real match.
//
// Run: node make-fixture.mjs  (writes next to this file). Committed output is
// checked in so tests need no generation step; this script documents its shape.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const T = '\t';
const line = (ch, type, fields) => `Chindex=${ch}${T}Type=${type}${T}Fields=${JSON.stringify(fields)}`;

const mv = (ts, x, y, z, yaw) => ({
  Marker: 1, MoveType: 1,
  Position: { X: x, Y: y, Z: z, ScaleFactor: 100, Bits: 21 },
  Velocity: { X: 0, Y: 0, Z: 0, ScaleFactor: 10, Bits: 1 },
  RotationInput: { X: 0, Y: 0, Z: 0, ScaleFactor: 65536, Bits: 16 }, // real dumps: 0
  Timestamp: ts, Yaw: yaw, Pitch: 0, ErrorSentinel: false,
});
const movementLine = (ch, guid, moves) => line(ch, 'ReplaysClientReceiveRemoteCharacterUpdatesSingleArrayNoAutonomous', [
  { Name: 'RemoteCharacterUpdates', Value: [
    { ShooterCharacterNetGuidValue: guid, ComponentDataStream: { HasMovementSection: true, Moves: moves } },
  ] },
]);

const lines = [
  '# SYNTHETIC decode-full fixture — fabricated, NOT a real VALORANT match.',
  '# Shape mirrors ValorantReplayParser --verbose --full output. See make-fixture.mjs.',
  'MapUrl=/Game/Maps/Ascent/Ascent',
  // info-logger noise the extractor must skip:
  'info: ValorantReplayParser.ValorantReplayReader[0]',
  '      Not reading type /Script/ShooterGame.ViewTargetComponent',
  // two players on two teams, with ProfileNames (privacy-sensitive)
  line(16, 'BombTeamComponent', [{ Name: 'Team', Value: 0 }]),
  line(16, 'BombPlayerState', [{ Name: 'PlayerId', Value: 256 }, { Name: 'ProfileName', Value: 'SynthPlayerA' }, { Name: 'CompetitiveTier', Value: -1 }]),
  line(17, 'BombTeamComponent', [{ Name: 'Team', Value: 1 }]),
  line(17, 'BombPlayerState', [{ Name: 'PlayerId', Value: 257 }, { Name: 'ProfileName', Value: 'SynthPlayerB' }, { Name: 'CompetitiveTier', Value: -1 }]),
  // --- round 1 ---
  line(1, 'ClientGamePhaseEnded', [{ Name: 'OldPhase', Value: 1 }]), // buy->... ignored
  line(17, 'BombGameState', [{ Name: 'ReplicatedWorldTimeSecondsDouble', Value: 10.0 }]),   // sampleIdx 0
  line(1, 'ClientGamePhaseEnded', [{ Name: 'OldPhase', Value: 2 }]), // combat start = round 1 @ idx0
  movementLine(1, 100, [mv(2, 100, 200, 50, 90), mv(3, 110, 200, 50, 90)]),                 // idx 0,1
  movementLine(2, 200, [mv(2, -100, -200, 50, 270)]),                                        // idx 2
  line(17, 'BombGameState', [{ Name: 'ReplicatedWorldTimeSecondsDouble', Value: 11.0 }]),   // sampleIdx 3
  movementLine(1, 100, [mv(4, 120, 200, 50, 45)]),                                           // idx 3
  line(17, 'BombGameState', [{ Name: 'ReplicatedWorldTimeSecondsDouble', Value: 45.0 }]),   // sampleIdx 4
  // --- round 2 ---
  line(1, 'ClientGamePhaseEnded', [{ Name: 'OldPhase', Value: 4 }]),
  line(1, 'ClientGamePhaseEnded', [{ Name: 'OldPhase', Value: 5 }]),
  line(1, 'ClientGamePhaseEnded', [{ Name: 'OldPhase', Value: 2 }]), // round 2 @ idx4
  movementLine(1, 100, [mv(2, 500, 500, 50, 0)]),                                            // idx 4
  line(17, 'BombGameState', [{ Name: 'ReplicatedWorldTimeSecondsDouble', Value: 60.0 }]),   // sampleIdx 5
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, 'decode-full.synthetic.txt');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out} (${lines.length} lines)`);
