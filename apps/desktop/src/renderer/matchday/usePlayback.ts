// Playback clock for the live match screen. The playhead lives in a ref and advances on
// requestAnimationFrame; per-frame consumers (the PixiJS stage) subscribe to it directly, while
// React only re-renders the HUD ~10×/s through the throttled `tMs` state. Playback always stops
// at the end of the round under the playhead — the caller decides what happens next.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoTempoAt } from './frame.ts';
import { roundIndexAt, type MatchTimeline, type RoundTimeline } from './timeline.ts';
import type { Tempo } from './prefs.ts';

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

export function usePlayback(tl: MatchTimeline, tempo: Tempo, onRoundEnd?: (round: RoundTimeline) => void): Playback {
  const tRef = useRef(tl.startMs);
  const playingRef = useRef(false);
  const [tMs, setTMs] = useState(tl.startMs);
  const [playing, setPlaying] = useState(false);
  const subs = useRef(new Set<(t: number) => void>());
  const live = useRef({ tl, tempo, onRoundEnd });
  live.current = { tl, tempo, onRoundEnd };

  const setPlay = useCallback((v: boolean) => { playingRef.current = v; setPlaying(v); }, []);

  useEffect(() => {
    let raf = 0; let last = performance.now(); let lastEmit = 0;
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); last = now;
      const { tl: cur, tempo: tp, onRoundEnd: done } = live.current;
      if (playingRef.current && cur.rounds.length > 0) {
        const round = cur.rounds[roundIndexAt(cur, tRef.current)];
        const speed = tp === 'auto' ? autoTempoAt(round, tRef.current) : tp;
        const next = Math.max(round.startMs, tRef.current) + dt * speed;
        if (next >= round.endMs) {
          tRef.current = round.endMs;
          setPlay(false);
          setTMs(round.endMs); lastEmit = now;
          done?.(round);
        } else tRef.current = next;
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
