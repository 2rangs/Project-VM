// Fits and reports the quick series estimate on a (large) cached engine-series set — NO engine runs.
// This is the large-data companion to fit-quick-sim.mts: the maximum-likelihood fit is analytic and
// cheap, but fit-quick-sim.mts also runs a 5x5 cross-validation with 200-rep per-series simulation,
// which is ~100x too slow at ~1,100 series. Here the fit is run once per model, the calibration curve
// comes from a single in-sample simulation pass, the held-out check is one 50/50 split, and the
// standard errors come from a modest bootstrap — all bounded for thousands of series.
//
//   PV_CALIBRATION_DATA=<large cache> tsx tools/career/refit-report.mts [--bootstrap=24] [--reps=200]
// Output: JSON on stdout (tools/career/refit-quick-sim.sh writes it to tools/career/quick-sim-refit.json).
import { loadCalibration } from '../../packages/career/src/game-data.ts';
import {
  fitQuick, logLik, MODEL_KINDS, mulberry32, QUICK_SIM, quickSeriesWith, reliability, seriesLogLik,
  type FitSeries, type ModelKind, type QuickParams,
} from '../../packages/career/src/index.ts';

const arg = (name: string, def: number) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${def}`).split('=')[1]);
const BOOT = arg('bootstrap', 24);
const REPS = arg('reps', 200);
const { played, series, career } = loadCalibration();
const N = series.length;
const r3 = (v: number) => Number(v.toFixed(3));

/** P(A wins the series) from the shipped quick sim run with `th` on the actual request. */
function seriesProb(idx: number, th: QuickParams): number {
  const p = played[idx]!;
  let wins = 0;
  for (let k = 0; k < REPS; k++) {
    const out = quickSeriesWith({ ...p.req, seed: p.req.seed + k * 7919 }, career, { roundSlope: th.k, mapSlope: th.mu, mapNoiseSd: th.sigma, seriesNoiseSd: th.tau, abilityCap: th.cap });
    if (out.winner === p.a) wins += 1;
  }
  return Math.min(0.99, Math.max(0.01, wins / REPS));
}
const logLoss = (preds: Array<{ p: number; winA: number }>) => preds.reduce((t, x) => t - (x.winA ? Math.log(x.p) : Math.log(1 - x.p)), 0) / preds.length;
const brier = (preds: Array<{ p: number; winA: number }>) => preds.reduce((t, x) => t + (x.p - x.winA) ** 2, 0) / preds.length;
const relBlock = (th: QuickParams) => {
  const preds = series.map((s, i) => ({ p: seriesProb(i, th), winA: s.winA }));
  const rel = reliability(preds);
  return { brier: r3(brier(preds)), logLoss: r3(logLoss(preds)), ece: r3(rel.ece), meanPredictedFavourite: r3(rel.meanPredicted), meanObservedFavourite: r3(rel.meanObserved),
    reliability: rel.bins.map((b) => ({ bin: `${b.lo.toFixed(1)}–${Math.min(1, b.hi).toFixed(1)}`, n: b.n, predicted: r3(b.predicted), observed: r3(b.observed) })) };
};

// 1. Fit every model once (analytic likelihood; no simulation).
const models: Record<string, unknown> = {};
for (const kind of MODEL_KINDS) {
  const f = fitQuick(series, kind);
  models[kind] = { params: Object.fromEntries(Object.entries(f.params).map(([k, v]) => [k, r3(v)])), nParams: f.nParams, logLik: r3(f.logLik), aic: r3(2 * f.nParams - 2 * f.logLik) };
  process.stderr.write(`${kind}: logLik ${f.logLik.toFixed(2)} aic ${(2 * f.nParams - 2 * f.logLik).toFixed(1)}\n`);
}
const best: ModelKind = 'both';
const bestFull = fitQuick(series, best);

// 2. Bootstrap standard errors of the best model, and how many series a target precision needs.
const rng = mulberry32(7);
const boots: QuickParams[] = [];
for (let b = 0; b < BOOT; b++) {
  const sample: FitSeries[] = Array.from({ length: N }, () => series[Math.floor(rng() * N)]!);
  boots.push(fitQuick(sample, best, bestFull.params).params);
  process.stderr.write(`bootstrap ${b + 1}/${BOOT}\n`);
}
const se = (key: keyof QuickParams) => { if (!boots.length) return 0; const v = boots.map((p) => p[key]); const m = v.reduce((t, x) => t + x, 0) / v.length; return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, v.length - 1)); };
const ses = { k: se('k'), mu: se('mu'), sigma: se('sigma'), tau: se('tau') };
const targets: Record<string, number> = { k: 0.05 * Math.abs(bestFull.params.k), mu: 0.1, sigma: 0.05, tau: 0.05 };
const need = (key: string, x: number) => Math.ceil(N * (x / targets[key]!) ** 2);

// 3. Held-out: one 50/50 split, fit the noise model and rounds-only on the train half, score the test half.
const train = series.filter((_, i) => i % 2 === 0);
const test = series.filter((_, i) => i % 2 === 1);
const noisy = fitQuick(train, 'both', bestFull.params).params;
const plain = fitQuick(train, 'rounds').params;
const heldLL = (th: QuickParams) => test.reduce((t, s) => t + seriesLogLik(s, th), 0) / test.length;

// 4. Calibration curves (simulation): shipped constants and the refit best params, in sample.
const shipped: QuickParams = { k: QUICK_SIM.roundSlope, mu: QUICK_SIM.mapSlope, b: 0, sigma: QUICK_SIM.mapNoiseSd, tau: QUICK_SIM.seriesNoiseSd, cap: QUICK_SIM.abilityCap };

console.log(JSON.stringify({
  series: N, maps: series.reduce((t, s) => t + s.maps.length, 0), reps: REPS,
  best, bestParams: Object.fromEntries(Object.entries(bestFull.params).map(([k, v]) => [k, r3(v)])),
  logLikAtBest: r3(bestFull.logLik),
  models,
  committedNow: { roundSlope: QUICK_SIM.roundSlope, mapSlope: QUICK_SIM.mapSlope, mapNoiseSd: QUICK_SIM.mapNoiseSd, seriesNoiseSd: QUICK_SIM.seriesNoiseSd, abilityCap: QUICK_SIM.abilityCap },
  shippedLogLik: r3(logLik(series, shipped)), shippedGapToBest: r3(bestFull.logLik - logLik(series, shipped)),
  noiseGainOverRoundsOnly: r3(bestFull.logLik - (models['rounds'] as { logLik: number }).logLik),
  bootstrap: { resamples: BOOT, se: Object.fromEntries(Object.entries(ses).map(([k, v]) => [k, r3(v)])), targets: { k: r3(targets.k!), mu: 0.1, sigma: 0.05, tau: 0.05 }, seriesNeededForTarget: Object.fromEntries(Object.entries(ses).map(([k, v]) => [k, need(k, v)])) },
  heldOut: { trainSeries: train.length, testSeries: test.length, bothLogLikPerSeries: r3(heldLL(noisy)), roundsOnlyLogLikPerSeries: r3(heldLL(plain)), gain: r3(heldLL(noisy) - heldLL(plain)) },
  coinBrier: r3(series.reduce((t, s) => t + (0.5 - s.winA) ** 2, 0) / N),
  calibration: { shipped: relBlock(shipped), refit: relBlock(bestFull.params) },
}, null, 2));
