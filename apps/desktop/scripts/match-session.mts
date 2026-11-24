// Stateful interactive match host. Wraps the managed match session (createManagedSession: the
// match plus the manager layer — docs/MATCH_MANAGEMENT.md) and exposes it
// over a line-delimited JSON protocol on stdin/stdout, so the Electron main process
// can drive a tactical-timeout match one round at a time (the session is a live
// stateful object and the match-runner can't be bundled into the app — it runs here,
// in the workspace, as one long-lived tsx subprocess, like run-match.mts but kept open).
//
// Protocol: one JSON object per line.
//   → {"id":1,"cmd":"state"}
//   ← {"id":1,"ok":true,"state":{...}}
//   cmd ∈ state | callTimeout(team) | setOrders(team,order) | playNextRound | result | stop
//         | setShouts(team,shouts) | setStrategy(team,strategy) | teamTalk(team,talk)   [manager]
//   playNextRound returns {round:<compact RoundRecord>, state}; errors come back {ok:false,error}.
// Config (teams/seed/aiTeams) is argv[2] JSON. Diagnostics go to stderr only.
import { createInterface } from 'node:readline';
import { compactBuy, compactEconomy, engagementOf, sightOf } from './compact-round.mts';
import { createManagedSession, type ManagedSession, type MatchPlan, type Shouts, type TeamTalk, type TeamGameLog } from '../../../packages/match-runner/src/index.ts';
import type { StrategyOrder, TeamOrder } from '../../../packages/match-runner/src/orders.ts';
import { managerResultView, managerView } from './manager-view.mts';

interface Cfg {
  teamA: { id: string; name: string }; teamB: { id: string; name: string };
  map?: string; seed?: number; aiTeams?: ('A' | 'B')[];
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> } };
  /** [manager] Our pre-match plan, and the opponent film our report was read from. */
  plan?: MatchPlan;
  scouting?: { logs: TeamGameLog[]; uptake?: number };
}
const cfg: Cfg = JSON.parse(process.argv[2] ?? '{}');
const human = (['A', 'B'] as const).find((t) => !(cfg.aiTeams ?? ['B']).includes(t)) ?? 'A';

const session: ManagedSession = createManagedSession(
  {
    teamA: cfg.teamA ?? { id: 'A', name: 'Team A' },
    teamB: cfg.teamB ?? { id: 'B', name: 'Team B' },
    map: cfg.map ?? 'ascent',
    seed: cfg.seed ?? 1,
    recordPerception: true,
    recordTracks: true, // player positions + the navigation trace (see run-match.mts)
    ...(cfg.options?.opponentMemory !== undefined ? { opponentMemory: cfg.options.opponentMemory } : {}),
    ...(cfg.options?.minThrowRates ? { minThrowRates: cfg.options.minThrowRates } : {}),
  },
  {
    aiTeams: cfg.aiTeams ?? ['B'],
    ...(cfg.plan ? { plans: { [human]: cfg.plan } } : {}),
    ...(cfg.scouting?.logs?.length ? { scouting: { [human]: cfg.scouting } } : {}),
  },
);
/** Session state + the manager layer (our seat = engine slot here). */
const stateOf = () => { const s = session.state(); return { ...s, manager: managerView(s.manager) }; };

// Compact a RoundRecord to the serializable shape mergeMatch/ipc expect (same as run-match.mts).
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

function reply(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: number; cmd?: string; team?: 'A' | 'B'; order?: TeamOrder; shouts?: Partial<Shouts>; strategy?: { attack?: StrategyOrder; defense?: StrategyOrder; rounds?: number } | null; talk?: TeamTalk };
  try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
  const id = msg.id;
  try {
    switch (msg.cmd) {
      case 'state': reply({ id, ok: true, state: stateOf() }); break;
      case 'callTimeout': session.callTimeout(msg.team!); reply({ id, ok: true, state: stateOf() }); break;
      case 'setOrders': session.setOrders(msg.team!, msg.order ?? {}); reply({ id, ok: true, state: stateOf() }); break;
      case 'setShouts': session.setShouts(msg.team!, msg.shouts ?? {}); reply({ id, ok: true, state: stateOf() }); break;
      case 'setStrategy': session.setStrategy(msg.team!, msg.strategy ?? null); reply({ id, ok: true, state: stateOf() }); break;
      case 'teamTalk': { const talk = session.teamTalk(msg.team!, msg.talk!); reply({ id, ok: true, talk, state: stateOf() }); break; }
      case 'playNextRound': {
        const round = compactRound(session.playNextRound());
        reply({ id, ok: true, round, state: stateOf() });
        break;
      }
      case 'result': {
        // Compact: the UI already streamed each round via playNextRound, so result
        // only carries the final summary + timeout/order log (no replays/perception).
        const r = session.result();
        reply({ id, ok: true, result: {
          winner: r.winner, score: r.score, wentToOvertime: r.wentToOvertime,
          timeoutLog: r.timeoutLog,
          manager: managerResultView(r),
        } });
        break;
      }
      case 'stop': reply({ id, ok: true }); rl.close(); break;
      default: reply({ id, ok: false, error: `unknown cmd ${msg.cmd}` });
    }
  } catch (e) { reply({ id, ok: false, error: (e as Error).message }); }
});
rl.on('close', () => process.exit(0));
process.stderr.write('match-session ready\n');
