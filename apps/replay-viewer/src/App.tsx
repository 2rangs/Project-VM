import { useCallback, useEffect, useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import { ReplayViewer, viewerCss } from './lib/index.ts';

const DEFAULT_FIXTURE = '/fixtures/synthetic-replay.json';

/** Standalone web host: handles LOADING a replay (fetch/drop/file); the shared
 *  ReplayViewer renders it. The Electron app reuses the same ReplayViewer. */
export default function App() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openObject = useCallback((obj: unknown, label: string) => {
    try { setReplay(obj as Replay); setError(null); } catch (e) { setError(`${label}: ${(e as Error).message}`); }
  }, []);

  const openUrl = useCallback(async (url: string) => {
    try { const r = await fetch(url); openObject(await r.json(), url); }
    catch (e) { setError(`fetch ${url}: ${(e as Error).message}`); }
  }, [openObject]);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get('t');
    if (t != null) setSeekMs(Number(t));
    void openUrl(q.get('replay') || DEFAULT_FIXTURE);
  }, [openUrl]);

  const onDrop = useCallback(async (ev: React.DragEvent) => {
    ev.preventDefault();
    const file = ev.dataTransfer.files[0];
    if (!file) return;
    try { openObject(JSON.parse(await file.text()), file.name); }
    catch (e) { setError(`${file.name}: ${(e as Error).message}`); }
  }, [openObject]);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <style>{viewerCss}</style>
      <header><h1>PROJECT V — Replay Viewer</h1></header>
      <ReplayViewer replay={replay} initialSeekMs={seekMs} />
      <footer>
        <label className="fileopen">
          Open replay…
          <input type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) openObject(JSON.parse(await f.text()), f.name); }} />
        </label>
        <span className="hint">…or drag a replay JSON onto the window.</span>
        {error && <span className="err">⚠ {error}</span>}
      </footer>
    </div>
  );
}
