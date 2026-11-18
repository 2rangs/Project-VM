// Developer tools. Hosts the Decision Debugger (Handoff §21), including the
// ground-truth vs belief comparison — a dev-only view that does NOT feed the AI.
// The GROUND-TRUTH replay view (every real position) lives here, Dev-only, by
// design: Match Day shows only each team's fog-of-war perception (DECISION-004).
import { ReplayViewer } from '@pv/replay-viewer';
import type { Replay } from '@pv/replay-engine';
import type { ScreenCtx } from '../App.tsx';
import { DebuggerScreen } from './DebuggerScreen.tsx';
import perceptionDemo from '../../data/perception-demo.replay.json';

export function DevScreen({ ctx }: { ctx: ScreenCtx }) {
  return (
    <div className="dev-wrap">
      <div className="dev-note muted small pad">
        Developer tooling. The ground-truth views here are a debug aid only and are not an input to the AI
        (DECISION-004 / §29). Match Day never shows ground truth — only each team's perception.
        {' '}
        <button
          className="fog-demo" data-testid="load-perception-demo"
          onClick={() => ctx.setReplay(perceptionDemo as unknown as Replay)}
        >
          Load perception demo replay
        </button>
        <span className="muted small"> — a bundled real-data replay with a recorded perception track; open Match Day to see its fog view.</span>
      </div>
      {ctx.replay && (
        <section className="dev-truth">
          <div className="attr-grouplabel">
            Ground truth <span className="muted small">(every real position — Dev only)</span>
          </div>
          {/* perceptionPovTeamIdx defaults to null → full ground-truth render */}
          <ReplayViewer replay={ctx.replay} size={620} />
        </section>
      )}
      <DebuggerScreen />
    </div>
  );
}
