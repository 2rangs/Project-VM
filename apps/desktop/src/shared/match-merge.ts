// Merge the match-runner's per-round output (from scripts/run-match.mts) onto a
// single match timeline: offset each round's events, renumber roundStart, strip
// the heavy per-round events out of the summary the UI shows, and fold each
// round's per-team PerceptionTrack into ONE match-level perception track per real
// team (fog-of-war / belief heatmap source, DECISION-004).
import type { PerceptionTrack, PerceptionSnapshot, SimEvent } from '@pv/replay-engine';
import type { MatchOptions, MatchSummary, NavTraceEvent, RoundDecisions , SightFrame } from './ipc.ts';

const GAP_MS = 5000;

// A round's perception track as emitted by PV-4 recordPerception: teamIdx is
// SIDE-based for that one round (0 = attack, 1 = defense) with `side` set, and
// tMs is round-relative. We remap side→real team (A=0, B=1) and offset tMs.
interface RawPerceptionTrack {
  teamIdx: number;
  side?: 'attack' | 'defense' | null;
  intervalTicks?: number | null;
  snapshots: PerceptionSnapshot[];
}
interface RawRound {
  roundNumber: number; phase: string; attacker: 'A' | 'B'; winner: string; winnerSide: string;
  reason: string; planted: boolean;
  score: { A: number; B: number }; kills: { A: number; B: number };
  economy: { A: { credits: number; ultPoints: number }; B: { credits: number; ultPoints: number } };
  buys: { A: { tier: string; weapon: string }; B: { tier: string; weapon: string } };
  replayEvents: Array<Record<string, unknown>>;
  perception?: RawPerceptionTrack[] | null;
  /** RoundRecord.decisions, passed through untouched (absent on older engines). */
  decisions?: RoundDecisions | null;
  /** RoundRecord.navTrace (round-relative ms), passed through untouched. */
  nav?: NavTraceEvent[] | null;
  /** RoundRecord.sight (round-relative ms), passed through untouched; absent on older engines. */
  sight?: SightFrame[] | null;
}
export interface RawMatch {
  teams: { A: { id: string; name: string }; B: { id: string; name: string } };
  map: string; seed: number; winner: string; score: { A: number; B: number };
  wentToOvertime: boolean; rounds: RawRound[];
  options?: MatchOptions;
}

export interface MergedMatch {
  events: SimEvent[];
  summary: MatchSummary;
  /** One track per real team (teamIdx 0 = A, 1 = B), or undefined if no round recorded it. */
  perception?: PerceptionTrack[];
}

export function mergeMatch(raw: RawMatch): MergedMatch {
  const events: SimEvent[] = [];
  // Accumulate match-level snapshots per REAL team index (0 = A, 1 = B).
  const snapsByTeam: [PerceptionSnapshot[], PerceptionSnapshot[]] = [[], []];
  let sawPerception = false;
  let offset = 0;
  let seq = 0;
  for (const r of raw.rounds) {
    const defender: 'A' | 'B' = r.attacker === 'A' ? 'B' : 'A';
    // the buy phase comes before the round (negative round-relative times): make room for it
    let lead = 0;
    for (const src of r.replayEvents) lead = Math.max(lead, -((src.timeMs as number) ?? 0));
    offset += lead;
    let maxT = 0;
    for (const src of r.replayEvents) {
      const t = (src.timeMs as number) ?? 0;
      if (t > maxT) maxT = t;
      const ev: Record<string, unknown> = { ...src, timeMs: t + offset, seq: seq++ };
      if (ev.kind === 'roundStart') ev.roundNumber = r.roundNumber;
      events.push(ev as unknown as SimEvent);
    }
    for (const track of r.perception ?? []) {
      sawPerception = true;
      // side → real team: attack side belongs to this round's attacker, defense to the defender.
      const realSlot = track.side === 'defense' ? defender : r.attacker;
      const realIdx = realSlot === 'A' ? 0 : 1;
      for (const s of track.snapshots) {
        if ((s.tMs as number) > maxT) maxT = s.tMs as number;
        snapsByTeam[realIdx].push({ ...s, tMs: s.tMs + offset, roundNum: r.roundNumber });
      }
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
      attacker: r.attacker,
      winner: r.winner as 'A' | 'B',
      winnerSide: r.winnerSide,
      reason: r.reason,
      planted: r.planted,
      score: r.score,
      kills: r.kills,
      economy: r.economy,
      buys: r.buys,
      ...(r.decisions ? { decisions: r.decisions } : {}),
      ...(r.nav ? { nav: r.nav } : {}),
      ...(r.sight && r.sight.length ? { sight: r.sight } : {}),
    })),
    ...(raw.options ? { options: raw.options } : {}),
  };

  const perception: PerceptionTrack[] | undefined = sawPerception
    ? ([0, 1] as const).map((teamIdx) => ({
        teamIdx,
        snapshots: snapsByTeam[teamIdx].sort((a, b) => a.tMs - b.tMs),
      }))
    : undefined;

  return { events, summary, perception };
}
