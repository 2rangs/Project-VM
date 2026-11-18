// Generate a REAL perception-bearing match replay fixture for the desktop fog-of-war
// view. Runs a few rounds through PV-4's round-simulator with recordPerception on
// (alternating attacker, so the side→real-team remap is exercised), shapes them like
// scripts/run-match.mts output, folds them with the SAME mergeMatch the app uses, and
// writes the converted Replay (events + match-level perception) to a JSON the renderer
// imports. This stands in for PV-3's not-yet-enabled match-level recordPerception flag;
// once that lands the live match carries identical data and the fixture is unused.
//
//   npx tsx apps/desktop/scripts/gen-perception-fixture.mts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, toPv6ReplayFormat,
} from '../../../packages/round-simulator/src/index.ts';
import {
  loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery,
} from '../../../packages/round-simulator/test/fixtures/setup.ts';
import { fromSimEventLog } from '../../../packages/replay-engine/src/index.ts';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import { ASCENT_TRANSFORM } from '../src/shared/ascent-transform.ts';

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function runRound(seed: number) {
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: 'a-site' }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    config: { seed, roundTimeMs: 30000, recordPerception: true },
  }).runRound(makeSyntheticRound(spatial));
}

const N = 6;
const rounds: RawMatch['rounds'] = [];
for (let i = 0; i < N; i++) {
  const roundNumber = i + 1;
  const attacker: 'A' | 'B' = i < N / 2 ? 'A' : 'B'; // swap sides at the half
  const r = runRound(5 + i);
  const log = toPv6ReplayFormat(r, { mapId: 'ascent', seed: 5 + i });
  const winSlot: 'A' | 'B' = r.winner === 'attack' ? attacker : (attacker === 'A' ? 'B' : 'A');
  rounds.push({
    roundNumber,
    phase: roundNumber === 1 ? 'pistol' : 'regulation',
    attacker,
    winner: winSlot,
    winnerSide: r.winner,
    reason: r.reason,
    planted: r.events.some((e) => (e as { kind: string }).kind === 'planted' || (e as { kind: string }).kind === 'spikePlanted'),
    score: { A: 0, B: 0 },
    kills: { A: 5 - r.survivors.defense.length, B: 5 - r.survivors.attack.length },
    economy: { A: { credits: 3900, ultPoints: i }, B: { credits: 3900, ultPoints: i } },
    buys: { A: { tier: 'full', weapon: 'Vandal' }, B: { tier: 'full', weapon: 'Phantom' } },
    replayEvents: log.events as unknown as Array<Record<string, unknown>>,
    perception: (log.meta.perception ?? null) as RawMatch['rounds'][number]['perception'],
  });
}

const raw: RawMatch = {
  teams: { A: { id: 'sen', name: 'Sentinels' }, B: { id: 'prx', name: 'Paper Rex' } },
  map: 'ascent', seed: 5, winner: 'A', score: { A: 0, B: 0 }, wentToOvertime: false, rounds,
};

const { events, perception } = mergeMatch(raw);
const replay = fromSimEventLog(events, {
  mapId: 'ascent', mapDisplayName: 'Ascent', seed: 5, coordinateTransform: ASCENT_TRANSFORM,
  matchId: 'Sentinels vs Paper Rex (perception demo)', perception,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, '..', 'src', 'data', 'perception-demo.replay.json');
writeFileSync(outPath, JSON.stringify(replay));

const tracks = perception ?? [];
process.stderr.write(
  `wrote ${outPath}\n` +
  `rounds=${N} events=${events.length} tracks=${tracks.length} ` +
  `snaps=[${tracks.map((t) => `t${t.teamIdx}:${t.snapshots.length}`).join(', ')}] ` +
  `tMs=[${tracks.map((t) => `${t.snapshots[0]?.tMs}..${t.snapshots.at(-1)?.tMs}`).join(' | ')}]\n`,
);
