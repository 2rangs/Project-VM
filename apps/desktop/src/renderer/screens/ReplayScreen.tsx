// Replay screen — reuses the shared <ReplayViewer> from apps/replay-viewer
// (imported as @pv/replay-viewer, NOT copy-pasted). Adds desktop-side loading
// (open file / drag-drop) and honors external seek requests from the Debugger.
import { useCallback } from 'react';
import type { Replay } from '@pv/replay-engine';
import { ReplayViewer } from '@pv/replay-viewer';

export function ReplayScreen({
  replay, seekTo, onOpen,
}: { replay: Replay | null; seekTo: number | null; onOpen: (r: Replay, label: string) => void }) {
  const onDrop = useCallback(async (ev: React.DragEvent) => {
    ev.preventDefault();
    const f = ev.dataTransfer.files[0];
    if (f) onOpen(JSON.parse(await f.text()), f.name);
  }, [onOpen]);

  return (
    <div className="replay pad" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {!replay && <div className="muted">No replay loaded. Run a simulation, or open / drag a replay JSON.</div>}
      <ReplayViewer replay={replay} seekTo={seekTo} />
      <div className="replay-foot">
        <label className="fileopen">Open replay…
          <input type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) onOpen(JSON.parse(await f.text()), f.name); }} />
        </label>
        <span className="muted small">…or drag a replay JSON here.</span>
      </div>
    </div>
  );
}
