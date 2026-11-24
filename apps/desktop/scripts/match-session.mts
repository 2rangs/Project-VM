// tsx reference path for the interactive match session (src/engine/match-session.ts) over
// line-delimited JSON on stdin/stdout. The app runs the same code in the bundled engine host.
//   cmd ∈ state | callTimeout(team) | setOrders(team,order) | playNextRound | result | stop
// Config (teams/seed/aiTeams/options) is argv[2] JSON.
import { createMatchSessionHost, type MatchSessionCfg } from '../src/engine/match-session.ts';
import { serveLines } from '../src/engine/stdio.ts';

const cfg: MatchSessionCfg = JSON.parse(process.argv[2] ?? '{}');
const host = createMatchSessionHost(cfg);
serveLines((msg) => host.handle(msg));
process.stderr.write('match-session ready\n');
