// Simulation Runner. Kicks off a run in the separate process (via the bridge),
// shows streamed progress, and hands the resulting Replay back to the app so the
// Replay screen can play it. The actual simulator is a stub today (swap at
// integration — see README). The renderer only ever sees progress + result.
import { useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import { bridge, runtime } from '../platform.ts';
import type { SimProgress } from '../../shared/ipc.ts';

export function SimulationScreen({ onResult, onOpenReplay }: {
  onResult: (r: Replay, label: string) => void;
  onOpenReplay: () => void;
}) {
  const [seed, setSeed] = useState(42);
  const [rounds, setRounds] = useState(3);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SimProgress | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true); setError(null); setProgress(null); setLog([]); setDone(false);
    try {
      const res = await bridge.runSimulation({ mapId: 'ascent', seed, rounds }, (p) => {
        setProgress(p);
        setLog((l) => [...l, `[${(p.pct * 100).toFixed(0)}%] ${p.phase}${p.round ? ` round ${p.round}` : ''}${p.message ? ` — ${p.message}` : ''}`]);
      });
      // Load the result into the shared replay state, but stay on this screen so
      // the completed log is visible; the user opens it in the Replay tab.
      onResult(res.replay, `sim seed ${seed}`);
      setLog((l) => [...l, `✓ done — ${res.replay.rounds.length} rounds, ${res.replay.tracks.length} tracks (source: ${res.source})`]);
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setRunning(false); }
  }

  return (
    <div className="sim pad">
      <h2>Simulation Runner</h2>
      <p className="muted">
        Runs in a <b>separate process</b> from the UI (DECISION-007); the renderer receives only progress and the result.
        Engine today is a <b>stub</b> emitting a synthetic event log — swapped for <code>@pv/round-simulator</code> at integration.
        Runtime: <b>{runtime}</b>.
      </p>
      <div className="simctl">
        <label>seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={running} /></label>
        <label>rounds <input type="number" min={1} max={12} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} disabled={running} /></label>
        <button onClick={run} disabled={running} data-testid="run-sim">{running ? 'Running…' : '▶ Run stub simulation'}</button>
      </div>
      {progress && (
        <div className="bar"><div className="barfill" style={{ width: `${Math.round(progress.pct * 100)}%` }} /></div>
      )}
      {error && <div className="err">⚠ {error}</div>}
      <pre className="simlog" data-testid="sim-log">{log.join('\n')}</pre>
      {done && (
        <button className="openreplay" data-testid="open-sim-replay" onClick={onOpenReplay}>▶ Open result in Replay tab</button>
      )}
    </div>
  );
}
