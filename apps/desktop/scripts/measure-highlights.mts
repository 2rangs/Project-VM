// Measure the low-spec saving of the highlight playback levels (관전 상세도), deterministically and
// hardware-independently. The live match screen renders one frame per animation frame, and the
// expensive part of each frame is computeFrame() (team knowledge at that instant) plus the PixiJS /
// three.js draw. The highlight plan plays only chosen windows and skips the gaps, so the cost of a
// round scales with the round-time actually played. This script reports, per level:
//   covered%  — share of the round that is actually played (and thus rendered)
//   windows   — number of clips the viewer sees (each is one play/skip transition)
//   frames@60 — frames rendered for the round at 60 fps, real-time tempo
//   cpu(ms)   — frames@60 × the measured cost of one computeFrame() on this machine
// The RATIO between levels is hardware-independent; the absolute cpu(ms) scales with the machine
// (on a box N× slower, multiply by N). Run after `npm run build` is not required:
//   node --experimental-strip-types scripts/measure-highlights.mts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mergeMatch, type RawMatch } from '../src/shared/match-merge.ts';
import { fromSimEventLog } from '../../../packages/replay-engine/src/index.ts';
import { buildNav, type NavData } from '../src/renderer/matchday/nav.ts';
import { buildTimeline, type RoundTimeline } from '../src/renderer/matchday/timeline.ts';
import { computeFrame } from '../src/renderer/matchday/frame.ts';
import { roundPlayWindows, type HighlightLevel, type PlayWindow } from '../src/renderer/matchday/highlights.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (p: string) => JSON.parse(readFileSync(path.resolve(here, p), 'utf8'));
const nav = buildNav(readJson('../src/data/sim/ascent.navgraph.json') as NavData);
const raw = readJson('../test/fixtures/matchday/match-sample.json') as RawMatch;
const { events, summary, perception } = mergeMatch(raw);
const replay = fromSimEventLog(events, { mapId: 'ascent', perception });
const tl = buildTimeline(replay, summary, nav);

const RENDER_FPS = 60;
const covered = (ws: PlayWindow[]) => ws.reduce((s, w) => s + (w.endMs - w.startMs), 0);
const roundMs = (r: RoundTimeline) => r.endMs - r.buyStartMs;

// Micro-benchmark one computeFrame() on this machine (median of samples across the rounds).
function benchComputeFrame(): number {
  const samples: number[] = [];
  for (const r of tl.rounds) {
    for (let k = 0; k < 40; k++) {
      const tMs = r.buyStartMs + ((r.endMs - r.buyStartMs) * k) / 40;
      const t0 = performance.now();
      for (let n = 0; n < 20; n++) computeFrame(replay, tl, nav, 'A', tMs);
      samples.push((performance.now() - t0) / 20);
    }
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const LEVELS: HighlightLevel[] = ['instant', 'key', 'extended', 'full'];
const tPerFrame = benchComputeFrame();

console.log(`fixture: ${tl.rounds.length} rounds, computeFrame median ${tPerFrame.toFixed(4)} ms/frame (this machine)\n`);
console.log('per round:');
for (const r of tl.rounds) {
  const total = roundMs(r);
  const cells = LEVELS.map((lv) => {
    const ws = lv === 'full' ? [{ startMs: r.buyStartMs, endMs: r.endMs }] : roundPlayWindows(r, lv);
    const cov = covered(ws);
    const frames = Math.round((cov / 1000) * RENDER_FPS);
    const pct = total > 0 ? Math.round((cov / total) * 100) : 0;
    return `${lv.padEnd(8)} ${String(pct).padStart(3)}%  win=${String(ws.length).padStart(2)}  f@60=${String(frames).padStart(4)}  cpu=${(frames * tPerFrame).toFixed(1).padStart(6)}ms`;
  });
  console.log(`  R${r.roundNum} (${(total / 1000).toFixed(1)}s): \n    ${cells.join('\n    ')}`);
}

// Aggregate across the match.
console.log('\naggregate (whole match):');
const totalRound = tl.rounds.reduce((s, r) => s + roundMs(r), 0);
for (const lv of LEVELS) {
  let cov = 0, frames = 0, wins = 0;
  for (const r of tl.rounds) {
    const ws = lv === 'full' ? [{ startMs: r.buyStartMs, endMs: r.endMs }] : roundPlayWindows(r, lv);
    cov += covered(ws); frames += Math.round((covered(ws) / 1000) * RENDER_FPS); wins += ws.length;
  }
  const pct = Math.round((cov / totalRound) * 100);
  console.log(`  ${lv.padEnd(8)} ${String(pct).padStart(3)}% of round time · ${wins} clips · ${frames} frames@60 · ~${(frames * tPerFrame).toFixed(0)}ms computeFrame CPU`);
}
