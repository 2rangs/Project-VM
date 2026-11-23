// Career mode in the main process:
//  - CareerSimHost: one long-lived tsx subprocess (scripts/career-sim.mts) that plays a day's AI
//    fixtures through @pv/match-runner, one series at a time, off the UI thread; progress is
//    streamed to the renderer after each series.
//  - save slots: <userData>/saves/<slot>.json (the whole career as one JSON document), written
//    atomically (temp file + rename) so a crash mid-write never corrupts a slot.
import { app, ipcMain } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC } from '../shared/ipc.ts';
import { SAVE_SLOTS, type CareerSimOutcome, type CareerSimProgress, type CareerSimRequest, type SaveSlot, type SaveSlotInfo } from '../shared/career.ts';

interface Reply { id?: number; ok: boolean; error?: string; outcome?: CareerSimOutcome }

class CareerSimHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();

  constructor(private readonly script: () => string, private readonly cwd: () => string) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn('npx', ['tsx', this.script()], { cwd: this.cwd(), env: process.env });
    this.child = child;
    this.rl = createInterface({ input: child.stdout });
    this.rl.on('line', (line) => {
      let msg: Reply;
      try { msg = JSON.parse(line.trim()); } catch { return; }
      if (typeof msg.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg); else p.reject(new Error(msg.error ?? 'career sim error'));
    });
    const fail = (e: Error) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); };
    child.on('exit', () => { fail(new Error('career sim ended')); if (this.child === child) { this.child = null; this.rl = null; } });
    child.on('error', fail);
    return child;
  }

  series(req: CareerSimRequest, timeoutMs = 300000): Promise<CareerSimOutcome> {
    const child = this.ensure();
    const id = ++this.seq;
    return new Promise<CareerSimOutcome>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('career sim timed out')); }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r.outcome!); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ id, cmd: 'series', req }) + '\n');
    });
  }

  dispose(): void {
    if (this.child) { try { this.child.stdin.write(JSON.stringify({ id: ++this.seq, cmd: 'stop' }) + '\n'); } catch { /* */ } try { this.child.kill(); } catch { /* */ } }
    this.child = null; this.rl?.close(); this.rl = null;
  }
}

function savesDir(): string { return process.env.PV_SAVES_DIR ?? path.join(app.getPath('userData'), 'saves'); }
const isSlot = (s: unknown): s is SaveSlot => typeof s === 'string' && (SAVE_SLOTS as readonly string[]).includes(s);
const slotFile = (slot: SaveSlot) => path.join(savesDir(), `${slot}.json`);

/** The header of a save without parsing the world: the meta object is written first. */
function metaOf(text: string): SaveSlotInfo['meta'] {
  try {
    const head = text.slice(0, 4096);
    const m = /"meta":(\{[^{}]*\})/.exec(head);
    return m ? JSON.parse(m[1]!) : null;
  } catch { return null; }
}

export function registerCareerIpc(opts: { script: () => string; cwd: () => string }): () => void {
  const host = new CareerSimHost(opts.script, opts.cwd);
  /** One batch at a time; a second request waits for the first. */
  let queue: Promise<unknown> = Promise.resolve();

  ipcMain.handle(IPC.careerSim, (event, reqs: CareerSimRequest[]) => {
    const run = async (): Promise<CareerSimOutcome[]> => {
      const out: CareerSimOutcome[] = [];
      const send = (p: CareerSimProgress) => { try { event.sender.send(IPC.careerSimProgress, p); } catch { /* window gone */ } };
      for (let i = 0; i < reqs.length; i++) {
        send({ done: i, total: reqs.length, current: { home: reqs[i]!.home.name, away: reqs[i]!.away.name } });
        out.push(await host.series(reqs[i]!));
      }
      send({ done: reqs.length, total: reqs.length, current: null });
      return out;
    };
    const job = queue.then(run, run);
    queue = job.catch(() => undefined);
    return job;
  });

  ipcMain.handle(IPC.saveList, async (): Promise<SaveSlotInfo[]> => Promise.all(SAVE_SLOTS.map(async (slot) => {
    try { return { slot, meta: metaOf(await readFile(slotFile(slot), 'utf8')) }; } catch { return { slot, meta: null }; }
  })));
  ipcMain.handle(IPC.saveRead, async (_e, slot: unknown): Promise<string | null> => {
    if (!isSlot(slot)) throw new Error('bad slot');
    try { return await readFile(slotFile(slot), 'utf8'); } catch { return null; }
  });
  ipcMain.handle(IPC.saveWrite, async (_e, slot: unknown, text: unknown): Promise<void> => {
    if (!isSlot(slot) || typeof text !== 'string') throw new Error('bad save');
    await mkdir(savesDir(), { recursive: true });
    const tmp = `${slotFile(slot)}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, slotFile(slot));
  });
  ipcMain.handle(IPC.saveDelete, async (_e, slot: unknown): Promise<void> => {
    if (!isSlot(slot)) throw new Error('bad slot');
    await rm(slotFile(slot), { force: true });
  });
  ipcMain.handle(IPC.appQuit, () => { app.quit(); });
  return () => host.dispose();
}
