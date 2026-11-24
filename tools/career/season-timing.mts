// Time per career season on the DEFAULT settings (world sim depth `quick`), and what the engine
// depths would cost: a whole season (calendar, club layer, four leagues, three international
// events, the inbox) with the quick estimate for every AI series and the manager's matches by the
// quick estimate too; then a sample of AI series per scope through the full engine (runSeries, as
// the desktop's background host plays them) to extrapolate the `league` and `full` depths.
//   npx tsx tools/career/season-timing.mts [engineSamplePerScope=4]
// Heavy: run through /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh.
import { runSeries } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData, mapRecordsFromGameData } from '../../packages/career/src/game-data.ts';
import {
  answerInbox, batchOf, continueCareer, matchRoster, newCareer, quickSeries, recordResult, regionTeams, seriesRequest, setMapRecords,
  type SeriesRequest, type SimScope,
} from '../../packages/career/src/index.ts';

const sample = Number(process.argv[2] ?? 4);
setMapRecords(mapRecordsFromGameData());
const w = worldFromGameData(2026);
const c = newCareer(w, { seed: 2026, manager: { name: 't', nationality: 'kr' }, userTeamId: regionTeams(w, 'pacific')[3]! });
const sim = batchOf(quickSeries);
const count: Record<SimScope, number> = { league: 0, international: 0, other: 0 };
const samples: Record<SimScope, SeriesRequest[]> = { league: [], international: [], other: [] };
let userSeries = 0;
const t0 = Date.now();
for (;;) {
  const r = await continueCareer(c, (rs, cc) => {
    for (const q of rs) { count[q.scope] += 1; if (samples[q.scope].length < sample) samples[q.scope].push(q); }
    return sim(rs, cc);
  });
  if (r.stop === 'seasonEnd') break;
  if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? 'reject' : m.options![0]!.id);
  if (r.stop === 'matchDay') { const q = seriesRequest(c, r.fixture!); recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: 'user', lineups: { home: q.home.lineup, away: q.away.lineup } }); userSeries += 1; }
}
await continueCareer(c, sim); // the season transition (development, intake, the next circuit)
const quickMs = Date.now() - t0;

const perSeries: Record<SimScope, number> = { league: 0, international: 0, other: 0 };
let maps = 0; let n = 0;
for (const scope of ['league', 'international', 'other'] as const) {
  const t1 = Date.now();
  for (const q of samples[scope]) {
    const res = runSeries({
      teamA: { id: q.home.teamId, name: q.home.name, scouting: false, staff: { analyst: q.home.analyst }, roster: matchRoster(c, q.home.lineup) as never },
      teamB: { id: q.away.teamId, name: q.away.name, scouting: false, staff: { analyst: q.away.analyst }, roster: matchRoster(c, q.away.lineup) as never },
      format: q.format, seed: q.seed,
    });
    maps += res.games.length; n += 1;
  }
  perSeries[scope] = (Date.now() - t1) / 1000 / Math.max(1, samples[scope].length);
}
const minutes = (scopes: SimScope[]) => Number((scopes.reduce((s, k) => s + count[k] * perSeries[k], 0) / 60).toFixed(1));
console.log(JSON.stringify({
  defaultDepth: 'quick',
  seriesPerSeason: { ...count, manager: userSeries, total: count.league + count.international + count.other + userSeries },
  quickSeasonSeconds: Number((quickMs / 1000).toFixed(2)),
  engineSecondsPerSeries: Object.fromEntries(Object.entries(perSeries).map(([k, v]) => [k, Number(v.toFixed(2))])),
  engineMapsPerSeries: Number((maps / Math.max(1, n)).toFixed(2)),
  seasonMinutesAtDepth: { quick: Number((quickMs / 60000).toFixed(2)), league: Number((quickMs / 60000 + minutes(['league'])).toFixed(1)), full: Number((quickMs / 60000 + minutes(['league', 'international', 'other'])).toFixed(1)) },
}, null, 2));
