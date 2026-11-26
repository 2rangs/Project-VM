// Low-spec footprint of a career (HANDOFF P2-12, the "must run on a weak PC" principle): how long a
// whole season takes at the default depth, the peak RSS while doing it, the save-file size (raw and
// gzipped), and the peak RSS of one engine series (the background host plays AI series one at a time,
// so a season's engine-depth peak is ~this plus the world).
//   npx tsx tools/career/measure-footprint.mts [seasons=1]
import { gzipSync } from 'node:zlib';
import { runSeries } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData, mapRecordsFromGameData } from '../../packages/career/src/game-data.ts';
import {
  answerInbox, batchOf, continueCareer, matchRoster, newCareer, quickSeries, recordResult, regionTeams, seriesRequest,
  serializeCareer, serializeWorld, setMapRecords, type SeriesRequest,
} from '../../packages/career/src/index.ts';

const seasons = Number(process.argv[2] ?? 1);
let peakRss = 0, peakHeap = 0;
const sampleMem = () => { const m = process.memoryUsage(); peakRss = Math.max(peakRss, m.rss); peakHeap = Math.max(peakHeap, m.heapUsed); };
const mb = (b: number) => Number((b / 1024 / 1024).toFixed(1));

setMapRecords(mapRecordsFromGameData());
const w = worldFromGameData(2026);
const c = newCareer(w, { seed: 2026, manager: { name: 't', nationality: 'kr' }, userTeamId: regionTeams(w, 'pacific')[3]! });
const sim = batchOf(quickSeries);
const worldPlayers = Object.keys(c.world.players).length, worldTeams = Object.keys(c.world.teams).length;

const t0 = Date.now();
let userSeries = 0, aiSeries = 0;
const engineSample: SeriesRequest[] = [];
for (let s = 0; s < seasons; s++) {
  for (;;) {
    const r = await continueCareer(c, (rs, cc) => { aiSeries += rs.length; for (const q of rs) if (engineSample.length < 6) engineSample.push(q); return sim(rs, cc); });
    sampleMem();
    if (r.stop === 'seasonEnd') break;
    if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? 'reject' : m.options![0]!.id);
    if (r.stop === 'matchDay') { const q = seriesRequest(c, r.fixture!); recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: 'user', lineups: { home: q.home.lineup, away: q.away.lineup } }); userSeries += 1; }
  }
  await continueCareer(c, sim); // season transition
  sampleMem();
}
const quickSeasonSeconds = Number(((Date.now() - t0) / 1000 / seasons).toFixed(2));

// Save sizes (raw + gzipped), both the whole career save and the world alone.
const save = serializeCareer(c);
const worldJson = serializeWorld(c.world);
sampleMem();

// Peak RSS of one engine series (runSeries, as the desktop background host plays AI series).
let enginePeakRss = 0;
const esT0 = Date.now();
for (const q of engineSample) {
  runSeries({
    teamA: { id: q.home.teamId, name: q.home.name, scouting: false, staff: { analyst: q.home.analyst }, roster: matchRoster(c, q.home.lineup) as never },
    teamB: { id: q.away.teamId, name: q.away.name, scouting: false, staff: { analyst: q.away.analyst }, roster: matchRoster(c, q.away.lineup) as never },
    format: q.format, seed: q.seed,
  });
  const m = process.memoryUsage(); enginePeakRss = Math.max(enginePeakRss, m.rss); peakRss = Math.max(peakRss, m.rss);
}
const engineSecPerSeries = engineSample.length ? Number(((Date.now() - esT0) / 1000 / engineSample.length).toFixed(2)) : 0;

console.log(JSON.stringify({
  world: { players: worldPlayers, teams: worldTeams },
  seasonsRun: seasons, aiSeriesPerSeason: Math.round(aiSeries / seasons), managerSeriesPerSeason: Math.round(userSeries / seasons),
  quickSeasonSeconds,
  engineSecPerSeries, engineSeasonMinutesEstimate: Number(((aiSeries / seasons) * engineSecPerSeries / 60).toFixed(1)),
  saveBytes: save.length, saveMB: mb(save.length), saveGzipMB: mb(gzipSync(save).length),
  worldJsonMB: mb(worldJson.length), worldGzipMB: mb(gzipSync(worldJson).length),
  peakRssMB: mb(peakRss), peakHeapMB: mb(peakHeap), engineSeriesPeakRssMB: mb(enginePeakRss),
}, null, 2));
