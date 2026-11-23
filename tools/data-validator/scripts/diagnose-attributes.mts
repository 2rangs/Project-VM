// PROJECT V — which player attributes move the attack/defense balance? (diagnosis for recalibration)
//
// Plays the same seeds and the same team pairings as sim-batch under rosters built from the real
// game-data players, changing ONE thing at a time:
//   mirror     every rating at the 0.6 fallback (the pre-2026-11-23 batch condition)
//   mean       every player identical, each rating at the league mean of the real first-fives
//   only:<k>   real players, but every rating except <k> at 0.6 (what <k>'s real distribution does)
//   but:<k>    real players with <k> alone at 0.6 (what removing <k>'s distribution undoes)
//   real       real players (the sim-batch default)
// and prints attack round win rate, first-kill attack share, plant rate and the outcome mix per
// condition. Report-only — it changes nothing.
//
//   npx tsx tools/data-validator/scripts/diagnose-attributes.mts --matches 60 [--conditions mirror,mean,real,only:aim]
//   (wrap in the heavy-run lock: /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh "<label>" -- ...)

import { getPlayer, getTeam } from "../../../packages/game-data/src/index.ts";
import { runMatch, simulatableTeamRefs, type MatchConfig, type RosterPlayer, type TeamRef } from "../../../packages/match-runner/src/index.ts";

const KEYS = ["aim", "reaction", "tracking", "firstBulletAccuracy", "crosshairPlacement", "movement", "weaponControl",
  "impact", "trading", "clutch", "entryAggression", "consistency"] as const;

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1]!.startsWith("--") ? all[i + 1]! : "true"]] : acc), []));
const matches = Number(args["matches"] ?? 60);
const seedStart = Number(args["seed-start"] ?? 1);
const conditions = String(args["conditions"] ?? ["mirror", "mean", "real", ...KEYS.slice(0, 5).map((k) => `only:${k}`), "only:impact", "only:trading", "only:clutch", "only:entryAggression", "only:consistency"].join(",")).split(",");

const teams: TeamRef[] = simulatableTeamRefs();
const firstFive = (id: string) => (getTeam(id)?.roster ?? []).map((r) => getPlayer(r.playerId)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 5);
const val = (p: { attributes: unknown; hasRatings: boolean }, k: string): number | null => {
  const v = (p.attributes as Record<string, { value?: number } | undefined>)?.[k]?.value;
  return p.hasRatings && typeof v === "number" ? v : null;
};
// league mean of each rating over every team's first five (what an "average real player" is)
const leagueMean: Record<string, number> = {};
for (const k of KEYS) {
  const vs = teams.flatMap((t) => firstFive(t.id)).map((p) => val(p, k)).filter((v): v is number => v !== null);
  leagueMean[k] = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 0.6;
}

function rosterFor(teamId: string, cond: string): RosterPlayer[] {
  return firstFive(teamId).map((p, i) => {
    const attrs: Record<string, { value: number }> = {};
    for (const k of KEYS) {
      const real = val(p, k) ?? 0.6;
      let v = real;
      if (cond === "mirror") v = 0.6;
      else if (cond === "mean") v = leagueMean[k]!;
      else if (cond.startsWith("only:")) v = k === cond.slice(5) ? real : 0.6;
      else if (cond.startsWith("but:")) v = k === cond.slice(4) ? 0.6 : real;
      attrs[k] = { value: v };
    }
    return { playerId: `${p.playerId}#${i}`, attributes: attrs as never, hasRatings: true };
  });
}

console.error(`league means: ${KEYS.map((k) => `${k} ${leagueMean[k]!.toFixed(3)}`).join(" · ")}`);
console.log(["condition", "rounds", "attackWin", "fkAttack", "plant", "elim", "detonated", "defused", "timeout", "postPlantAtk", "forceSideWin"].join("\t"));
for (const cond of conditions) {
  let n = 0, atk = 0, fkA = 0, fk = 0, plant = 0, plantAtk = 0, force = 0, forceWins = 0;
  const reasons: Record<string, number> = {};
  for (let i = 0; i < matches; i++) {
    const teamA = teams[(2 * i) % teams.length]!, teamB = teams[(2 * i + 1) % teams.length]!;
    const config: MatchConfig = { teamA, teamB, map: "Ascent", seed: seedStart + i, rosters: { A: rosterFor(teamA.id, cond), B: rosterFor(teamB.id, cond) } };
    for (const r of runMatch(config).rounds) {
      n++;
      if (r.winnerSide === "attack") atk++;
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      const k = r.events.find((e) => e.kind === "kill");
      if (k) { fk++; if (k.actor?.startsWith("atk")) fkA++; }
      if (r.planted) { plant++; if (r.winnerSide === "attack") plantAtk++; }
      const def = r.attacker === "A" ? "B" : "A";
      const tA = r.buys[r.attacker].tier, tD = r.buys[def].tier;
      if ((tA === "force" && tD === "full") || (tA === "full" && tD === "force")) { force++; if ((tA === "force") === (r.winnerSide === "attack")) forceWins++; }
    }
  }
  const f = (x: number) => x.toFixed(3);
  console.log([cond, n, f(atk / n), f(fkA / fk), f(plant / n), f((reasons.elimination ?? 0) / n), f((reasons.spikeDetonation ?? 0) / n), f((reasons.spikeDefused ?? 0) / n), f((reasons.timeExpired ?? 0) / n), f(plantAtk / Math.max(1, plant)), f(forceWins / Math.max(1, force))].join("\t"));
}
