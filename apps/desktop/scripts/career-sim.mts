// Career background simulation host: plays whole series between AI teams through
// @pv/match-runner (veto + every map), one at a time, for the career calendar. Long-lived tsx
// subprocess of the Electron main process (src/main/career-host.ts), so the UI thread never runs
// the engine. Line-delimited JSON on stdin/stdout:
//   {id, cmd: 'series', req: CareerSimRequest} → {id, ok, outcome: CareerSimOutcome}
//   {id, cmd: 'stop'}                           → {id, ok}
// Diagnostics go to stderr only.
import { createInterface } from 'node:readline';
import { runSeries, type SeriesResult } from '../../../packages/match-runner/src/index.ts';
import type { RosterPlayer } from '../../../packages/match-runner/src/teams.ts';
import type { CareerSimOutcome, CareerSimRequest } from '../src/shared/career.ts';

/**
 * Kills / deaths per player from the engine's kill events. In a round the attacking slot's players
 * are `atk1..5` and the defenders `def1..5`, in roster order, so `atk3` is index 2 of the attacking
 * team's five.
 */
function killLines(res: SeriesResult, req: CareerSimRequest, gameIdx: number): Record<string, { k: number; d: number }> {
  const g = res.games[gameIdx]!;
  const out: Record<string, { k: number; d: number }> = {};
  const lineup = { A: req.home.roster.map((p) => p.playerId), B: req.away.roster.map((p) => p.playerId) };
  const teamOfSlot = (slot: 'A' | 'B'): 'A' | 'B' => (g.slots.A === slot ? 'A' : 'B');
  for (const id of [...lineup.A, ...lineup.B]) out[id] = { k: 0, d: 0 };
  for (const r of g.match.rounds) {
    const atkTeam = teamOfSlot(r.attacker);
    const defTeam = atkTeam === 'A' ? 'B' : 'A';
    const who = (pid: string | null | undefined): string | null => {
      const m = /^(atk|def)(\d)$/.exec(pid ?? '');
      if (!m) return null;
      const team = m[1] === 'atk' ? atkTeam : defTeam;
      return lineup[team][Number(m[2]) - 1] ?? null;
    };
    for (const e of r.replay.events as Array<{ kind?: string; killer?: string | null; victim?: string }>) {
      if (e.kind !== 'kill') continue;
      const k = who(e.killer); const v = who(e.victim);
      if (k && out[k]) out[k].k += 1;
      if (v && out[v]) out[v].d += 1;
    }
  }
  return out;
}

function play(req: CareerSimRequest): CareerSimOutcome {
  const res = runSeries({
    teamA: { id: req.home.teamId, name: req.home.name, scouting: false, staff: { analyst: req.home.analyst }, roster: req.home.roster as RosterPlayer[] },
    teamB: { id: req.away.teamId, name: req.away.name, scouting: false, staff: { analyst: req.away.analyst }, roster: req.away.roster as RosterPlayer[] },
    format: req.format,
    seed: req.seed,
  });
  return {
    fixtureId: req.fixtureId,
    winner: res.winner === 'A' ? req.home.teamId : req.away.teamId,
    mapsWon: [res.score.A, res.score.B],
    maps: res.games.map((g, i) => ({
      map: g.map, score: [g.score.A, g.score.B], ...(g.match.wentToOvertime ? { overtime: true } : {}), players: killLines(res, req, i),
    })),
  };
}

const reply = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify(o) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg: { id?: number; cmd?: string; req?: CareerSimRequest };
  try { msg = JSON.parse(text); } catch (e) { reply({ ok: false, error: `bad json: ${(e as Error).message}` }); return; }
  try {
    if (msg.cmd === 'series' && msg.req) {
      const t0 = Date.now();
      const outcome = play(msg.req);
      process.stderr.write(`career-sim: ${msg.req.home.name} ${outcome.mapsWon[0]}-${outcome.mapsWon[1]} ${msg.req.away.name} (${Date.now() - t0} ms)\n`);
      reply({ id: msg.id, ok: true, outcome });
    } else if (msg.cmd === 'stop') { reply({ id: msg.id, ok: true }); rl.close(); }
    else reply({ id: msg.id, ok: false, error: `unknown cmd ${msg.cmd}` });
  } catch (e) { reply({ id: msg.id, ok: false, error: (e as Error).message }); }
});
rl.on('close', () => process.exit(0));
process.stderr.write('career-sim ready\n');
