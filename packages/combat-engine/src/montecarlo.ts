import type { Duel, PlayerId } from "./types.js";
import { resolveDuel, type ResolveOptions } from "./engine.js";

export interface DuelStats {
  readonly trials: number;
  readonly wins: Readonly<Record<PlayerId, number>>;
  readonly draws: number;
  /** win rate of combatant a (duel.a.id) in [0,1]. */
  readonly winRateA: number;
  readonly avgTimeToKillMs: number | null;
}

/**
 * Run `trials` independent duels over consecutive seeds (baseSeed..baseSeed+trials-1)
 * and aggregate win rates. Deterministic for a fixed baseSeed.
 */
export function monteCarloDuel(duel: Duel, trials: number, baseSeed = 1, opts: ResolveOptions = {}): DuelStats {
  const wins: Record<PlayerId, number> = { [duel.a.id]: 0, [duel.b.id]: 0 };
  let draws = 0;
  let ttkSum = 0;
  let ttkCount = 0;
  for (let i = 0; i < trials; i++) {
    const r = resolveDuel(duel, baseSeed + i, opts);
    if (r.winner) {
      wins[r.winner] += 1;
      if (r.timeToKillMs !== null) {
        ttkSum += r.timeToKillMs;
        ttkCount += 1;
      }
    } else {
      draws += 1;
    }
  }
  return {
    trials,
    wins,
    draws,
    winRateA: wins[duel.a.id] / trials,
    avgTimeToKillMs: ttkCount > 0 ? ttkSum / ttkCount : null,
  };
}
