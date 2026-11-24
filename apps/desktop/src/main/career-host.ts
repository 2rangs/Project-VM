// Career mode in the main process:
//  - CareerSimHost: one long-lived bundled engine worker (src/engine/career-sim.ts) that plays a
//    day's AI fixtures through @pv/match-runner, one series at a time, off the UI thread; progress
//    is streamed to the renderer after each series.
//  - save slots: <userData>/saves/<slot>.json (the whole career as one JSON document), written
//    atomically (temp file + rename) so a crash mid-write never corrupts a slot.
import { app, ipcMain } from 'electron';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IPC } from '../shared/ipc.ts';
import { EngineWorker } from './engine-worker.ts';
import { SAVE_SLOTS, type CareerSimOutcome, type CareerSimProgress, type CareerSimRequest, type SaveSlot, type SaveSlotInfo } from '../shared/career.ts';

class CareerSimHost {
  // Its own worker: a day's fixtures take minutes and must not hold up the user's own match.
  private readonly worker = new EngineWorker('career');

  async series(req: CareerSimRequest, timeoutMs = 300000): Promise<CareerSimOutcome> {
    return (await this.worker.request<{ outcome: CareerSimOutcome }>('career.series', req, { timeoutMs })).outcome;
  }

  dispose(): void { this.worker.kill('career sim disposed'); }
}

function savesDir(): string { return process.env.PV_SAVES_DIR ?? path.join(app.getPath('userData'), 'saves'); }
const isSlot = (s: unknown): s is SaveSlot => typeof s === 'string' && (SAVE_SLOTS as readonly string[]).includes(s);
const slotFile = (slot: SaveSlot) => path.join(savesDir(), `${slot}.json`);
/** One write chain per save slot (see saveWrite). */
const saveQueue = new Map<SaveSlot, Promise<void>>();

/** The header of a save without parsing the world: the meta object is written first. */
function metaOf(text: string): SaveSlotInfo['meta'] {
  try {
    const head = text.slice(0, 4096);
    const m = /"meta":(\{[^{}]*\})/.exec(head);
    return m ? JSON.parse(m[1]!) : null;
  } catch { return null; }
}

export function registerCareerIpc(): () => void {
  const host = new CareerSimHost();
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
    // Autosaves can overlap. Writes to one slot run one after another, in the order they arrived, so
    // the newest save is always the one left on disk (a shared `.tmp` used to be renamed away by the
    // other write → ENOENT; unique temp files alone would let an older write land last).
    const prev = saveQueue.get(slot) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      await mkdir(savesDir(), { recursive: true });
      const tmp = `${slotFile(slot)}.tmp`;
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, slotFile(slot));
    });
    saveQueue.set(slot, next);
    try { await next; } finally { if (saveQueue.get(slot) === next) saveQueue.delete(slot); }
  });
  ipcMain.handle(IPC.saveDelete, async (_e, slot: unknown): Promise<void> => {
    if (!isSlot(slot)) throw new Error('bad slot');
    await rm(slotFile(slot), { force: true });
  });
  ipcMain.handle(IPC.appQuit, () => { app.quit(); });
  return () => host.dispose();
}
