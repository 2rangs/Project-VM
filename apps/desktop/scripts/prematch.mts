// tsx reference path for the pre-match opponent report (src/engine/prematch.ts). The app runs the
// same code in the bundled engine host (op `prematch.report`).
// Usage: tsx prematch.mts '<PrematchRequest json>'   (src/shared/manager.ts)
import { prematchReport, type PrematchReq } from '../src/engine/prematch.ts';

const req: PrematchReq = JSON.parse(process.argv[2] ?? '{}');
const { report, filmGames } = prematchReport(req);
process.stderr.write(`prematch: ${req.them.name}, ${report.gamesReviewed}/${filmGames} games reviewed\n`);
process.stdout.write(JSON.stringify(report));
