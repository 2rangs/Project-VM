/**
 * Before/after proof that single-map `runMatch` is unchanged: prints one SHA-256 per (teams, seed)
 * over everything a match produces that is not a replay blob — score, per-round winner / reason /
 * buys / kills / economy, every sim event and both teams' plans and opponent reads.
 *
 *   npx tsx scripts/match-signature.mts            # from packages/match-runner
 *
 * Run it at the commit before a change and after it; identical output = identical matches.
 */
import { createHash } from "node:crypto";
import { listSimulatableTeams } from "@pv/game-data";
import { runMatch } from "../src/index.js";

const teams = listSimulatableTeams();
const pairs: Array<[number, number, number]> = [[0, 1, 1], [2, 3, 7], [4, 5, 42], [10, 20, 1234], [30, 6, 99]];
const all = createHash("sha256");
for (const [i, j, seed] of pairs) {
  const a = teams[i]!, b = teams[j]!;
  // --no-mid-control: mid as a label only (MatchConfig.midControl false) — must equal the signature from before mid control existed
  const r = runMatch({ teamA: { id: a.teamId, name: a.name ?? a.teamId }, teamB: { id: b.teamId, name: b.name ?? b.teamId }, map: "Ascent", seed, ...(process.argv.includes("--no-mid-control") ? { midControl: false } : {}) });
  const body = JSON.stringify({
    winner: r.winner, score: r.score, ot: r.wentToOvertime, memory: r.memory,
    rounds: r.rounds.map((x) => ({ n: x.roundNumber, a: x.attacker, w: x.winner, why: x.reason, buys: x.buys, kills: x.kills, eco: x.economy, events: x.events, decisions: x.decisions })),
  });
  const h = createHash("sha256").update(body).digest("hex");
  all.update(h);
  console.log(`${a.teamId} vs ${b.teamId} seed ${seed}: ${r.score.A}-${r.score.B} ${h.slice(0, 16)}`);
}
console.log(`ALL ${all.digest("hex")}`);
