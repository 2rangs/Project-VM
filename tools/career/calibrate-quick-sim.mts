// Calibrates the quick series estimate (packages/career quick-sim.ts QUICK_SIM.roundSlope) against
// the match engine: plays N maps through match-runner between league teams of a career world (their
// starting fives as MatchConfig.rosters) and fits the logistic slope of the round share on the
// lineup-strength difference by maximum likelihood (rounds as Bernoulli trials).
//   npx tsx tools/career/calibrate-quick-sim.mts [maps=48] [seed=2026]
// Heavy (≈4 s per map): run through /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh.
import { runMatch } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData } from '../../packages/career/src/game-data.ts';
import { batchOf, lineupStrength, newCareer, quickSeries, regionTeams, startingFive, mulberry32, REGIONS } from '../../packages/career/src/index.ts';

const N = Number(process.argv[2] ?? 48);
const seed = Number(process.argv[3] ?? 2026);
const w = worldFromGameData(seed);
const user = regionTeams(w, 'pacific')[0]!;
const c = newCareer(w, { seed, manager: { name: 'cal', nationality: 'kr' }, userTeamId: user });
const rng = mulberry32(seed);
const teams = REGIONS.flatMap((r) => regionTeams(c.world, r).slice(0, 12));
const rows: Array<{ d: number; won: number; lost: number }> = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const a = teams[Math.floor(rng() * teams.length)]!;
  let b = a; while (b === a) b = teams[Math.floor(rng() * teams.length)]!;
  const fa = startingFive(c.world, a); const fb = startingFive(c.world, b);
  const m = runMatch({ teamA: { id: a, name: a }, teamB: { id: b, name: b }, map: 'ascent', seed: seed * 100 + i, rosters: { A: fa, B: fb } });
  const d = lineupStrength(c, fa.map((p) => p.playerId)) - lineupStrength(c, fb.map((p) => p.playerId));
  rows.push({ d, won: m.score.A, lost: m.score.B });
  process.stderr.write(`${i + 1}/${N} d=${d.toFixed(3)} ${m.score.A}-${m.score.B}\n`);
}
const msPerMap = (Date.now() - t0) / N;
// MLE of P(round) = sigmoid(k·d + b) (b absorbs the attack-first side bias, expected ≈ 0).
let k = 0; let b = 0;
for (let it = 0; it < 200; it++) {
  let gk = 0; let gb = 0; let hkk = 0; let hkb = 0; let hbb = 0;
  for (const r of rows) {
    const p = 1 / (1 + Math.exp(-(k * r.d + b)));
    const n = r.won + r.lost;
    gk += (r.won - n * p) * r.d; gb += r.won - n * p;
    const v = n * p * (1 - p);
    hkk += v * r.d * r.d; hkb += v * r.d; hbb += v;
  }
  const det = hkk * hbb - hkb * hkb;
  if (Math.abs(det) < 1e-12) break;
  k += (hbb * gk - hkb * gb) / det; b += (hkk * gb - hkb * gk) / det;
}
const share = rows.reduce((s, r) => s + r.won, 0) / rows.reduce((s, r) => s + r.won + r.lost, 0);
const spread = Math.sqrt(rows.reduce((s, r) => s + r.d * r.d, 0) / rows.length);
// Quick estimate on the same pairs for comparison (map win rate of the stronger side).
const quickWins = rows.map((r) => r.d).length;
void quickWins; void batchOf; void quickSeries;
console.log(JSON.stringify({ maps: N, msPerMap: Math.round(msPerMap), roundSlope: Number(k.toFixed(3)), intercept: Number(b.toFixed(3)), roundShareA: Number(share.toFixed(3)), sdStrengthDiff: Number(spread.toFixed(4)) }, null, 2));
