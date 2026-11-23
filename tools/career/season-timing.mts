// Time per career season: a whole season (calendar, club layer, 74 series) with the quick estimate
// for every series, and a sample of AI series through the full engine (runSeries, as the desktop's
// background host plays them) to extrapolate an engine season.
//   npx tsx tools/career/season-timing.mts [engineSample=6]
// Heavy: run through /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh.
import { runSeries } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData } from '../../packages/career/src/game-data.ts';
import {
  answerInbox, batchOf, continueCareer, matchRoster, newCareer, quickSeries, recordResult, regionTeams, seriesRequest,
} from '../../packages/career/src/index.ts';

const sample = Number(process.argv[2] ?? 6);
const w = worldFromGameData(2026);
const c = newCareer(w, { seed: 2026, manager: { name: 't', nationality: 'kr' }, userTeamId: regionTeams(w, 'pacific')[3]! });
const sim = batchOf(quickSeries);
const t0 = Date.now();
let series = 0;
let userSeries = 0;
const reqs: ReturnType<typeof seriesRequest>[] = [];
for (;;) {
  const r = await continueCareer(c, (rs, cc) => { series += rs.length; if (reqs.length < sample) reqs.push(...rs.slice(0, sample - reqs.length)); return sim(rs, cc); });
  if (r.stop === 'seasonEnd') break;
  if (r.stop === 'message') for (const m of r.items!) answerInbox(c, m.id, m.ref?.offerId ? 'reject' : m.options![0]!.id);
  if (r.stop === 'matchDay') { const q = seriesRequest(c, r.fixture!); recordResult(c, q.fixtureId, { ...quickSeries(q, c), source: 'user', lineups: { home: q.home.lineup, away: q.away.lineup } }); series += 1; userSeries += 1; }
}
await continueCareer(c, sim); // the season transition
const quickMs = Date.now() - t0;
const t1 = Date.now();
let maps = 0;
for (const q of reqs) {
  const res = runSeries({
    teamA: { id: q.home.teamId, name: q.home.name, scouting: false, staff: { analyst: q.home.analyst }, roster: matchRoster(c, q.home.lineup) as never },
    teamB: { id: q.away.teamId, name: q.away.name, scouting: false, staff: { analyst: q.away.analyst }, roster: matchRoster(c, q.away.lineup) as never },
    format: q.format, seed: q.seed,
  });
  maps += res.games.length;
}
const perSeries = (Date.now() - t1) / Math.max(1, reqs.length);
console.log(JSON.stringify({
  seasonSeriesTotal: series, userSeries, aiSeries: series - userSeries,
  quickSeasonSeconds: Number((quickMs / 1000).toFixed(1)),
  engineSampleSeries: reqs.length, engineMapsPerSeries: Number((maps / Math.max(1, reqs.length)).toFixed(2)),
  engineSecondsPerSeries: Number((perSeries / 1000).toFixed(1)),
  engineSeasonMinutesEstimate: Number(((perSeries * (series - userSeries)) / 60000).toFixed(1)),
}, null, 2));
