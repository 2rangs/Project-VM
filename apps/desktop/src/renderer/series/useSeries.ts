// Series orchestration for the series / veto screen: start a series, make our veto choices,
// let the AI make its own one step at a time (so each is revealed as it happens), refresh the
// view after a map. Thin wrapper over the Electron series bridge.
import { useCallback, useState } from 'react';
import { bridge } from '../platform.ts';
import type { SeriesStartRequest, SeriesView, VetoActionView } from '../../shared/series.ts';

export interface SeriesHook {
  view: SeriesView | null;
  busy: boolean;
  error: string | null;
  /** The veto action that was just made (for the reveal banner). */
  lastAction: VetoActionView | null;
  start: (req: SeriesStartRequest) => Promise<void>;
  choose: (choice: string) => Promise<void>;
  aiStep: () => Promise<void>;
  refresh: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useSeries(): SeriesHook {
  const [view, setView] = useState<SeriesView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<VetoActionView | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const start = useCallback((req: SeriesStartRequest) => run(async () => { setLastAction(null); setView(null); setView(await bridge.seriesStart(req)); }), [run]);
  const choose = useCallback((choice: string) => run(async () => {
    const r = await bridge.seriesCmd({ cmd: 'chooseVeto', choice });
    if (r.view) setView(r.view);
    if (r.action) setLastAction(r.action);
  }), [run]);
  const aiStep = useCallback(() => run(async () => {
    const r = await bridge.seriesCmd({ cmd: 'aiStep' });
    if (r.view) setView(r.view);
    if (r.action) setLastAction(r.action);
  }), [run]);
  const refresh = useCallback(() => run(async () => { const r = await bridge.seriesCmd({ cmd: 'view' }); if (r.view) setView(r.view); }), [run]);
  const stop = useCallback(async () => { try { await bridge.seriesStop(); } catch { /* */ } setView(null); setLastAction(null); setError(null); }, []);

  return { view, busy, error, lastAction, start, choose, aiStep, refresh, stop };
}
