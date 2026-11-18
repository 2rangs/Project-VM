// Decision Debugger (Handoff §21, README §29). Renders a DecisionTrace:
// situation (observed/belief vs ground-truth, clearly separated), candidate
// actions with their computed Feasibility/Time/Risk/Utility, EXCLUDED actions
// with reasons, and the selected action + rationale. A debug-only toggle reveals
// the ground-truth column — labeled as a dev tool that does NOT feed the AI.
import { useEffect, useState } from 'react';
import { bridge } from '../platform.ts';
import { parseTrace, predictionById, type DecisionTrace } from '../../shared/trace.ts';

export function DebuggerScreen({ onJumpToReplay }: { onJumpToReplay?: (roundNum: number) => void }) {
  const [ids, setIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<string>('');
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [showTruth, setShowTruth] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { bridge.listTraces().then((l) => { setIds(l); setCurrent(l[0] ?? ''); }); }, []);
  useEffect(() => {
    if (!current) return;
    bridge.loadTrace(current)
      .then((j) => { setTrace(parseTrace(j)); setError(null); })
      .catch((e) => { setError((e as Error).message); setTrace(null); });
  }, [current]);

  if (error) return <div className="pad err">⚠ trace: {error}</div>;
  if (!trace) return <div className="pad muted">loading trace…</div>;

  const sel = trace.selected;
  return (
    <div className="dbg">
      <div className="dbg-head">
        <select value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="trace-select">
          {ids.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <span className="dbg-meta">
          {trace.mapId} · R{trace.roundNumber} · {Math.round(trace.timeRemainingMs / 1000)}s left · {trace.world.decidingSide}
        </span>
        {trace.provenance.synthetic && <span className="badge synth">SYNTHETIC</span>}
        {onJumpToReplay && <button className="jump" onClick={() => onJumpToReplay(trace.roundNumber)}>View round in Replay ↗</button>}
      </div>

      <div className="dbg-grid">
        <section className="card">
          <h3>What the AI sees <span className="muted">(observation + belief)</span></h3>
          <div className="kv"><span>Visible enemies</span><b>{trace.observed.visibleEnemies.length}</b></div>
          {trace.observed.visibleEnemies.map((e) => (
            <div key={e.playerId} className="row small">
              {e.playerId} @ {e.zone} · {e.currentlyVisible ? 'visible now' : `${e.msAgo}ms ago`}
            </div>
          ))}
          <div className="kv mt"><span>Top believed enemy zones</span></div>
          {trace.observed.beliefTopZones.length === 0 && <div className="row small muted">none</div>}
          {trace.observed.beliefTopZones.map((z) => (
            <div key={z.zone} className="row small">{z.zone} <span className="muted">pressure {z.pressure}</span></div>
          ))}
        </section>

        <section className="card truth" data-testid="truth-card" style={{ display: showTruth ? 'block' : 'none' }}>
          <h3>Ground truth <span className="warn">· debug only</span></h3>
          <p className="disclaimer">Dev tool. This omniscient state is <b>not</b> an input to the AI (DECISION-004 / §29).</p>
          <div className="kv"><span>Attackers alive</span><b>{trace.world.attackersAlive}</b></div>
          <div className="kv"><span>Defenders alive</span><b>{trace.world.defendersAlive}</b></div>
          <div className="kv"><span>Known enemy alive</span><b>{trace.world.knownEnemyAliveCount ?? '—'}</b></div>
          <div className="kv"><span>Spike</span><b>{trace.world.spikePhase}{trace.world.spikeZone ? ` @ ${trace.world.spikeZone}` : ''}</b></div>
        </section>
      </div>
      <label className="toggle"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} data-testid="truth-toggle" /> show ground-truth column (debug only)</label>

      <section className="card">
        <h3>Candidate actions <span className="muted">({trace.generated.filter((g) => g.feasible).length} feasible of {trace.generated.length})</span></h3>
        <table className="tbl">
          <thead><tr><th>Action</th><th>Category</th><th>Feasible</th><th>Time</th><th>Risk</th><th>Utility</th></tr></thead>
          <tbody>
            {trace.prediction.map((p) => (
              <tr key={p.id} className={sel && p.id === sel.id ? 'selected' : ''}>
                <td>{p.id}{sel && p.id === sel.id ? ' ★' : ''}</td>
                <td className="muted">{p.category}</td>
                <td className="ok">✓</td>
                <td>{(p.requiredTimeMs / 1000).toFixed(1)}s</td>
                <td>{p.estimatedRisk.toFixed(2)}</td>
                <td><b>{p.expectedUtility.toFixed(3)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card excluded" data-testid="excluded-card">
        <h3>Excluded actions <span className="muted">({trace.excluded.length}) — physically/tactically impossible, not just low score</span></h3>
        {trace.excluded.length === 0 && <div className="row small muted">none excluded</div>}
        {trace.excluded.map((e) => (
          <div key={e.id} className="exrow">
            <span className="exid">{e.id}</span>
            <span className="exwhy">{e.explanation}</span>
            <span className="extags">{e.reasons.map((r) => <span key={r} className="tag">{r}</span>)}</span>
          </div>
        ))}
      </section>

      <section className="card selected-card">
        <h3>Selected decision</h3>
        {sel ? (
          <div>
            <div className="selhead">★ {sel.id}
              {predictionById(trace, sel.id) && <span className="muted"> · utility {predictionById(trace, sel.id)!.expectedUtility.toFixed(3)}</span>}
            </div>
            <p className="rationale">{sel.rationale}</p>
          </div>
        ) : <div className="row small muted">no action selected</div>}
      </section>
    </div>
  );
}
