// Fit the live win-probability logistic (src/renderer/matchday/winprob.ts) to ENGINE match data.
// This does NOT enter the simulation — it only sets the coefficients of the viewer's estimate, which
// is pinned to the real result once a round ends. Generated matches use real rosters on Ascent, the
// same pipeline the desktop runs (runMatchCompact → mergeMatch → buildTimeline), so the fitted
// weights describe exactly the state wpStateAt/wpFeatures compute at runtime.
//
// Train on seeds 1..TRAIN, validate on seeds (TRAIN+1)..(TRAIN+VAL). Reports Brier, ECE and a
// reliability curve, and compares engine/model against session J's community anchors (first-blood →
// round win, 5v4 post-first-blood, post-plant). Writes the coefficients to winprob-coef.json
// (committed artifact) and winprob-coef.ts (what the app imports), plus a small fit report.
//
//   npx tsx apps/desktop/scripts/fit-winprob.mts --train 160 --val 160 [--step 1500] \
//       [--community <path>] [--out-dir src/renderer/matchday]
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { simulatableTeamRefs, type TeamRef } from '../../../packages/match-runner/src/index.ts';
import { runMatchCompact } from '../src/engine/run-match.ts';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import { fromSimEventLog } from '../../../packages/replay-engine/src/index.ts';
import { buildNav, type NavData } from '../src/renderer/matchday/nav.ts';
import { buildTimeline, roundOver, type RoundTimeline, type TeamSlot } from '../src/renderer/matchday/timeline.ts';
import { wpFeatures, wpStateAt, type WpCoef, type WpState } from '../src/renderer/matchday/winprob.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
function arg(name: string, def: string): string { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const TRAIN = Number(arg('train', '160'));
const VAL = Number(arg('val', '160'));
const STEP = Number(arg('step', '1500'));
const OUT_DIR = path.resolve(here, '..', arg('out-dir', 'src/renderer/matchday'));
const COMMUNITY = arg('community', '');

const nav = buildNav(JSON.parse(readFileSync(path.join(here, '../src/data/sim/ascent.navgraph.json'), 'utf8')) as NavData);
const teams = simulatableTeamRefs();
const n = teams.length;
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

interface Snap { x: number[]; y: number; firstBlood?: { side: TeamSlot; killerWon: boolean }; postPlant?: boolean; clutch?: number }

/** Run one seed's match, return its rounds as timelines. */
function matchRounds(seed: number): RoundTimeline[] {
  const teamA: TeamRef = teams[(2 * (seed - 1)) % n];
  const teamB: TeamRef = teams[(2 * (seed - 1) + 1) % n];
  const raw = runMatchCompact({ teamA, teamB, map: 'Ascent', seed, recordPerception: false }) as unknown as RawMatch;
  const { events, summary } = mergeMatch(raw);
  const replay = fromSimEventLog(events, { mapId: 'ascent' });
  return buildTimeline(replay, summary, nav).rounds;
}

/** Non-terminal state snapshots of a round, labelled with the attacker's eventual win (1/0). */
function roundSnaps(r: RoundTimeline): Snap[] {
  if (!r.summary) return [];
  const y = r.summary.winner === r.attacker ? 1 : 0;
  const out: Snap[] = [];
  for (let t = r.startMs; t < r.endMs - 400; t += STEP) {
    if (roundOver(r, t)) break;
    const st = wpStateAt(r, t);
    if (st.aliveAtt <= 0 || st.aliveDef <= 0) continue; // terminal overrides are not fitted
    out.push({ x: wpFeatures(st), y });
  }
  return out;
}

// ── logistic regression by IRLS (Newton) with a small L2 ridge (intercept unpenalised) ──────────
function solve(A: number[][], b: number[]): number[] {
  const m = A.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < m; c++) {
    let piv = c; for (let r = c + 1; r < m; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-9;
    for (let j = c; j <= m; j++) M[c][j] /= d;
    for (let r = 0; r < m; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= m; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row) => row[m]);
}

function fit(snaps: Snap[], lambda = 1.0, iters = 30): number[] {
  const d = 1 + snaps[0].x.length; // intercept + features
  let w = new Array(d).fill(0);
  const X = snaps.map((s) => [1, ...s.x]);
  const y = snaps.map((s) => s.y);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      let z = 0; for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const p = sigmoid(z); const wgt = Math.max(p * (1 - p), 1e-6);
      for (let j = 0; j < d; j++) {
        g[j] += (y[i] - p) * X[i][j];
        for (let k = 0; k < d; k++) H[j][k] += wgt * X[i][j] * X[i][k];
      }
    }
    for (let j = 1; j < d; j++) { g[j] -= lambda * w[j]; H[j][j] += lambda; } // ridge, skip intercept
    const step = solve(H, g);
    let max = 0; for (let j = 0; j < d; j++) { w[j] += step[j]; max = Math.max(max, Math.abs(step[j])); }
    if (max < 1e-7) break;
  }
  return w;
}

const predict = (w: number[], x: number[]) => sigmoid(w[0] + x.reduce((s, xi, j) => s + w[j + 1] * xi, 0));

function metrics(w: number[], snaps: Snap[]) {
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  let brier = 0;
  for (const s of snaps) {
    const p = predict(w, s.x); brier += (p - s.y) ** 2;
    const b = Math.min(9, Math.floor(p * 10)); bins[b].n++; bins[b].p += p; bins[b].y += s.y;
  }
  brier /= snaps.length;
  let ece = 0; for (const b of bins) if (b.n) ece += (b.n / snaps.length) * Math.abs(b.p / b.n - b.y / b.n);
  const reliability = bins.map((b, i) => ({ bin: `${i / 10}-${(i + 1) / 10}`, n: b.n, pred: b.n ? +(b.p / b.n).toFixed(3) : null, obs: b.n ? +(b.y / b.n).toFixed(3) : null }));
  return { brier: +brier.toFixed(4), ece: +ece.toFixed(4), n: snaps.length, reliability };
}

// ── engine/model anchors vs community (first blood, post-plant) ──────────────────────────────────
function anchors(w: number[], rounds: RoundTimeline[]) {
  let fbWins = 0, fbN = 0, fbModel = 0;        // first-blood team → round win
  let ppWins = 0, ppN = 0;                      // post-plant attack win
  for (const r of rounds) {
    if (!r.summary || r.kills.length === 0) continue;
    const first = [...r.kills].sort((a, b) => a.tMs - b.tMs).find((k) => k.killerTeam);
    if (first && first.killerTeam) {
      const won = r.summary.winner === first.killerTeam ? 1 : 0;
      fbWins += won; fbN++;
      const st = wpStateAt(r, first.tMs + 400);
      const pAtt = predict(w, wpFeatures(st));
      fbModel += first.killerTeam === r.attacker ? pAtt : 1 - pAtt;
    }
    if (r.plant) { ppN++; if (r.summary.winner === r.attacker) ppWins++; }
  }
  return {
    firstBloodRoundWin_engine: fbN ? +(fbWins / fbN).toFixed(3) : null,
    firstBloodRoundWin_model: fbN ? +(fbModel / fbN).toFixed(3) : null,
    firstBloodN: fbN,
    postPlantAttackWin_engine: ppN ? +(ppWins / ppN).toFixed(3) : null,
    postPlantN: ppN,
  };
}

function communityAnchors() {
  if (!COMMUNITY || !existsSync(COMMUNITY)) return null;
  const items = (JSON.parse(readFileSync(COMMUNITY, 'utf8')) as { items: Array<{ id: string; value: number; scope: string }> }).items;
  const pick = (id: string) => items.find((it) => it.id === id);
  return {
    firstBlood_berlin2021: pick('firstblood-round-win-berlin2021')?.value ?? null,
    firstBlood_copenhagen2022: pick('firstblood-round-win-copenhagen2022')?.value ?? null,
    fiveVsFour_copenhagen2022: pick('manadv-5v4-postfirstblood-copenhagen2022')?.value ?? null,
    postPlant_best_2023: pick('postplant-attack-win-best-team-2023')?.value ?? null,
  };
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
console.error(`generating ${TRAIN} train + ${VAL} val matches (real rosters, Ascent, step ${STEP}ms)…`);
const t0 = Date.now();
const trainSnaps: Snap[] = []; const valSnaps: Snap[] = [];
const valRounds: RoundTimeline[] = []; const trainRounds: RoundTimeline[] = [];
for (let s = 1; s <= TRAIN + VAL; s++) {
  const rounds = matchRounds(s);
  const isVal = s > TRAIN;
  for (const r of rounds) { const snaps = roundSnaps(r); (isVal ? valSnaps : trainSnaps).push(...snaps); (isVal ? valRounds : trainRounds).push(r); }
  if (s % 20 === 0) console.error(`  ${s}/${TRAIN + VAL} matches, ${trainSnaps.length}+${valSnaps.length} snaps, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

const w = fit(trainSnaps);
const coef: WpCoef = { b0: +w[0].toFixed(4), man: +w[1].toFixed(4), equip: +w[2].toFixed(4), plant: +w[3].toFixed(4), spikeTime: +w[4].toFixed(4), defuse: +w[5].toFixed(4), preplant: +w[6].toFixed(4) };
const trainM = metrics(w, trainSnaps);
const valM = metrics(w, valSnaps);
const engineAnchors = anchors(w, valRounds);
const community = communityAnchors();

const report = {
  fittedAt: new Date().toISOString(),
  config: { train: TRAIN, val: VAL, stepMs: STEP, map: 'Ascent', rosters: 'real (simulatableTeamRefs)', seconds: +((Date.now() - t0) / 1000).toFixed(0) },
  coef,
  train: trainM,
  val: valM,
  anchors: { engineAndModel: engineAnchors, community },
};
console.error('\n' + JSON.stringify(report, null, 1));

writeFileSync(path.join(OUT_DIR, 'winprob-coef.json'), JSON.stringify({ coef, meta: { fittedAt: report.fittedAt, trainSnaps: trainM.n, valBrier: valM.brier, valEce: valM.ece } }, null, 2) + '\n');
const ts = `// Win-probability logistic coefficients. GENERATED by scripts/fit-winprob.mts from engine match
// data (real rosters, Ascent, seeds 1..${TRAIN} train / ${TRAIN + 1}..${TRAIN + VAL} validate). Mirrored in
// winprob-coef.json. These never enter the simulation — they only shape the viewer's estimate,
// which is pinned to the real result once a round ends. Re-run the fitter to refresh both files.
import type { WpCoef } from './winprob.ts';

export const WP_COEF: WpCoef = {
  b0: ${coef.b0},
  man: ${coef.man},
  equip: ${coef.equip},
  plant: ${coef.plant},
  spikeTime: ${coef.spikeTime},
  defuse: ${coef.defuse},
  preplant: ${coef.preplant},
};

export const WP_COEF_META: { fittedAt: string | null; trainSnaps: number | null; valBrier: number | null } = {
  fittedAt: ${JSON.stringify(report.fittedAt)},
  trainSnaps: ${trainM.n},
  valBrier: ${valM.brier},
};
`;
writeFileSync(path.join(OUT_DIR, 'winprob-coef.ts'), ts);
writeFileSync(path.join(OUT_DIR, 'winprob-fit-report.json'), JSON.stringify(report, null, 2) + '\n');
console.error(`\nwrote winprob-coef.{json,ts} and winprob-fit-report.json to ${OUT_DIR}`);
