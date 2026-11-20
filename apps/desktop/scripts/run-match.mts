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
import { installTrackRecording, withSpawnMoves } from './track-shim.mts';

installTrackRecording(); // player positions for the live match screen (see track-shim.mts)

interface Cfg {
  teamA: { id: string; name: string }; teamB: { id: string; name: string }; map?: string; seed?: number; recordPerception?: boolean;
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> } };
}
const cfg: Cfg = JSON.parse(process.argv[2] ?? '{}');

// recordPerception drives PV-4's fog-of-war / belief track (off by default in the
// match-runner; MatchConfig.recordPerception since PV-3 7a7a847). We request it on.
// Each round's events with spawn positions prepended, captured as the round resolves.
const eventsWithSpawns = new Map<number, Record<string, unknown>[]>();
const res = runMatch({
  teamA: cfg.teamA ?? { id: 'A', name: 'Team A' },
  teamB: cfg.teamB ?? { id: 'B', name: 'Team B' },
  map: cfg.map ?? 'ascent',
  seed: cfg.seed ?? 1,
  recordPerception: cfg.recordPerception ?? true,
  ...(cfg.options?.opponentMemory !== undefined ? { opponentMemory: cfg.options.opponentMemory } : {}),
  ...(cfg.options?.minThrowRates ? { minThrowRates: cfg.options.minThrowRates } : {}),
}, {
  onRound: (r) => { eventsWithSpawns.set(r.roundNumber, withSpawnMoves(r.replay.events as unknown as Record<string, unknown>[])); },
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
  options: cfg.options ?? {},
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
    replayEvents: eventsWithSpawns.get(r.roundNumber) ?? r.replay.events,
    // Per-team PerceptionTrack[] for this round (side-keyed, round-relative tMs);
    // the parent remaps side→real-team and offsets tMs onto the match timeline.
    // Absent on match-runner versions without recordPerception.
    perception: r.replay.meta.perception ?? null,
    // Why each team played the round the way it did (plans, pre-round opponent reads,
    // what the round let them observe). Plain JSON; null on engines that predate it.
    decisions: r.decisions ?? null,
  })),
};
process.stderr.write(`perception: ${out.rounds.filter((r) => r.perception).length}/${out.rounds.length} rounds\n`);
process.stdout.write(JSON.stringify(out));
