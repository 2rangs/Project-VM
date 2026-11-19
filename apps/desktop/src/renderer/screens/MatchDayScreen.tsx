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
import { ZONE_POSITIONS } from '../zones.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { useT, strategyLabel } from '../i18n/index.tsx';

export function MatchDayScreen({ ctx }: { ctx: ScreenCtx }) {
  const t = useT();
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
  const [pov, setPov] = useState(0);            // fog point of view: 0 = our team (A), 1 = B
  const [beliefOn, setBeliefOn] = useState(false);
  const [tab, setTab] = useState<'match' | 'review'>('match'); // post-match review tab
  const replay = ctx.replay;
  const refOf = (name: string) => { const t = allTeams.find((x) => x.name === name); return { id: t?.teamId ?? name, name }; };
  const lastRound = match?.rounds[match.rounds.length - 1];
  const hasPerception = !!(replay?.perception && replay.perception.length > 0);
  // POV labels: real match team names when we have them, else the demo/fixture teams.
  const povName = (i: number) => match?.teams[i === 0 ? 'A' : 'B']?.name ?? t(i === 0 ? 'md.povName.our' : 'md.povName.opp');

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

  const engineLabel = source === 'match-runner' ? t('md.engine.matchRunner')
    : source ? t('md.engine.fallback', { src: source }) : (runtime === 'electron' ? t('md.engine.default') : t('md.engine.stub'));

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
          <label className="md-seed">{t('md.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={running} /></label>
          <button className="md-run" onClick={runMatch} disabled={running} data-testid="run-match">
            {running ? t('md.simulating', { pct: Math.round(pct * 100) }) : t('md.run')}
          </button>
        </div>
        {match && (
          <div className="md-tabs" data-testid="md-tabs">
            <button className={tab === 'match' ? 'on' : ''} onClick={() => setTab('match')} data-testid="tab-match">{t('md.tab.match')}</button>
            <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')} data-testid="tab-review">{t('md.tab.review')}</button>
          </div>
        )}
        {tab === 'review' && match ? (
          <ReviewPanel match={match} replay={replay} />
        ) : (
        <>
        <div className="md-toolbar" data-testid="fog-toolbar">
          <span className="pill">{engineLabel}</span>
          {hasPerception ? (
            <>
              <span className="fog-tag" data-testid="fog-on">{t('md.fog.on')}</span>
              <label className="fog-ctl">{t('md.fog.pov')}
                <select value={pov} onChange={(e) => setPov(Number(e.target.value))} data-testid="fog-pov">
                  <option value={0}>{povName(0)}</option>
                  <option value={1}>{povName(1)}</option>
                </select>
              </label>
              <label className="fog-ctl">
                <input type="checkbox" checked={beliefOn} onChange={(e) => setBeliefOn(e.target.checked)} data-testid="fog-belief" />
                {t('md.fog.belief')}
              </label>
              <span className="muted small">{t('md.fog.hint')}</span>
            </>
          ) : (
            <span className="muted small">{t('md.fog.need')}</span>
          )}
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

        {replay ? (
          <ReplayViewer
            replay={replay}
            perceptionPovTeamIdx={hasPerception ? pov : null}
            showBelief={beliefOn}
            zonePositions={ZONE_POSITIONS}
          />
        ) : (
          <div className="md-empty muted">{t('md.empty')}</div>
        )}

        {match && (
          <div className="roundstrip" data-testid="roundstrip">
            {match.rounds.map((r) => (
              <span key={r.roundNumber} className={`rs-dot rs-${r.winner === 'A' ? 'a' : 'b'} ${r.phase === 'pistol' ? 'pistol' : ''}`} title={`R${r.roundNumber} ${r.phase}: ${r.winner} (${r.reason})`}>{r.roundNumber}</span>
            ))}
          </div>
        )}

        <div className="md-feed" data-testid="event-feed">
          <div className="attr-grouplabel">{t('md.feed.title')} <span className="muted small">{t('md.feed.sub')}</span></div>
          {(replay?.events ?? []).slice(0, 10).map((e, i) => (
            <div key={i} className="feed-row">
              <span className="feed-t">{Math.round(e.tMs / 1000)}s</span>
              <span className={`feed-kind k-${e.kind}`}>{e.kind}</span>
              <span className="muted small">{e.actorId ?? ''}{e.victimId ? ` → ${e.victimId}` : ''}</span>
            </div>
          ))}
          {!replay && <div className="row small muted">{t('md.feed.none')}</div>}
        </div>
        </>
        )}
      </div>

      {!(tab === 'review' && match) && (
      <aside className="md-side">
        <section className="md-card" data-testid="economy-panel">
          <h3>{t('md.econ.title')} {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="econ-team">
              <b>{match!.teams[s].name}</b>
              <span className="econ-credits">{lastRound.economy[s].credits}c</span>
              <span className={`buy-badge buy-${lastRound.buys[s].tier}`}>{t(`buy.${lastRound.buys[s].tier}`)}</span>
            </div>
          )) : <div className="row small muted">{t('md.econ.run')}</div>}
          {lastRound && <div className="save-alert">{t('md.econ.buys', { a: match!.teams.A.name, aw: lastRound.buys.A.weapon, b: match!.teams.B.name, bw: lastRound.buys.B.weapon })} <span className="muted small">{t('md.econ.engine')}</span></div>}
        </section>

        <section className="md-card" data-testid="ult-panel">
          <h3>{t('md.ult.title')} {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="ult-team">
              <b>{match!.teams[s].name}</b>
              <span className="ult-pts">{t('md.ult.pts', { n: lastRound.economy[s].ultPoints })}</span>
            </div>
          )) : <div className="row small muted">{t('md.ult.run')}</div>}
        </section>

        <section className="md-card coachnote" data-testid="coach-note">
          <h3>{t('md.coach.title')}</h3>
          {trace ? (
            <p className="note">
              {t('md.coach.chose', { side: trace.world.decidingSide, time: trace.timeRemainingMs / 1000, action: strategyLabel(t, trace.selected?.id) })}
              {' '}{trace.selected?.rationale ?? ''} {trace.excluded.length > 0 && <span className="muted">{t('md.coach.ruledOut', { n: trace.excluded.length })}</span>}
              <span className="muted small">{t('md.coach.candidates')}</span>
            </p>
          ) : <div className="row small muted">{t('md.coach.loading')}</div>}
        </section>
      </aside>
      )}
    </div>
  );
}
