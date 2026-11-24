// tsx reference path for the career background simulation (src/engine/career-sim.ts) over
// line-delimited JSON on stdin/stdout. The app runs the same code in the bundled engine host.
//   {id, cmd: 'series', req: CareerSimRequest} → {id, ok, outcome: CareerSimOutcome}
//   {id, cmd: 'stop'}                           → {id, ok}
import { playCareerSeries } from '../src/engine/career-sim.ts';
import { serveLines } from '../src/engine/stdio.ts';
import type { CareerSimRequest } from '../src/shared/career.ts';

serveLines((msg) => {
  if (msg.cmd !== 'series' || !msg.req) throw new Error(`unknown cmd ${String(msg.cmd)}`);
  const req = msg.req as CareerSimRequest;
  const t0 = Date.now();
  const outcome = playCareerSeries(req);
  process.stderr.write(`career-sim: ${req.home.name} ${outcome.mapsWon[0]}-${outcome.mapsWon[1]} ${req.away.name} (${Date.now() - t0} ms)\n`);
  return { outcome };
});
process.stderr.write('career-sim ready\n');
