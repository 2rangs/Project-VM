// PROJECT V — quick A/B of engine options on real rosters (diagnosis aid; report-only).
//   npx tsx tools/data-validator/scripts/sweep.mts --matches 40 --seed-start 1 --label X [--tuning '{"damageCarryover":1}'] [--mirror]
//   [--plant default|safe|open|cover|near]  both teams' plant preference on every site (default: auto)
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
const bySpot: Record<string, { n: number; atk: number; defuse: number; boom: number }> = {};
// --post '{"hold":"offSpike"}' / --retake '{"approach":"stack"}': that plan on every site for both teams
const every = (j?: string) => (j ? Object.fromEntries(["A", "B", "C"].map((x) => [x, { "*": JSON.parse(j) }])) : undefined);
const postPlans = a.post || a.retake ? { ...(a.post ? { postPlantPlans: every(a.post) } : {}), ...(a.retake ? { retakePlans: every(a.retake) } : {}) } : null;
const plantPref = a.plant ? Object.fromEntries(["A", "B", "C"].map((x) => [x, a.plant as "default"])) : null;
for (let i = 0; i < matches; i++) {
  const cfg: MatchConfig = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: (a.map as string) ?? "Ascent", seed: seed0 + i, collectStats: true, ...(tuning ? { tuning } : {}), ...(a.abilities ? { enableAbilities: true } : {}), ...(a.gaze ? { gaze: true } : {}), ...(a.sound ? { soundDetail: true } : {}), ...(plantPref || postPlans ? { teamInputs: { A: { ...(plantPref ? { plantPreference: plantPref } : {}), ...(postPlans ?? {}) }, B: { ...(plantPref ? { plantPreference: plantPref } : {}), ...(postPlans ?? {}) } } } : {}) };
  for (const r of runMatch(cfg).rounds) {
    n++; const w = r.winnerSide === "attack"; if (w) atk++;
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const k = r.events.find((e) => e.kind === "kill"); if (k) { fk++; fkTimes.push(k.elapsedMs); if (k.actor?.startsWith("atk")) fkA++; }
    for (const [kk, v] of Object.entries((r.stats as { peeks?: Record<string, number> } | undefined)?.peeks ?? {})) peeks[kk] = (peeks[kk] ?? 0) + v;
    if (r.planted) plant++;
    if (r.plant) {
      for (const key of [r.plant.spotKind, "all"]) {
        const b = (bySpot[key] ??= { n: 0, atk: 0, defuse: 0, boom: 0 });
        b.n++; if (w) b.atk++; if (r.reason === "spikeDefused") b.defuse++; if (r.reason === "spikeDetonation") b.boom++;
      }
    }
    if (r.phase === "pistol") { pistol++; if (w) pistolA++; }
    const d = r.attacker === "A" ? "B" : "A";
    if (r.buys[r.attacker].tier === "full" && r.buys[d].tier === "full") { ff++; if (w) ffA++; }
  }
}
const f = (x: number) => x.toFixed(3);
console.log(`${(a.label ?? "").padEnd(24)} n=${n} atk=${f(atk / n)} fullfull=${f(ffA / ff)} pistol=${f(pistolA / pistol)} fkAtk=${f(fkA / fk)} plant=${f(plant / n)} ` + Object.entries(reasons).sort().map(([k, v]) => `${k}=${f(v / n)}`).join(" ") + ` fkP50=${(fkTimes.sort((x, y) => x - y)[Math.floor(fkTimes.length / 2)] ?? 0) / 1000}s` + (Object.keys(peeks).length ? " peeks " + Object.entries(peeks).map(([kk, v]) => `${kk}=${v}`).join(" ") : ""));
if (a.spots) for (const [k, b] of Object.entries(bySpot).sort()) console.log(`  plant ${k.padEnd(8)} n=${String(b.n).padStart(5)} postPlantAtk=${f(b.atk / b.n)} defuse=${f(b.defuse / b.n)} detonate=${f(b.boom / b.n)}`);
