// PROJECT V — quick A/B of engine options on real rosters (diagnosis aid; report-only).
//   npx tsx tools/data-validator/scripts/sweep.mts --matches 40 --seed-start 1 --label X [--tuning '{"damageCarryover":1}'] [--mirror]
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";
const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
const matches = Number(a.matches ?? 40), seed0 = Number(a["seed-start"] ?? 1);
const tuning = a.tuning ? JSON.parse(a.tuning) : undefined;
const teams = a.mirror ? [{ id: "undefined", name: "A" }, { id: "undefined", name: "B" }] : simulatableTeamRefs();
let n = 0, atk = 0, fk = 0, fkA = 0, plant = 0, pistol = 0, pistolA = 0, ff = 0, ffA = 0;
const reasons: Record<string, number> = {};
const peeks: Record<string, number> = {};
const fkTimes: number[] = [];
for (let i = 0; i < matches; i++) {
  const cfg: MatchConfig = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: (a.map as string) ?? "Ascent", seed: seed0 + i, collectStats: true, ...(tuning ? { tuning } : {}), ...(a.abilities ? { enableAbilities: true } : {}), ...(a.gaze ? { gaze: true } : {}), ...(a.sound ? { soundDetail: true } : {}) };
  for (const r of runMatch(cfg).rounds) {
    n++; const w = r.winnerSide === "attack"; if (w) atk++;
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const k = r.events.find((e) => e.kind === "kill"); if (k) { fk++; fkTimes.push(k.elapsedMs); if (k.actor?.startsWith("atk")) fkA++; }
    for (const [kk, v] of Object.entries((r.stats as { peeks?: Record<string, number> } | undefined)?.peeks ?? {})) peeks[kk] = (peeks[kk] ?? 0) + v;
    if (r.planted) plant++;
    if (r.phase === "pistol") { pistol++; if (w) pistolA++; }
    const d = r.attacker === "A" ? "B" : "A";
    if (r.buys[r.attacker].tier === "full" && r.buys[d].tier === "full") { ff++; if (w) ffA++; }
  }
}
const f = (x: number) => x.toFixed(3);
console.log(`${(a.label ?? "").padEnd(24)} n=${n} atk=${f(atk / n)} fullfull=${f(ffA / ff)} pistol=${f(pistolA / pistol)} fkAtk=${f(fkA / fk)} plant=${f(plant / n)} ` + Object.entries(reasons).sort().map(([k, v]) => `${k}=${f(v / n)}`).join(" ") + ` fkP50=${(fkTimes.sort((x, y) => x - y)[Math.floor(fkTimes.length / 2)] ?? 0) / 1000}s` + (Object.keys(peeks).length ? " peeks " + Object.entries(peeks).map(([kk, v]) => `${kk}=${v}`).join(" ") : ""));
