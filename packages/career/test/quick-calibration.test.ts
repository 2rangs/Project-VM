// The quick series estimate against engine-played series (tools/career/calibration-data.json: 120
// Bo3s played by match-runner between random teams of the four regions with their career fives,
// committed — no engine runs here). Checks the likelihood maths, that the fitter recovers known
// constants from the simulator's own output, that the SHIPPED constants are near the maximum
// likelihood and calibrated (error bounds), and that a model fitted on half the series predicts the
// other half. Numbers and their reading: docs/CAREER_MODE.md §4.
import { describe, it, expect, beforeAll } from "vitest";
import { loadCalibration, mapRecordsFromGameData } from "../src/game-data.ts";
import {
  fitQuick, logLik, mapLogLik, mapShare, QUICK_SIM, quickSeriesWith, reliability, seriesLogLik, setMapRecords,
  type FitSeries, type QuickParams,
} from "../src/index.ts";

const SHIPPED: QuickParams = { k: QUICK_SIM.roundSlope, mu: QUICK_SIM.mapSlope, b: 0, sigma: QUICK_SIM.mapNoiseSd, tau: QUICK_SIM.seriesNoiseSd, cap: QUICK_SIM.abilityCap };
const REPS = 200;
let cal: ReturnType<typeof loadCalibration>;
beforeAll(() => { cal = loadCalibration(); }, 120_000);

function seriesProb(i: number, th: QuickParams): number {
  const p = cal.played[i]!;
  let wins = 0;
  for (let k = 0; k < REPS; k++) {
    const out = quickSeriesWith({ ...p.req, seed: p.req.seed + k * 7919 }, cal.career, { roundSlope: th.k, mapSlope: th.mu, mapNoiseSd: th.sigma, seriesNoiseSd: th.tau, abilityCap: th.cap });
    if (out.winner === p.a) wins += 1;
  }
  return Math.min(0.99, Math.max(0.01, wins / REPS));
}

describe("the map-score likelihood", () => {
  it("is a probability distribution over the final scores (regulation and overtime)", () => {
    for (const p of [0.2, 0.5, 0.63, 0.9]) {
      let total = 0;
      for (let x = 0; x <= 11; x++) total += Math.exp(mapLogLik(13, x, p)) + Math.exp(mapLogLik(x, 13, p));
      for (let n = 0; n < 400; n++) total += Math.exp(mapLogLik(14 + n, 12 + n, p)) + Math.exp(mapLogLik(12 + n, 14 + n, p));
      expect(total, `p = ${p}`).toBeCloseTo(1, 6);
    }
  });
});

describe("the fit", () => {
  it("recovers known constants from the simulator's own output", () => {
    const truth: QuickParams = { k: 8, mu: 0.3, b: 0, sigma: 0.4, tau: 0.3, cap: 0 };
    const synth: FitSeries[] = [];
    for (let rep = 0; rep < 3; rep++) {
      cal.played.forEach((p, i) => {
        const out = quickSeriesWith({ ...p.req, seed: p.req.seed + 1_000_003 * (rep + 1) }, cal.career, { roundSlope: truth.k, mapSlope: truth.mu, mapNoiseSd: truth.sigma, seriesNoiseSd: truth.tau });
        synth.push({
          d: cal.series[i]!.d, winA: out.winner === p.a ? 1 : 0,
          maps: out.maps.map((m) => { const ma = mapShare(p.a, m.map); const mb = mapShare(p.b, m.map); return { a: m.score[0], b: m.score[1], m: ma !== null && mb !== null ? ma - mb : 0 }; }),
        });
      });
    }
    const fit = fitQuick(synth, "both", { k: 6, sigma: 0.1, tau: 0.1 }).params;
    expect(fit.k).toBeGreaterThan(truth.k - 1.8); expect(fit.k).toBeLessThan(truth.k + 1.8);
    expect(Math.abs(fit.sigma - truth.sigma)).toBeLessThan(0.15);
    expect(Math.abs(fit.tau - truth.tau)).toBeLessThan(0.2);
  }, 180_000);

  it("the shipped constants are near the maximum likelihood on the engine series", () => {
    const best = fitQuick(cal.series, "both", SHIPPED);
    expect(best.logLik - logLik(cal.series, SHIPPED)).toBeLessThan(3); // within 3 log-likelihood units of the optimum (6 units would be a rejected value)
    // and far better than leaving the noise out: the rounds-only model is ≥ 20 units worse.
    expect(best.logLik - fitQuick(cal.series, "rounds").logLik).toBeGreaterThan(20);
  }, 120_000);
});

describe("calibration of the shipped quick sim against the engine", () => {
  let preds: Array<{ p: number; winA: number }>;
  beforeAll(() => { preds = cal.played.map((p, i) => ({ p: seriesProb(i, SHIPPED), winA: p.winA })); }, 180_000);

  it("series level: the favourite's win rate matches what is predicted (error bounds)", () => {
    const rel = reliability(preds);
    // 120 series: the noise floor of the expected calibration error is ≈ 0.06–0.07, so the bounds are 0.10 / 0.05.
    expect(rel.ece).toBeLessThan(0.1);
    expect(Math.abs(rel.meanPredicted - rel.meanObserved)).toBeLessThan(0.05);
    const brier = preds.reduce((t, x) => t + (x.p - x.winA) ** 2, 0) / preds.length;
    expect(brier).toBeLessThan(0.215); // a coin is 0.25
  });

  it("map level: the favourite's round share matches the engine's", () => {
    // Per series, mean map round share of A in the engine vs the model's mean p over many draws.
    let eng = 0; let n = 0;
    for (const s of cal.series) for (const m of s.maps) { eng += m.a / (m.a + m.b); n += 1; }
    let model = 0; let nm = 0;
    cal.played.slice(0, 40).forEach((p, i) => {
      for (let k = 0; k < 20; k++) {
        const out = quickSeriesWith({ ...p.req, seed: p.req.seed + k * 104729 }, cal.career);
        for (const m of out.maps) { model += m.score[0] / (m.score[0] + m.score[1]); nm += 1; }
        void i;
      }
    });
    expect(Math.abs(eng / n - model / nm)).toBeLessThan(0.04);
  });

  it("held out: a model fitted on half the series predicts the other half better than rounds only", () => {
    const train = cal.series.filter((_, i) => i % 2 === 0);
    const test = cal.series.filter((_, i) => i % 2 === 1);
    const noisy = fitQuick(train, "both", SHIPPED).params;
    const plain = fitQuick(train, "rounds").params;
    const ll = (th: QuickParams) => test.reduce((t, s) => t + seriesLogLik(s, th), 0) / test.length;
    expect(ll(noisy)).toBeGreaterThan(ll(plain) + 0.15); // CV on 5 folds: +0.36 per series
    expect(Math.abs(noisy.sigma - SHIPPED.sigma)).toBeLessThan(0.25);
  }, 120_000);
});

describe("map records", () => {
  it("are registered by the loader (the map-pool term is live in the calibration)", () => {
    expect(mapShare(cal.played[0]!.a, "Lotus")).not.toBeNull();
    setMapRecords(mapRecordsFromGameData());
  });
});
