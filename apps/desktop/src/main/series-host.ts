// Series host: a best-of-N series (@pv/match-runner createSeriesSession — veto → maps) living in
// its own bundled engine worker (src/engine/series-session.ts), driven with the same commands as
// before. One series at a time; starting a new one replaces the old.
import { EngineWorker } from './engine-worker.ts';
import type { SeriesStartRequest, SeriesView } from '../shared/series.ts';

export interface HostReply { ok: boolean; error?: string; [key: string]: unknown }

export class SeriesHost {
  private readonly worker = new EngineWorker('series');
  private started = false;
  /** True while a map of the series is being played round by round through the session channels. */
  gameOpen = false;

  get active(): boolean { return this.started; }

  async start(req: SeriesStartRequest): Promise<SeriesView> {
    this.dispose();
    this.started = true;
    // The first reply waits for the scouting film (a few simulated games) to be prepared.
    const r = await this.worker.request<{ view: SeriesView }>('series.start', req, { timeoutMs: 180000 });
    return r.view;
  }

  async send(cmd: Record<string, unknown>, timeoutMs = 120000): Promise<HostReply> {
    if (!this.started) throw new Error('no active series');
    const r = await this.worker.request<Record<string, unknown>>('series.cmd', cmd, { timeoutMs });
    return { ok: true, ...r };
  }

  dispose(): void {
    const wasStarted = this.started;
    this.started = false; this.gameOpen = false;
    // Mid-computation (film preparation, a map being played out) the only way to stop is to end
    // the process; an idle worker just forgets the series and keeps its caches.
    if (this.worker.inFlight > 0) this.worker.kill('series disposed');
    else if (wasStarted && this.worker.alive) void this.worker.request('series.stop').catch(() => undefined);
  }

  /** App shutdown. */
  shutdown(): void { this.started = false; this.gameOpen = false; this.worker.kill('series disposed'); }
}
