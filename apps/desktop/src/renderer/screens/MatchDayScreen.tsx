// Match Day — the match view. Reuses the shared ReplayViewer for the 2D minimap,
// runs a full map through @pv/match-runner (pistol → halves → first-to-13 → OT,
// with economy + ultimate carryover) in a separate process, and shows the
// match-level scoreboard + real economy / ultimate / coach-note / event panels.
//
// TODO: the information-warfare fog-of-war render and the Belief heatmap overlay
// need PV-4's recordPerception output (Replay.perception, already defined in
// @pv/replay-engine). Until then the match plays with full visibility.
import { useEffect, useMemo, useState } from 'react';
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { bridge, runtime } from '../platform.ts';
import { parseTrace, type DecisionTrace } from '../../shared/trace.ts';
import type { MatchSummary } from '../../shared/ipc.ts';
import { teams } from '../data.ts';

export function MatchDayScreen({ ctx }: { ctx: ScreenCtx }) {
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [source, setSource] = useState<string>('');
  const allTeams = useMemo(() => teams().sort((a, b) => a.name.localeCompare(b.name)), []);
  const [teamA, setTeamA] = useState('NRG');
  const [teamB, setTeamB] = useState('Team Heretics');
  const [seed, setSeed] = useState(42);
  const replay = ctx.replay;
  const refOf = (name: string) => { const t = allTeams.find((x) => x.name === name); return { id: t?.teamId ?? name, name }; };
  const lastRound = match?.rounds[match.rounds.length - 1];

  useEffect(() => { bridge.loadTrace('trace-scenario-01').then((j) => setTrace(parseTrace(j))).catch(() => {}); }, []);

  async function runMatch() {
    setRunning(true); setPct(0); setLog([]); setMatch(null);
    try {
      const res = await bridge.runSimulation(
        { mapId: 'ascent', seed, rounds: 13, teamA: refOf(teamA), teamB: refOf(teamB) },
        (p) => { setPct(p.pct); if (p.message) setLog((l) => [...l.slice(-3), p.message!]); },
      );
      ctx.setReplay(res.replay as Replay);
      setMatch(res.match ?? null);
      setSource(res.source);
    } catch (e) { setLog((l) => [...l, `⚠ ${(e as Error).message}`]); } finally { setRunning(false); }
  }

  const engineLabel = source === 'match-runner' ? '@pv/match-runner (real match, separate process)'
    : source ? `${source} (fallback)` : (runtime === 'electron' ? '@pv/match-runner' : 'stub (browser)');

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
          <button className="md-run" onClick={runMatch} disabled={running} data-testid="run-match">
            {running ? `Simulating… ${Math.round(pct * 100)}%` : '▶ Run match'}
          </button>
        </div>
        <div className="md-toolbar">
          <span className="pill">{engineLabel}</span>
          <span className="muted small">fog-of-war + Belief heatmap: 준비 중 (needs PV-4 recordPerception)</span>
        </div>
        {log.length > 0 && <div className="md-roundlog small muted">{log.join('  ·  ')}</div>}

        {match && (
          <div className="scoreboard" data-testid="scoreboard">
            <span className={`sb-team ${match.winner === 'A' ? 'win' : ''}`}>{match.teams.A.name}</span>
            <span className="sb-score">{match.score.A}</span>
            <span className="sb-dash">–</span>
            <span className="sb-score">{match.score.B}</span>
            <span className={`sb-team ${match.winner === 'B' ? 'win' : ''}`}>{match.teams.B.name}</span>
            {match.wentToOvertime && <span className="sb-ot">OT</span>}
          </div>
        )}

        {replay ? <ReplayViewer replay={replay} /> : (
          <div className="md-empty muted">Pick two teams and run the match.</div>
        )}

        {match && (
          <div className="roundstrip" data-testid="roundstrip">
            {match.rounds.map((r) => (
              <span key={r.roundNumber} className={`rs-dot rs-${r.winner === 'A' ? 'a' : 'b'} ${r.phase === 'pistol' ? 'pistol' : ''}`} title={`R${r.roundNumber} ${r.phase}: ${r.winner} (${r.reason})`}>{r.roundNumber}</span>
            ))}
          </div>
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
          <h3>Economy {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="econ-team">
              <b>{match!.teams[s].name}</b>
              <span className="econ-credits">{lastRound.economy[s].credits}c</span>
              <span className={`buy-badge buy-${lastRound.buys[s].tier}`}>{lastRound.buys[s].tier}</span>
            </div>
          )) : <div className="row small muted">run a match for real economy</div>}
          {lastRound && <div className="save-alert">Buys: {match!.teams.A.name} {lastRound.buys.A.weapon} · {match!.teams.B.name} {lastRound.buys.B.weapon} <span className="muted small">— economy-engine</span></div>}
        </section>

        <section className="md-card" data-testid="ult-panel">
          <h3>Ultimates {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="ult-team">
              <b>{match!.teams[s].name}</b>
              <span className="ult-pts">{lastRound.economy[s].ultPoints} pts</span>
            </div>
          )) : <div className="row small muted">run a match for ultimate points</div>}
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
      </aside>
    </div>
  );
}
