// Pre-match opponent report: simulate the opponent's recent film, read it through the scouting
// model, return the report (src/shared/manager.ts OpponentReportView). Shared by the bundled engine
// host (op `prematch.report`) and the tsx reference script (scripts/prematch.mts).
import { buildOpponentReport, scoutingFilm } from '../../../../packages/match-runner/src/index.ts';

export interface PrematchReq { us: { id: string; name: string }; them: { id: string; name: string }; map: string; seed: number; analyst: number; film?: number }

export function prematchReport(req: PrematchReq) {
  const logs = scoutingFilm(req.them, [req.us.id], req.film ?? 2, req.seed);
  const report = buildOpponentReport({ us: req.us, them: req.them, map: req.map, logs, analyst: req.analyst, seed: req.seed });
  return { report, filmGames: logs.length };
}
