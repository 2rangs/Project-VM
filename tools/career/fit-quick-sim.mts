// Fits the quick series estimate to the cached engine series — NO engine runs.
//   npx tsx tools/career/fit-quick-sim.mts [--bootstrap=30]
// 1. Maximum likelihood of four nested models on the exact map-score likelihood (quick-fit.ts):
//    rounds only (k, μ, b) · + per-map noise σ · + per-series noise τ · both.
// 2. 5-fold cross-validation (fit on 4/5 of the series, score the held-out 1/5): held-out log-likelihood
//    per series, and the held-out series-level prediction of the SHIPPED quick sim with the fitted
//    constants → reliability of "the favourite wins" and its expected calibration error.
// 3. Bootstrap standard errors of the best model, and how many more engine series would pin the
//    noise terms down.
// Output: JSON on stdout (the numbers in docs/CAREER_MODE.md §4 and the test bounds come from here).
import { loadCalibration } from '../../packages/career/src/game-data.ts';
import {
  fitQuick, folds, logLik, MODEL_KINDS, mulberry32, QUICK_SIM, quickSeriesWith, reliability, seriesLogLik,
  type FitSeries, type ModelKind, type QuickParams,
} from '../../packages/career/src/index.ts';

const BOOT = Number((process.argv.find((a) => a.startsWith('--bootstrap=')) ?? '--bootstrap=30').split('=')[1]);
const REPS = 200;
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

const models: Record<string, unknown> = {};
const cvPreds: Record<string, Array<{ p: number; winA: number }>> = {};
for (const kind of MODEL_KINDS) {
  const full = fitQuick(series, kind);
  // 5-fold CV: held-out log-likelihood of the map scores, and held-out series probabilities.
  let cvLL = 0; const preds: Array<{ p: number; winA: number; i: number }> = [];
  const idx = series.map((_, i) => i);
  for (let f = 0; f < 5; f++) {
    const train = series.filter((_, i) => i % 5 !== f);
    const fit = fitQuick(train, kind, full.params);
    for (const i of idx.filter((i) => i % 5 === f)) {
      cvLL += seriesLogLik(series[i]!, fit.params);
      preds.push({ p: seriesProb(i, fit.params), winA: series[i]!.winA, i });
    }
  }
  cvPreds[kind] = preds;
  const rel = reliability(preds);
  models[kind] = {
    params: Object.fromEntries(Object.entries(full.params).map(([k, v]) => [k, r3(v)])),
    nParams: full.nParams, logLik: r3(full.logLik), aic: r3(2 * full.nParams - 2 * full.logLik),
    cvLogLikPerSeries: r3(cvLL / N),
    heldOutSeries: { brier: r3(brier(preds)), logLoss: r3(logLoss(preds)), ece: r3(rel.ece), meanPredictedFavourite: r3(rel.meanPredicted), meanObservedFavourite: r3(rel.meanObserved),
      reliability: rel.bins.map((b) => ({ bin: `${b.lo.toFixed(1)}–${Math.min(1, b.hi).toFixed(1)}`, n: b.n, predicted: r3(b.predicted), observed: r3(b.observed) })) },
  };
  process.stderr.write(`${kind}: logLik ${full.logLik.toFixed(2)} cv/series ${(cvLL / N).toFixed(4)}\n`);
}

// The constants committed before this fit, as the baseline (no noise on the series, σ = 0.3 guess).
const old: QuickParams = { k: 7.9, mu: 0.4, b: 0, sigma: 0.3, tau: 0, cap: 0 };
const oldPreds = series.map((s, i) => ({ p: seriesProb(i, old), winA: s.winA }));
const oldRel = reliability(oldPreds);
// … and the constants that ship now (QUICK_SIM), on the same series.
const now: QuickParams = { k: QUICK_SIM.roundSlope, mu: QUICK_SIM.mapSlope, b: 0, sigma: QUICK_SIM.mapNoiseSd, tau: QUICK_SIM.seriesNoiseSd, cap: QUICK_SIM.abilityCap };
const nowPreds = series.map((s, i) => ({ p: seriesProb(i, now), winA: s.winA }));
const nowRel = reliability(nowPreds);

// Best model by cross-validated log-likelihood, then bootstrap standard errors.
const best = (MODEL_KINDS as readonly ModelKind[]).slice().sort((a, b) => (models[b] as { cvLogLikPerSeries: number }).cvLogLikPerSeries - (models[a] as { cvLogLikPerSeries: number }).cvLogLikPerSeries)[0]!;
const bestFull = fitQuick(series, best);
const rng = mulberry32(7);
const boots: QuickParams[] = [];
for (let b = 0; b < BOOT; b++) {
  const sample: FitSeries[] = Array.from({ length: N }, () => series[Math.floor(rng() * N)]!);
  boots.push(fitQuick(sample, best, bestFull.params).params);
  process.stderr.write(`bootstrap ${b + 1}/${BOOT}\n`);
}
const se = (key: keyof QuickParams) => { const v = boots.map((p) => p[key]); const m = v.reduce((t, x) => t + x, 0) / v.length; return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / Math.max(1, v.length - 1)); };
const ses = { k: se('k'), mu: se('mu'), sigma: se('sigma'), tau: se('tau'), cap: se('cap') };
// Series needed for a parameter's SE to reach its target (SE shrinks as 1/√n): the noise terms ±0.05
// logit, the ability slope ±5% of its value, the map-pool slope ±0.1.
const targets: Record<string, number> = { k: 0.05 * Math.abs(bestFull.params.k), mu: 0.1, sigma: 0.05, tau: 0.05, cap: Infinity };
const need = (key: string, x: number) => Math.ceil(N * (x / targets[key]!) ** 2);

console.log(JSON.stringify({
  series: N, maps: series.reduce((t, s) => t + s.maps.length, 0), committedBefore: { ...old, heldOutNote: 'in-sample (constants were not fitted on a held-out split)' },
  baseline: { brier: r3(brier(oldPreds)), logLoss: r3(logLoss(oldPreds)), ece: r3(oldRel.ece), meanPredictedFavourite: r3(oldRel.meanPredicted), meanObservedFavourite: r3(oldRel.meanObserved), reliability: oldRel.bins.map((b) => ({ bin: `${b.lo.toFixed(1)}–${Math.min(1, b.hi).toFixed(1)}`, n: b.n, predicted: r3(b.predicted), observed: r3(b.observed) })) },
  shipped: { params: now, logLik: r3(logLik(series, now)), brier: r3(brier(nowPreds)), logLoss: r3(logLoss(nowPreds)), ece: r3(nowRel.ece), meanPredictedFavourite: r3(nowRel.meanPredicted), meanObservedFavourite: r3(nowRel.meanObserved), reliability: nowRel.bins.map((b) => ({ bin: `${b.lo.toFixed(1)}–${Math.min(1, b.hi).toFixed(1)}`, n: b.n, predicted: r3(b.predicted), observed: r3(b.observed) })) },
  coinBrier: r3(series.reduce((t, s) => t + (0.5 - s.winA) ** 2, 0) / N),
  models, best, bestParams: Object.fromEntries(Object.entries(bestFull.params).map(([k, v]) => [k, r3(v)])),
  bootstrap: { resamples: BOOT, se: Object.fromEntries(Object.entries(ses).map(([k, v]) => [k, r3(v)])), seriesNeededForTarget: Object.fromEntries(Object.entries(ses).filter(([k]) => k !== 'cap').map(([k, v]) => [k, need(k, v)])), targets: { k: r3(targets.k!), mu: 0.1, sigma: 0.05, tau: 0.05 } },
  committedNow: { k: QUICK_SIM.roundSlope, mu: QUICK_SIM.mapSlope, sigma: QUICK_SIM.mapNoiseSd, tau: QUICK_SIM.seriesNoiseSd, cap: QUICK_SIM.abilityCap },
  logLikAtBest: r3(logLik(series, bestFull.params)),
}, null, 2));
void folds;
