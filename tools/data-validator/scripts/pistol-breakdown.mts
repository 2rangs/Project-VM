// Pistol rounds vs gun rounds, side by side (report-only diagnosis): outcome mix, plant rate,
// post-plant win, first contact, trades, loadouts, and duels by phase, distance and weapon pair.
// Same team pairing as sim-batch (pair i = teams 2i, 2i+1), real rosters, Ascent.
//   npx tsx tools/data-validator/scripts/pistol-breakdown.mts --matches 160 --seed-start 161 [--max-rounds 13] [--plant-tactics] [--gaze] [--weapon-modes]
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
const matches = Number(a.matches ?? 40), seed0 = Number(a["seed-start"] ?? 1), maxRounds = Number(a["max-rounds"] ?? 24);
const teams = simulatableTeamRefs();

type Acc = { n: number; atk: number; reasons: Record<string, number>; plant: number; ppN: number; ppAtk: number; fk: number; fkAtk: number; winFkAtk: number; winFkDef: number;
  killsA: number; killsD: number; trades: number; deaths: number; loadA: number; loadD: number; armorA: number; armorD: number; weapons: Record<string, number>;
  duels: Record<string, { n: number; atk: number; dist: number }>; plantMs: number[]; fkMs: number[] };
const mk = (): Acc => ({ n: 0, atk: 0, reasons: {}, plant: 0, ppN: 0, ppAtk: 0, fk: 0, fkAtk: 0, winFkAtk: 0, winFkDef: 0, killsA: 0, killsD: 0, trades: 0, deaths: 0, loadA: 0, loadD: 0, armorA: 0, armorD: 0, weapons: {}, duels: {}, plantMs: [], fkMs: [] });
const acc: Record<string, Acc> = { pistol: mk(), "r2-3": mk(), "full-full": mk(), all: mk() };
const add = (k: string, x: Acc["duels"][string] | undefined, win: boolean, d: number) => x ?? { n: 0, atk: 0, dist: 0 };

for (let i = 0; i < matches; i++) {
  const cfg: MatchConfig = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: "Ascent", seed: seed0 + i, collectStats: true, traceEngagements: true, maxRounds,
    ...(a["plant-tactics"] ? { plantTactics: true } : {}), ...(a.gaze ? { gaze: true } : {}), ...(a["weapon-modes"] ? { weaponModes: true } : {}) } as MatchConfig;
  for (const r of runMatch(cfg).rounds) {
    const def = r.attacker === "A" ? "B" : "A";
    const keys = ["all"];
    if (r.phase === "pistol") keys.push("pistol");
    else if (r.roundNumber === 2 || r.roundNumber === 3 || r.roundNumber === 14 || r.roundNumber === 15) keys.push("r2-3");
    if (r.buys[r.attacker].tier === "full" && r.buys[def].tier === "full") keys.push("full-full");
    const win = r.winnerSide === "attack";
    const kills = r.events.filter((e) => e.kind === "kill");
    const fk = kills[0];
    let trades = 0;
    for (let k = 0; k < kills.length; k++) {
      const v = kills[k]!;
      // a trade: the killer of v dies within 3 s
      if (kills.slice(k + 1).some((w) => w.target === v.actor && w.elapsedMs - v.elapsedMs <= 3000)) trades++;
    }
    const planted = r.events.find((e) => e.kind === "planted");
    for (const key of keys) {
      const x = acc[key]!;
      x.n++; if (win) x.atk++;
      x.reasons[r.reason] = (x.reasons[r.reason] ?? 0) + 1;
      if (r.planted) { x.plant++; x.ppN++; if (win) x.ppAtk++; if (planted) x.plantMs.push(planted.elapsedMs); }
      if (fk) { x.fk++; x.fkMs.push(fk.elapsedMs); const fa = String(fk.actor).startsWith("atk"); if (fa) { x.fkAtk++; if (win) x.winFkAtk++; } else if (win) x.winFkDef++; }
      for (const k of kills) { if (String(k.actor).startsWith("atk")) x.killsA++; else x.killsD++; }
      x.trades += trades; x.deaths += kills.length;
      x.loadA += r.buys[r.attacker].loadoutValue; x.loadD += r.buys[def].loadoutValue;
      x.armorA += r.buys[r.attacker].players.reduce((s, p) => s + p.armor, 0) / 5; x.armorD += r.buys[def].players.reduce((s, p) => s + p.armor, 0) / 5;
      for (const p of r.buys[r.attacker].players) x.weapons[`A:${p.weapon}`] = (x.weapons[`A:${p.weapon}`] ?? 0) + 1;
      for (const p of r.buys[def].players) x.weapons[`D:${p.weapon}`] = (x.weapons[`D:${p.weapon}`] ?? 0) + 1;
      for (const e of (r.engagements ?? []) as any[]) {
        if (e.winnerSide === null) continue;
        const phase = e.spikePhase === "planted" || e.spikePhase === "defusing" ? "post" : "pre";
        const band = e.distanceMeters < 10 ? "<10m" : e.distanceMeters < 20 ? "10-20m" : "20m+";
        for (const dk of [`${phase}`, `${phase} ${band}`, `${phase} first=${e.firstSight}`, `${phase} moving A${e.attackerMoving ? 1 : 0}D${e.defenderMoving ? 1 : 0}`]) {
          const d = (x.duels[dk] ??= { n: 0, atk: 0, dist: 0 });
          d.n++; if (e.winnerSide === "attack") d.atk++; d.dist += e.distanceMeters;
        }
      }
    }
  }
}
void add;
const f = (v: number) => v.toFixed(3);
const med = (xs: number[]) => (xs.sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? 0) / 1000;
for (const [k, x] of Object.entries(acc)) {
  if (x.n === 0) continue;
  console.log(`== ${k}  n=${x.n} atkWin=${f(x.atk / x.n)}  ` + Object.entries(x.reasons).sort().map(([r, v]) => `${r}=${f(v / x.n)}`).join(" "));
  console.log(`   plant=${f(x.plant / x.n)} postPlantAtk=${f(x.ppAtk / Math.max(1, x.ppN))} plantP50=${med(x.plantMs)}s  fkAtk=${f(x.fkAtk / x.fk)} win|fkAtk=${f(x.winFkAtk / Math.max(1, x.fkAtk))} win|fkDef=${f(x.winFkDef / Math.max(1, x.fk - x.fkAtk))} fkP50=${med(x.fkMs)}s`);
  console.log(`   kills/round A=${(x.killsA / x.n).toFixed(2)} D=${(x.killsD / x.n).toFixed(2)} tradeShare=${f(x.trades / Math.max(1, x.deaths))} loadout A=${Math.round(x.loadA / x.n)} D=${Math.round(x.loadD / x.n)} armor A=${(x.armorA / x.n).toFixed(1)} D=${(x.armorD / x.n).toFixed(1)}`);
  if (k === "pistol") console.log(`   weapons ${Object.entries(x.weapons).sort().map(([w, c]) => `${w}=${c}`).join(" ")}`);
  for (const [dk, d] of Object.entries(x.duels).sort()) if (d.n >= 20) console.log(`   duel ${dk.padEnd(24)} n=${String(d.n).padStart(5)} atk=${f(d.atk / d.n)} dist=${(d.dist / d.n).toFixed(1)}m`);
}
