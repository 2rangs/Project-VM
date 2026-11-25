// Duel breakdown (report-only diagnostics for recalibration): attacker duel win rate by spike phase,
// who peeked and how, first sight and ready-time gap. Real rosters, Ascent.
//   npx tsx tools/data-validator/scripts/duel-breakdown.mts --matches 20 [--gaze] [--tuning JSON]
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
const matches = Number(a.matches ?? 20), seed0 = Number(a["seed-start"] ?? 1);
const teams = simulatableTeamRefs();
const groups = new Map<string, { n: number; atk: number; dis: number; gap: number; ao: number; do: number }>();
let cur: any = null;
const add = (k: string, atkWin: boolean | null, dis: boolean, gap: number) => {
  const g = groups.get(k) ?? { n: 0, atk: 0, dis: 0, gap: 0, ao: 0, do: 0 };
  g.n++; if (atkWin) g.atk++; if (dis) g.dis++; g.gap += gap; g.ao += cur?.aimOffsetDeg?.attacker ?? 0; g.do += cur?.aimOffsetDeg?.defender ?? 0; groups.set(k, g);
};
for (let i = 0; i < matches; i++) {
  const cfg: MatchConfig = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: "Ascent", seed: seed0 + i, traceEngagements: true, ...(a.gaze ? { gaze: true } : {}), ...(a["plant-tactics"] ? { plantTactics: true } : {}), ...(a.tuning ? { tuning: JSON.parse(a.tuning) } : {}) } as MatchConfig;
  for (const r of runMatch(cfg).rounds) {
    for (const e of (r.engagements ?? []) as any[]) {
      cur = e;
      const post = e.spikePhase === "planted" || e.spikePhase === "defusing" ? "post" : "pre";
      const win = e.winnerSide === null ? null : e.winnerSide === "attack";
      const gap = e.readyMs ? e.readyMs.defender - e.readyMs.attacker : 0; // > 0: attacker ready first
      const who = e.peek ? `${e.peek.side === "attack" ? "A" : "D"}-${e.peek.rePeek ? "rePeek" : e.peek.kind}` : e.attackerMoving && e.defenderMoving ? "both-move" : !e.attackerMoving && !e.defenderMoving ? "both-still" : "legacy";
      add(`${post} all`, win, !!e.disengaged, gap);
      add(`${post} ${who}`, win, !!e.disengaged, gap);
      add(`${post} first=${e.firstSight}`, win, !!e.disengaged, gap);
    }
  }
}
const rows = [...groups.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
for (const [k, g] of rows) console.log(`${k.padEnd(26)} n=${String(g.n).padStart(5)} atkWin=${(g.atk / g.n).toFixed(3)} disengage=${(g.dis / g.n).toFixed(3)} readyGap=${(g.gap / g.n).toFixed(0)}ms offset atk ${(g.ao / g.n).toFixed(0)}° def ${(g.do / g.n).toFixed(0)}°`);
