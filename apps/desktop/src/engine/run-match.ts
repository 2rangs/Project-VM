// One whole map in one call: @pv/match-runner's runMatch, projected to the compact, JSON-safe
// RawMatch the desktop merges onto one timeline (src/shared/match-merge.ts). Shared by the bundled
// engine host (src/engine/host.ts) and the tsx reference script (scripts/run-match.mts), so both
// paths produce the same bytes for the same config.
import { runMatch } from '../../../../packages/match-runner/src/index.ts';
import { compactBuy, compactEconomy, engagementOf, sightOf } from './compact-round.ts';

export interface RunMatchCfg {
  teamA?: { id: string; name: string }; teamB?: { id: string; name: string }; map?: string; seed?: number; recordPerception?: boolean;
  /** Pre-match options chosen in the Match Day setup (see src/shared/ipc.ts MatchOptions). */
  options?: { opponentMemory?: boolean; minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> } };
}
export interface RoundProgress { round: number; score: { A: number; B: number } }

export function runMatchCompact(cfg: RunMatchCfg, onRound?: (p: RoundProgress) => void) {
  // recordPerception drives the fog-of-war / belief track (off by default in the match-runner).
  // recordTracks: every player's position on every tick (the live match screen draws them) and the
  // navigation trace (what each player planned to walk, and why — the navigation debug view).
  const res = runMatch({
    teamA: cfg.teamA ?? { id: 'A', name: 'Team A' },
    teamB: cfg.teamB ?? { id: 'B', name: 'Team B' },
    map: cfg.map ?? 'ascent',
    seed: cfg.seed ?? 1,
    recordPerception: cfg.recordPerception ?? true,
    recordTracks: true,
    ...(cfg.options?.opponentMemory !== undefined ? { opponentMemory: cfg.options.opponentMemory } : {}),
    ...(cfg.options?.minThrowRates ? { minThrowRates: cfg.options.minThrowRates } : {}),
  }, {
    // one progress report per round; the caller turns it into the loading screen's counter
    onRound: (r, score) => { onRound?.({ round: r.roundNumber, score: { A: score.A, B: score.B } }); },
  });

  // Compact, serializable projection: strip the round replay to just its events
  // (the caller merges them onto one match timeline).
  return {
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
      economy: { A: compactEconomy(r.economy.A), B: compactEconomy(r.economy.B) },
      buys: { A: compactBuy(r.buys.A), B: compactBuy(r.buys.B) },
      replayEvents: r.replay.events,
      // Per-team PerceptionTrack[] for this round (side-keyed, round-relative tMs);
      // the caller remaps side→real-team and offsets tMs onto the match timeline.
      perception: r.replay.meta.perception ?? null,
      // per-tick sight decided by the sim (engine-truth), when the engine records it
      sight: sightOf(r),
      engagement: engagementOf(r),
      // Why each team played the round the way it did (plans, pre-round opponent reads,
      // what the round let them observe). Plain JSON; null on engines that predate it.
      decisions: r.decisions ?? null,
      // What the navigation layer planned for each player (round-relative ms); null without tracks.
      nav: r.navTrace ?? null,
    })),
  };
}
