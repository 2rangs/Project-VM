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

const REASON_SHORT: Record<string, string> = {
  elimination: 'elim', spikeDetonation: 'spike', spikeDefused: 'defuse', timeExpired: 'time',
};

export function ReviewPanel({ match, replay }: { match: MatchSummary; replay: Replay | null }) {
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
        <span className="muted small">{match.map} · seed {match.seed}{match.wentToOvertime ? ' · OT' : ''} · {match.rounds.length} rounds</span>
      </div>

      {/* round result strip */}
      <section className="rev-card">
        <div className="attr-grouplabel">Round results <span className="muted small">({match.teams.A.name} 관점 · W/L · 종료 사유 · 구매)</span></div>
        <div className="rev-strip" data-testid="rev-strip">
          {match.rounds.map((r) => {
            const won = r.winner === 'A';
            return (
              <div key={r.roundNumber} className={`rev-rcell ${won ? 'w' : 'l'}`} title={`R${r.roundNumber} ${r.phase} · ${won ? 'WIN' : 'LOSS'} · ${r.reason} · A ${r.buys.A.tier}/${r.buys.A.weapon} · B ${r.buys.B.tier}/${r.buys.B.weapon}`}>
                <span className="rc-n">{r.roundNumber}</span>
                <span className="rc-wl">{won ? 'W' : 'L'}</span>
                <span className="rc-reason">{REASON_SHORT[r.reason] ?? r.reason.slice(0, 5)}</span>
                <span className={`rc-buy buy-${r.buys.A.tier}`}>{r.buys.A.tier}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* economy timeline */}
      <section className="rev-card">
        <div className="attr-grouplabel">Economy timeline <span className="muted small">(credits at buy, both teams)</span></div>
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
        <div className="attr-grouplabel">Key decisions <span className="muted small">(PV-3 IGL decision traces · 선택 + 근거 + 제외 대안)</span></div>
        {traces.length === 0 ? <div className="row small muted">loading decision traces…</div> : (
          <div className="rev-decisions">
            {traces.map((t, i) => (
              <div key={i} className="rev-dcard" data-testid="rev-decision">
                <div className="rev-dhead">
                  <span className="pill">{t.world.decidingSide}</span>
                  <b>{t.selected?.id ?? '—'}</b>
                  <span className="muted small">{(t.timeRemainingMs / 1000).toFixed(0)}s left</span>
                </div>
                <p className="rev-drationale small">{t.selected?.rationale ?? 'no action selected'}</p>
                <div className="muted small">{t.excluded.length} option(s) ruled out (time/space) · full breakdown in Dev → Decision Debugger</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* MVP */}
      <section className="rev-card" data-testid="rev-mvp">
        <div className="attr-grouplabel">Match MVP <span className="muted small">(kills + 생존 · 실명 핸들 · 로스터 귀속은 합성)</span></div>
        {mvp ? (
          <>
            <div className="rev-mvpline">
              <span className={`mvp-badge ${teamClass(mvp.team)}`}>MVP</span>
              <b>{mvp.handle}</b> <span className="muted small">({mvp.teamName})</span>
              <span className="mvp-stat">{mvp.kills} K</span>
              <span className="mvp-stat muted">{mvp.survived}/{match.rounds.length} survived</span>
            </div>
            <table className="rev-mvptable">
              <tbody>
                {lines.slice(0, 6).map((l, i) => (
                  <tr key={i} className={i === 0 ? 'top' : ''}>
                    <td className="muted">{i + 1}</td>
                    <td><b>{l.handle}</b> <span className={`tag ${teamClass(l.team)}`}>{l.teamName}</span></td>
                    <td>{l.kills} K</td>
                    <td className="muted">{l.deaths} D</td>
                    <td className="muted small">{l.score} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <div className="row small muted">no kill data</div>}
      </section>

      {/* post-match ground truth — allowed because the match is over */}
      {replay && (
        <section className="rev-card">
          <div className="attr-grouplabel">경기 후 전체 시점 <span className="muted small">(post-match full view — ground truth, match is over)</span></div>
          <ReplayViewer replay={replay} size={560} />
        </section>
      )}
    </div>
  );
}
