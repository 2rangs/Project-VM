// Loading screens for anything that takes long enough to notice. One original design used
// everywhere (CSS + inline SVG, no game assets): a streak banner that builds up in five steps
// (StreakBanner.tsx — the player picks the variant), a `//` label, and — when the work can report
// progress — a bar with a counter.
//
// Usage
//   <LoadingScreen title={t('load.sim.title')} detail="NRG vs Team Heretics" progress={0.4} steps="R11 · 5–5" />
//       full-area takeover while a screen has nothing to show yet (cover="window" covers the app)
//   <LoadingScreen title=… error={message} onDismiss={…} onRetry={…} />
//       the SAME surface when the work failed: a message and a way out — never an endless spinner
//   <LoadingInline label={t('load.assets.mesh')} />
//       a small chip for something that loads next to content already on screen
//
// Rules the callers follow: render it only while the work is pending (it holds no timers of its
// own, so it cannot outlive the work), and pass `error` instead of leaving it up on failure.
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.tsx';
import { LoadingBanner, useLoadingBanner, type BannerStage } from './StreakBanner.tsx';
import './loading.css';

export function LoadingMark({ size = 56 }: { size?: number }) {
  return (
    <svg className="pvl-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path className="pvl-m a" d="M24 4l9 9-9 9-9-9z" />
      <path className="pvl-m b" d="M35 15l9 9-9 9-9-9z" />
      <path className="pvl-m c" d="M24 26l9 9-9 9-9-9z" />
      <path className="pvl-m d" d="M13 15l9 9-9 9-9-9z" />
    </svg>
  );
}

export interface LoadingScreenProps {
  title: string;
  /** What is being worked on (teams, map, file…). */
  detail?: ReactNode;
  /** 0..1 when the work reports progress; omit for an indeterminate bar. */
  progress?: number | null;
  /** Short counter next to the bar, e.g. "맵 2/3 · 라운드 14". */
  steps?: string | null;
  /** Set when the work failed: the screen turns into an error panel. */
  error?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** 'area' fills the positioned parent (default); 'window' covers the whole app window. */
  cover?: 'area' | 'window';
  testId?: string;
}

export function LoadingScreen({ title, detail, progress, steps, error, onRetry, onDismiss, cover = 'area', testId = 'loading-screen' }: LoadingScreenProps) {
  const t = useT();
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const banner = useLoadingBanner();
  // with real progress the banner builds 1 → 5 as the work advances; otherwise it loops
  const stage: BannerStage = pct == null ? 'loop' : (Math.min(5, Math.floor(pct / 20) + 1) as BannerStage);
  if (error) {
    return (
      <div className={`pvl pvl-${cover} pvl-error`} role="alert" data-testid={`${testId}-error`}>
        <div className="pvl-card">
          <span className="pvl-kicker"><i>//</i>{t('load.error.kicker')}</span>
          <strong className="pvl-title">{title}</strong>
          <p className="pvl-msg">{error}</p>
          <div className="pvl-actions">
            {onRetry && <button className="pvl-btn primary" onClick={onRetry} data-testid="loading-retry">{t('load.error.retry')}</button>}
            {onDismiss && <button className="pvl-btn" onClick={onDismiss} data-testid="loading-dismiss">{t('load.error.dismiss')}</button>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`pvl pvl-${cover}`} role="status" aria-live="polite" aria-busy="true" data-testid={testId} data-banner={banner}>
      <div className="pvl-card">
        <LoadingBanner variant={banner} stage={stage} />
        <span className={`pvl-pips ${stage === 'loop' ? 'loop' : ''}`} aria-hidden>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={stage !== 'loop' && stage >= n ? 'on' : ''} />)}</span>
        <span className="pvl-kicker"><i>//</i>{t('load.kicker')}</span>
        <strong className="pvl-title">{title}</strong>
        {detail && <span className="pvl-detail">{detail}</span>}
        <div className={`pvl-bar ${pct == null ? 'indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <i style={pct == null ? undefined : { width: `${pct}%` }} />
        </div>
        <span className="pvl-steps" data-testid="loading-steps">{steps ?? (pct != null ? `${pct}%` : ' ')}</span>
      </div>
    </div>
  );
}

/** A small "still loading" chip for content that arrives next to what is already on screen. */
export function LoadingInline({ label, testId = 'loading-inline' }: { label: string; testId?: string }) {
  return <span className="pvl-inline" role="status" data-testid={testId}><LoadingMark size={14} />{label}</span>;
}
