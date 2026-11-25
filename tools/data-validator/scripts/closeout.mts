// Attack close-out (report-only): rounds the attack loses on time while it still has the numbers.
// For each: man count at the end, spike state (carried / dropped / never picked), the attack's plan
// and its revisions, the defenders' weapons, and the last kill time. Real rosters, Ascent.
//   npx tsx tools/data-validator/scripts/closeout.mts --matches 40 [--seed-start 1] [--economy '{"ecoSidearms":true}'] [--tactics]
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../../packages/match-runner/src/index.ts";

const a: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) if (process.argv[i]!.startsWith("--")) a[process.argv[i]!.slice(2)] = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[++i]! : "true";
const teams = simulatableTeamRefs();
let n = 0, timeouts = 0, ahead = 0, vsEco = 0, vsEcoTimeouts = 0;
const spike: Record<string, number> = {}, strat: Record<string, number> = {};
const lines: string[] = [];
for (let i = 0; i < Number(a.matches ?? 40); i++) {
  const cfg = { teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]!, map: "Ascent", seed: Number(a["seed-start"] ?? 1) + i,
    ...(a.economy ? { economy: JSON.parse(a.economy) } : {}), ...(a.tactics ? { plantTactics: true } : {}) } as MatchConfig;
  for (const r of runMatch(cfg).rounds) {
    n++;
    const def = r.attacker === "A" ? "B" : "A";
    const eco = r.buys[r.attacker].tier === "full" && (r.buys[def].vctTier === "eco");
    if (eco) vsEco++;
    if (r.reason !== "timeExpired") continue;
    timeouts++;
    const kills = r.events.filter((e) => e.kind === "kill");
    const aDead = kills.filter((k) => String(k.target).startsWith("atk")).length, dDead = kills.filter((k) => String(k.target).startsWith("def")).length;
    const aAlive = 5 - aDead, dAlive = 5 - dDead;
    if (aAlive <= dAlive) continue;
    ahead++; if (eco) vsEcoTimeouts++;
    const ev = r.events.map((e) => e.kind);
    const state = ev.includes("plantStart") ? "plant-started" : ev.includes("spikePickup") ? "picked-up" : "carried";
    spike[state] = (spike[state] ?? 0) + 1;
    const plan = r.decisions.plans[r.attacker];
    const key = `${plan?.strategy ?? "?"}`;
    strat[key] = (strat[key] ?? 0) + 1;
    const lastKill = kills.at(-1)?.elapsedMs ?? 0;
    const defWeapons = r.buys[def].players.map((p) => p.weapon).join(",");
    const timeline = r.events.filter((e) => ["kill", "spikePickup", "plantStart", "planted"].includes(e.kind))
      .map((e) => `${(e.elapsedMs / 1000).toFixed(0)}s ${e.kind}${e.kind === "kill" ? ` ${e.actor}>${e.target}` : ` ${e.actor ?? ""}`}@${e.zoneId ?? ""}`).join(", ");
    const ends = r.replay.events.filter((e) => e.kind === "roundEnd").length;
    void ends;
    lines.push(`    timeline: ${timeline}`);
    lines.push(`  seed ${cfg.seed} r${r.roundNumber} ${aAlive}v${dAlive} ${eco ? "vsEco " : ""}spike=${state} plan=${plan?.opening}->${plan?.strategy} obj=${plan?.objective} lastKill=${(lastKill / 1000).toFixed(0)}s def=[${defWeapons}] revisions=${(plan?.revisions ?? []).map((v) => `${v.to}@${Math.round(v.atMs / 1000)}s`).join(">")}`);
  }
}
console.log(`rounds=${n} timeExpired=${timeouts} withAttackAhead=${ahead} fullVsEco=${vsEco} fullVsEcoAheadTimeouts=${vsEcoTimeouts}`);
console.log(`spike: ${JSON.stringify(spike)} final strategy: ${JSON.stringify(strat)}`);
for (const l of lines.slice(0, Number(a.show ?? 30))) console.log(l);
