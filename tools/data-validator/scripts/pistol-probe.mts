// Pistol-round probe: plays only round 1 of each pairing, both ways round, under several movement-style
// variants, and writes one JSON line per round (paired by seed) for ablation. Scratch tool, not wired into CI.
//   npx tsx tools/data-validator/scripts/pistol-probe.mts --seeds 1..600 --variants '{"off":{...},"all":true}' --out FILE
import { writeFileSync } from "node:fs";
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1]! : d; };
const [s0, s1] = arg("seeds", "1..200").split("..").map(Number);
const variants = JSON.parse(arg("variants", '{"off":false,"all":true}')) as Record<string, MatchConfig["movementStyle"]>;
const out = arg("out", "pistol.jsonl");
const teams = simulatableTeamRefs();
const lines: string[] = [];
const side = (id?: string) => (id?.startsWith("atk") ? "attack" : id?.startsWith("def") ? "defense" : undefined);
const t0 = Date.now();
for (const [name, style] of Object.entries(variants)) {
  let w = 0, n = 0;
  for (let s = s0!; s <= s1!; s++) {
    const i = s - 1;
    const A = teams[(2 * i) % teams.length]!, B = teams[(2 * i + 1) % teams.length]!;
    for (const [ta, tb, o] of [[A, B, 0], [B, A, 1]] as const) {
      const m = runMatch({ teamA: ta, teamB: tb, map: "Ascent", seed: s, maxRounds: 1, movementStyle: style });
      const r = m.rounds[0]!;
      const kills = r.events.filter((e) => e.kind === "kill");
      const fk = kills[0];
      const plant = r.events.find((e) => e.kind === "planted");
      const end = r.events.find((e) => e.kind === "roundEnd");
      lines.push(JSON.stringify({ v: name, s, o, win: r.winnerSide === "attack" ? 1 : 0, reason: r.reason,
        fkS: fk ? fk.elapsedMs / 1000 : null, fkAtk: fk ? (side(fk.actor as string) === "attack" ? 1 : 0) : null,
        plantS: plant ? plant.elapsedMs / 1000 : null, endS: (end?.elapsedMs ?? 0) / 1000,
        atkDead: kills.filter((k) => side(k.target as string) === "attack").length,
        defDead: kills.filter((k) => side(k.target as string) === "defense").length }));
      n++; w += r.winnerSide === "attack" ? 1 : 0;
    }
  }
  console.error(`${name}: pistol attack ${(w / n).toFixed(3)} (${w}/${n})  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
writeFileSync(out, lines.join("\n") + "\n");
