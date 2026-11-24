// Stateful interactive match: wraps @pv/match-runner's managed match session (createManagedSession:
// the match plus the manager layer — docs/MATCH_MANAGEMENT.md) behind the command set the desktop
// drives a tactical-timeout match with, one round at a time.
//   cmd ∈ state | callTimeout(team) | setOrders(team, order) | playNextRound | result
//         | setShouts(team, shouts) | setStrategy(team, strategy) | teamTalk(team, talk)   [manager]
//   playNextRound → {round: <compact RoundRecord>, state}; teamTalk → {talk, state}
// `handle` returns the reply body and throws on a bad command; the transport (the bundled engine
// host, or scripts/match-session.mts over stdin/stdout) adds {id, ok}.
import { createManagedSession, type ManagedSession, type MatchPlan, type Shouts, type TeamTalk, type TeamGameLog } from '../../../../packages/match-runner/src/index.ts';
import type { StrategyOrder, TeamOrder } from '../../../../packages/match-runner/src/orders.ts';
import { compactBuy, compactEconomy, engagementOf, sightOf } from './compact-round.ts';
import { managerResultView, managerView } from './manager-view.ts';

export interface MatchSessionCfg {
  teamA?: { id: string; name: string }; teamB?: { id: string; name: string };
  map?: string; seed?: number; aiTeams?: ('A' | 'B')[];
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> }; moodEffects?: boolean; aiManager?: boolean; timeoutsPerHalf?: number };
  /** [manager] Our pre-match plan, and the opponent film our report was read from. */
  plan?: MatchPlan;
  scouting?: { logs: TeamGameLog[]; uptake?: number };
}
export interface SessionMsg {
  cmd?: string; team?: 'A' | 'B'; order?: TeamOrder;
  // [manager]
  shouts?: Partial<Shouts>; strategy?: { attack?: StrategyOrder; defense?: StrategyOrder; rounds?: number } | null; talk?: TeamTalk;
}
export interface CommandHost { handle(msg: Record<string, unknown>): Record<string, unknown> }

// Compact a RoundRecord to the serializable shape mergeMatch/ipc expect (same as run-match.ts).
function compactRound(r: ReturnType<ManagedSession['playNextRound']>) {
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
  const human = (['A', 'B'] as const).find((t) => !(cfg.aiTeams ?? ['B']).includes(t)) ?? 'A';
  const session: ManagedSession = createManagedSession(
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
    {
      aiTeams: cfg.aiTeams ?? ['B'],
      // [manager] flags, default off (src/shared/ipc.ts MatchOptions)
      ...(cfg.options?.moodEffects ? { moodEffects: true } : {}),
      ...(cfg.options?.aiManager ? { aiManager: true } : {}),
      ...(cfg.options?.timeoutsPerHalf ? { timeoutsPerHalf: cfg.options.timeoutsPerHalf } : {}),
      ...(cfg.plan ? { plans: { [human]: cfg.plan } } : {}),
      ...(cfg.scouting?.logs?.length ? { scouting: { [human]: cfg.scouting } } : {}),
    },
  );
  /** Session state + the manager layer (our seat = engine slot here). */
  const stateOf = () => { const s = session.state(); return { ...s, manager: managerView(s.manager) }; };
  return {
    handle(raw) {
      const msg = raw as SessionMsg;
      switch (msg.cmd) {
        case 'state': return { state: stateOf() };
        case 'callTimeout': session.callTimeout(msg.team!); return { state: stateOf() };
        case 'setOrders': session.setOrders(msg.team!, msg.order ?? {}); return { state: stateOf() };
        case 'setShouts': session.setShouts(msg.team!, msg.shouts ?? {}); return { state: stateOf() };
        case 'setStrategy': session.setStrategy(msg.team!, msg.strategy ?? null); return { state: stateOf() };
        case 'teamTalk': { const talk = session.teamTalk(msg.team!, msg.talk!); return { talk, state: stateOf() }; }
        case 'playNextRound': {
          const round = compactRound(session.playNextRound());
          return { round, state: stateOf() };
        }
        case 'result': {
          // Compact: the UI already streamed each round via playNextRound, so result
          // only carries the final summary + timeout/order log (no replays/perception).
          const r = session.result();
          return { result: { winner: r.winner, score: r.score, wentToOvertime: r.wentToOvertime, timeoutLog: r.timeoutLog, manager: managerResultView(r) } };
        }
        default: throw new Error(`unknown cmd ${msg.cmd}`);
      }
    },
  };
}
