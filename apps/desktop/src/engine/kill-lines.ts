// Kills / deaths per player of one series game, from the engine's kill events. In a round the
// attacking slot's players are `atk1..5` and the defenders `def1..5`, in roster order, so `atk3`
// is index 2 of the attacking team's five. Used by career-sim.ts and series-session.ts.
import type { SeriesGameResult } from '../../../../packages/match-runner/src/index.ts';

export function killLines(g: SeriesGameResult, lineupA: readonly string[], lineupB: readonly string[]): Record<string, { k: number; d: number }> {
  const out: Record<string, { k: number; d: number }> = {};
  const lineup = { A: lineupA, B: lineupB };
  const teamOfSlot = (slot: 'A' | 'B'): 'A' | 'B' => (g.slots.A === slot ? 'A' : 'B');
  for (const id of [...lineupA, ...lineupB]) out[id] = { k: 0, d: 0 };
  for (const r of g.match.rounds) {
    const atkTeam = teamOfSlot(r.attacker);
    const defTeam = atkTeam === 'A' ? 'B' : 'A';
    const who = (pid: string | null | undefined): string | null => {
      const m = /^(atk|def)(\d)$/.exec(pid ?? '');
      if (!m) return null;
      return lineup[m[1] === 'atk' ? atkTeam : defTeam][Number(m[2]) - 1] ?? null;
    };
    for (const e of r.replay.events as ReadonlyArray<{ kind?: string; killer?: string | null; victim?: string }>) {
      if (e.kind !== 'kill') continue;
      const k = who(e.killer); const v = who(e.victim);
      if (k && out[k]) out[k].k += 1;
      if (v && out[v]) out[v].d += 1;
    }
  }
  return out;
}
