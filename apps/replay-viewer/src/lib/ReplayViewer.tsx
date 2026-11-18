// Reusable replay viewer surface: PixiJS minimap stage + playback controls +
// timeline + round jumps + source badge. Host-agnostic — the Electron desktop
// app and the standalone web app both render this and only differ in how they
// LOAD a Replay (file/drag/fetch/IPC). Pure presentation of engine state;
// playback speed never changes computed state (DECISION-010).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadReplay, replayBounds, stateAt, type Replay } from '@pv/replay-engine';
import { ReplayStage } from './PixiStage.ts';

const SPEEDS = [0.5, 1, 2, 4];

export type MinimapResolver = (displayName: string | null) => Promise<string | null>;

export async function valorantApiMinimap(displayName: string | null): Promise<string | null> {
  if (!displayName) return null;
  try {
    const r = await fetch('https://valorant-api.com/v1/maps');
    const data = (await r.json()).data as Array<{ displayName: string; displayIcon: string | null }>;
    return data.find((x) => x.displayName?.toLowerCase() === displayName.toLowerCase())?.displayIcon ?? null;
  } catch { return null; }
}

export interface ReplayViewerProps {
  replay: Replay | null;
  /** Seek here (ms) whenever the replay changes; else start at the beginning. */
  initialSeekMs?: number | null;
  /** How to resolve the minimap image; defaults to valorant-api. */
  minimapResolver?: MinimapResolver;
  size?: number;
  /** Notified on every seek, so a host (e.g. the debugger) can sync. */
  onSeek?: (ms: number) => void;
  /** External seek requests (e.g. "jump to this decision time"). */
  seekTo?: number | null;
}

export function ReplayViewer({
  replay, initialSeekMs, minimapResolver = valorantApiMinimap, size = 760, onSeek, seekTo,
}: ReplayViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReplayStage | null>(null);
  const [ready, setReady] = useState(false);
  const [mapLoaded, setMapLoaded] = useState<boolean | null>(null);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const safeReplay = replay ? loadReplay(replay) : null;
  const bounds = useMemo(
    () => (safeReplay ? replayBounds(safeReplay) : { startMs: 0, endMs: 0 }),
    [safeReplay],
  );

  const seek = useCallback((ms: number) => { setPlaying(false); setTMs(ms); onSeek?.(ms); }, [onSeek]);

  useEffect(() => {
    const stage = new ReplayStage();
    stageRef.current = stage;
    if (mountRef.current) stage.init(mountRef.current, size).then(() => setReady(true));
    return () => stage.destroy();
  }, [size]);

  // (re)load map + event markers when the replay changes
  useEffect(() => {
    if (!safeReplay || !stageRef.current) return;
    let alive = true;
    (async () => {
      const url = await minimapResolver(safeReplay.meta.mapDisplayName ?? null);
      if (!alive) return;
      const ok = await stageRef.current!.setMap(url);
      setMapLoaded(ok);
      stageRef.current!.drawEvents(safeReplay);
    })();
    const b = replayBounds(safeReplay);
    setTMs(initialSeekMs != null ? Math.min(b.endMs, Math.max(b.startMs, initialSeekMs)) : b.startMs);
    setPlaying(false);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  // external seek requests
  useEffect(() => { if (seekTo != null) seek(seekTo); /* eslint-disable-next-line */ }, [seekTo]);

  // playback clock
  useEffect(() => {
    if (!playing || !safeReplay) return;
    let raf = 0; let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setTMs((prev) => {
        const next = prev + dt * speed;
        if (next >= bounds.endMs) { setPlaying(false); return bounds.endMs; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, safeReplay, bounds.endMs]);

  // render current instant
  useEffect(() => {
    if (ready && safeReplay && stageRef.current) stageRef.current.render(stateAt(safeReplay, tMs), safeReplay);
  }, [ready, safeReplay, tMs]);

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="rv">
      <div className="rv-stageWrap">
        <div ref={mountRef} className="rv-stage" data-testid="pixi-stage" />
        {safeReplay && (
          <span className={`rv-src rv-src-${safeReplay.meta.source}`}>
            {safeReplay.meta.source.toUpperCase()} · {safeReplay.meta.mapDisplayName ?? safeReplay.meta.mapId}
            {safeReplay.meta.seed != null ? ` · seed ${safeReplay.meta.seed}` : ''}
          </span>
        )}
        {mapLoaded === false && <div className="rv-maphint">minimap image unavailable (offline) — neutral backdrop</div>}
      </div>

      <div className="rv-controls">
        <button data-testid="playpause" onClick={() => setPlaying((p) => !p)} disabled={!safeReplay}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <div className="rv-speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <input
          className="rv-scrub" type="range" min={bounds.startMs} max={bounds.endMs} step={50}
          value={tMs} onChange={(e) => seek(Number(e.target.value))} disabled={!safeReplay}
        />
        <span className="rv-clock">{fmt(tMs - bounds.startMs)} / {fmt(bounds.endMs - bounds.startMs)}</span>
      </div>

      <div className="rv-rounds">
        <span>Rounds:</span>
        {safeReplay?.rounds.map((r) => (
          <button key={r.roundNum} onClick={() => seek(r.startMs)}>R{r.roundNum}</button>
        ))}
      </div>
    </div>
  );
}
