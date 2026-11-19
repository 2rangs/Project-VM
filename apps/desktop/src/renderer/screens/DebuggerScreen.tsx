// Decision Debugger (Handoff §21, README §29). Renders a DecisionTrace:
// situation (observed/belief vs ground-truth, clearly separated), candidate
// actions with their computed Feasibility/Time/Risk/Utility, EXCLUDED actions
// with reasons, and the selected action + rationale. A debug-only toggle reveals
// the ground-truth column — labeled as a dev tool that does NOT feed the AI.
import { useEffect, useState } from 'react';
import { bridge } from '../platform.ts';
import { parseTrace, predictionById, type DecisionTrace } from '../../shared/trace.ts';
import { useT } from '../i18n/index.tsx';

export function DebuggerScreen({ onJumpToReplay }: { onJumpToReplay?: (roundNum: number) => void }) {
  const t = useT();
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

  if (error) return <div className="pad err">⚠ {t('dbg.error', { msg: error })}</div>;
  if (!trace) return <div className="pad muted">{t('dbg.loading')}</div>;

  const sel = trace.selected;
  return (
    <div className="dbg">
      <div className="dbg-head">
        <select value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="trace-select">
          {ids.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <span className="dbg-meta">
          {t('dbg.meta', { map: trace.mapId, n: trace.roundNumber, time: Math.round(trace.timeRemainingMs / 1000), side: trace.world.decidingSide })}
        </span>
        {trace.provenance.synthetic && <span className="badge synth">{t('dbg.synthetic')}</span>}
        {onJumpToReplay && <button className="jump" onClick={() => onJumpToReplay(trace.roundNumber)}>{t('dbg.viewRound')}</button>}
      </div>

      <div className="dbg-grid">
        <section className="card">
          <h3>{t('dbg.aiSees')} <span className="muted">{t('dbg.aiSees.sub')}</span></h3>
          <div className="kv"><span>{t('dbg.visibleEnemies')}</span><b>{trace.observed.visibleEnemies.length}</b></div>
          {trace.observed.visibleEnemies.map((e) => (
            <div key={e.playerId} className="row small">
              {e.playerId} @ {e.zone} · {e.currentlyVisible ? t('dbg.visibleNow') : t('dbg.msAgo', { ms: e.msAgo })}
            </div>
          ))}
          <div className="kv mt"><span>{t('dbg.topBelief')}</span></div>
          {trace.observed.beliefTopZones.length === 0 && <div className="row small muted">{t('common.none')}</div>}
          {trace.observed.beliefTopZones.map((z) => (
            <div key={z.zone} className="row small">{z.zone} <span className="muted">{t('dbg.pressure', { p: z.pressure })}</span></div>
          ))}
        </section>

        <section className="card truth" data-testid="truth-card" style={{ display: showTruth ? 'block' : 'none' }}>
          <h3>{t('dbg.gtruth')} <span className="warn">{t('dbg.debugOnly')}</span></h3>
          <p className="disclaimer">{t('dbg.truthDisc')}</p>
          <div className="kv"><span>{t('dbg.atkAlive')}</span><b>{trace.world.attackersAlive}</b></div>
          <div className="kv"><span>{t('dbg.defAlive')}</span><b>{trace.world.defendersAlive}</b></div>
          <div className="kv"><span>{t('dbg.knownEnemy')}</span><b>{trace.world.knownEnemyAliveCount ?? '—'}</b></div>
          <div className="kv"><span>{t('dbg.spike')}</span><b>{trace.world.spikePhase}{trace.world.spikeZone ? ` @ ${trace.world.spikeZone}` : ''}</b></div>
        </section>
      </div>
      <label className="toggle"><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} data-testid="truth-toggle" /> {t('dbg.showTruth')}</label>

      <section className="card">
        <h3>{t('dbg.candidates')} <span className="muted">{t('dbg.candidates.sub', { feasible: trace.generated.filter((g) => g.feasible).length, total: trace.generated.length })}</span></h3>
        <table className="tbl">
          <thead><tr><th>{t('dbg.col.action')}</th><th>{t('dbg.col.category')}</th><th>{t('dbg.col.feasible')}</th><th>{t('dbg.col.time')}</th><th>{t('dbg.col.risk')}</th><th>{t('dbg.col.utility')}</th></tr></thead>
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
        <h3>{t('dbg.excluded')} <span className="muted">{t('dbg.excluded.sub', { n: trace.excluded.length })}</span></h3>
        {trace.excluded.length === 0 && <div className="row small muted">{t('dbg.excluded.none')}</div>}
        {trace.excluded.map((e) => (
          <div key={e.id} className="exrow">
            <span className="exid">{e.id}</span>
            <span className="exwhy">{e.explanation}</span>
            <span className="extags">{e.reasons.map((r) => <span key={r} className="tag">{r}</span>)}</span>
          </div>
        ))}
      </section>

      <section className="card selected-card">
        <h3>{t('dbg.selected')}</h3>
        {sel ? (
          <div>
            <div className="selhead">★ {sel.id}
              {predictionById(trace, sel.id) && <span className="muted"> {t('dbg.selected.utility', { u: predictionById(trace, sel.id)!.expectedUtility.toFixed(3) })}</span>}
            </div>
            <p className="rationale">{sel.rationale}</p>
          </div>
        ) : <div className="row small muted">{t('dbg.selected.none')}</div>}
      </section>
    </div>
  );
}
