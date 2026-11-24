// tsx reference path for the series host (src/engine/series-session.ts: veto → maps) over
// line-delimited JSON on stdin/stdout. The app runs the same code in the bundled engine host.
// Config is argv[2] JSON (SeriesStartRequest + filmGames).
import { createSeriesHost, type SeriesCfg } from '../src/engine/series-session.ts';
import { serveLines } from '../src/engine/stdio.ts';

const cfg: SeriesCfg = JSON.parse(process.argv[2] ?? '{}');
process.stderr.write('series-session: preparing scouting film\n');
const host = createSeriesHost(cfg);
serveLines((msg) => host.handle(msg));
process.stderr.write('series-session ready\n');
