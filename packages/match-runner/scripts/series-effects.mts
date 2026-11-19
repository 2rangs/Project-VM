/**
 * Effect sizes of the series layer (docs/SERIES_AND_VETO.md §6). Counterfactuals: every pair of
 * conditions shares its seeds and differs in ONE input.
 *
 *   npx tsx scripts/series-effects.mts mastery  1 200
 *   npx tsx scripts/series-effects.mts scouting 1 200 off,maps,full
 *   npx tsx scripts/series-effects.mts scouting 1 200 break-off,break-full
 *   PV_HABIT=30 npx tsx scripts/series-effects.mts scouting 1 200 off,full      (a more stubborn habit)
 *
 * Teams (game-data ids): mastery — Paper Rex (624) vs MIBR (7386), near even on Ascent.
 * scouting — FURIA (2406, the weaker side, ~0.30 map win rate) vs Global Esports (918).
 */
import { listSimulatableTeams } from "@pv/game-data";
import {
  DEFAULT_MAP_POOL, gamePlanPrior, leagueMasteryReference, masteryEngineInputs, runMatch, runSeries, teamGameLog,
  type GamePlan, type SeriesConfig, type SeriesResult, type TeamGameLog,
} from "../src/index.js";

const [exp = "mastery", fromArg = "1", toArg = "200", condArg] = process.argv.slice(2);
const from = Number(fromArg), to = Number(toArg);
const n = to - from + 1;
const pct = (x: number): string => (100 * x).toFixed(1);
/** 95% half-width of a proportion. */
const ci = (p: number, m: number): string => `±${(196 * Math.sqrt((p * (1 - p)) / Math.max(1, m))).toFixed(1)}`;

if (exp === "mastery") {
  const a = { id: "624", name: "Paper Rex" }, b = { id: "7386", name: "MIBR" };
  const ref = leagueMasteryReference(DEFAULT_MAP_POOL);
  console.log(`mastery → map result. ${a.name} vs ${b.name}, Ascent, seeds ${from}..${to}, sides alternate by seed. M0 = ${ref.toFixed(3)}; opponent at M0.`);
  for (const d of [-0.25, 0, 0.25]) {
    let wins = 0, rounds = 0, roundsWon = 0;
    for (let seed = from; seed <= to; seed++) {
      const flip = seed % 2 === 0;
      const slot = flip ? "B" : "A";
      const r = runMatch({ teamA: flip ? b : a, teamB: flip ? a : b, map: "Ascent", seed, teamInputs: { [slot]: masteryEngineInputs(ref + d, ref).inputs } });
      if (r.winner === slot) wins++;
      rounds += r.rounds.length;
      roundsWon += r.score[slot];
    }
    console.log(`  d=${d >= 0 ? "+" : ""}${d.toFixed(2)}  map win ${pct(wins / n)}% ${ci(wins / n, n)}   round share ${pct(roundsWon / rounds)}% ${ci(roundsWon / rounds, rounds)}   (n=${n} maps, ${rounds} rounds)`);
  }
} else {
  const A = { id: "2406", name: "FURIA" }, B = { id: "918", name: "Global Esports" };
  /** How stubborn B's habit is (standing pseudo-observations). PV_HABIT overrides the default 8. */
  const strength = Number(process.env.PV_HABIT ?? 8);
  const habit: GamePlan = { attack: { site: "A", strength }, defense: { site: "A", strength } };
  const broken: GamePlan = { attack: { site: "B", strength }, defense: { site: "B", strength } };
  // B's observable history: seven games against other teams (one per pool map), played with its habit.
  const others = listSimulatableTeams().filter((t) => t.teamId !== A.id && t.teamId !== B.id).slice(0, DEFAULT_MAP_POOL.length);
  const history: TeamGameLog[] = others.map((o, k) => {
    const r = runMatch({ teamA: B, teamB: { id: o.teamId, name: o.name ?? o.teamId }, map: DEFAULT_MAP_POOL[k % DEFAULT_MAP_POOL.length]!, seed: 9000 + k, teamInputs: { A: { standingPrior: gamePlanPrior(habit)! } } });
    return teamGameLog(r, "A");
  });
  const conditions: Record<string, (seed: number) => SeriesConfig> = {
    "off": (seed) => ({ teamA: { ...A, scouting: false }, teamB: { ...B, scouting: false, gamePlan: habit, history }, seed }),
    "maps": (seed) => ({ teamA: { ...A, staff: { analyst: 1 } }, teamB: { ...B, scouting: false, gamePlan: habit, history: [] }, seed }),
    "full": (seed) => ({ teamA: { ...A, staff: { analyst: 1 } }, teamB: { ...B, scouting: false, gamePlan: habit, history }, seed }),
    "break-off": (seed) => ({ teamA: { ...A, scouting: false }, teamB: { ...B, scouting: false, gamePlan: broken, history }, seed }),
    "break-full": (seed) => ({ teamA: { ...A, staff: { analyst: 1 } }, teamB: { ...B, scouting: false, gamePlan: broken, history }, seed }),
  };
  const which = (condArg ?? Object.keys(conditions).join(",")).split(",");
  console.log(`scouting. ${A.name} (A, scouts) vs ${B.name} (B, habit: attack A / stack A, strength ${strength}), Bo3, seeds ${from}..${to}.`);
  console.log(`B's history: ${history.length} games; attack-site evidence share A = ${pct(history.flatMap((h) => h.rounds).filter((r) => r.plantSite === "A").length / Math.max(1, history.flatMap((h) => h.rounds).filter((r) => r.plantSite).length))}% of plants.`);
  const vetoKey = (r: SeriesResult): string => r.veto.actions.map((a) => `${a.kind}:${a.map}:${a.side ?? ""}`).join("|");
  for (const name of which) {
    const make = conditions[name]!;
    let series = 0, maps = 0, mapsWon = 0, rounds = 0, roundsWon = 0;
    let early = 0, earlyWon = 0, defOpen = 0, defStackA = 0, defStackB = 0, atkOpen = 0, atkToA = 0, atkToB = 0;
    const vetoes = new Map<string, number>();
    for (let seed = from; seed <= to; seed++) {
      const r = runSeries(make(seed));
      if (r.winner === "A") series++;
      vetoes.set(vetoKey(r), (vetoes.get(vetoKey(r)) ?? 0) + 1);
      for (const g of r.games) {
        maps++;
        if (g.winner === "A") mapsWon++;
        const slot = g.slots.A;
        let nDef = 0, nAtk = 0;
        for (const rd of g.match.rounds) {
          rounds++;
          if (rd.winner === slot) roundsWon++;
          const attacking = rd.attacker === slot;
          const plan = rd.decisions.plans[slot];
          // The first four rounds A plays on each side: where a prior matters before the match teaches it.
          if (attacking ? nAtk < 4 : nDef < 4) { early++; if (rd.winner === slot) earlyWon++; }
          if (!attacking && nDef++ < 4) { defOpen++; if (plan?.opening === "stackA") defStackA++; if (plan?.opening === "stackB") defStackB++; }
          if (attacking && nAtk++ < 4) { atkOpen++; if (plan?.opening === "aExecute" || plan?.opening === "fakeBtoA") atkToA++; if (plan?.opening === "bExecute" || plan?.opening === "fakeAtoB") atkToB++; }
        }
      }
    }
    const topVeto = [...vetoes.entries()].sort((x, y) => y[1] - x[1])[0]!;
    console.log(`  [${name}] series ${pct(series / n)}% ${ci(series / n, n)} | maps ${pct(mapsWon / maps)}% ${ci(mapsWon / maps, maps)} (n=${maps}) | rounds ${pct(roundsWon / rounds)}% ${ci(roundsWon / rounds, rounds)} (n=${rounds}) | early rounds ${pct(earlyWon / early)}% ${ci(earlyWon / early, early)} (n=${early})`);
    console.log(`      A's early defense openings: stackA ${pct(defStackA / defOpen)}% stackB ${pct(defStackB / defOpen)}% | early attack openings: to A ${pct(atkToA / atkOpen)}% to B ${pct(atkToB / atkOpen)}%`);
    console.log(`      veto (${vetoes.size} distinct): ${topVeto[1]}× ${topVeto[0]}`);
  }
}
