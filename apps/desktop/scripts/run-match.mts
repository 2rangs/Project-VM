// Match-runner subprocess entry. Runs PV-3's @pv/match-runner (a full VALORANT
// map: pistol → halves → first-to-13 → OT, with economy + ultimate carryover)
// from workspace source and prints a compact match result as JSON to stdout.
//
// The Electron main process spawns this via tsx (the match-runner reads data
// files with node:fs and pulls in many @pv engines, so it cannot be bundled into
// the app — it runs here, in the workspace, as a separate process). Progress and
// diagnostics go to stderr; only the final JSON goes to stdout.
//
// Usage: tsx run-match.mts '<json config>'
import { runMatch } from '../../../packages/match-runner/src/index.ts';

interface Cfg { teamA: { id: string; name: string }; teamB: { id: string; name: string }; map?: string; seed?: number }
const cfg: Cfg = JSON.parse(process.argv[2] ?? '{}');

const res = runMatch({
  teamA: cfg.teamA ?? { id: 'A', name: 'Team A' },
  teamB: cfg.teamB ?? { id: 'B', name: 'Team B' },
  map: cfg.map ?? 'ascent',
  seed: cfg.seed ?? 1,
});

process.stderr.write(`match: ${res.winner} wins ${res.score.A}-${res.score.B} (${res.rounds.length} rounds, OT=${res.wentToOvertime})\n`);

// Compact, serializable projection: strip the round replay to just its events
// (the parent merges them onto one match timeline).
const out = {
  teams: { A: res.config.teamA, B: res.config.teamB },
  map: res.config.map,
  seed: res.config.seed,
  winner: res.winner,
  score: res.score,
  wentToOvertime: res.wentToOvertime,
  rounds: res.rounds.map((r) => ({
    roundNumber: r.roundNumber,
    phase: r.phase,
    attacker: r.attacker,
    winner: r.winner,
    winnerSide: r.winnerSide,
    reason: r.reason,
    planted: r.planted,
    score: r.score,
    kills: r.kills,
    economy: {
      A: { credits: r.economy.A.credits, ultPoints: r.economy.A.ultPoints },
      B: { credits: r.economy.B.credits, ultPoints: r.economy.B.ultPoints },
    },
    buys: {
      A: { tier: r.buys.A.tier, weapon: r.buys.A.weapon },
      B: { tier: r.buys.B.tier, weapon: r.buys.B.weapon },
    },
    replayEvents: r.replay.events,
  })),
};
process.stdout.write(JSON.stringify(out));
