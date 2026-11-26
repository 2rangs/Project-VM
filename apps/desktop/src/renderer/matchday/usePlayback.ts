// Playback clock for the live match screen. The playhead lives in a ref and advances on
// requestAnimationFrame (at the display's rate, at most MAX_FPS); per-frame consumers (the PixiJS stage) subscribe to it directly, while
// React only re-renders the HUD ~10×/s through the throttled `tMs` state. Playback always stops
// at the end of the round under the playhead — the caller decides what happens next.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roundIndexAt, type MatchTimeline, type RoundTimeline } from './timeline.ts';
import { advanceHighlighted, type PlayWindow } from './highlights.ts';
import type { Tempo } from './prefs.ts';

/**
 * Given the round under the playhead, the windows to actually play (highlight plan), or null to
 * play the whole round continuously. An empty array means "play nothing" (instant result).
 */
export type HighlightPlan = (round: RoundTimeline) => PlayWindow[] | null;

/** Frame-rate ceiling for the live view (2D stage and 3D cams follow this loop). */
export const MAX_FPS = 144;

export interface Playback {
  /** Throttled playhead for React (match ms). */
  readonly tMs: number;
  readonly playing: boolean;
  /** Exact playhead, readable any time. */
  now(): number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number, opts?: { play?: boolean }): void;
  /** Called on every animation frame with the exact playhead (also while paused). Stable identity. */
  subscribe(fn: (tMs: number) => void): () => void;
}

export function usePlayback(tl: MatchTimeline, tempo: Tempo, onRoundEnd?: (round: RoundTimeline) => void, plan?: HighlightPlan): Playback {
  const tRef = useRef(tl.startMs);
  const playingRef = useRef(false);
  const [tMs, setTMs] = useState(tl.startMs);
  const [playing, setPlaying] = useState(false);
  const subs = useRef(new Set<(t: number) => void>());
  const live = useRef({ tl, tempo, onRoundEnd, plan });
  live.current = { tl, tempo, onRoundEnd, plan };

  const setPlay = useCallback((v: boolean) => { playingRef.current = v; setPlaying(v); }, []);

  useEffect(() => {
    let raf = 0; let last = performance.now(); let lastEmit = 0;
    const tick = (now: number) => {
      // Follow the display's refresh, but never draw more than MAX_FPS (a 240 Hz panel draws 144).
      if (now - last < 1000 / MAX_FPS - 0.5) { raf = requestAnimationFrame(tick); return; }
      const dt = Math.min(100, now - last); last = now;
      const { tl: cur, tempo: tp, onRoundEnd: done, plan: pl } = live.current;
      if (playingRef.current && cur.rounds.length > 0) {
        const round = cur.rounds[roundIndexAt(cur, tRef.current)];
        const base = Math.max(round.buyStartMs, tRef.current);
        const windows = pl ? pl(round) : null;
        if (windows) {
          // Highlight plan: play inside a window, skip the gaps, finish at the round end.
          const adv = advanceHighlighted(windows, base, dt * tp, round.endMs);
          tRef.current = adv.t;
          if (adv.done) { setPlay(false); setTMs(adv.t); lastEmit = now; done?.(round); }
        } else {
          const next = base + dt * tp;
          if (next >= round.endMs) {
            tRef.current = round.endMs;
            setPlay(false);
            setTMs(round.endMs); lastEmit = now;
            done?.(round);
          } else tRef.current = next;
        }
      }
      if (now - lastEmit >= 100) { lastEmit = now; setTMs(tRef.current); }
      for (const fn of subs.current) fn(tRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setPlay]);

  const seek = useCallback((ms: number, opts?: { play?: boolean }) => {
    const { tl: cur } = live.current;
    tRef.current = Math.min(Math.max(ms, cur.startMs), cur.endMs);
    setTMs(tRef.current);
    if (opts?.play != null) setPlay(opts.play);
  }, [setPlay]);

  const api = useMemo(() => ({
    now: () => tRef.current,
    play: () => setPlay(true),
    pause: () => setPlay(false),
    toggle: () => setPlay(!playingRef.current),
    seek,
    subscribe: (fn: (t: number) => void) => { subs.current.add(fn); return () => { subs.current.delete(fn); }; },
  }), [seek, setPlay]);

  return useMemo(() => ({ ...api, tMs, playing }), [api, tMs, playing]);
}
