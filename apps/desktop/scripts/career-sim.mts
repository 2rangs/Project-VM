// Career background simulation host: plays whole series between AI teams through
// @pv/match-runner (veto + every map), one at a time, for the career calendar. Long-lived tsx
// subprocess of the Electron main process (src/main/career-host.ts), so the UI thread never runs
// the engine. Line-delimited JSON on stdin/stdout:
//   {id, cmd: 'series', req: CareerSimRequest} → {id, ok, outcome: CareerSimOutcome}
//   {id, cmd: 'stop'}                           → {id, ok}
// Diagnostics go to stderr only.
import { createInterface } from 'node:readline';
import { runSeries, type SeriesResult } from '../../../packages/match-runner/src/index.ts';
import type { RosterPlayer } from '../../../packages/match-runner/src/teams.ts';
import { getTeamMapRecords } from '../../../packages/game-data/src/index.ts';
import { withPractice } from '../../../packages/career/src/club/training.ts';
import { killLines } from './kill-lines.mts';
import type { CareerSimOutcome, CareerSimRequest } from '../src/shared/career.ts';

/** The team's map records with its training map practice added (mastery continuity C). */
const records = (side: CareerSimRequest['home']) =>
  (side.practice && Object.keys(side.practice).length ? { mapRecords: withPractice(getTeamMapRecords(side.teamId), side.practice) as ReturnType<typeof getTeamMapRecords> } : {});

function play(req: CareerSimRequest): CareerSimOutcome {
  const res = runSeries({
    teamA: { id: req.home.teamId, name: req.home.name, scouting: false, staff: { analyst: req.home.analyst }, roster: req.home.roster as RosterPlayer[], ...records(req.home) },
    teamB: { id: req.away.teamId, name: req.away.name, scouting: false, staff: { analyst: req.away.analyst }, roster: req.away.roster as RosterPlayer[], ...records(req.away) },
    format: req.format,
    seed: req.seed,
  });
  return {
    fixtureId: req.fixtureId,
    winner: res.winner === 'A' ? req.home.teamId : req.away.teamId,
    mapsWon: [res.score.A, res.score.B],
    maps: res.games.map((g) => ({
      map: g.map, score: [g.score.A, g.score.B], ...(g.match.wentToOvertime ? { overtime: true } : {}), players: killLines(g, req.home.roster.map((p) => p.playerId), req.away.roster.map((p) => p.playerId)),
    })),
  };
}

const reply = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: number; cmd?: string; req?: CareerSimRequest };
  try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
  try {
    if (msg.cmd === 'series' && msg.req) {
      const t0 = Date.now();
      const outcome = play(msg.req);
      process.stderr.write(`career-sim: ${msg.req.home.name} ${outcome.mapsWon[0]}-${outcome.mapsWon[1]} ${msg.req.away.name} (${Date.now() - t0} ms)\n`);
      reply({ id: msg.id, ok: true, outcome });
    } else if (msg.cmd === 'stop') { reply({ id: msg.id, ok: true }); rl.close(); }
    else reply({ id: msg.id, ok: false, error: `unknown cmd ${msg.cmd}` });
  } catch (e) { reply({ id: msg.id, ok: false, error: (e as Error).message }); }
});
rl.on('close', () => process.exit(0));
process.stderr.write('career-sim ready\n');
