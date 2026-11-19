// Post-match Review (manager-game convention). Shown after a match finishes, from
// the Match Day "리뷰" tab. Everything here is from the REAL match-runner summary +
// the simulated replay. The match is over, so the ground-truth replay is allowed here
// (labelled "경기 후 전체 시점") — unlike the live Match Day fog view.
import { useEffect, useMemo, useState } from 'react';
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { MatchSummary } from '../../shared/ipc.ts';
import { bridge } from '../platform.ts';
import { parseTrace, type DecisionTrace } from '../../shared/trace.ts';
import { computeMvp, economySeries } from '../review.ts';
import { useT, strategyLabel } from '../i18n/index.tsx';

export function ReviewPanel({ match, replay }: { match: MatchSummary; replay: Replay | null }) {
  const t = useT();
  const reasonShort = (r: string) => t(`reason.${r}`);
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = await bridge.listTraces().catch(() => [] as string[]);
      const loaded = await Promise.all(ids.map((id) =>
        bridge.loadTrace(id).then((j) => { try { return parseTrace(j); } catch { return null; } }).catch(() => null)));
      if (alive) setTraces(loaded.filter((t): t is DecisionTrace => !!t));
    })();
    return () => { alive = false; };
  }, []);

  const econ = useMemo(() => economySeries(match), [match]);
  const { mvp, lines } = useMemo(() => (replay ? computeMvp(match, replay) : { mvp: null, lines: [] }), [match, replay]);
  const teamClass = (t: 'A' | 'B') => (t === 'A' ? 'rv-a' : 'rv-b');

  // economy timeline geometry
  const W = 560; const H = 150; const PAD = 28;
  const maxC = Math.max(9000, ...econ.flatMap((p) => [p.a, p.b]));
  const x = (i: number) => PAD + (econ.length <= 1 ? 0 : (i / (econ.length - 1)) * (W - PAD * 2));
  const y = (c: number) => H - PAD - (c / maxC) * (H - PAD * 2);
  const path = (sel: (p: { a: number; b: number }) => number) =>
    econ.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(' ');

  return (
    <div className="review" data-testid="review-panel">
      <div className="rev-head">
        <span className="rev-score">
          <b className={match.winner === 'A' ? 'win' : ''}>{match.teams.A.name}</b> {match.score.A}
          <span className="muted"> – </span>{match.score.B} <b className={match.winner === 'B' ? 'win' : ''}>{match.teams.B.name}</b>
        </span>
        <span className="muted small">{t('rev.meta', { map: match.map, seed: match.seed, ot: match.wentToOvertime ? t('rev.ot') : '', n: match.rounds.length })}</span>
      </div>

      {/* round result strip */}
      <section className="rev-card">
        <div className="attr-grouplabel">{t('rev.roundResults')} <span className="muted small">{t('rev.roundResults.sub', { team: match.teams.A.name })}</span></div>
        <div className="rev-strip" data-testid="rev-strip">
          {match.rounds.map((r) => {
            const won = r.winner === 'A';
            return (
              <div key={r.roundNumber} className={`rev-rcell ${won ? 'w' : 'l'}`} title={`R${r.roundNumber} ${r.phase} · ${won ? t('rev.win') : t('rev.loss')} · ${reasonShort(r.reason)} · A ${r.buys.A.tier}/${r.buys.A.weapon} · B ${r.buys.B.tier}/${r.buys.B.weapon}`}>
                <span className="rc-n">{r.roundNumber}</span>
                <span className="rc-wl">{won ? t('rev.win') : t('rev.loss')}</span>
                <span className="rc-reason">{reasonShort(r.reason)}</span>
                <span className={`rc-buy buy-${r.buys.A.tier}`}>{t(`buy.${r.buys.A.tier}`)}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* economy timeline */}
      <section className="rev-card">
        <div className="attr-grouplabel">{t('rev.econ')} <span className="muted small">{t('rev.econ.sub')}</span></div>
        <svg className="rev-econ" viewBox={`0 0 ${W} ${H}`} data-testid="rev-econ" role="img" aria-label="economy timeline">
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#2b3440" />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#2b3440" />
          <path d={path((p) => p.a)} fill="none" stroke="#3cdcff" strokeWidth={2} />
          <path d={path((p) => p.b)} fill="none" stroke="#ff9f40" strokeWidth={2} />
          <text x={W - PAD} y={PAD - 8} fill="#3cdcff" fontSize={10} textAnchor="end">{match.teams.A.name}</text>
          <text x={W - PAD} y={PAD + 6} fill="#ff9f40" fontSize={10} textAnchor="end">{match.teams.B.name}</text>
        </svg>
      </section>

      {/* key decision cards (PV-3 decision traces) */}
      <section className="rev-card">
        <div className="attr-grouplabel">{t('rev.decisions')} <span className="muted small">{t('rev.decisions.sub')}</span></div>
        {traces.length === 0 ? <div className="row small muted">{t('rev.decisions.loading')}</div> : (
          <div className="rev-decisions">
            {traces.map((tr, i) => (
              <div key={i} className="rev-dcard" data-testid="rev-decision">
                <div className="rev-dhead">
                  <span className="pill">{tr.world.decidingSide}</span>
                  <b>{strategyLabel(t, tr.selected?.id)}</b>
                  <span className="muted small">{t('rev.dcard.left', { n: (tr.timeRemainingMs / 1000).toFixed(0) })}</span>
                </div>
                <p className="rev-drationale small">{tr.selected?.rationale ?? t('rev.dcard.noAction')}</p>
                <div className="muted small">{t('rev.dcard.ruledOut', { n: tr.excluded.length })}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* MVP */}
      <section className="rev-card" data-testid="rev-mvp">
        <div className="attr-grouplabel">{t('rev.mvp')} <span className="muted small">{t('rev.mvp.sub')}</span></div>
        {mvp ? (
          <>
            <div className="rev-mvpline">
              <span className={`mvp-badge ${teamClass(mvp.team)}`}>MVP</span>
              <b>{mvp.handle}</b> <span className="muted small">({mvp.teamName})</span>
              <span className="mvp-stat">{t('rev.mvp.k', { n: mvp.kills })}</span>
              <span className="mvp-stat muted">{t('rev.mvp.survived', { s: mvp.survived, n: match.rounds.length })}</span>
            </div>
            <table className="rev-mvptable">
              <tbody>
                {lines.slice(0, 6).map((l, i) => (
                  <tr key={i} className={i === 0 ? 'top' : ''}>
                    <td className="muted">{i + 1}</td>
                    <td><b>{l.handle}</b> <span className={`tag ${teamClass(l.team)}`}>{l.teamName}</span></td>
                    <td>{t('rev.mvp.kd.k', { n: l.kills })}</td>
                    <td className="muted">{t('rev.mvp.kd.d', { n: l.deaths })}</td>
                    <td className="muted small">{t('rev.mvp.pts', { n: l.score })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <div className="row small muted">{t('rev.mvp.none')}</div>}
      </section>

      {/* post-match ground truth — allowed because the match is over */}
      {replay && (
        <section className="rev-card">
          <div className="attr-grouplabel">{t('rev.truth')} <span className="muted small">{t('rev.truth.sub')}</span></div>
          <ReplayViewer replay={replay} size={560} />
        </section>
      )}
    </div>
  );
}
