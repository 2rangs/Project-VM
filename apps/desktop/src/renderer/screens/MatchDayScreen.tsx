// Match Day — the match view. Reuses the shared ReplayViewer for the 2D minimap.
// Two modes:
//  - One-shot: run a whole map through @pv/match-runner in one subprocess call.
//  - Interactive: drive a stateful @pv/match-runner MatchSession round by round,
//    calling tactical timeouts (2 per team) and issuing coach orders between rounds;
//    the AI opponent calls its own timeouts. Both show the fog-of-war view, the
//    match scoreboard and real economy / ultimate panels; the post-match Review tab
//    adds the timeout log.
import { useEffect, useMemo, useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { bridge, runtime } from '../platform.ts';
import { parseTrace, type DecisionTrace } from '../../shared/trace.ts';
import type { MatchSummary, TeamOrder } from '../../shared/ipc.ts';
import { teams } from '../data.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { useMatchSession } from '../useMatchSession.ts';
import { useT, strategyLabel } from '../i18n/index.tsx';
import { LiveMatch } from './matchday/LiveMatch.tsx';
import { MatchHub } from './matchday/MatchHub.tsx';
import { LoadingScreen } from '../loading/Loading.tsx';

export function MatchDayScreen({ ctx }: { ctx: ScreenCtx }) {
  const t = useT();
  const [mode, setMode] = useState<'oneshot' | 'interactive'>('oneshot');
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  // Loading screen state for a one-shot run: latest round/score from the runner, and a failure message.
  const [simStep, setSimStep] = useState<{ round: number; a: number; b: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [dismissedSessError, setDismissedSessError] = useState<string | null>(null);
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [source, setSource] = useState<string>('');
  const allTeams = useMemo(() => teams().sort((a, b) => a.name.localeCompare(b.name)), []);
  const [teamA, setTeamA] = useState('NRG');
  const [teamB, setTeamB] = useState('Team Heretics');
  const [seed, setSeed] = useState(42);
  // Full-window live view (matchday/LiveMatch). Opens when a match starts; closing it returns
  // to the shell (MatchHub) without stopping the session.
  const [immersive, setImmersive] = useState(false);
  const [tab, setTab] = useState<'match' | 'review'>('match');
  const [autoPlay, setAutoPlay] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const sess = useMatchSession();

  const interactive = mode === 'interactive';
  const matchForView = interactive ? sess.match : match;
  const replay = ctx.replay;
  const refOf = (name: string) => { const x = allTeams.find((y) => y.name === name); return { id: x?.teamId ?? name, name }; };
  const lastRound = matchForView?.rounds[matchForView.rounds.length - 1];
  const busyControls = running || sess.busy;

  useEffect(() => { bridge.loadTrace('trace-scenario-01').then((j) => setTrace(parseTrace(j))).catch(() => {}); }, []);
  // In interactive mode, mirror the session's live replay into shared ctx (Dev etc.).
  useEffect(() => { if (interactive && sess.replay) ctx.setReplay(sess.replay); }, [interactive, sess.replay, ctx]);
  // (Auto-play now lives in LiveMatch: it advances once the round has been watched.)

  async function runMatch() {
    setRunning(true); setPct(0); setLog([]); setMatch(null); setSimStep(null); setRunError(null);
    try {
      const res = await bridge.runSimulation(
        { mapId: 'ascent', seed, rounds: 13, teamA: refOf(teamA), teamB: refOf(teamB) },
        (p) => {
          setPct(p.pct);
          if (p.round != null && p.score) setSimStep({ round: p.round, a: p.score.A, b: p.score.B });
          if (p.message) setLog((l) => [...l.slice(-3), p.message!]);
        },
      );
      ctx.setReplay(res.replay as Replay);
      setMatch(res.match ?? null);
      setSource(res.source);
      setTab('match'); setImmersive(true);
    } catch (e) { setRunError((e as Error).message); setLog((l) => [...l, `⚠ ${(e as Error).message}`]); } finally { setRunning(false); }
  }

  async function startInteractive() {
    setTab('match'); setAutoPlay(false); setOrdersOpen(false); setSource('match-runner'); setImmersive(true);
    await sess.start({ mapId: 'ascent', seed, teamA: refOf(teamA), teamB: refOf(teamB), aiTeams: ['B'] });
  }
  async function callTimeout() { await sess.callTimeout('A'); setOrdersOpen(true); }
  async function confirmOrders(order: TeamOrder) { await sess.setOrders('A', order); setOrdersOpen(false); }

  const engineLabel = source === 'match-runner' ? t('md.engine.matchRunner')
    : source ? t('md.engine.fallback', { src: source }) : (runtime === 'electron' ? t('md.engine.default') : t('md.engine.stub'));
  const st = sess.state;

  // Live view: full-window, replaces the shell while a match is being played or watched.
  const liveAvailable = interactive ? sess.active : !!replay && source !== '';
  if (immersive && tab === 'match' && liveAvailable) {
    return (
      <LiveMatch
        replay={interactive ? sess.replay : replay}
        match={matchForView}
        teams={matchForView?.teams ?? { A: refOf(teamA), B: refOf(teamB) }}
        sourceLabel={engineLabel}
        session={interactive && st ? {
          state: st, busy: sess.busy, error: sess.error, feed: sess.feed, timeoutLog: sess.timeoutLog, ordersOpen,
          onNext: () => { void sess.playNext(); },
          onTimeout: () => { void callTimeout(); },
          onConfirmOrders: (o) => { void confirmOrders(o); },
          onCancelOrders: () => setOrdersOpen(false),
        } : null}
        autoPlay={autoPlay} onAutoPlay={setAutoPlay}
        onExit={() => setImmersive(false)}
        onReview={matchForView ? () => { setImmersive(false); setTab('review'); } : null}
      />
    );
  }

  // Loading / failure surfaces: shown only while the work is pending or until the error is dismissed.
  const sessStarting = interactive && sess.busy && !sess.active;
  const sessStartError = interactive && !sess.active && sess.error && sess.error !== dismissedSessError ? sess.error : null;
  const versus = `${teamA} vs ${teamB}`;

  return (
    <div className="matchday">
      {running && (
        <LoadingScreen cover="window" title={t('load.sim.title')} detail={`${versus} · Ascent`}
          progress={simStep ? pct : null} steps={simStep ? t('load.sim.steps', { n: simStep.round, a: simStep.a, b: simStep.b }) : t('load.sim.starting')} />
      )}
      {!running && runError && (
        <LoadingScreen cover="window" title={t('load.sim.failed')} error={runError} onRetry={() => { void runMatch(); }} onDismiss={() => setRunError(null)} />
      )}
      {sessStarting && <LoadingScreen cover="window" title={t('load.session.title')} detail={`${versus} · Ascent`} steps={t('load.session.steps')} />}
      {!sessStarting && sessStartError && (
        <LoadingScreen cover="window" title={t('load.session.failed')} error={sessStartError} onRetry={() => { void startInteractive(); }} onDismiss={() => setDismissedSessError(sessStartError)} />
      )}
      <div className="md-main">
        <div className="md-teamsel">
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)} disabled={busyControls || sess.active} data-testid="team-a">
            {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
          </select>
          <span className="vs">vs</span>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)} disabled={busyControls || sess.active} data-testid="team-b">
            {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
          </select>
          <label className="md-seed">{t('md.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={busyControls || sess.active} /></label>
          <div className="md-modetoggle" data-testid="md-mode">
            <button className={!interactive ? 'on' : ''} onClick={() => setMode('oneshot')} disabled={sess.active} data-testid="mode-oneshot">{t('md.mode.oneshot')}</button>
            <button className={interactive ? 'on' : ''} onClick={() => setMode('interactive')} disabled={running} data-testid="mode-interactive">{t('md.mode.interactive')}</button>
          </div>
          {!interactive ? (
            <button className="md-run" onClick={runMatch} disabled={busyControls} data-testid="run-match">
              {running ? t('md.simulating', { pct: Math.round(pct * 100) }) : t('md.run')}
            </button>
          ) : !sess.active ? (
            <button className="md-run" onClick={startInteractive} disabled={busyControls} data-testid="start-interactive">{t('md.sess.start')}</button>
          ) : (
            <button className="ord-cancel" onClick={() => { setAutoPlay(false); void sess.stop(); }} data-testid="session-stop">{t('md.sess.stop')}</button>
          )}
        </div>

        {matchForView && (
          <div className="md-tabs" data-testid="md-tabs">
            <button className={tab === 'match' ? 'on' : ''} onClick={() => setTab('match')} data-testid="tab-match">{t('md.tab.match')}</button>
            <button className={tab === 'review' ? 'on' : ''} onClick={() => setTab('review')} data-testid="tab-review">{t('md.tab.review')}</button>
          </div>
        )}

        {tab === 'review' && matchForView ? (
          <ReviewPanel match={matchForView} replay={replay} timeoutLog={interactive ? sess.timeoutLog : []} />
        ) : (
          <MatchHub
            match={matchForView} session={interactive ? st : null} engineLabel={engineLabel}
            log={log} error={sess.error} canOpen={liveAvailable} onOpen={() => { setTab('match'); setImmersive(true); }}
          />
        )}
      </div>

      {tab !== 'review' && (
      <aside className="md-side">
        <section className="md-card" data-testid="economy-panel">
          <h3>{t('md.econ.title')} {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="econ-team">
              <b>{matchForView!.teams[s].name}</b>
              <span className="econ-credits">{lastRound.economy[s].credits}c</span>
              <span className={`buy-badge buy-${lastRound.buys[s].tier}`}>{t(`buy.${lastRound.buys[s].tier}`)}</span>
            </div>
          )) : <div className="row small muted">{t('md.econ.run')}</div>}
          {lastRound && <div className="save-alert">{t('md.econ.buys', { a: matchForView!.teams.A.name, aw: lastRound.buys.A.weapon, b: matchForView!.teams.B.name, bw: lastRound.buys.B.weapon })} <span className="muted small">{t('md.econ.engine')}</span></div>}
        </section>

        <section className="md-card" data-testid="ult-panel">
          <h3>{t('md.ult.title')} {lastRound ? <span className="pill">R{lastRound.roundNumber}</span> : <span className="pill synth">—</span>}</h3>
          {lastRound ? (['A', 'B'] as const).map((s) => (
            <div key={s} className="ult-team">
              <b>{matchForView!.teams[s].name}</b>
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
