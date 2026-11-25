// Maximum-likelihood fit of the quick series estimate (quick-sim.ts) to engine-played series.
// Pure maths on plain data (no engine, no I/O): tools/career/fit-quick-sim.mts feeds it the cached
// engine series, the calibration test checks the shipped constants against them.
//
// The model of one map between A and B (the quick sim's own generative model):
//     η      = f(d) + μ · m + b + τ · u + σ · z          u ~ N(0,1) once per SERIES, z ~ N(0,1) per MAP
//     f(d)   = k · d, or with a cap  cap · tanh(k · d / cap)   (the engine does not let even a big
//              ability gap decide a series: the favourite's win rate saturates)
//     p      = sigmoid(η)                                 P(A wins a round)
//     score  = first to 13 with a 2-round lead (overtime past 12–12)
//   d = lineup-ability difference (A − B), m = map-share difference on the map played.
// The likelihood of an observed final score under p is exact (negative binomial; overtime = the
// 12–12 tie then a run of split pairs), and u and z are integrated out on a grid, so a series
// contributes   ∫ φ(u) Π_maps ∫ φ(z) P(score | sigmoid(η)) dz du.
// τ is the between-series variance a pure rounds model lacks: in the engine a matchup is more
// one-sided or closer than the lineups say, on every map of the series; σ is the same per map.

export interface FitMap { readonly a: number; readonly b: number; readonly m: number }
export interface FitSeries { readonly d: number; readonly maps: readonly FitMap[]; /** 1 when A won the series. */ readonly winA: number }

export interface QuickParams { k: number; mu: number; b: number; sigma: number; tau: number; /** Cap of the ability term (logit); 0 = linear. */ cap: number }

/** The ability term of the round logit. */
export const abilityTerm = (k: number, cap: number, d: number): number => (cap > 0 ? cap * Math.tanh((k * d) / cap) : k * d);

const logFact: number[] = [0];
for (let i = 1; i < 200; i++) logFact.push(logFact[i - 1]! + Math.log(i));
const logC = (n: number, r: number): number => logFact[n]! - logFact[r]! - logFact[n - r]!;

/** log P(final score a–b | P(A wins a round) = p) under first-to-13 / win-by-2 with overtime. */
export function mapLogLik(a: number, b: number, p: number): number {
  const q = 1 - p;
  const lp = Math.log(Math.max(p, 1e-12)); const lq = Math.log(Math.max(q, 1e-12));
  const hi = Math.max(a, b); const lo = Math.min(a, b);
  if (hi === 13 && lo <= 11) return a === 13 ? logC(12 + b, b) + 13 * lp + b * lq : logC(12 + a, a) + 13 * lq + a * lp;
  if (hi - lo === 2 && lo >= 12) {
    const n = lo - 12; // split pairs after 12–12
    return logC(24, 12) + 12 * lp + 12 * lq + n * (Math.log(2) + lp + lq) + (a > b ? 2 * lp : 2 * lq);
  }
  return -40; // not a score the rules allow (never in engine data)
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Standard-normal quadrature grid (equal spacing, weights ∝ φ, normalised). */
function grid(n = 17, span = 3.6): { z: number[]; w: number[] } {
  const z: number[] = []; const w: number[] = [];
  for (let i = 0; i < n; i++) { const x = -span + (2 * span * i) / (n - 1); z.push(x); w.push(Math.exp(-0.5 * x * x)); }
  const s = w.reduce((t, x) => t + x, 0);
  return { z, w: w.map((x) => x / s) };
}
const G = grid();
const G1 = { z: [0], w: [1] };

/** log-likelihood of one series. */
export function seriesLogLik(s: FitSeries, th: QuickParams): number {
  const gu = th.tau > 1e-9 ? G : G1;
  const gz = th.sigma > 1e-9 ? G : G1;
  let total = 0;
  for (let i = 0; i < gu.z.length; i++) {
    let logProd = 0;
    for (const m of s.maps) {
      const eta0 = abilityTerm(th.k, th.cap, s.d) + th.mu * m.m + th.b + th.tau * gu.z[i]!;
      let inner = 0;
      for (let j = 0; j < gz.z.length; j++) inner += gz.w[j]! * Math.exp(mapLogLik(m.a, m.b, sigmoid(eta0 + th.sigma * gz.z[j]!)));
      logProd += Math.log(Math.max(inner, 1e-300));
    }
    total += gu.w[i]! * Math.exp(logProd);
  }
  return Math.log(Math.max(total, 1e-300));
}

export const logLik = (data: readonly FitSeries[], th: QuickParams): number => data.reduce((t, s) => t + seriesLogLik(s, th), 0);

/** Nelder–Mead minimiser (small, dependency-free). */
export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], iters = 400): { x: number[]; fx: number } {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step[i]! : v)))];
  let fs = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const order = fs.map((v, i) => i).sort((p, q) => fs[p]! - fs[q]!);
    pts = order.map((i) => pts[i]!); fs = order.map((i) => fs[i]!);
    if (Math.abs(fs[n]! - fs[0]!) < 1e-8) break;
    const c = x0.map((_, j) => pts.slice(0, n).reduce((t, p) => t + p[j]!, 0) / n);
    const at = (t: number) => c.map((v, j) => v + t * (pts[n]![j]! - v));
    const xr = at(-1); const fr = f(xr);
    if (fr < fs[0]!) { const xe = at(-2); const fe = f(xe); if (fe < fr) { pts[n] = xe; fs[n] = fe; } else { pts[n] = xr; fs[n] = fr; } }
    else if (fr < fs[n - 1]!) { pts[n] = xr; fs[n] = fr; }
    else {
      const xc = at(fr < fs[n]! ? -0.5 : 0.5); const fc = f(xc);
      if (fc < Math.min(fr, fs[n]!)) { pts[n] = xc; fs[n] = fc; }
      else for (let i = 1; i <= n; i++) { pts[i] = pts[i]!.map((v, j) => pts[0]![j]! + 0.5 * (v - pts[0]![j]!)); fs[i] = f(pts[i]!); }
    }
  }
  const best = fs.indexOf(Math.min(...fs));
  return { x: pts[best]!, fx: fs[best]! };
}

export type ModelKind = "rounds" | "map-noise" | "series-noise" | "both" | "both+cap";
export const MODEL_KINDS: readonly ModelKind[] = ["rounds", "map-noise", "series-noise", "both", "both+cap"];

/** Fit the parameters of a model kind by maximum likelihood. Fixed terms are zero. */
export function fitQuick(data: readonly FitSeries[], kind: ModelKind, start: Partial<QuickParams> = {}): { params: QuickParams; logLik: number; nParams: number } {
  const useS = kind === "map-noise" || kind === "both" || kind === "both+cap";
  const useT = kind === "series-noise" || kind === "both" || kind === "both+cap";
  const useC = kind === "both+cap";
  const unpack = (x: number[]): QuickParams => ({ k: x[0]!, mu: x[1]!, b: x[2]!, sigma: useS ? Math.abs(x[3]!) : 0, tau: useT ? Math.abs(x[4]!) : 0, cap: useC ? Math.max(0.2, Math.abs(x[5]!)) : 0 });
  const x0 = [start.k ?? 7.5, start.mu ?? 0.3, start.b ?? 0, useS ? start.sigma ?? 0.2 : 0, useT ? start.tau ?? 0.2 : 0, useC ? (start.cap && start.cap > 0 ? start.cap : 1.5) : 0];
  const free = [0, 1, 2, ...(useS ? [3] : []), ...(useT ? [4] : []), ...(useC ? [5] : [])];
  const full = (y: number[]) => { const x = [...x0]; free.forEach((idx, i) => { x[idx] = y[i]!; }); return x; };
  const r = nelderMead((y) => -logLik(data, unpack(full(y))), free.map((i) => x0[i]!), free.map((i) => (i === 0 ? 1 : 0.15)), 500);
  const params = unpack(full(r.x));
  return { params, logLik: -r.fx, nParams: free.length };
}

/** Deterministic K-fold split by series index. */
export function folds<T>(data: readonly T[], k: number): Array<{ train: T[]; test: T[] }> {
  return Array.from({ length: k }, (_, f) => ({ train: data.filter((_, i) => i % k !== f), test: data.filter((_, i) => i % k === f) }));
}

/** Reliability of "the favourite wins the series": bins by the favourite's predicted probability. */
export interface ReliabilityBin { readonly lo: number; readonly hi: number; n: number; predicted: number; observed: number }
export function reliability(preds: ReadonlyArray<{ p: number; winA: number }>, edges: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]): { bins: ReliabilityBin[]; ece: number; meanPredicted: number; meanObserved: number } {
  const bins: ReliabilityBin[] = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1]!, n: 0, predicted: 0, observed: 0 }));
  let sp = 0; let so = 0;
  for (const { p, winA } of preds) {
    const fav = p >= 0.5; const pf = fav ? p : 1 - p; const won = fav ? winA : 1 - winA;
    const bin = bins.find((b) => pf >= b.lo && pf < b.hi)!;
    bin.n += 1; bin.predicted += pf; bin.observed += won; sp += pf; so += won;
  }
  let ece = 0;
  for (const b of bins) if (b.n) ece += (b.n / preds.length) * Math.abs(b.predicted / b.n - b.observed / b.n);
  return { bins: bins.filter((b) => b.n).map((b) => ({ ...b, predicted: b.predicted / b.n, observed: b.observed / b.n })), ece, meanPredicted: sp / preds.length, meanObserved: so / preds.length };
}

