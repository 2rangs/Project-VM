// Post-plant duels by the retaker's zone, the guard's zone and the guard's gaze source (report-only).
//   npx tsx tools/data-validator/scripts/postplant-duels.mts --matches 8 [--gaze] [--map Ascent]
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";
const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
const teams = simulatableTeamRefs();
const g = new Map<string, { n: number; atk: number; ao: number }>();
const add = (k: string, win: boolean, ao: number) => { const x = g.get(k) ?? { n: 0, atk: 0, ao: 0 }; x.n++; if (win) x.atk++; x.ao += ao; g.set(k, x); };
for (let i = 0; i < Number(a.matches ?? 8); i++) {
  const cfg = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: a.map ?? "Ascent", seed: Number(a["seed-start"] ?? 1) + i, traceEngagements: true, ...(a.gaze ? { gaze: true } : {}) } as MatchConfig;
  for (const r of runMatch(cfg).rounds) for (const e of (r.engagements ?? []) as any[]) {
    if (e.spikePhase !== "planted" && e.spikePhase !== "defusing") continue;
    const win = e.winnerSide === "attack", ao = e.aimOffsetDeg?.attacker ?? 0;
    add(`retaker ${e.defenderZone}`, win, ao);
    add(`guard ${e.attackerZone} <- ${e.defenderZone}`, win, ao);
    add(`gaze ${e.gaze?.attacker ?? "-"}`, win, ao);
  }
}
for (const [k, x] of [...g.entries()].sort()) if (x.n >= 4) console.log(`${k.padEnd(40)} n=${String(x.n).padStart(4)} atkWin=${(x.atk / x.n).toFixed(2)} atkOffset=${(x.ao / x.n).toFixed(0)}°`);
