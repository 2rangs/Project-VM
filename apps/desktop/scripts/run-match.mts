// tsx reference path for a whole map: the same code the bundled engine host runs
// (src/engine/run-match.ts), from workspace source. The app no longer spawns this — it is kept for
// the determinism test (bundle vs. source), the engine-contract test and command-line use.
// Progress goes to stderr (one `PVPROGRESS {json}` line per round); only the final JSON to stdout.
//
// Usage: tsx run-match.mts '<json config>'
import { runMatchCompact, type RunMatchCfg } from '../src/engine/run-match.ts';

const cfg: RunMatchCfg = JSON.parse(process.argv[2] ?? '{}');
const out = runMatchCompact(cfg, (p) => { process.stderr.write(`PVPROGRESS ${JSON.stringify(p)}\n`); });
process.stderr.write(`match: ${out.winner} wins ${out.score.A}-${out.score.B} (${out.rounds.length} rounds, OT=${out.wentToOvertime})\n`);
process.stderr.write(`perception: ${out.rounds.filter((r) => r.perception).length}/${out.rounds.length} rounds\n`);
process.stdout.write(JSON.stringify(out));
