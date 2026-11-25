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
// 4. Scans the per-map form noise σ (QUICK_SIM.mapNoiseSd) and the round slope on the same cached
//    engine series and reports the log-loss for each; the committed constants are the minimum.
//
//   npx tsx tools/career/calibrate-quick-sim.mts [series=120] [seed=2026] [--refit]
// The engine series are cached in tools/career/calibration-data.json (committed): without --refit a
// run only re-fits and re-validates against the cached engine results (seconds). --refit replays the
// engine (≈ 3.5 s per series; heavy: run through /Users/yi-rang/ProjectV-assets/tools/heavy-run.sh).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSeries } from '../../packages/match-runner/src/index.ts';
import { worldFromGameData, mapRecordsFromGameData } from '../../packages/career/src/game-data.ts';
import {
  lineupStrength, mapShare, matchRoster, mulberry32, newCareer, quickSeries, regionTeams, REGIONS, seriesRequest, setMapRecords,
  lineupFor, quickSeriesWith, QUICK_SIM, type Fixture,
} from '../../packages/career/src/index.ts';

const N = Number(process.argv[2] ?? 120);
const seed = Number(process.argv[3] ?? 2026);
const REFIT = process.argv.includes('--refit');
// Sharding for a parallel refit (tools/career/refit-quick-sim.sh): --shard=i/n generates only the
// series whose global index ≡ i (mod n), with an independent team-draw stream per shard but globally
// unique match seeds (seed·1000 + i), and --gen-only writes the shard cache and stops before the fit.
// The shells merge the shard caches into one file keyed by `seed`, then run fit-quick-sim.mts.
const shardArg = process.argv.find((a) => a.startsWith('--shard='));
const [shardIdx, shardCount] = shardArg ? shardArg.split('=')[1]!.split('/').map(Number) as [number, number] : [0, 1];
const GEN_ONLY = process.argv.includes('--gen-only');
// Cache path: PV_CALIBRATION_DATA (absolute or repo-root-relative) overrides the committed small set,
// so a large regenerated set never clobbers it (tools/career/refit-quick-sim.sh).
const { resolve: resolvePath } = await import('node:path');
const CACHE = process.env.PV_CALIBRATION_DATA
  ? new URL(`file://${resolvePath(process.env.PV_CALIBRATION_DATA)}`)
  : new URL('./calibration-data.json', import.meta.url);
setMapRecords(mapRecordsFromGameData());
const w = worldFromGameData(seed);
const c = newCareer(w, { seed, manager: { name: 'cal', nationality: 'kr' }, userTeamId: regionTeams(w, 'pacific')[0]! });
const rng = mulberry32(seed + shardIdx * 1_000_003);
const teams = REGIONS.flatMap((r) => regionTeams(c.world, r).slice(0, 12));

interface Row { d: number; m: number; won: number; lost: number }
interface Played { a: string; b: string; winA: number; req: ReturnType<typeof seriesRequest>; games: Array<{ map: string; A: number; B: number }> }
let played: Played[];
const cachePath = fileURLToPath(CACHE);
if (!REFIT && existsSync(cachePath)) {
  const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as { seed: number; played: Played[] };
  if (cached.seed !== seed) throw new Error(`cache is for seed ${cached.seed}`);
  played = cached.played;
  process.stderr.write(`using ${played.length} cached engine series\n`);
} else {
  played = [];
  const t0 = Date.now();
  let done = 0;
  for (let i = shardIdx; i < N; i += shardCount) {
    const a = teams[Math.floor(rng() * teams.length)]!;
    let b = a; while (b === a) b = teams[Math.floor(rng() * teams.length)]!;
    const fx = { id: `cal-${i}`, season: 2026, stage: 'stage1', phase: 'group', round: 1, date: '2026-03-06', format: 'bo3', home: a, away: b } as Fixture;
    const req = seriesRequest(c, fx);
    const res = runSeries({
      teamA: { id: a, name: a, scouting: false, roster: matchRoster(c, lineupFor(c, a)) as never },
      teamB: { id: b, name: b, scouting: false, roster: matchRoster(c, lineupFor(c, b)) as never },
      format: 'bo3', seed: seed * 1000 + i,
    });
    played.push({ a, b, winA: res.winner === 'A' ? 1 : 0, req, games: res.games.map((g) => ({ map: g.map, A: g.score.A, B: g.score.B })) });
    done += 1;
    process.stderr.write(`shard ${shardIdx}/${shardCount}: ${done} (series ${i}) ${res.score.A}-${res.score.B}\n`);
  }
  writeFileSync(cachePath, JSON.stringify({ seed, engineSecondsPerSeries: Number(((Date.now() - t0) / 1000 / Math.max(1, played.length)).toFixed(2)), played }));
  if (GEN_ONLY) { process.stderr.write(`shard ${shardIdx}/${shardCount}: wrote ${played.length} series to ${cachePath}\n`); process.exit(0); }
}
const secPerSeries = Number((JSON.parse(readFileSync(cachePath, 'utf8')) as { engineSecondsPerSeries: number }).engineSecondsPerSeries);
const rows: Row[] = [];
const series = played;
for (const p of played) {
  const dA = lineupStrength(c, p.req.home.lineup) - lineupStrength(c, p.req.away.lineup);
  for (const g of p.games) {
    const ma = mapShare(p.a, g.map); const mb = mapShare(p.b, g.map);
    rows.push({ d: dA, m: ma !== null && mb !== null ? ma - mb : 0, won: g.A, lost: g.B });
  }
}

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

// Series-level validation of the quick model: P(A wins the series) from REPS quickSeries runs.
const REPS = 200;
function validate(tuning: { roundSlope?: number; mapNoiseSd?: number }, withBins = false) {
  let brierQ = 0; let ll = 0;
  const bins = [0, 0.3, 0.45, 0.55, 0.7].map((lo, i, a) => ({ lo, hi: a[i + 1] ?? 1.0001, n: 0, pred: 0, obs: 0 }));
  for (const s of series) {
    let wins = 0;
    for (let k = 0; k < REPS; k++) if (quickSeriesWith({ ...s.req, seed: s.req.seed + k * 7919 }, c, tuning).winner === s.a) wins += 1;
    const p = Math.min(0.99, Math.max(0.01, wins / REPS));
    brierQ += (p - s.winA) ** 2; ll += -(s.winA ? Math.log(p) : Math.log(1 - p));
    if (withBins) { const bin = bins.find((b) => p >= b.lo && p < b.hi)!; bin.n += 1; bin.pred += p; bin.obs += s.winA; }
  }
  return { brier: brierQ / series.length, logLoss: ll / series.length, bins };
}
const scan: Array<{ roundSlope: number; mapNoiseSd: number; logLoss: number; brier: number }> = [];
for (const roundSlope of [Math.round(th[0]! * 10) / 10, QUICK_SIM.roundSlope, 6.5]) {
  for (const mapNoiseSd of [0, 0.15, 0.3, 0.45, 0.6]) {
    const v = validate({ roundSlope, mapNoiseSd });
    scan.push({ roundSlope, mapNoiseSd, logLoss: Number(v.logLoss.toFixed(4)), brier: Number(v.brier.toFixed(4)) });
  }
}
const best = [...scan].sort((a, b) => a.logLoss - b.logLoss)[0]!;
const cur = validate({}, true);
const brier5 = series.reduce((s, x) => s + (0.5 - x.winA) ** 2, 0) / series.length;
const sd = Math.sqrt(rows.reduce((s, r) => s + r.d * r.d, 0) / rows.length);
console.log(JSON.stringify({
  series: played.length, maps: rows.length, secondsPerEngineSeries: secPerSeries,
  fit: { roundSlope: Number(th[0]!.toFixed(2)), roundSlopeSE: Number(cov[0]!.toFixed(2)), mapSlope: Number(th[1]!.toFixed(2)), mapSlopeSE: Number(cov[1]!.toFixed(2)), intercept: Number(th[2]!.toFixed(3)), sdAbilityDiff: Number(sd.toFixed(4)) },
  committed: { roundSlope: QUICK_SIM.roundSlope, mapSlope: QUICK_SIM.mapSlope, mapNoiseSd: QUICK_SIM.mapNoiseSd },
  seriesValidation: {
    brierQuick: Number(cur.brier.toFixed(4)), brierConstantHalf: Number(brier5.toFixed(4)), logLoss: Number(cur.logLoss.toFixed(4)),
    meanPredicted: Number((cur.bins.reduce((s, b) => s + b.pred, 0) / played.length).toFixed(3)), meanObserved: Number((series.reduce((s, x) => s + x.winA, 0) / played.length).toFixed(3)),
    calibration: cur.bins.filter((b) => b.n).map((b) => ({ predicted: `${b.lo}–${Math.min(1, b.hi)}`, n: b.n, meanPredicted: Number((b.pred / b.n).toFixed(3)), observed: Number((b.obs / b.n).toFixed(3)) })),
  },
  scan, best,
}, null, 2));
