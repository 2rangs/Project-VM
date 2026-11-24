// Main-process client of the bundled engine host (out/main/engine-host.js, src/engine/host.ts).
// One EngineWorker = one long-lived Electron utilityProcess: forked on first use, reused for every
// later request (so the engine's per-process caches — parsed map data — survive between matches),
// and re-forked on demand if it was killed. The engine is synchronous, so a worker answers its
// requests one at a time; work that must not wait on other work gets its own worker (see index.ts:
// one-shot matches, the interactive session, the series and the career background sim).
import { app, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineMessage, EngineOp, EngineRequest } from '../engine/protocol.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// electron-vite lays out: out/main/index.js, out/main/engine-host.js
const ENGINE_HOST = path.join(dirname, 'engine-host.js');

/**
 * Where the engine's data files are (see src/engine/root.ts): the packaged copy under
 * <resources>/engine, else the repository this build sits in (apps/desktop/out/main → repo root).
 * PV_ENGINE_ROOT / PV_REPO_ROOT override it (tests).
 */
export function engineDataRoot(): string {
  if (process.env.PV_ENGINE_ROOT) return process.env.PV_ENGINE_ROOT;
  if (app.isPackaged) return path.join(process.resourcesPath, 'engine');
  return process.env.PV_REPO_ROOT ?? path.resolve(dirname, '..', '..', '..', '..');
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  onEvent?: (data: unknown) => void;
}

export interface RequestOptions {
  /** After this long the request fails AND the worker is killed: a synchronous engine call cannot be interrupted. */
  timeoutMs?: number;
  /** Streamed events of this request (round progress of a one-shot match). */
  onEvent?: (data: unknown) => void;
}

export class EngineWorker {
  private child: UtilityProcess | null = null;
  private ready: Promise<UtilityProcess> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly name: string) {}

  /** Requests sent and not yet answered. */
  get inFlight(): number { return this.pending.size; }
  get alive(): boolean { return this.child !== null; }

  private start(): Promise<UtilityProcess> {
    if (this.ready) return this.ready;
    const child = utilityProcess.fork(ENGINE_HOST, [], {
      serviceName: `pv-engine-${this.name}`,
      env: { ...process.env, PV_ENGINE_ROOT: engineDataRoot() },
    });
    this.child = child;
    this.ready = new Promise<UtilityProcess>((resolve, reject) => {
      const boot = setTimeout(() => { reject(new Error(`engine worker "${this.name}" did not start`)); this.kill('engine worker did not start'); }, 30000);
      child.on('message', (m: EngineMessage) => {
        if ('ready' in m) { clearTimeout(boot); resolve(child); return; }
        const p = this.pending.get(m.id);
        if (!p) return;
        if ('event' in m) { p.onEvent?.(m.data); return; }
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) {
          try { p.resolve(JSON.parse(m.json)); } catch (e) { p.reject(new Error(`engine reply parse failed: ${(e as Error).message}`)); }
        } else p.reject(new Error(m.error));
      });
      child.on('exit', (code) => {
        clearTimeout(boot);
        if (this.child === child) { this.child = null; this.ready = null; }
        this.failAll(new Error(`engine worker "${this.name}" ended${code ? ` (exit ${code})` : ''}`));
        reject(new Error(`engine worker "${this.name}" exited before it was ready`));
      });
    });
    this.ready.catch(() => { /* reported to the request that was waiting */ });
    return this.ready;
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear();
  }

  async request<T>(op: EngineOp, payload?: unknown, opts: RequestOptions = {}): Promise<T> {
    const id = ++this.seq;
    const timeoutMs = opts.timeoutMs ?? 120000;
    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        // The engine call is still running in the worker and would block everything queued behind it.
        this.kill(`engine request ${op} timed out after ${Math.round(timeoutMs / 1000)} s`);
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, onEvent: opts.onEvent });
    });
    // The worker can be killed (dispose, timeout) while we are still waiting for it to start; the
    // caller only gets `result` afterwards, so it must not count as an unhandled rejection meanwhile.
    result.catch(() => undefined);
    try {
      const child = await this.start();
      if (this.pending.has(id)) child.postMessage({ id, op, payload } satisfies EngineRequest);
    } catch (e) {
      const p = this.pending.get(id);
      if (p) { this.pending.delete(id); clearTimeout(p.timer); p.reject(e as Error); }
    }
    return result;
  }

  /** Stop the process now; every unanswered request fails with `reason`. The next request forks a new one. */
  kill(reason = 'engine worker stopped'): void {
    const child = this.child;
    this.child = null; this.ready = null;
    this.failAll(new Error(reason));
    if (child) { try { child.kill(); } catch { /* already gone */ } }
  }
}
