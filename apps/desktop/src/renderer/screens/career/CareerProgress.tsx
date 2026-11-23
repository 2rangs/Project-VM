// Simple progress surface for career work (world generation, loading a save, background
// simulation). Same props shape as the match-day session's LoadingScreen (title / detail /
// progress / steps) so it can be swapped for it once that lands on main.
import type { ReactNode } from 'react';

export function CareerProgress({ title, detail, progress, steps, inline }: {
  title: string; detail?: ReactNode; progress?: number | null; steps?: string | null; inline?: boolean;
}) {
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className={inline ? 'cprog inline' : 'cprog'} role="status" data-testid="career-progress">
      <div className="cprog-card">
        <div className="cprog-title">{title}</div>
        {detail && <div className="cprog-detail small muted">{detail}</div>}
        <div className={`cprog-bar ${pct == null ? 'indet' : ''}`}><span style={pct == null ? undefined : { width: `${pct}%` }} /></div>
        {steps && <div className="cprog-steps small muted">{steps}</div>}
      </div>
    </div>
  );
}
