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
import type { MatchOptions, MatchSummary, TeamOrder } from '../../shared/ipc.ts';
import { teams } from '../data.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { useMatchSession } from '../useMatchSession.ts';
import { useT, strategyLabel } from '../i18n/index.tsx';
import { LiveMatch } from './matchday/LiveMatch.tsx';
import { MatchHub } from './matchday/MatchHub.tsx';
import { Icon } from './matchday/Icons.tsx';
import { LoadingScreen } from '../loading/Loading.tsx';
import { MatchLoadScreen } from '../loading/MatchLoadScreen.tsx';
import { preloadMatchAssets } from './matchday/assets.ts';

/**
 * [series] Optional: this Match Day plays the NEXT MAP of a live series (teams, map and seed come
 * from the series; our team is always shown as team A). Nothing else about the screen changes.
 */
export interface MatchDaySeriesGame {
  teamA: string; teamB: string;
  /** Banner text: which map of the series this is. */
  label: string;
  /** Extra line under the banner (e.g. the geometry note). */
  note?: string;
  returnLabel: string;
  onReturn: () => void;
}

export function MatchDayScreen({ ctx, series }: { ctx: ScreenCtx; series?: MatchDaySeriesGame }) {
  const t = useT();
  const [mode, setMode] = useState<'oneshot' | 'interactive'>('oneshot');
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  // Loading screen state for a one-shot run: latest round/score from the runner, and a failure message.
  const [simStep, setSimStep] = useState<{ round: number; a: number; b: number } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  // 'assets' = the simulation / session is ready and the live view's assets (3D map, minimap) are being finished
  const [loadPhase, setLoadPhase] = useState<'work' | 'assets' | null>(null);
  const [sessPreparing, setSessPreparing] = useState(false);
  const [dismissedSessError, setDismissedSessError] = useState<string | null>(null);
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [source, setSource] = useState<string>('');
  const allTeams = useMemo(() => teams().sort((a, b) => a.name.localeCompare(b.name)), []);
  const [teamA, setTeamA] = useState(series?.teamA ?? 'NRG');
  const [teamB, setTeamB] = useState(series?.teamB ?? 'Team Heretics');
  const [seed, setSeed] = useState(42);
  // Full-window live view (matchday/LiveMatch). Opens when a match starts; closing it returns
  // to the shell (MatchHub) without stopping the session.
  const [immersive, setImmersive] = useState(false);
  const [tab, setTab] = useState<'match' | 'review'>('match');
  const [autoPlay, setAutoPlay] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  // Pre-match options (a team's / organiser's choice). Engine physics tunables are not exposed.
  const [optsOpen, setOptsOpen] = useState(false);
  const [opponentMemory, setOpponentMemory] = useState(true);
  const [minThrow, setMinThrow] = useState<{ A: number; B: number }>({ A: 0, B: 0 });
  const sess = useMatchSession();

  const interactive = mode === 'interactive';
  const matchForView = interactive ? sess.match : match;
  const replay = ctx.replay;
  const refOf = (name: string) => { const x = allTeams.find((y) => y.name === name); return { id: x?.teamId ?? name, name }; };
  const lastRound = matchForView?.rounds[matchForView.rounds.length - 1];
  const hasPerception = !!(replay?.perception && replay.perception.length > 0);
  const povName = (i: number) => matchForView?.teams[i === 0 ? 'A' : 'B']?.name ?? t(i === 0 ? 'md.povName.our' : 'md.povName.opp');
  // [series] teams / seed are fixed by the series, and a map is played once.
  const busyControls = running || sess.busy || (!!series && (match !== null || (sess.state?.finished ?? false)));
  const lockSetup = !!series;
  const optsChanged = !opponentMemory || minThrow.A > 0 || minThrow.B > 0;
  // Only non-default choices are sent, so a default match is the engine's own default config.
  const matchOptions = (): MatchOptions | undefined => {
    const teams: Record<string, number> = {};
    if (minThrow.A > 0) teams[refOf(teamA).id] = minThrow.A;
    if (minThrow.B > 0) teams[refOf(teamB).id] = minThrow.B;
    const o: MatchOptions = {
      ...(opponentMemory ? {} : { opponentMemory: false }),
      ...(Object.keys(teams).length > 0 ? { minThrowRates: { teams } } : {}),
    };
    return Object.keys(o).length > 0 ? o : undefined;
  };
  const setThrow = (slot: 'A' | 'B', raw: string) => {
    const v = Number(raw);
    setMinThrow((m) => ({ ...m, [slot]: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0 }));
  };

  useEffect(() => { bridge.loadTrace('trace-scenario-01').then((j) => setTrace(parseTrace(j))).catch(() => {}); }, []);
  // In interactive mode, mirror the session's live replay into shared ctx (Dev etc.).
  useEffect(() => { if (interactive && sess.replay) ctx.setReplay(sess.replay); }, [interactive, sess.replay, ctx]);
  // (Auto-play now lives in LiveMatch: it advances once the round has been watched.)

  async function runMatch() {
    setRunning(true); setPct(0); setLog([]); setMatch(null); setSimStep(null); setRunError(null); setLoadPhase('work');
    // the live view's assets (3D map for the team cams, minimap) load alongside the simulation
    const assets = preloadMatchAssets();
    try {
      const res = await bridge.runSimulation(
        { mapId: 'ascent', seed, rounds: 13, teamA: refOf(teamA), teamB: refOf(teamB), options: matchOptions(), ...(series ? { seriesGame: true } : {}) },
        (p) => {
          setPct(p.pct);
          if (p.round != null && p.score) setSimStep({ round: p.round, a: p.score.A, b: p.score.B });
          if (p.message) setLog((l) => [...l.slice(-3), p.message!]);
        },
      );
      setLoadPhase('assets');
      await assets;
      ctx.setReplay(res.replay as Replay);
      setMatch(res.match ?? null);
      setSource(res.source);
      setTab('match'); setImmersive(true);
    } catch (e) { setRunError((e as Error).message); setLog((l) => [...l, `⚠ ${(e as Error).message}`]); } finally { setRunning(false); setLoadPhase(null); }
  }

  async function startInteractive() {
    setTab('match'); setAutoPlay(false); setOrdersOpen(false); setSource('match-runner'); setImmersive(true);
    setSessPreparing(true); setLoadPhase('work');
    const assets = preloadMatchAssets();
    try {
      await sess.start({ mapId: 'ascent', seed, teamA: refOf(teamA), teamB: refOf(teamB), aiTeams: ['B'], options: matchOptions(), ...(series ? { seriesGame: true } : {}) });
      setLoadPhase('assets');
      await assets;
    } finally { setSessPreparing(false); setLoadPhase(null); }
  }
  async function callTimeout() { await sess.callTimeout('A'); setOrdersOpen(true); }
  async function confirmOrders(order: TeamOrder) { await sess.setOrders('A', order); setOrdersOpen(false); }

  const engineLabel = source === 'match-runner' ? t('md.engine.matchRunner')
    : source ? t('md.engine.fallback', { src: source }) : (runtime === 'electron' ? t('md.engine.default') : t('md.engine.stub'));
  const st = sess.state;

  // Live view: full-window, replaces the shell while a match is being played or watched.
  const liveAvailable = interactive ? sess.active : !!replay && source !== '';
  if (immersive && tab === 'match' && liveAvailable && !sessPreparing) {
    return (
      <>
      {/* [series] the live view replaces the setup screen, so the way back to the series lives here too */}
      {series && (
        <div className="ser-mdbanner ser-live" data-testid="series-md-banner-live"
          style={{ position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
          <b>{series.label}</b>
          <button className="md-run" onClick={series.onReturn} disabled={running || sess.busy} data-testid="series-return">{series.returnLabel}</button>
        </div>
      )}
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
      </>
    );
  }

  // Loading / failure surfaces: shown only while the work is pending or until the error is dismissed.
  const sessStarting = interactive && (sessPreparing || (sess.busy && !sess.active));
  const sessStartError = interactive && !sess.active && sess.error && sess.error !== dismissedSessError ? sess.error : null;
  const versus = `${teamA} vs ${teamB}`;

  return (
    <div className="matchday">
      {running && (
        <MatchLoadScreen map="Ascent" mode={t('load.sim.title')} ally={{ ...refOf(teamA), side: 'attack' }} enemy={{ ...refOf(teamB), side: 'defense' }}
          progress={loadPhase === 'assets' ? 1 : simStep ? pct : null}
          steps={loadPhase === 'assets' ? t('load.assets.preparing') : simStep ? t('load.sim.steps', { n: simStep.round, a: simStep.a, b: simStep.b }) : t('load.sim.starting')} />
      )}
      {!running && runError && (
        <LoadingScreen cover="window" title={t('load.sim.failed')} error={runError} onRetry={() => { void runMatch(); }} onDismiss={() => setRunError(null)} />
      )}
      {sessStarting && (
        <MatchLoadScreen map="Ascent" mode={t('load.session.title')} ally={{ ...refOf(teamA), side: 'attack' }} enemy={{ ...refOf(teamB), side: 'defense' }}
          progress={null} steps={loadPhase === 'assets' ? t('load.assets.preparing') : t('load.session.steps')} />
      )}
      {!sessStarting && sessStartError && (
        <LoadingScreen cover="window" title={t('load.session.failed')} error={sessStartError} onRetry={() => { void startInteractive(); }} onDismiss={() => setDismissedSessError(sessStartError)} />
      )}
      <div className="md-main">
        {series && (
          <div className="ser-mdbanner" data-testid="series-md-banner">
            <b>{series.label}</b>
            {series.note && <span className="muted small"><Icon name="info" size={11} /> {series.note}</span>}
            <button className="md-run" onClick={series.onReturn} disabled={running || sess.busy} data-testid="series-return">{series.returnLabel}</button>
          </div>
        )}
        <div className="md-teamsel">
          <select value={teamA} onChange={(e) => setTeamA(e.target.value)} disabled={busyControls || sess.active || lockSetup} data-testid="team-a">
            {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
          </select>
          <span className="vs">vs</span>
          <select value={teamB} onChange={(e) => setTeamB(e.target.value)} disabled={busyControls || sess.active || lockSetup} data-testid="team-b">
            {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
          </select>
          <label className="md-seed">{t('md.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={busyControls || sess.active || lockSetup} /></label>
          <button className={`md-optsbtn ${optsOpen ? 'on' : ''}`} onClick={() => setOptsOpen((v) => !v)} data-testid="match-options-toggle" aria-expanded={optsOpen}>
            <Icon name="debug" size={13} /> {t('md.opts.toggle')}{optsChanged && <span className="md-optsdot" data-testid="match-options-changed" title={t('md.opts.changed')}>●</span>}
          </button>
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

        {/* pre-match options: opponent memory + per-team minimum throw rate */}
        {optsOpen && (
          <div className="md-opts" data-testid="match-options">
            <label className="md-opt">
              <input type="checkbox" checked={opponentMemory} onChange={(e) => setOpponentMemory(e.target.checked)} disabled={busyControls || sess.active} data-testid="opt-memory" />
              <b>{t('md.opts.memory')}</b>
              <span className="muted small">{t('md.opts.memory.hint')}</span>
            </label>
            <div className="md-opt">
              <b>{t('md.opts.throw')}</b>
              {(['A', 'B'] as const).map((s) => (
                <label key={s} className="md-optnum">{s === 'A' ? teamA : teamB}
                  <input type="number" min={0} max={1} step={0.005} value={minThrow[s]} onChange={(e) => setThrow(s, e.target.value)} disabled={busyControls || sess.active} data-testid={`opt-throw-${s}`} />
                </label>
              ))}
              <span className="muted small">{t('md.opts.throw.hint')}</span>
            </div>
            <div className="md-optfoot">
              <button className="ord-cancel" onClick={() => { setOpponentMemory(true); setMinThrow({ A: 0, B: 0 }); }} disabled={!optsChanged || busyControls || sess.active} data-testid="opt-reset">{t('md.opts.reset')}</button>
              {sess.active && <span className="muted small">{t('md.opts.locked')}</span>}
            </div>
          </div>
        )}

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
