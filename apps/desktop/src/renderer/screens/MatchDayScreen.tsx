// Match Day — the match view. Reuses the shared ReplayViewer for the 2D minimap,
// runs the match through the SimulationRunner (stub today, separate process), and
// shows economy / ultimate / coach-note / event panels.
//
// NOTE (freeze): the information-warfare fog-of-war render (show only what our
// team observes) and the Belief heatmap overlay are a TODO — they need PV-3
// Belief State output. Everything shown as economy/ultimate here is SYNTHETIC
// stub data, labelled as such. See apps/desktop handoff.
import { useEffect, useMemo, useState } from 'react';
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { bridge, runtime } from '../platform.ts';
import { parseTrace, type DecisionTrace } from '../../shared/trace.ts';
import { teams } from '../data.ts';

const BUY_TYPES = ['eco', 'half', 'force', 'full'] as const;
function synthEconomy(seed: number) {
  const rng = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
  return [0, 1].map((team) => ({
    team, credits: 1500 + Math.floor(rng(team) * 6000),
    buy: BUY_TYPES[Math.floor(rng(team + 3) * 4)],
    ult: Math.floor(rng(team + 7) * 7), ultCost: 7,
  }));
}

export function MatchDayScreen({ ctx }: { ctx: ScreenCtx }) {
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const allTeams = useMemo(() => teams().sort((a, b) => a.name.localeCompare(b.name)), []);
  const [teamA, setTeamA] = useState('NRG');
  const [teamB, setTeamB] = useState('Team Heretics');
  const [seed, setSeed] = useState(42);
  const [rounds, setRounds] = useState(5);
  const replay = ctx.replay;
  const econ = synthEconomy(replay?.meta.seed ?? 1);

  useEffect(() => { bridge.loadTrace('trace-scenario-01').then((j) => setTrace(parseTrace(j))).catch(() => {}); }, []);

  async function runMatch() {
    setRunning(true); setPct(0); setLog([]);
    try {
      const res = await bridge.runSimulation({ mapId: 'ascent', seed, rounds }, (p) => {
        setPct(p.pct);
        if (p.message) setLog((l) => [...l, p.message!]);
      });
      ctx.setReplay(res.replay as Replay);
      setLog((l) => [...l, `✓ ${res.source} · ${res.replay.rounds.length} rounds`]);
    } catch (e) { setLog((l) => [...l, `⚠ ${(e as Error).message}`]); } finally { setRunning(false); }
  }

  const engineLabel = runtime === 'electron' ? '@pv/round-simulator (real, separate process)' : 'stub (browser fallback)';

  return (
    <div className="matchday">
      <div className="md-main">
        <div className="md-teamsel">
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)} disabled={running} data-testid="team-a">
            {allTeams.map((t) => <option key={t.teamId} value={t.name}>{t.name}</option>)}
          </select>
          <span className="vs">vs</span>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)} disabled={running} data-testid="team-b">
            {allTeams.map((t) => <option key={t.teamId} value={t.name}>{t.name}</option>)}
          </select>
          <label className="md-seed">seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={running} /></label>
          <label className="md-seed">Bo<input type="number" min={1} max={13} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} disabled={running} /></label>
        </div>
        <div className="md-toolbar">
          <button className="md-run" onClick={runMatch} disabled={running} data-testid="run-match">
            {running ? `Simulating… ${Math.round(pct * 100)}%` : '▶ Run match'}
          </button>
          <span className="pill">{engineLabel}</span>
          <span className="muted small">fog-of-war + Belief heatmap: 준비 중 (needs PV-3 Belief State)</span>
        </div>
        {log.length > 0 && <div className="md-roundlog small muted">{log.join('  ·  ')}</div>}
        {replay ? <ReplayViewer replay={replay} /> : (
          <div className="md-empty muted">Run the match to generate a replay, or open one in the viewer.</div>
        )}
        <div className="md-feed" data-testid="event-feed">
          <div className="attr-grouplabel">Event feed <span className="muted small">(text play-by-play)</span></div>
          {(replay?.events ?? []).slice(0, 10).map((e, i) => (
            <div key={i} className="feed-row">
              <span className="feed-t">{Math.round(e.tMs / 1000)}s</span>
              <span className={`feed-kind k-${e.kind}`}>{e.kind}</span>
              <span className="muted small">{e.actorId ?? ''}{e.victimId ? ` → ${e.victimId}` : ''}</span>
            </div>
          ))}
          {!replay && <div className="row small muted">no events yet</div>}
        </div>
      </div>

      <aside className="md-side">
        <section className="md-card" data-testid="economy-panel">
          <h3>Economy <span className="pill synth">stub</span></h3>
          {econ.map((e) => (
            <div key={e.team} className="econ-team">
              <b>{e.team === 0 ? 'Attack' : 'Defense'}</b>
              <span className="econ-credits">{e.credits}c</span>
              <span className={`buy-badge buy-${e.buy}`}>{e.buy}</span>
            </div>
          ))}
          <div className="save-alert">💡 Save recommended: preserve Operator (est. value +0.3 next round) <span className="muted small">— economy-engine (stub)</span></div>
        </section>

        <section className="md-card" data-testid="ult-panel">
          <h3>Ultimates <span className="pill synth">stub</span></h3>
          {econ.map((e) => (
            <div key={e.team} className="ult-team">
              <b>{e.team === 0 ? 'Attack' : 'Defense'}</b>
              <span className="ult-pts">{e.ult}/{e.ultCost}</span>
              {e.ult === e.ultCost - 1 && <span className="warn small">⚠ 1 pt away — deny value</span>}
            </div>
          ))}
        </section>

        <section className="md-card coachnote" data-testid="coach-note">
          <h3>Coach note</h3>
          {trace ? (
            <p className="note">
              IGL ({trace.world.decidingSide}) chose <b>{trace.selected?.id ?? '—'}</b> with {trace.timeRemainingMs / 1000}s left.
              {' '}{trace.selected?.rationale ?? ''} {trace.excluded.length > 0 && <span className="muted">· {trace.excluded.length} option(s) ruled out (time/space).</span>}
              <span className="muted small"> — full candidates in Dev → Decision Debugger.</span>
            </p>
          ) : <div className="row small muted">loading trace…</div>}
        </section>

        <section className="md-card" data-testid="round-timeline">
          <h3>Round timeline</h3>
          <div className="rtl">
            {(replay?.rounds ?? []).map((r) => (
              <div key={r.roundNum} className="rtl-round">R{r.roundNum}</div>
            ))}
            {!replay && <div className="row small muted">no rounds yet</div>}
          </div>
        </section>
      </aside>
    </div>
  );
}
