// Developer tools. Hosts the Decision Debugger (Handoff §21), including the
// ground-truth vs belief comparison — a dev-only view that does NOT feed the AI.
import { DebuggerScreen } from './DebuggerScreen.tsx';

export function DevScreen() {
  return (
    <div className="dev-wrap">
      <div className="dev-note muted small pad">
        Developer tooling. The ground-truth column here is a debug aid only and is not an input to the AI
        (DECISION-004 / §29).
      </div>
      <DebuggerScreen />
    </div>
  );
}
