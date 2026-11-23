// Stateful interactive match host. Wraps PV-3's createMatchSession and exposes it
// over a line-delimited JSON protocol on stdin/stdout, so the Electron main process
// can drive a tactical-timeout match one round at a time (the session is a live
// stateful object and the match-runner can't be bundled into the app — it runs here,
// in the workspace, as one long-lived tsx subprocess, like run-match.mts but kept open).
//
// Protocol: one JSON object per line.
//   → {"id":1,"cmd":"state"}
//   ← {"id":1,"ok":true,"state":{...}}
//   cmd ∈ state | callTimeout(team) | setOrders(team,order) | playNextRound | result | stop
//   playNextRound returns {round:<compact RoundRecord>, state}; errors come back {ok:false,error}.
// Config (teams/seed/aiTeams) is argv[2] JSON. Diagnostics go to stderr only.
import { createInterface } from 'node:readline';
import { createMatchSession, type MatchSession } from '../../../packages/match-runner/src/index.ts';
import type { TeamOrder } from '../../../packages/match-runner/src/orders.ts';

interface Cfg {
  teamA: { id: string; name: string }; teamB: { id: string; name: string };
  map?: string; seed?: number; aiTeams?: ('A' | 'B')[];
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> } };
}
const cfg: Cfg = JSON.parse(process.argv[2] ?? '{}');

const session: MatchSession = createMatchSession(
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
  { aiTeams: cfg.aiTeams ?? ['B'] },
);

// Compact a RoundRecord to the serializable shape mergeMatch/ipc expect (same as run-match.mts).
function compactRound(r: ReturnType<MatchSession['playNextRound']>) {
  return {
    roundNumber: r.roundNumber, phase: r.phase, attacker: r.attacker,
    winner: r.winner, winnerSide: r.winnerSide, reason: r.reason, planted: r.planted,
    score: r.score, kills: r.kills,
    economy: {
      A: { credits: r.economy.A.credits, ultPoints: r.economy.A.ultPoints },
      B: { credits: r.economy.B.credits, ultPoints: r.economy.B.ultPoints },
    },
    buys: {
      A: { tier: r.buys.A.tier, weapon: r.buys.A.weapon },
      B: { tier: r.buys.B.tier, weapon: r.buys.B.weapon },
    },
    replayEvents: r.replay.events,
    perception: r.replay.meta.perception ?? null,
    // per-tick sight decided by the sim (engine-truth), when the engine records it
    sight: (r as unknown as { sight?: unknown }).sight ?? (r.replay.meta as unknown as { sight?: unknown }).sight ?? null,
    decisions: r.decisions ?? null,
    nav: r.navTrace ?? null,
  };
}

function reply(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: number; cmd?: string; team?: 'A' | 'B'; order?: TeamOrder };
  try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
  const id = msg.id;
  try {
    switch (msg.cmd) {
      case 'state': reply({ id, ok: true, state: session.state() }); break;
      case 'callTimeout': session.callTimeout(msg.team!); reply({ id, ok: true, state: session.state() }); break;
      case 'setOrders': session.setOrders(msg.team!, msg.order ?? {}); reply({ id, ok: true, state: session.state() }); break;
      case 'playNextRound': {
        const round = compactRound(session.playNextRound());
        reply({ id, ok: true, round, state: session.state() });
        break;
      }
      case 'result': {
        // Compact: the UI already streamed each round via playNextRound, so result
        // only carries the final summary + timeout/order log (no replays/perception).
        const r = session.result();
        reply({ id, ok: true, result: {
          winner: r.winner, score: r.score, wentToOvertime: r.wentToOvertime,
          timeoutLog: r.timeoutLog,
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
