// Series host process: one long-lived tsx subprocess running scripts/series-session.mts
// (@pv/match-runner createSeriesSession), driven over line-delimited JSON — the same
// arrangement as the interactive match SessionHost in index.ts, kept in its own file.
// One series at a time; starting a new one disposes the old.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { SeriesStartRequest, SeriesView } from '../shared/series.ts';

export interface HostReply { ok: boolean; error?: string; [key: string]: unknown }

export class SeriesHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: HostReply) => void; reject: (e: Error) => void }>();
  /** True while a map of the series is being played round by round through the session channels. */
  gameOpen = false;

  constructor(private readonly script: () => string, private readonly cwd: () => string) {}

  get active(): boolean { return this.child !== null; }

  async start(req: SeriesStartRequest): Promise<SeriesView> {
    this.dispose();
    const child = spawn('npx', ['tsx', this.script(), JSON.stringify(req)], { cwd: this.cwd(), env: process.env });
    this.child = child;
    this.rl = createInterface({ input: child.stdout });
    this.rl.on('line', (line) => {
      const text = line.trim(); if (!text) return;
      let msg: HostReply & { id?: number };
      try { msg = JSON.parse(text); } catch { return; } // ignore non-JSON diagnostics
      if (typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg); else p.reject(new Error(msg.error ?? 'series error'));
    });
    const fail = (e: Error) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); };
    child.on('exit', () => { fail(new Error('series ended')); if (this.child === child) { this.child = null; this.gameOpen = false; } });
    child.on('error', fail);
    // The first reply waits for the scouting film (a few simulated games) to be prepared.
    return (await this.send({ cmd: 'view' }, 180000)).view as SeriesView;
  }

  send(cmd: Record<string, unknown>, timeoutMs = 120000): Promise<HostReply> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('no active series'));
    const id = ++this.seq;
    return new Promise<HostReply>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('series command timed out')); }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
    });
  }

  dispose(): void {
    if (this.child) {
      try { this.child.stdin.write(JSON.stringify({ id: ++this.seq, cmd: 'stop' }) + '\n'); } catch { /* */ }
      try { this.child.kill(); } catch { /* */ }
    }
    this.rl?.close(); this.rl = null; this.child = null; this.gameOpen = false;
    for (const p of this.pending.values()) p.reject(new Error('series disposed'));
    this.pending.clear();
  }
}
