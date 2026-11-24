// Stateful series host: wraps @pv/match-runner's createSeriesSession (veto → maps) and exposes
// it over the same line-delimited JSON protocol as match-session.mts, so the Electron main
// process can drive a best-of-N series: the veto one step at a time, then each map either in
// one go (playGame) or round by round (startGame + the match-session commands).
//
// Everything is reported from OUR seat: series team "A" (the user's team) is slot A of every
// game summary, whichever engine slot it occupies (the engine's slot A is the team that starts
// on attack). The host translates in both directions.
//
// Protocol: one JSON object per line, {id, cmd, ...} → {id, ok, ...}.
//   view | chooseVeto(choice) | aiStep            → {view, action?}
//   playGame                                       → {match: RawMatch, view}
//   startGame | state | callTimeout(team) | setOrders(team, order) | playNextRound | result
//   closeGame (play the open map out)              → {view}
//   stop
// Config is argv[2] JSON (SeriesStartRequest + filmGames). Diagnostics go to stderr only.
import { createInterface } from 'node:readline';
import { compactBuy, compactEconomy, engagementOf, sightOf } from './compact-round.mts';
import { listSimulatableTeams, getMapComps } from '../../../packages/game-data/src/index.ts';
import {
  createSeriesSession, runMatch, teamGameLog, DEFAULT_MAP_POOL, SIMULATED_GEOMETRY,
  type MatchSession, type SeriesGameContext, type SeriesGameResult, type SeriesSession, type TeamGameLog,
} from '../../../packages/match-runner/src/index.ts';
import type { TeamOrder } from '../../../packages/match-runner/src/orders.ts';
import type { RosterPlayer } from '../../../packages/match-runner/src/teams.ts';
import { getTeamMapRecords } from '../../../packages/game-data/src/index.ts';
import { withPractice } from '../../../packages/career/src/club/training.ts';
import { killLines } from './kill-lines.mts';

type Team = 'A' | 'B';
interface Cfg {
  teamA: { id: string; name: string }; teamB: { id: string; name: string };
  format?: 'bo1' | 'bo3' | 'bo5'; seed?: number; analyst?: number; scouting?: boolean;
  /** Recent games simulated per team as its scoutable film (no real per-round history exists). */
  filmGames?: number;
  /** [career] Today's five per team (career world); every map and the film use them. */
  rosters?: { A?: RosterPlayer[]; B?: RosterPlayer[] };
  /** [career] Training map practice per team → added to its map records (mastery continuity). */
  practice?: { A?: Record<string, Record<string, number>>; B?: Record<string, Record<string, number>> };
}
const cfg: Cfg = JSON.parse(process.argv[2] ?? '{}');
const seed = cfg.seed ?? 1;
const pool = DEFAULT_MAP_POOL;
const other = (t: Team): Team => (t === 'A' ? 'B' : 'A');

// --- scoutable film: each team's last few games against other teams (simulated, deterministic) ---
function film(team: { id: string; name: string }, salt: number, roster?: RosterPlayer[]): TeamGameLog[] {
  const n = Math.max(0, Math.min(6, cfg.filmGames ?? Number(process.env.PV_SERIES_FILM ?? 2)));
  const others = listSimulatableTeams().filter((t) => t.teamId !== cfg.teamA.id && t.teamId !== cfg.teamB.id);
  const logs: TeamGameLog[] = [];
  for (let k = 0; k < n && others.length > 0; k++) {
    const opp = others[(salt * 7 + k * 3 + seed) % others.length]!;
    const r = runMatch({ teamA: team, teamB: { id: opp.teamId, name: opp.name ?? opp.teamId }, map: pool[(k + salt) % pool.length]!, seed: seed * 31 + salt * 1000 + k, ...(roster ? { rosters: { A: roster } } : {}) });
    logs.push(teamGameLog(r, 'A'));
  }
  return logs;
}
/** [career] A team's map records with its training map practice added (mastery continuity C). */
function practiceRecords(teamId: string, practice?: Record<string, Record<string, number>>) {
  return practice && Object.keys(practice).length ? { mapRecords: withPractice(getTeamMapRecords(teamId), practice) as ReturnType<typeof getTeamMapRecords> } : {};
}
process.stderr.write('series-session: preparing scouting film\n');
const series: SeriesSession = createSeriesSession(
  {
    teamA: { ...cfg.teamA, scouting: cfg.scouting ?? true, staff: { analyst: cfg.analyst ?? 0.5 }, history: film(cfg.teamA, 1, cfg.rosters?.A), ...(cfg.rosters?.A ? { roster: cfg.rosters.A } : {}), ...practiceRecords(cfg.teamA.id, cfg.practice?.A) },
    teamB: { ...cfg.teamB, history: film(cfg.teamB, 2, cfg.rosters?.B), ...(cfg.rosters?.B ? { roster: cfg.rosters.B } : {}), ...practiceRecords(cfg.teamB.id, cfg.practice?.B) },
    format: cfg.format ?? 'bo3',
    seed,
    match: { recordPerception: true, recordTracks: true }, // positions + navigation trace for the live view
  },
  { aiTeams: ['B'] },
);
const prep = series.preparation();

// --- the open map (round-by-round) ---
let open: { context: SeriesGameContext; session: MatchSession } | null = null;
let closed: { context: SeriesGameContext; state: unknown; result: unknown } | null = null;
/** Maps finished so far, in order. */
const gamesSoFar: SeriesGameResult[] = [];

const uiOf = (ctx: SeriesGameContext, slot: 'A' | 'B'): Team => (ctx.slots.A === slot ? 'A' : 'B');
const byUi = <T,>(ctx: SeriesGameContext, rec: Readonly<Record<'A' | 'B', T>>): Record<Team, T> => ({ A: rec[ctx.slots.A], B: rec[ctx.slots.B] });

function compactRound(ctx: SeriesGameContext, r: ReturnType<MatchSession['playNextRound']>) {
  const eco = byUi(ctx, r.economy);
  const buys = byUi(ctx, r.buys);
  return {
    roundNumber: r.roundNumber, phase: r.phase, attacker: uiOf(ctx, r.attacker),
    winner: uiOf(ctx, r.winner), winnerSide: r.winnerSide, reason: r.reason, planted: r.planted,
    score: byUi(ctx, r.score), kills: byUi(ctx, r.kills),
    economy: { A: compactEconomy(eco.A), B: compactEconomy(eco.B) },
    buys: { A: compactBuy(buys.A), B: compactBuy(buys.B) },
    replayEvents: r.replay.events,
    perception: r.replay.meta.perception ?? null,
    // per-tick sight decided by the sim (engine-truth), when the engine records it
    sight: sightOf(r),
    engagement: engagementOf(r),
    decisions: r.decisions ? { plans: byUi(ctx, r.decisions.plans), opponentReadBefore: byUi(ctx, r.decisions.opponentReadBefore), observed: r.decisions.observed } : null,
    nav: r.navTrace ?? null,
  };
}
function uiState(ctx: SeriesGameContext, s: ReturnType<MatchSession['state']>) {
  return {
    roundNumber: s.roundNumber, score: byUi(ctx, s.score), attacker: uiOf(ctx, s.attacker), economy: byUi(ctx, s.economy),
    timeoutsRemaining: byUi(ctx, s.timeoutsRemaining), timeoutActive: byUi(ctx, s.timeoutActive), finished: s.finished,
  };
}
function uiResult(ctx: SeriesGameContext, r: ReturnType<MatchSession['result']>) {
  return { winner: uiOf(ctx, r.winner), score: byUi(ctx, r.score), wentToOvertime: r.wentToOvertime, timeoutLog: r.timeoutLog.map((e) => ({ ...e, team: uiOf(ctx, e.team) })) };
}
/** A whole game as the RawMatch run-match.mts prints (our team = A). */
function rawMatch(g: SeriesGameResult) {
  return {
    teams: { A: cfg.teamA, B: cfg.teamB }, map: g.map, seed: g.match.config.seed,
    winner: g.winner, score: g.score, wentToOvertime: g.match.wentToOvertime, options: {},
    rounds: g.match.rounds.map((r) => compactRound(g, r)),
  };
}
/** If the open map has just ended, record it in the series and keep its last state for the UI. */
function settle(): void {
  if (!open || !open.session.isFinished()) return;
  const { context, session } = open;
  closed = { context, state: uiState(context, session.state()), result: uiResult(context, session.result()) };
  gamesSoFar.push(series.finishGame());
  open = null;
}

function view() {
  const st = series.state();
  const report = prep.scouting.A;
  const pending = series.pendingVeto();
  const maps = prep.pool.map((map) => {
    const m = (t: Team) => {
      const x = prep.mastery[t][map]!;
      return {
        value: x.value, uncertainty: x.uncertainty,
        history: { value: x.history.value, uncertainty: x.history.uncertainty, games: x.history.games, wins: x.history.wins, resultsKnown: x.history.resultsKnown },
        continuity: { value: x.continuity.value, uncertainty: x.continuity.uncertainty, measured: x.continuity.measured },
        compFit: { value: x.compFit.value, uncertainty: x.compFit.uncertainty, basis: x.compFit.basis, bestComp: x.compFit.bestComp ? [...x.compFit.bestComp] : null },
      };
    };
    const sm = report?.maps.find((x) => x.map === map);
    const mass = (p: Partial<Record<'A' | 'B', number>> | undefined) => (p?.A ?? 0) + (p?.B ?? 0);
    return {
      map,
      mastery: { A: m('A'), B: m('B') },
      winBelief: prep.beliefs.A.winProbability[map] ?? 0.5,
      atkRoundWR: getMapComps(map)?.atkRoundWR ?? null,
      scouting: sm ? {
        estimatedMastery: sm.estimatedMastery, verdict: sm.verdict,
        attack: { shareA: sm.attackSite.share.A, rounds: sm.attackSite.rounds },
        defense: { shareA: sm.defenseSite.share.A, rounds: sm.defenseSite.rounds },
        priorMass: { attack: mass(sm.prior?.attackSite), defense: mass(sm.prior?.defenseSite) },
      } : null,
    };
  });
  const result = series.isFinished() ? series.result() : null;
  const games = gamesSoFar.map((g) => ({
    gameNumber: g.gameNumber, map: g.map, pickedBy: g.pickedBy, startingSides: g.startingSides,
    winner: g.winner, score: g.score, overtime: g.match.wentToOvertime,
    ...(cfg.rosters?.A && cfg.rosters?.B ? { players: killLines(g, cfg.rosters.A.map((p) => p.playerId), cfg.rosters.B.map((p) => p.playerId)) } : {}),
  }));
  const next = st.phase === 'playing' ? st.maps[st.gamesPlayed] : undefined;
  return {
    phase: st.phase,
    teams: { A: cfg.teamA, B: cfg.teamB },
    format: { id: prep.format.id, games: prep.format.games, steps: prep.format.steps.map((s) => ({ kind: s.kind, team: s.kind === 'decider' ? null : s.team })) },
    pool: [...prep.pool],
    reference: prep.reference,
    geometry: SIMULATED_GEOMETRY,
    score: st.score,
    winsNeeded: st.winsNeeded,
    maps,
    veto: {
      actions: st.vetoActions.map((a) => ({ step: a.step, kind: a.kind, team: a.team, map: a.map, ...(a.side ? { side: a.side } : {}), by: a.by })),
      maps: st.maps, banned: st.banned, remaining: st.remaining,
      pending: pending ? { step: pending.step, kind: pending.kind, team: pending.team, options: [...pending.options], ...(pending.map ? { map: pending.map } : {}), ai: pending.ai, recommendation: { choice: pending.recommendation.choice, values: pending.recommendation.values } } : null,
    },
    games,
    nextGame: next ? { ...next, gameNumber: st.gamesPlayed + 1 } : null,
    gameInProgress: st.gameInProgress,
    scouting: {
      enabled: report !== null,
      analyst: cfg.analyst ?? 0.5,
      gamesReviewed: report?.quality.gamesReviewed ?? 0,
      gamesAvailable: report?.quality.gamesAvailable ?? 0,
      uptake: report?.quality.uptake ?? 0,
      players: (report?.players ?? []).map((p) => ({ handle: p.handle, role: p.role, rating: p.rating, threat: p.threat, tag: p.tag })),
    },
    winner: result?.winner ?? null,
  };
}
function reply(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: number; cmd?: string; team?: Team; order?: TeamOrder; choice?: string };
  try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
  const id = msg.id;
  try {
    switch (msg.cmd) {
      case 'view': reply({ id, ok: true, view: view() }); break;
      case 'chooseVeto': { const a = series.chooseVeto(msg.choice ?? ''); reply({ id, ok: true, action: a, view: view() }); break; }
      case 'aiStep': {
        if (!series.pendingVeto()?.ai) throw new Error('it is not the AI team\'s veto step');
        const a = series.autoVeto(); reply({ id, ok: true, action: a, view: view() }); break;
      }
      case 'playGame': {
        if (open) throw new Error('a map is already in progress');
        const g = series.playNextGame();
        gamesSoFar.push(g);
        reply({ id, ok: true, match: rawMatch(g), view: view() });
        break;
      }
      case 'startGame': {
        if (open) throw new Error('a map is already in progress');
        const g = series.startGame();
        open = g; closed = null;
        reply({ id, ok: true, state: uiState(g.context, g.session.state()) });
        break;
      }
      case 'state': {
        if (open) reply({ id, ok: true, state: uiState(open.context, open.session.state()) });
        else if (closed) reply({ id, ok: true, state: closed.state });
        else throw new Error('no map in progress');
        break;
      }
      case 'callTimeout': case 'setOrders': {
        if (!open) throw new Error('no map in progress');
        const slot = open.context.slots[msg.team ?? 'A'];
        if (msg.cmd === 'callTimeout') open.session.callTimeout(slot); else open.session.setOrders(slot, msg.order ?? {});
        reply({ id, ok: true, state: uiState(open.context, open.session.state()) });
        break;
      }
      case 'playNextRound': {
        if (!open) throw new Error('no map in progress');
        const ctx = open.context;
        const round = compactRound(ctx, open.session.playNextRound());
        const state = uiState(ctx, open.session.state());
        settle();
        reply({ id, ok: true, round, state });
        break;
      }
      case 'result': {
        if (open) reply({ id, ok: true, result: uiResult(open.context, open.session.result()) });
        else if (closed) reply({ id, ok: true, result: closed.result });
        else throw new Error('no map in progress');
        break;
      }
      case 'closeGame': {
        if (open) {
          while (!open.session.isFinished()) open.session.playNextRound();
          settle();
        }
        reply({ id, ok: true, view: view() });
        break;
      }
      case 'stop': reply({ id, ok: true }); rl.close(); break;
      default: reply({ id, ok: false, error: `unknown cmd ${msg.cmd}` });
    }
  } catch (e) { reply({ id, ok: false, error: (e as Error).message }); }
});
rl.on('close', () => process.exit(0));

process.stderr.write('series-session ready\n');
