// Stateful interactive match: wraps @pv/match-runner's createMatchSession behind the command set
// the desktop drives a tactical-timeout match with, one round at a time.
//   cmd ∈ state | callTimeout(team) | setOrders(team, order) | playNextRound | result
//   playNextRound → {round: <compact RoundRecord>, state}
// `handle` returns the reply body and throws on a bad command; the transport (the bundled engine
// host, or scripts/match-session.mts over stdin/stdout) adds {id, ok}.
import { createMatchSession, type MatchSession } from '../../../../packages/match-runner/src/index.ts';
import type { TeamOrder } from '../../../../packages/match-runner/src/orders.ts';
import { compactBuy, compactEconomy, engagementOf, sightOf } from './compact-round.ts';

export interface MatchSessionCfg {
  teamA?: { id: string; name: string }; teamB?: { id: string; name: string };
  map?: string; seed?: number; aiTeams?: ('A' | 'B')[];
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> } };
}
export interface SessionMsg { cmd?: string; team?: 'A' | 'B'; order?: TeamOrder }
export interface CommandHost { handle(msg: Record<string, unknown>): Record<string, unknown> }

// Compact a RoundRecord to the serializable shape mergeMatch/ipc expect (same as run-match.ts).
function compactRound(r: ReturnType<MatchSession['playNextRound']>) {
  return {
    roundNumber: r.roundNumber, phase: r.phase, attacker: r.attacker,
    winner: r.winner, winnerSide: r.winnerSide, reason: r.reason, planted: r.planted,
    score: r.score, kills: r.kills,
    economy: { A: compactEconomy(r.economy.A), B: compactEconomy(r.economy.B) },
    buys: { A: compactBuy(r.buys.A), B: compactBuy(r.buys.B) },
    replayEvents: r.replay.events,
    perception: r.replay.meta.perception ?? null,
    // per-tick sight decided by the sim (engine-truth), when the engine records it
    sight: sightOf(r),
    engagement: engagementOf(r),
    decisions: r.decisions ?? null,
    nav: r.navTrace ?? null,
  };
}

export function createMatchSessionHost(cfg: MatchSessionCfg): CommandHost {
  const session: MatchSession = createMatchSession(
    {
      teamA: cfg.teamA ?? { id: 'A', name: 'Team A' },
      teamB: cfg.teamB ?? { id: 'B', name: 'Team B' },
      map: cfg.map ?? 'ascent',
      seed: cfg.seed ?? 1,
      recordPerception: true,
      recordTracks: true, // player positions + the navigation trace (see run-match.ts)
      ...(cfg.options?.opponentMemory !== undefined ? { opponentMemory: cfg.options.opponentMemory } : {}),
      ...(cfg.options?.minThrowRates ? { minThrowRates: cfg.options.minThrowRates } : {}),
    },
    { aiTeams: cfg.aiTeams ?? ['B'] },
  );
  return {
    handle(raw) {
      const msg = raw as SessionMsg;
      switch (msg.cmd) {
        case 'state': return { state: session.state() };
        case 'callTimeout': session.callTimeout(msg.team!); return { state: session.state() };
        case 'setOrders': session.setOrders(msg.team!, msg.order ?? {}); return { state: session.state() };
        case 'playNextRound': {
          const round = compactRound(session.playNextRound());
          return { round, state: session.state() };
        }
        case 'result': {
          // Compact: the UI already streamed each round via playNextRound, so result
          // only carries the final summary + timeout/order log (no replays/perception).
          const r = session.result();
          return { result: { winner: r.winner, score: r.score, wentToOvertime: r.wentToOvertime, timeoutLog: r.timeoutLog } };
        }
        default: throw new Error(`unknown cmd ${msg.cmd}`);
      }
    },
  };
}
