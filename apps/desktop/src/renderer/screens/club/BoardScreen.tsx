// Board: confidence, this season's objectives, last season's review, and the manager's requests
// (transfer budget, wage budget, facilities, staff budget). Formulas: docs/CLUB_OPERATIONS.md §11.
import { useState } from 'react';
import { useLang, useT } from '../../i18n/index.tsx';
import { getWorld, updateWorld, useWorld } from '../../career/store.ts';
import { boardRequest, DEPTH_MODEL, facilitiesOf, type BoardRequestKind, type Text } from '../../career/world.ts';
import { userTeamId } from '../../career/club.ts';
import './club.css';

const KINDS: BoardRequestKind[] = ['transferBudget', 'wageBudget', 'facilities', 'staffBudget'];

export function BoardScreen() {
  const t = useT();
  const { lang } = useLang();
  const w = useWorld();
  const [answer, setAnswer] = useState<{ kind: BoardRequestKind; granted: boolean; reason: Text } | null>(null);
  const uid = userTeamId(w);
  const b = w.club?.board;
  if (!uid || !b) return <div className="pad">{t('club.noClub')}</div>;
  const o = b.objectives;
  const asked = b.requests[String(w.season)] ?? [];
  const pct = Math.round(b.confidence * 100);
  const ask = (kind: BoardRequestKind) => {
    const r = boardRequest(getWorld(), kind);
    setAnswer({ kind, granted: r.answer.granted, reason: r.answer.reason });
    updateWorld(() => r.world);
  };
  return (
    <div className="pad club" data-testid="board-screen">
      <h2>{t('club.board.title')} <span className="muted small">{w.teams[uid]?.name}</span></h2>
      {b.sacked && <div className="disclaimer-banner warn" data-testid="board-sacked">{t('club.board.sacked')}</div>}
      <div className="fin-cards">
        <div className={`fin-card ${b.confidence < DEPTH_MODEL.warnBelow ? 'warn' : ''}`} data-testid="board-confidence" data-value={pct}>
          <div className="muted small">{t('club.board.confidence')}</div>
          <div className="fin-value">{pct}%</div>
          <div className="wage-bar"><div className={`wage-fill ${b.confidence < DEPTH_MODEL.warnBelow ? 'over' : ''}`} style={{ width: `${pct}%` }} /></div>
          <div className="muted small">{t('club.board.thresholds', { warn: Math.round(DEPTH_MODEL.warnBelow * 100), sack: Math.round(DEPTH_MODEL.sackBelow * 100) })}</div>
        </div>
        {o && (
          <div className="fin-card" data-testid="board-objectives">
            <div className="muted small">{t('club.board.objectives', { season: o.season })}</div>
            <div>{t('club.board.objLeague', { place: o.leaguePlace, expected: o.expectedPlace })}</div>
            {o.international && <div>{t('club.board.objIntl', { slots: DEPTH_MODEL.internationalSlots })}</div>}
            <div>{t('club.board.objWage')}</div>
          </div>
        )}
        <div className="fin-card">
          <div className="muted small">{t('club.board.facilities')}</div>
          <div className="fin-value">{Math.round(facilitiesOf(w.club, uid) * 100)}%</div>
          <div className="muted small">{t('club.board.facilitiesHint')}</div>
        </div>
        {b.lastReview && (
          <div className="fin-card" data-testid="board-review">
            <div className="muted small">{t('club.board.review', { season: b.lastReview.season })}</div>
            <div>{t('club.board.reviewLine', { place: b.lastReview.place, met: t(b.lastReview.leagueMet ? 'club.board.met' : 'club.board.missed') })}</div>
            <div className="muted small">{t('club.board.reviewDelta', { d: `${b.lastReview.delta >= 0 ? '+' : ''}${Math.round(b.lastReview.delta * 100)}` })}</div>
          </div>
        )}
      </div>
      <div className="attr-grouplabel">{t('club.board.requests')}</div>
      <div className="club-actions" style={{ flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <button key={k} className="club-btn" disabled={asked.includes(k) || b.sacked} onClick={() => ask(k)} data-testid={`board-request-${k}`}>
            {t(`club.board.req.${k}`)} <span className="muted small">({t('club.board.needs', { c: Math.round((DEPTH_MODEL.requestConfidence[k] ?? 0.5) * 100) })})</span>
          </button>
        ))}
      </div>
      {answer && (
        <div className={`offer-status ${answer.granted ? 'st-completed' : 'st-rejected'}`} data-testid="board-answer" data-granted={answer.granted ? '1' : '0'}>
          <b>{t(`club.board.req.${answer.kind}`)}</b> — {answer.reason[lang]}
        </div>
      )}
      <p className="small muted">{t('club.board.requestsHint')}</p>
      {b.history.length > 0 && (
        <div className="small mt" data-testid="board-history">
          <div className="attr-grouplabel">{t('club.board.history')}</div>
          {b.history.slice(-8).reverse().map((h, i) => <div key={i} className="muted">{h.date} · {t(`club.board.why.${h.why.replace(' ', '')}`)} → {Math.round(h.value * 100)}%</div>)}
        </div>
      )}
      <p className="small muted mt">{t('club.board.note')}</p>
    </div>
  );
}
