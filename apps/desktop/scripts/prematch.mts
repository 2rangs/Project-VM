// Pre-match opponent report (one-shot subprocess, like run-match.mts): simulate the opponent's
// recent film, read it through the scouting model and print the report JSON to stdout.
// Usage: tsx prematch.mts '<PrematchRequest json>'   (src/shared/manager.ts)
import { buildOpponentReport, scoutingFilm } from '../../../packages/match-runner/src/index.ts';

interface Req { us: { id: string; name: string }; them: { id: string; name: string }; map: string; seed: number; analyst: number; film?: number }
const req: Req = JSON.parse(process.argv[2] ?? '{}');
const logs = scoutingFilm(req.them, [req.us.id], req.film ?? 2, req.seed);
const report = buildOpponentReport({ us: req.us, them: req.them, map: req.map, logs, analyst: req.analyst, seed: req.seed });
process.stderr.write(`prematch: ${req.them.name}, ${report.gamesReviewed}/${logs.length} games reviewed\n`);
process.stdout.write(JSON.stringify(report));
