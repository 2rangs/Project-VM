// "준비 중" placeholder for club-ops screens deferred by DECISION-001.
import { useT } from '../i18n/index.tsx';

export function Placeholder({ title }: { title: string }) {
  const t = useT();
  return (
    <div className="pad placeholder">
      <h2>{title}</h2>
      <div className="soon-card">
        <div className="soon-badge">{t('ph.soon')}</div>
        <p className="muted">{t('ph.body')}</p>
      </div>
    </div>
  );
}
