// Career background simulation: one whole series between two AI teams through @pv/match-runner
// (veto + every map), for the career calendar. Shared by the bundled engine host and the tsx
// reference script (scripts/career-sim.mts).
import { runSeries } from '../../../../packages/match-runner/src/index.ts';
import type { RosterPlayer } from '../../../../packages/match-runner/src/teams.ts';
import { getTeamMapRecords } from '../../../../packages/game-data/src/index.ts';
import { withPractice } from '../../../../packages/career/src/club/training.ts';
import { killLines } from './kill-lines.ts';
import type { CareerSimOutcome, CareerSimRequest } from '../shared/career.ts';

/** The team's map records with its training map practice added (mastery continuity C). */
const records = (side: CareerSimRequest['home']) =>
  (side.practice && Object.keys(side.practice).length ? { mapRecords: withPractice(getTeamMapRecords(side.teamId), side.practice) as ReturnType<typeof getTeamMapRecords> } : {});

export function playCareerSeries(req: CareerSimRequest): CareerSimOutcome {
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
