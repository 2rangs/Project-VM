// Series: choose the two teams and the format → map veto (we choose ours, the AI theirs) → each
// map through the existing Match Day (one-shot or round by round) → series scoreboard between
// maps → series summary. Engine: @pv/match-runner createSeriesSession via scripts/series-session.mts.
import { useEffect, useMemo, useState } from 'react';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../../App.tsx';
import { bridge, runtime } from '../../platform.ts';
import { teams } from '../../data.ts';
import { useT } from '../../i18n/index.tsx';
import type { SeriesFormat, SeriesStartRequest, SeriesTeam, SeriesView } from '../../../shared/series.ts';
import { useSeries } from '../../series/useSeries.ts';
import { usesBorrowedGeometry, vetoLogLine } from '../../series/view.ts';
import { MatchDayScreen } from '../MatchDayScreen.tsx';
import { VetoBoard } from './VetoBoard.tsx';
import './series.css';
import { LoadingScreen } from '../../loading/Loading.tsx'; // [loading]

/** Pause before each AI veto step, so its choice is seen as it happens. */
const AI_REVEAL_MS = Number((globalThis as { PV_VETO_REVEAL_MS?: number }).PV_VETO_REVEAL_MS ?? 900);

function GeometryNote({ view }: { view: SeriesView }) {
  const t = useT();
  if (!usesBorrowedGeometry(view)) return null;
  return <div className="ser-geonote" data-testid="series-geometry-note">ⓘ {t('ser.geometry.note', { map: view.geometry })}</div>;
}

function SeriesScore({ view }: { view: SeriesView }) {
  const t = useT();
  const name = (team: SeriesTeam) => view.teams[team].name;
  return (
    <div className="ser-score" data-testid="series-scoreboard">
      <div className="scoreboard">
        <span className={`sb-team ${view.winner === 'A' ? 'win' : ''}`}>{name('A')}</span>
        <span className="sb-score" data-testid="series-score-a">{view.score.A}</span>
        <span className="sb-dash">–</span>
        <span className="sb-score" data-testid="series-score-b">{view.score.B}</span>
        <span className={`sb-team ${view.winner === 'B' ? 'win' : ''}`}>{name('B')}</span>
        <span className="sb-ot">{t('ser.firstTo', { n: view.winsNeeded })}</span>
      </div>
      <table className="ser-maps">
        <thead><tr><th>#</th><th>{t('ser.col.map')}</th><th>{t('ser.col.pick')}</th><th>{t('ser.col.side', { team: name('A') })}</th><th>{t('ser.col.score')}</th></tr></thead>
        <tbody>
          {view.veto.maps.map((m, i) => {
            const g = view.games.find((x) => x.gameNumber === i + 1);
            const isNext = view.nextGame?.gameNumber === i + 1;
            return (
              <tr key={m.map} className={g ? (g.winner === 'A' ? 'won' : 'lost') : isNext ? 'next' : 'unplayed'} data-testid={`series-map-${i + 1}`}>
                <td>{i + 1}</td>
                <td><b>{m.map}</b></td>
                <td>{m.pickedBy === 'decider' ? <span className="ser-decidertag">{t('ser.decider')}</span> : name(m.pickedBy)}</td>
                <td>{t(`ser.side.${m.startingSides.A}`)}</td>
                <td>{g ? <b>{g.score.A}–{g.score.B}{g.overtime ? ' OT' : ''}</b> : isNext ? t('ser.map.next') : view.phase === 'finished' ? t('ser.map.notNeeded') : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * [career] This series is a fixture of the manager's career: teams, format, seed, analyst and the
 * five players per side come from the career world, and the finished series is handed back.
 */
export interface CareerSeriesFixture {
  teamA: { id: string; name: string };
  teamB: { id: string; name: string };
  format: SeriesFormat;
  seed: number;
  /** Our analyst's quality from the career staff. */
  analyst: number;
  rosters: NonNullable<SeriesStartRequest['rosters']>;
  /** e.g. "Stage 1 · Group Alpha · Round 2". */
  label: string;
  onFinished: (view: SeriesView) => void | Promise<void>;
  onBack: () => void;
}

export function SeriesScreen({ ctx, fixture }: { ctx: ScreenCtx; fixture?: CareerSeriesFixture }) {
  const t = useT();
  const ser = useSeries();
  const allTeams = useMemo(() => {
    const list = teams().sort((a, b) => a.name.localeCompare(b.name));
    // [career] a fixture team may be missing from the dataset list; the selects stay locked anyway.
    for (const x of fixture ? [fixture.teamA, fixture.teamB] : []) if (!list.some((y) => y.name === x.name)) list.push({ teamId: x.id, name: x.name } as (typeof list)[number]);
    return list;
  }, [fixture]);
  const [teamA, setTeamA] = useState(fixture?.teamA.name ?? 'NRG');
  const [teamB, setTeamB] = useState(fixture?.teamB.name ?? 'Team Heretics');
  const [format, setFormat] = useState<SeriesFormat>(fixture?.format ?? 'bo3');
  const [seed, setSeed] = useState(fixture?.seed ?? 7);
  const [analyst, setAnalyst] = useState(fixture?.analyst ?? 0.7);
  const [recording, setRecording] = useState(false);
  const locked = !!fixture;
  const [scouting, setScouting] = useState(true);
  const [inGame, setInGame] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null); // [loading] a failed quick map shows a message, not a spinner
  const view = ser.view;
  const refOf = (name: string) => {
    if (fixture && name === fixture.teamA.name) return fixture.teamA;
    if (fixture && name === fixture.teamB.name) return fixture.teamB;
    const x = allTeams.find((y) => y.name === name); return { id: x?.teamId ?? name, name };
  };

  // The AI makes its veto choices one at a time, each after a short pause.
  const aiPending = view?.phase === 'veto' && view.veto.pending?.ai === true;
  const aiStepNo = view?.veto.pending?.step;
  useEffect(() => {
    if (!aiPending || ser.busy) return;
    const id = setTimeout(() => { void ser.aiStep(); }, AI_REVEAL_MS);
    return () => clearTimeout(id);
  }, [aiPending, aiStepNo, ser.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    await ser.start({ teamA: refOf(teamA), teamB: refOf(teamB), format, seed, analyst, scouting, ...(fixture ? { rosters: fixture.rosters } : {}) });
  }
  /** Back from Match Day: if the map was left unfinished it is played out, then the series view refreshes. */
  async function returnFromGame() {
    setInGame(false);
    try { await bridge.sessionStop(); } catch { /* no open map */ }
    await ser.refresh();
  }
  /** Play the next map in one go without opening Match Day. */
  async function quickGame() {
    setQuickBusy(true); setQuickError(null);
    try {
      const res = await bridge.runSimulation({ mapId: 'ascent', seed, rounds: 13, seriesGame: true }, () => {});
      ctx.setReplay(res.replay as Replay);
    } catch (e) { setQuickError((e as Error).message); }
    await ser.refresh();
    setQuickBusy(false);
  }

  if (runtime !== 'electron') return <div className="ser-wrap"><div className="md-empty muted">{t('ser.needElectron')}</div></div>;

  // ── a map of the series, in the existing Match Day ──
  if (view && inGame && view.nextGame) {
    const g = view.nextGame;
    return (
      <MatchDayScreen
        key={`series-game-${g.gameNumber}`}
        ctx={ctx}
        series={{
          teamA: view.teams.A.name, teamB: view.teams.B.name,
          label: t('ser.md.label', { n: g.gameNumber, map: g.map, side: t(`ser.side.${g.startingSides.A}`), a: view.score.A, b: view.score.B }),
          note: g.map.toLowerCase() !== view.geometry.toLowerCase() ? t('ser.geometry.note', { map: view.geometry }) : undefined,
          returnLabel: t('ser.md.return'),
          onReturn: () => void returnFromGame(),
        }}
      />
    );
  }

  return (
    <div className="ser-wrap" data-testid="series-screen" data-phase={view?.phase ?? 'setup'}>
      {/* [loading] series preparation and a quick-simulated map get a loading screen; a failure gets a message */}
      {!view && ser.busy && <LoadingScreen cover="window" title={t('load.series.preparing')} detail={`${teamA} vs ${teamB}`} steps={t('ser.setup.preparing')} testId="loading-series" />}
      {quickBusy && view && (
        <LoadingScreen cover="window" title={t('load.sim.title')} detail={`${view.teams.A.name} vs ${view.teams.B.name}${view.nextGame ? ` · ${view.nextGame.map}` : ''}`}
          steps={view.nextGame ? t('load.series.steps', { n: view.nextGame.gameNumber, m: view.format.games }) : null} testId="loading-series-game" />
      )}
      {!quickBusy && quickError && <LoadingScreen cover="window" title={t('load.sim.failed')} error={quickError} onRetry={() => { void quickGame(); }} onDismiss={() => setQuickError(null)} />}
      <h2 className="ser-title">{t('ser.title')} {view && <span className="pill">{t(`ser.format.${view.format.games === 1 ? 'bo1' : view.format.games === 3 ? 'bo3' : 'bo5'}`)}</span>}</h2>
      {fixture && (
        <div className="ser-geonote" data-testid="series-career-fixture">
          🏆 <b>{fixture.label}</b> · {t('career.match.fromWorld')}
          {!view && <button className="ord-cancel" style={{ marginLeft: 12 }} onClick={fixture.onBack} data-testid="series-career-back">{t('career.match.back')}</button>}
        </div>
      )}

      {/* ── setup ── */}
      {!view && (
        <div className="ser-setup" data-testid="series-setup">
          <div className="ser-setuprow">
            <label>{t('ser.setup.our')}
              <select value={teamA} onChange={(e) => setTeamA(e.target.value)} disabled={ser.busy || locked} data-testid="series-team-a">
                {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
              </select>
            </label>
            <span className="vs">vs</span>
            <label>{t('ser.setup.opp')}
              <select value={teamB} onChange={(e) => setTeamB(e.target.value)} disabled={ser.busy || locked} data-testid="series-team-b">
                {allTeams.map((x) => <option key={x.teamId} value={x.name}>{x.name}</option>)}
              </select>
            </label>
            <label className="md-seed">{t('md.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={ser.busy || locked} data-testid="series-seed" /></label>
          </div>
          <div className="ser-setuprow">
            <span>{t('ser.setup.format')}</span>
            <div className="md-modetoggle" data-testid="series-format">
              {(['bo1', 'bo3', 'bo5'] as const).map((f) => (
                <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)} disabled={ser.busy || locked} data-testid={`series-format-${f}`}>{t(`ser.format.${f}`)}</button>
              ))}
            </div>
          </div>
          <div className="md-opts ser-opts" data-testid="series-options">
            <label className="md-opt">
              <input type="checkbox" checked={scouting} onChange={(e) => setScouting(e.target.checked)} disabled={ser.busy} data-testid="series-opt-scouting" />
              <b>{t('ser.opt.scouting')}</b>
              <span className="muted small">{t('ser.opt.scouting.hint')}</span>
            </label>
            <label className="md-opt">
              <b>{t('ser.opt.analyst')}</b>
              <input type="range" min={0} max={1} step={0.1} value={analyst} onChange={(e) => setAnalyst(Number(e.target.value))} disabled={ser.busy || !scouting || locked} data-testid="series-opt-analyst" />
              <span className="ser-analystval">{analyst.toFixed(1)}</span>
              <span className="muted small">{t('ser.opt.analyst.hint')}</span>
            </label>
          </div>
          <div className="ser-setuprow">
            <button className="md-run" onClick={() => void start()} disabled={ser.busy || teamA === teamB} data-testid="series-start">
              {ser.busy ? t('ser.setup.preparing') : t('ser.setup.start')}
            </button>
            {teamA === teamB && <span className="muted small">{t('ser.setup.sameTeam')}</span>}
          </div>
          <div className="ser-geonote">ⓘ {t('ser.geometry.note', { map: 'Ascent' })}</div>
          <p className="muted small">{t('ser.setup.about')}</p>
        </div>
      )}

      {ser.error && <div className="ser-error" data-testid="series-error">⚠ {ser.error}</div>}

      {/* ── veto ── */}
      {view && view.phase === 'veto' && (
        <>
          <GeometryNote view={view} />
          <VetoBoard view={view} busy={ser.busy} onChoose={(c) => void ser.choose(c)} />
        </>
      )}

      {/* ── between maps / finished ── */}
      {view && view.phase !== 'veto' && (
        <>
          <GeometryNote view={view} />
          <SeriesScore view={view} />
          {view.phase === 'playing' && view.nextGame && (
            <div className="ser-next" data-testid="series-next">
              <div>
                <b>{t('ser.next.title', { n: view.nextGame.gameNumber, map: view.nextGame.map })}</b>
                <span className="muted small"> {view.nextGame.pickedBy === 'decider' ? t('ser.decider') : t('ser.next.pickedBy', { team: view.teams[view.nextGame.pickedBy].name })} · {t('ser.next.side', { side: t(`ser.side.${view.nextGame.startingSides.A}`) })}</span>
              </div>
              <button className="md-run" onClick={() => setInGame(true)} disabled={ser.busy || quickBusy} data-testid="series-open-game">{t('ser.next.open')}</button>
              <button className="ord-cancel" onClick={() => void quickGame()} disabled={ser.busy || quickBusy} data-testid="series-quick-game">{quickBusy ? t('ser.next.quickBusy') : t('ser.next.quick')}</button>
            </div>
          )}
          {view.phase === 'finished' && view.winner && (
            <div className="ser-summary" data-testid="series-summary">
              <h3>{t('ser.summary.title', { team: view.teams[view.winner].name, a: view.score.A, b: view.score.B })}</h3>
              <div className="attr-grouplabel">{t('ser.log.title')}</div>
              <div className="ser-summaryveto">
                {view.veto.actions.map((a) => {
                  const line = vetoLogLine(a);
                  return <span key={a.step} className="ser-chip">{t(line.key, { ...line.vars, team: line.team ? view.teams[line.team].name : '' })}</span>;
                })}
              </div>
              <div className="attr-grouplabel">{t('ser.summary.mastery')}</div>
              <table className="ser-maps">
                <thead><tr><th>{t('ser.col.map')}</th><th>{view.teams.A.name}</th><th>{view.teams.B.name}</th><th>{t('ser.col.score')}</th></tr></thead>
                <tbody>
                  {view.games.map((g) => {
                    const m = view.maps.find((x) => x.map === g.map)!;
                    return (
                      <tr key={g.gameNumber} className={g.winner === 'A' ? 'won' : 'lost'}>
                        <td><b>{g.map}</b></td>
                        <td>{Math.round(m.mastery.A.value * 100)} ±{Math.round(m.mastery.A.uncertainty * 100)}</td>
                        <td>{Math.round(m.mastery.B.value * 100)} ±{Math.round(m.mastery.B.uncertainty * 100)}</td>
                        <td>{g.score.A}–{g.score.B}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {fixture && view.phase === 'finished' && (
            <button className="md-run" disabled={recording} data-testid="series-career-record"
              onClick={async () => { setRecording(true); try { await fixture.onFinished(view); } finally { setRecording(false); } await ser.stop(); }}>
              {t('career.match.record')}
            </button>
          )}
          {!(fixture && view.phase === 'finished') && <button className="ord-cancel ser-reset" onClick={() => void ser.stop()} data-testid="series-reset">{view.phase === 'finished' ? t('ser.new') : t('ser.abandon')}</button>}
        </>
      )}
      {view && view.phase === 'veto' && <button className="ord-cancel ser-reset" onClick={() => void ser.stop()} data-testid="series-reset">{t('ser.abandon')}</button>}
    </div>
  );
}
