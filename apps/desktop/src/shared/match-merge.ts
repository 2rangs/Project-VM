// Merge the match-runner's per-round output (from scripts/run-match.mts) onto a
// single match timeline: offset each round's events, renumber roundStart, and
// strip the heavy per-round events out of the summary the UI shows.
import type { SimEvent } from '@pv/replay-engine';
import type { MatchSummary } from './ipc.ts';

const GAP_MS = 5000;

interface RawRound {
  roundNumber: number; phase: string; attacker: string; winner: string; winnerSide: string;
  reason: string; planted: boolean;
  score: { A: number; B: number }; kills: { A: number; B: number };
  economy: { A: { credits: number; ultPoints: number }; B: { credits: number; ultPoints: number } };
  buys: { A: { tier: string; weapon: string }; B: { tier: string; weapon: string } };
  replayEvents: Array<Record<string, unknown>>;
}
export interface RawMatch {
  teams: { A: { id: string; name: string }; B: { id: string; name: string } };
  map: string; seed: number; winner: string; score: { A: number; B: number };
  wentToOvertime: boolean; rounds: RawRound[];
}

export function mergeMatch(raw: RawMatch): { events: SimEvent[]; summary: MatchSummary } {
  const events: SimEvent[] = [];
  let offset = 0;
  let seq = 0;
  for (const r of raw.rounds) {
    let maxT = 0;
    for (const src of r.replayEvents) {
      const t = (src.timeMs as number) ?? 0;
      if (t > maxT) maxT = t;
      const ev: Record<string, unknown> = { ...src, timeMs: t + offset, seq: seq++ };
      if (ev.kind === 'roundStart') ev.roundNumber = r.roundNumber;
      events.push(ev as unknown as SimEvent);
    }
    offset += maxT + GAP_MS;
  }
  const summary: MatchSummary = {
    teams: raw.teams,
    map: raw.map,
    seed: raw.seed,
    winner: raw.winner as 'A' | 'B',
    score: raw.score,
    wentToOvertime: raw.wentToOvertime,
    rounds: raw.rounds.map((r) => ({
      roundNumber: r.roundNumber,
      phase: r.phase as MatchSummary['rounds'][number]['phase'],
      attacker: r.attacker as 'A' | 'B',
      winner: r.winner as 'A' | 'B',
      winnerSide: r.winnerSide,
      reason: r.reason,
      planted: r.planted,
      score: r.score,
      kills: r.kills,
      economy: r.economy,
      buys: r.buys,
    })),
  };
  return { events, summary };
}
