// Match Day — the match view. Reuses the shared ReplayViewer for the 2D minimap.
// Two modes:
//  - One-shot: run a whole map through @pv/match-runner in one subprocess call.
//  - Interactive: drive a stateful @pv/match-runner MatchSession round by round,
//    calling tactical timeouts (2 per team) and issuing coach orders between rounds;
//    the AI opponent calls its own timeouts. Both show the fog-of-war view, the
//    match scoreboard and real economy / ultimate panels; the post-match Review tab
//    adds the timeout log.
import { useEffect, useMemo, useState } from 'react';
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { bridge, runtime } from '../platform.ts';
import { parseTrace, type DecisionTrace } from '../../shared/trace.ts';
import type { MatchOptions, MatchSummary, TeamOrder } from '../../shared/ipc.ts';
import { teams } from '../data.ts';
import { ZONE_POSITIONS } from '../zones.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { OrdersPanel } from './OrdersPanel.tsx';
import { useMatchSession } from '../useMatchSession.ts';
import { useT, strategyLabel } from '../i18n/index.tsx';

export function MatchDayScreen({ ctx }: { ctx: ScreenCtx }) {
  const t = useT();
  const [mode, setMode] = useState<'oneshot' | 'interactive'>('oneshot');
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
  const busyControls = running || sess.busy;
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
  // Auto-play: advance rounds on a timer while enabled and idle.
  useEffect(() => {
    if (!(interactive && autoPlay && sess.active && sess.state && !sess.state.finished && !sess.busy && !ordersOpen)) return;
    const id = setTimeout(() => { void sess.playNext(); }, 700);
    return () => clearTimeout(id);
  }, [interactive, autoPlay, sess, ordersOpen]);

  async function runMatch() {
    setRunning(true); setPct(0); setLog([]); setMatch(null);
    try {
      const res = await bridge.runSimulation(
        { mapId: 'ascent', seed, rounds: 13, teamA: refOf(teamA), teamB: refOf(teamB), options: matchOptions() },
        (p) => { setPct(p.pct); if (p.message) setLog((l) => [...l.slice(-3), p.message!]); },
      );
      ctx.setReplay(res.replay as Replay);
      setMatch(res.match ?? null);
      setSource(res.source);
    } catch (e) { setLog((l) => [...l, `⚠ ${(e as Error).message}`]); } finally { setRunning(false); }
  }

  async function startInteractive() {
    setTab('match'); setAutoPlay(false); setOrdersOpen(false); setSource('match-runner');
    await sess.start({ mapId: 'ascent', seed, teamA: refOf(teamA), teamB: refOf(teamB), aiTeams: ['B'], options: matchOptions() });
  }
  async function callTimeout() { await sess.callTimeout('A'); setOrdersOpen(true); }
  async function confirmOrders(order: TeamOrder) { await sess.setOrders('A', order); setOrdersOpen(false); }

  const engineLabel = source === 'match-runner' ? t('md.engine.matchRunner')
    : source ? t('md.engine.fallback', { src: source }) : (runtime === 'electron' ? t('md.engine.default') : t('md.engine.stub'));
  const st = sess.state;

  return (
    <div className="matchday">
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
          <button className={`md-optsbtn ${optsOpen ? 'on' : ''}`} onClick={() => setOptsOpen((v) => !v)} data-testid="match-options-toggle" aria-expanded={optsOpen}>
            ⚙ {t('md.opts.toggle')}{optsChanged && <span className="md-optsdot" data-testid="match-options-changed" title={t('md.opts.changed')}>●</span>}
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

        {/* interactive control bar */}
        {interactive && sess.active && st && (
          <div className="md-sessbar" data-testid="session-bar">
            <span className="sess-status">{t('md.sess.status', { round: st.roundNumber, attacker: matchForView?.teams[st.attacker]?.name ?? st.attacker, a: st.score.A, b: st.score.B, ta: st.timeoutsRemaining.A, tb: st.timeoutsRemaining.B })}</span>
            {!st.finished ? (
              <>
                <button className="md-run" onClick={() => void sess.playNext()} disabled={sess.busy || ordersOpen} data-testid="next-round">{t('md.sess.next')}</button>
                <label className="fog-ctl"><input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} data-testid="auto-play" /> {t('md.sess.auto')}</label>
                <button className="md-timeout" onClick={() => void callTimeout()} disabled={sess.busy || ordersOpen || st.timeoutsRemaining.A <= 0 || st.timeoutActive.A} data-testid="call-timeout">
                  {st.timeoutsRemaining.A > 0 ? t('md.sess.timeout', { n: st.timeoutsRemaining.A }) : t('md.sess.timeoutNone')}
                </button>
              </>
            ) : <span className="sess-done">{t('md.sess.finished')}</span>}
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
        ) : ordersOpen && interactive && st ? (
          <OrdersPanel state={st} match={matchForView} team="A" onConfirm={(o) => void confirmOrders(o)} onCancel={() => setOrdersOpen(false)} />
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

        {matchForView && (
          <div className="scoreboard" data-testid="scoreboard">
            <span className={`sb-team ${matchForView.winner === 'A' && (st?.finished ?? true) ? 'win' : ''}`}>{matchForView.teams.A.name}</span>
            <span className="sb-score">{matchForView.score.A}</span>
            <span className="sb-dash">–</span>
            <span className="sb-score">{matchForView.score.B}</span>
            <span className={`sb-team ${matchForView.winner === 'B' && (st?.finished ?? true) ? 'win' : ''}`}>{matchForView.teams.B.name}</span>
            {matchForView.wentToOvertime && <span className="sb-ot">OT</span>}
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

        {matchForView && (
          <div className="roundstrip" data-testid="roundstrip">
            {matchForView.rounds.map((r) => (
              <span key={r.roundNumber} className={`rs-dot rs-${r.winner === 'A' ? 'a' : 'b'} ${r.phase === 'pistol' ? 'pistol' : ''}`} title={`R${r.roundNumber} ${r.phase}: ${r.winner} (${r.reason})`}>{r.roundNumber}</span>
            ))}
          </div>
        )}

        {/* session log (interactive): round outcomes + timeouts (incl. AI opponent) */}
        {interactive && sess.feed.length > 0 && (
          <div className="md-feed" data-testid="session-feed">
            <div className="attr-grouplabel">{t('md.sess.feed')}</div>
            {sess.feed.slice(-8).map((f, i) => (
              <div key={i} className={`feed-row sess-${f.kind}`}>
                <span className="feed-t">R{f.round}</span>
                <span className="muted small">{f.text}</span>
              </div>
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

      {!((tab === 'review' || ordersOpen) && matchForView) && (
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
