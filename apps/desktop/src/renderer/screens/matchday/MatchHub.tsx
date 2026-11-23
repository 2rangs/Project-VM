// Match Day inside the manager shell, when the full-window live view is closed: the score so
// far, the round strip and one clear way back into the match. Starting a match (team select,
// seed, mode) stays in MatchDayScreen above this.
import type { MatchSummary, SessionState } from '../../../shared/ipc.ts';
import { useT } from '../../i18n/index.tsx';
import { Icon } from './Icons.tsx';
import './matchday.css';

export function MatchHub({ match, session, engineLabel, log, error, canOpen, onOpen }: {
  match: MatchSummary | null;
  /** Live interactive session state, if one is running. */
  session: SessionState | null;
  engineLabel: string;
  log: string[];
  error: string | null;
  canOpen: boolean;
  onOpen: () => void;
}) {
  const t = useT();
  const live = !!session && !session.finished;
  const score = session?.score ?? match?.score ?? null;
  return (
    <div className="mdx-hub" data-testid="match-hub">
      <div className="mdx-hub-meta">
        <span className="pill">{engineLabel}</span>
        {log.length > 0 && <span className="muted small">{log.join('  ·  ')}</span>}
        {error && <span className="err small"><Icon name="warn" size={12} /> {error}</span>}
      </div>
      {canOpen ? (
        <div className="mdx-hub-card">
          <div className="mdx-hub-score" data-testid="hub-score">
            <span className="mdx-hub-team">{match?.teams.A.name ?? '—'}</span>
            <b>{score?.A ?? 0}</b><i>:</i><b>{score?.B ?? 0}</b>
            <span className="mdx-hub-team">{match?.teams.B.name ?? '—'}</span>
            {match?.wentToOvertime && <em>OT</em>}
          </div>
          <div className="mdx-hub-state">
            {live ? t('mdx.hub.live', { n: session!.roundNumber }) : match ? t('mdx.hub.finished', { n: match.rounds.length }) : t('mdx.hub.ready')}
          </div>
          {match && match.rounds.length > 0 && (
            <div className="roundstrip" data-testid="hub-roundstrip">
              {match.rounds.map((r) => (
                <span key={r.roundNumber} className={`rs-dot rs-${r.winner === 'A' ? 'a' : 'b'} ${r.phase === 'pistol' ? 'pistol' : ''}`} title={`R${r.roundNumber} · ${t(`reason.${r.reason}`)}`}>{r.roundNumber}</span>
              ))}
            </div>
          )}
          <button className="mdx-btn primary big" onClick={onOpen} data-testid="open-live"><Icon name="play" size={14} /> {live ? t('mdx.hub.resume') : t('mdx.hub.watch')}</button>
          <p className="muted small">{t('mdx.hub.hint')}</p>
        </div>
      ) : (
        <div className="md-empty muted">{t('md.empty')}</div>
      )}
    </div>
  );
}
