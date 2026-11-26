// Highlight playback plan (관전 상세도) — which parts of a round are actually played, so a viewer
// can trade detail for speed and a weak machine renders far fewer frames (COMPARABLES §D: FM-style
// "key highlights only"). Nothing here touches the simulation; it only chooses time windows of an
// already-recorded round to play, and the gaps between windows are skipped by the playback clock.
//
// Levels (least → most detail):
//   instant   play nothing — jump straight to the round result (= OOTP "text result").
//   key       only the decisive moments: first contact, plant, defuse, the round-deciding kills.
//   extended  every recorded event (all kills, plant, defuse), still skipping dead travel time.
//   full      the whole round, continuously, from the buy phase (the original behaviour).
//
// Pure module: runs under `node --test`.
import { roundMarks } from './monitor.ts';
import { swingMoments } from './winprob.ts';
import type { RoundTimeline } from './timeline.ts';

export type HighlightLevel = 'instant' | 'key' | 'extended' | 'full';
export const HIGHLIGHT_LEVELS: readonly HighlightLevel[] = ['instant', 'key', 'extended', 'full'];
export function isHighlightLevel(v: unknown): v is HighlightLevel {
  return typeof v === 'string' && (HIGHLIGHT_LEVELS as readonly string[]).includes(v);
}

/** A span of the round the playhead actually plays through; gaps between windows are skipped. */
export interface PlayWindow { readonly startMs: number; readonly endMs: number }

// Lead-in before / tail after each shown moment. 'key' and 'extended' use the SAME window width so
// that the key moments are a strict subset of the extended ones (fewer clips = less rendered, the
// low-spec win); the levels differ only in WHICH moments are shown.
const LEAD_MS = 2200;
const TAIL_MS = 1500;
/** Windows closer than this after merging are joined (so two near events read as one clip). */
const JOIN_GAP_MS = 500;
/** The round result is always worth a short tail so the outcome lands. */
const RESULT_TAIL_MS = 1600;

/** Merge overlapping / near-adjacent windows and clamp to [lo, hi]; drops empties. */
export function mergeWindows(raw: readonly PlayWindow[], lo: number, hi: number): PlayWindow[] {
  const spans = raw
    .map((w) => ({ startMs: Math.max(lo, Math.min(w.startMs, hi)), endMs: Math.max(lo, Math.min(w.endMs, hi)) }))
    .filter((w) => w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: PlayWindow[] = [];
  for (const w of spans) {
    const last = out[out.length - 1];
    if (last && w.startMs - last.endMs <= JOIN_GAP_MS) out[out.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, w.endMs) };
    else out.push(w);
  }
  return out;
}

/** How many of the biggest win-probability swings the 'key' level shows. */
const KEY_SWINGS = 6;

/**
 * The moments (round-relative-free, match-ms) the 'key' level shows: the biggest WIN-PROBABILITY
 * swings of the round (the moments that actually turned it), plus the objective beats (plant,
 * defuse) and the opening and closing duels for context. Swing selection is what makes 'key' smart —
 * a trade that changed nothing is skipped, the kill that flipped the round is kept. All times are
 * existing round marks (kills/plant/defuse), so these stay a subset of the 'extended' windows.
 */
function keyTimes(round: RoundTimeline): number[] {
  const marks = roundMarks(round);
  const kills = marks.filter((m) => m.kind === 'kill');
  const times = new Set<number>();
  if (kills[0]) times.add(kills[0].tMs);                                // opening duel
  if (kills[kills.length - 1]) times.add(kills[kills.length - 1].tMs);  // the finish
  const plant = marks.find((m) => m.kind === 'plant'); if (plant) times.add(plant.tMs);
  const defuse = marks.find((m) => m.kind === 'defuse'); if (defuse) times.add(defuse.tMs);
  // The win-probability swings (symmetric in magnitude, so either team's view works); 'end' swings
  // are dropped because the result window already covers the finish.
  for (const s of swingMoments(round, round.attacker, KEY_SWINGS)) if (s.kind !== 'end') times.add(s.tMs);
  return [...times].sort((a, b) => a - b);
}

/**
 * The windows to play for a round at a given detail level, merged and clamped to the round.
 * `instant` returns [] (play nothing); `full` returns the whole round.
 */
export function roundPlayWindows(round: RoundTimeline, level: HighlightLevel): PlayWindow[] {
  const lo = round.buyStartMs;
  const hi = round.endMs;
  if (level === 'full') return [{ startMs: lo, endMs: hi }];
  if (level === 'instant') return [];
  const chosenTimes = level === 'key'
    ? keyTimes(round)
    : roundMarks(round).filter((m) => m.kind !== 'end').map((m) => m.tMs);
  const raw: PlayWindow[] = chosenTimes.map((tMs) => ({ startMs: tMs - LEAD_MS, endMs: tMs + TAIL_MS }));
  // Always end on the result so the round outcome is seen.
  raw.push({ startMs: hi - RESULT_TAIL_MS, endMs: hi });
  const windows = mergeWindows(raw, lo, hi);
  // A round with no recorded marks (e.g. no tracks) still shows its result.
  return windows.length > 0 ? windows : [{ startMs: Math.max(lo, hi - RESULT_TAIL_MS), endMs: hi }];
}

/** The window containing t (inclusive of start, exclusive of end), or null when t is in a gap. */
export function windowAt(windows: readonly PlayWindow[], t: number): PlayWindow | null {
  for (const w of windows) if (t >= w.startMs && t < w.endMs) return w;
  return null;
}

/** The start of the first window strictly after t, or null when none remains. */
export function nextWindowStart(windows: readonly PlayWindow[], t: number): number | null {
  for (const w of windows) if (w.startMs > t) return w.startMs;
  return null;
}

/**
 * Advance the playhead by `step` ms honouring a highlight plan: play inside a window, skip the
 * gap to the next window, and finish at `endMs` once the windows are exhausted. With an empty
 * plan (`instant`) it finishes immediately. Pure, so the playback clock and tests share it.
 */
export function advanceHighlighted(
  windows: readonly PlayWindow[], cur: number, step: number, endMs: number,
): { readonly t: number; readonly done: boolean } {
  if (windows.length === 0) return { t: endMs, done: true };
  const target = cur + step;
  if (target >= endMs) return { t: endMs, done: true };
  if (windowAt(windows, target)) return { t: target, done: false };
  const ns = nextWindowStart(windows, target);
  if (ns == null) return { t: endMs, done: true };
  return { t: ns, done: false };
}
