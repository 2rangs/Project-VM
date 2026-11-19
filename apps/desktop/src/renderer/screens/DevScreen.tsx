// Developer tools. Hosts the Decision Debugger (Handoff §21), including the
// ground-truth vs belief comparison — a dev-only view that does NOT feed the AI.
// The GROUND-TRUTH replay view (every real position) lives here, Dev-only, by
// design: Match Day shows only each team's fog-of-war perception (DECISION-004).
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { DebuggerScreen } from './DebuggerScreen.tsx';
import { useT } from '../i18n/index.tsx';
import perceptionDemo from '../../data/perception-demo.replay.json';

export function DevScreen({ ctx }: { ctx: ScreenCtx }) {
  const t = useT();
  return (
    <div className="dev-wrap">
      <div className="dev-note muted small pad">
        {t('dev.note')}
        {' '}
        <button
          className="fog-demo" data-testid="load-perception-demo"
          onClick={() => ctx.setReplay(perceptionDemo as unknown as Replay)}
        >
          {t('dev.loadDemo')}
        </button>
        <span className="muted small">{t('dev.demoHint')}</span>
      </div>
      {ctx.replay && (
        <section className="dev-truth">
          <div className="attr-grouplabel">
            {t('dev.groundTruth')} <span className="muted small">{t('dev.groundTruth.sub')}</span>
          </div>
          {/* perceptionPovTeamIdx defaults to null → full ground-truth render */}
          <ReplayViewer replay={ctx.replay} size={620} />
        </section>
      )}
      <DebuggerScreen />
    </div>
  );
}
