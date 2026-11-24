// Calibrates the quick series estimate (packages/career quick-sim.ts) against the match engine.
//
// 1. Plays N Bo3 series through match-runner (runSeries: veto, map mastery, every map) between
//    random teams of the four regions, with their career fives as rosters.
// 2. Fits, by maximum likelihood over every ROUND of every map, the round-win logit
//        logit P(A wins a round) = roundSlope · (s_A − s_B) + mapSlope · (share_A − share_B) + b
//    where s is the lineup ability (QUICK_SIM's lineupStrength) and share the shrunk real map win
//    share on the map that was played (QUICK_SIM's mapShare). b absorbs the attack-first side effect.
// 3. Validates at SERIES level: for each engine series the quick model's P(A wins the series) is
//    estimated from 300 quickSeries runs on the same pair; reports the Brier score of the quick
//    model, of the constant 0.5, the log-loss, and a calibration table by predicted probability.
//
//   npx tsx tools/career/calibrate-quick-sim.mts [series=60] [seed=2026]
// Heavy (≈ 3 s per series): run through /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh.
import { runSeries } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData, mapRecordsFromGameData } from '../../packages/career/src/game-data.ts';
import {
  lineupStrength, mapShare, matchRoster, mulberry32, newCareer, quickSeries, regionTeams, REGIONS, seriesRequest, setMapRecords,
  lineupFor, type Fixture,
} from '../../packages/career/src/index.ts';

const N = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 2026);
setMapRecords(mapRecordsFromGameData());
const w = worldFromGameData(seed);
const c = newCareer(w, { seed, manager: { name: 'cal', nationality: 'kr' }, userTeamId: regionTeams(w, 'pacific')[0]! });
const rng = mulberry32(seed);
const teams = REGIONS.flatMap((r) => regionTeams(c.world, r).slice(0, 12));

interface Row { d: number; m: number; won: number; lost: number }
const rows: Row[] = [];
const series: Array<{ a: string; b: string; winA: number; req: ReturnType<typeof seriesRequest> }> = [];
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const a = teams[Math.floor(rng() * teams.length)]!;
  let b = a; while (b === a) b = teams[Math.floor(rng() * teams.length)]!;
  const fx = { id: `cal-${i}`, season: 2026, stage: 'stage1', phase: 'group', round: 1, date: '2026-03-06', format: 'bo3', home: a, away: b } as Fixture;
  const req = seriesRequest(c, fx);
  const res = runSeries({
    teamA: { id: a, name: a, scouting: false, roster: matchRoster(c, lineupFor(c, a)) as never },
    teamB: { id: b, name: b, scouting: false, roster: matchRoster(c, lineupFor(c, b)) as never },
    format: 'bo3', seed: seed * 1000 + i,
  });
  const dA = lineupStrength(c, req.home.lineup) - lineupStrength(c, req.away.lineup);
  for (const g of res.games) {
    const ma = mapShare(a, g.map); const mb = mapShare(b, g.map);
    rows.push({ d: dA, m: ma !== null && mb !== null ? ma - mb : 0, won: g.score.A, lost: g.score.B });
  }
  series.push({ a, b, winA: res.winner === 'A' ? 1 : 0, req });
  process.stderr.write(`${i + 1}/${N} d=${dA.toFixed(3)} ${res.score.A}-${res.score.B}\n`);
}
const secPerSeries = (Date.now() - t0) / 1000 / N;

// Newton–Raphson MLE for (k, mq, b) over rounds.
let th = [0, 0, 0];
for (let it = 0; it < 100; it++) {
  const g = [0, 0, 0]; const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const r of rows) {
    const x = [r.d, r.m, 1];
    const p = 1 / (1 + Math.exp(-(th[0]! * x[0]! + th[1]! * x[1]! + th[2]!)));
    const n = r.won + r.lost; const v = n * p * (1 - p);
    for (let i = 0; i < 3; i++) { g[i]! += (r.won - n * p) * x[i]!; for (let j = 0; j < 3; j++) H[i]![j]! += v * x[i]! * x[j]!; }
  }
  // solve H · step = g (3×3 Gauss)
  const A = H.map((row, i) => [...row, g[i]!]);
  for (let i = 0; i < 3; i++) {
    let p = i; for (let r = i + 1; r < 3; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[p]![i]!)) p = r;
    [A[i], A[p]] = [A[p]!, A[i]!];
    for (let r = i + 1; r < 3; r++) { const f = A[r]![i]! / A[i]![i]!; for (let c2 = i; c2 < 4; c2++) A[r]![c2]! -= f * A[i]![c2]!; }
  }
  const step = [0, 0, 0];
  for (let i = 2; i >= 0; i--) { let s = A[i]![3]!; for (let j = i + 1; j < 3; j++) s -= A[i]![j]! * step[j]!; step[i] = s / A[i]![i]!; }
  th = th.map((v, i) => v + step[i]!);
  if (Math.hypot(...step) < 1e-9) break;
}
// Standard errors from the inverse information (3×3 inverse of H at the solution).
const cov = (() => {
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const r of rows) {
    const x = [r.d, r.m, 1];
    const p = 1 / (1 + Math.exp(-(th[0]! * x[0]! + th[1]! * x[1]! + th[2]!)));
    const v = (r.won + r.lost) * p * (1 - p);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i]![j]! += v * x[i]! * x[j]!;
  }
  const a = H; const det = a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const c00 = (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) / det; const c11 = (a[0]![0]! * a[2]![2]! - a[0]![2]! * a[2]![0]!) / det;
  return [Math.sqrt(c00), Math.sqrt(c11)];
})();

// Series-level validation of the quick model with the constants currently in quick-sim.ts.
let brierQ = 0; let brier5 = 0; let ll = 0;
const bins = [0, 0.3, 0.45, 0.55, 0.7, 1.0001].map((lo, i, a) => ({ lo, hi: a[i + 1] ?? 1.0001, n: 0, pred: 0, obs: 0 })).slice(0, 5);
for (const s of series) {
  let wins = 0;
  for (let k = 0; k < 300; k++) if (quickSeries({ ...s.req, seed: s.req.seed + k * 7919 }, c).winner === s.a) wins += 1;
  const p = Math.min(0.995, Math.max(0.005, wins / 300));
  brierQ += (p - s.winA) ** 2; brier5 += (0.5 - s.winA) ** 2; ll += -(s.winA ? Math.log(p) : Math.log(1 - p));
  const bin = bins.find((b) => p >= b.lo && p < b.hi)!;
  bin.n += 1; bin.pred += p; bin.obs += s.winA;
}
const sd = Math.sqrt(rows.reduce((s, r) => s + r.d * r.d, 0) / rows.length);
console.log(JSON.stringify({
  series: N, maps: rows.length, secondsPerEngineSeries: Number(secPerSeries.toFixed(2)),
  fit: { roundSlope: Number(th[0]!.toFixed(2)), roundSlopeSE: Number(cov[0]!.toFixed(2)), mapSlope: Number(th[1]!.toFixed(2)), mapSlopeSE: Number(cov[1]!.toFixed(2)), intercept: Number(th[2]!.toFixed(3)), sdAbilityDiff: Number(sd.toFixed(4)) },
  seriesValidation: {
    brierQuick: Number((brierQ / N).toFixed(4)), brierConstantHalf: Number((brier5 / N).toFixed(4)), logLoss: Number((ll / N).toFixed(4)),
    meanPredicted: Number((series.length ? bins.reduce((s, b) => s + b.pred, 0) / N : 0).toFixed(3)), meanObserved: Number((series.reduce((s, x) => s + x.winA, 0) / N).toFixed(3)),
    calibration: bins.filter((b) => b.n).map((b) => ({ predicted: `${b.lo}–${Math.min(1, b.hi)}`, n: b.n, meanPredicted: Number((b.pred / b.n).toFixed(3)), observed: Number((b.obs / b.n).toFixed(3)) })),
  },
}, null, 2));
