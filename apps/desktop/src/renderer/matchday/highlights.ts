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
import { roundMarks, type RoundMark } from './monitor.ts';
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

/** The marks that count as "decisive" for the 'key' level. */
function keyMarks(round: RoundTimeline, marks: readonly RoundMark[]): RoundMark[] {
  const kills = marks.filter((m) => m.kind === 'kill');
  const picked = new Map<number, RoundMark>();
  const add = (m: RoundMark | undefined) => { if (m) picked.set(m.tMs, m); };
  add(kills[0]);                                   // first blood (opening duel)
  add(marks.find((m) => m.kind === 'plant'));      // plant
  add(marks.find((m) => m.kind === 'defuse'));     // defuse
  // Round-deciding kills: anything in the last stretch before the round ends.
  const decideFrom = round.endMs - 9000;
  for (const m of kills) if (m.tMs >= decideFrom) add(m);
  add(kills[kills.length - 1]);                    // the last kill, even on a slow round
  return [...picked.values()].sort((a, b) => a.tMs - b.tMs);
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
  const marks = roundMarks(round);
  const chosen = level === 'key' ? keyMarks(round, marks) : marks.filter((m) => m.kind !== 'end');
  const raw: PlayWindow[] = chosen.map((m) => ({ startMs: m.tMs - LEAD_MS, endMs: m.tMs + TAIL_MS }));
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
