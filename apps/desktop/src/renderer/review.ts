// Post-match review derivations. All stats come from the REAL match-runner summary
// and the simulated replay's kill events. Player identity: the simulator plays with
// side-slot rosters (atk1..def5), not real people, so per-slot stats are attributed
// to each real team's five handles by a deterministic (synthetic) roster map — real
// handles, simulated performance (see RATINGS_DISCLAIMER). Clearly labelled in the UI.
import type { Replay } from '@pv/replay-engine';
import type { MatchSummary } from '../shared/ipc.ts';
import { players, type JoinedPlayer } from './data.ts';

export interface EconomyPoint { round: number; a: number; b: number }
/** Both teams' credit-at-buy per round, for the economy timeline graph. */
export function economySeries(match: MatchSummary): EconomyPoint[] {
  return match.rounds.map((r) => ({ round: r.roundNumber, a: r.economy.A.credits, b: r.economy.B.credits }));
}

// Deterministic 5-handle roster for a team, stable per team name. Picks distinct
// real handles from the player pool so each team shows its own five people.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rosterFor(teamName: string, pool: JoinedPlayer[]): string[] {
  if (pool.length === 0) return ['P1', 'P2', 'P3', 'P4', 'P5'];
  const start = hash(teamName) % pool.length;
  const step = 7 + (hash(teamName + '·') % 11); // coprime-ish stride for spread
  const out: string[] = [];
  const seen = new Set<number>();
  for (let k = 0; out.length < 5 && k < pool.length; k++) {
    const idx = (start + k * step) % pool.length;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push(pool[idx].handle);
  }
  while (out.length < 5) out.push(`P${out.length + 1}`);
  return out;
}

export interface PlayerLine {
  team: 'A' | 'B'; teamName: string; slot: number; handle: string;
  kills: number; deaths: number; survived: number; score: number;
}
export interface MvpResult { mvp: PlayerLine | null; lines: PlayerLine[] }

const sideSlot = (id: string): { side: 'attack' | 'defense'; slot: number } | null => {
  const m = /^(atk|def)(\d+)$/.exec(id);
  if (!m) return null;
  return { side: m[1] === 'atk' ? 'attack' : 'defense', slot: Number(m[2]) };
};

/**
 * MVP + per-player lines from the replay's kill events. A kill/death is attributed
 * to (real team, slot) via the round's attacker (side→team), then to a real handle.
 * Score = 2·kills + survived rounds (simple, as asked).
 */
export function computeMvp(match: MatchSummary, replay: Replay): MvpResult {
  const pool = players();
  const rosters: Record<'A' | 'B', string[]> = {
    A: rosterFor(match.teams.A.name, pool),
    B: rosterFor(match.teams.B.name, pool),
  };
  const byRound = new Map(match.rounds.map((r) => [r.roundNumber, r]));
  const key = (t: 'A' | 'B', slot: number) => `${t}:${slot}`;
  const stat = new Map<string, { kills: number; deaths: number }>();
  const bump = (t: 'A' | 'B', slot: number, field: 'kills' | 'deaths') => {
    const k = key(t, slot);
    const s = stat.get(k) ?? { kills: 0, deaths: 0 };
    s[field] += 1; stat.set(k, s);
  };
  const teamOfSide = (round: MatchSummary['rounds'][number], side: 'attack' | 'defense'): 'A' | 'B' =>
    side === 'attack' ? round.attacker : (round.attacker === 'A' ? 'B' : 'A');

  for (const e of replay.events) {
    if (e.kind !== 'kill') continue;
    const round = e.roundNum != null ? byRound.get(e.roundNum) : undefined;
    if (!round) continue;
    if (e.actorId) { const k = sideSlot(e.actorId); if (k) bump(teamOfSide(round, k.side), k.slot, 'kills'); }
    if (e.victimId) { const v = sideSlot(e.victimId); if (v) bump(teamOfSide(round, v.side), v.slot, 'deaths'); }
  }

  const totalRounds = match.rounds.length;
  const lines: PlayerLine[] = (['A', 'B'] as const).flatMap((team) =>
    [1, 2, 3, 4, 5].map((slot) => {
      const s = stat.get(key(team, slot)) ?? { kills: 0, deaths: 0 };
      const survived = Math.max(0, totalRounds - s.deaths);
      return {
        team, teamName: match.teams[team].name, slot, handle: rosters[team][slot - 1] ?? `P${slot}`,
        kills: s.kills, deaths: s.deaths, survived, score: s.kills * 2 + survived,
      };
    }),
  );
  lines.sort((a, b) => b.score - a.score || b.kills - a.kills);
  return { mvp: lines[0] ?? null, lines };
}
