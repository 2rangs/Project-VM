import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadReplay, replayBounds, stateAt, type Replay } from '@pv/replay-engine';
import { ReplayStage } from './viewer/PixiStage.ts';

const SPEEDS = [0.5, 1, 2, 4];
const DEFAULT_FIXTURE = '/fixtures/synthetic-replay.json';

async function resolveMinimap(displayName: string | null): Promise<string | null> {
  if (!displayName) return null;
  try {
    const r = await fetch('https://valorant-api.com/v1/maps');
    const data = (await r.json()).data as Array<{ displayName: string; displayIcon: string | null }>;
    const m = data.find((x) => x.displayName?.toLowerCase() === displayName.toLowerCase());
    return m?.displayIcon ?? null;
  } catch { return null; }
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<ReplayStage | null>(null);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [mapLoaded, setMapLoaded] = useState<boolean | null>(null);
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(() => (replay ? replayBounds(replay) : { startMs: 0, endMs: 0 }), [replay]);

  // init Pixi once
  useEffect(() => {
    const stage = new ReplayStage();
    stageRef.current = stage;
    if (mountRef.current) stage.init(mountRef.current, 760).then(() => setReady(true));
    return () => stage.destroy();
  }, []);

  // load ?replay=<url> if given, else the default synthetic fixture
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('replay');
    void openUrl(q || DEFAULT_FIXTURE);
  }, []);

  const loadReplayObject = useCallback(async (obj: unknown, label: string) => {
    try {
      const r = loadReplay(obj);
      setReplay(r);
      setError(null);
      setPlaying(false);
      const b = replayBounds(r);
      const qt = new URLSearchParams(window.location.search).get('t');
      setTMs(qt != null ? Math.min(b.endMs, Math.max(b.startMs, Number(qt))) : b.startMs);
      const url = await resolveMinimap(r.meta.mapDisplayName ?? null);
      const ok = await stageRef.current?.setMap(url);
      setMapLoaded(ok ?? false);
      stageRef.current?.drawEvents(r);
    } catch (e) { setError(`${label}: ${(e as Error).message}`); }
  }, []);

  const openUrl = useCallback(async (url: string) => {
    try { const r = await fetch(url); await loadReplayObject(await r.json(), url); }
    catch (e) { setError(`fetch ${url}: ${(e as Error).message}`); }
  }, [loadReplayObject]);

  const onDrop = useCallback(async (ev: React.DragEvent) => {
    ev.preventDefault();
    const file = ev.dataTransfer.files[0];
    if (!file) return;
    try { await loadReplayObject(JSON.parse(await file.text()), file.name); }
    catch (e) { setError(`${file.name}: ${(e as Error).message}`); }
  }, [loadReplayObject]);

  // playback clock — advances wall time * speed; state computation is independent (DECISION-010)
  useEffect(() => {
    if (!playing || !replay) return;
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
  }, [playing, speed, replay, bounds.endMs]);

  // render current instant whenever time, replay, or readiness changes
  useEffect(() => {
    if (ready && replay && stageRef.current) stageRef.current.render(stateAt(replay, tMs), replay);
  }, [ready, replay, tMs]);

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header>
        <h1>PROJECT V — Replay Viewer</h1>
        {replay && (
          <span className={`src src-${replay.meta.source}`}>
            {replay.meta.source.toUpperCase()} · {replay.meta.mapDisplayName ?? replay.meta.mapId}
            {replay.meta.seed != null ? ` · seed ${replay.meta.seed}` : ''}
          </span>
        )}
      </header>

      <div className="stageWrap">
        <div ref={mountRef} className="stage" data-testid="pixi-stage" />
        {mapLoaded === false && <div className="maphint">minimap image unavailable (offline) — positions shown on neutral backdrop</div>}
      </div>

      <div className="controls">
        <button data-testid="playpause" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ Pause' : '▶ Play'}</button>
        <div className="speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </div>
        <input
          className="scrub" type="range" min={bounds.startMs} max={bounds.endMs} step={50}
          value={tMs} onChange={(e) => { setPlaying(false); setTMs(Number(e.target.value)); }}
        />
        <span className="clock">{fmt(tMs - bounds.startMs)} / {fmt(bounds.endMs - bounds.startMs)}</span>
      </div>

      <div className="rounds">
        <span>Rounds:</span>
        {replay?.rounds.map((r) => (
          <button key={r.roundNum} onClick={() => { setPlaying(false); setTMs(r.startMs); }}>R{r.roundNum}</button>
        ))}
      </div>

      <footer>
        <label className="fileopen">
          Open replay…
          <input type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await loadReplayObject(JSON.parse(await f.text()), f.name); }} />
        </label>
        <span className="hint">…or drag a replay JSON onto the window.</span>
        {error && <span className="err">⚠ {error}</span>}
      </footer>
    </div>
  );
}
