// Electron main process. Security defaults: contextIsolation ON,
// nodeIntegration OFF, sandbox ON; the renderer reaches privileged work only
// through the preload whitelist (src/preload). Simulation runs in a separate
// utilityProcess (DECISION-007), never on the UI thread.
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { readFile, readdir } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fromSimEventLog, type SimEvent } from '@pv/replay-engine';
import { ASCENT_TRANSFORM } from '../shared/ascent-transform.ts';
import { mergeMatch, type RawMatch } from '../shared/match-merge.ts';
import {
  IPC, type SessionCommand, type SessionReply, type SessionStartRequest, type SessionState,
  type SimProgress, type SimRunRequest, type SimResult,
} from '../shared/ipc.ts';
// [series]
import { SeriesHost } from './series-host.ts';
import type { SeriesCommand, SeriesReply, SeriesStartRequest, SeriesView } from '../shared/series.ts';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// electron-vite lays out: out/main/index.js, out/main/sim-worker.js, out/preload/index.mjs
const WORKER = path.join(dirname, 'sim-worker.js');
const PRELOAD = path.join(dirname, '../preload/index.mjs');

// Decision-trace fixtures live in the repo at test/fixtures/traces. Resolve from
// the app root (works in electron-vite dev); override with PV_TRACES_DIR.
function tracesDir(): string {
  return process.env.PV_TRACES_DIR
    ?? path.join(app.getAppPath(), 'test', 'fixtures', 'traces');
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180, height: 900, backgroundColor: '#0b0e13',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,   // renderer cannot touch Node/Electron directly
      nodeIntegration: false,   // no require/process in the renderer
      sandbox: false,           // ESM preload compat on Electron 33; switch to a
                                // CJS preload to re-enable the OS sandbox
      webSecurity: true,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(dirname, '../renderer/index.html'));
  return win;
}

// The match-runner (@pv/match-runner) reads data files and pulls in many engines,
// so it runs as a SEPARATE tsx subprocess in the workspace (not bundled). repoRoot
// resolves from the app path; override with PV_REPO_ROOT / PV_MATCH_SCRIPT for E2E.
function repoRoot(): string { return process.env.PV_REPO_ROOT ?? path.resolve(app.getAppPath(), '..', '..'); }
function matchScript(): string { return process.env.PV_MATCH_SCRIPT ?? path.join(app.getAppPath(), 'scripts', 'run-match.mts'); }
function sessionScript(): string { return process.env.PV_SESSION_SCRIPT ?? path.join(app.getAppPath(), 'scripts', 'match-session.mts'); }
// [series]
function seriesScript(): string { return process.env.PV_SERIES_SCRIPT ?? path.join(app.getAppPath(), 'scripts', 'series-session.mts'); }
const seriesHost = new SeriesHost(seriesScript, repoRoot);

// --- interactive match session: one long-lived tsx subprocess hosting a stateful
//     @pv/match-runner MatchSession, driven over a line-delimited JSON protocol.
//     One session at a time; starting a new one disposes the old. ---
class SessionHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: SessionReply) => void; reject: (e: Error) => void }>();

  async start(req: SessionStartRequest): Promise<SessionState> {
    this.dispose();
    const cfg = {
      teamA: req.teamA, teamB: req.teamB, map: req.mapId, seed: req.seed, aiTeams: req.aiTeams ?? ['B'],
      options: req.options ?? {},
    };
    const child = spawn('npx', ['tsx', sessionScript(), JSON.stringify(cfg)], { cwd: repoRoot(), env: process.env });
    this.child = child;
    this.rl = createInterface({ input: child.stdout });
    this.rl.on('line', (line) => {
      const text = line.trim(); if (!text) return;
      let msg: SessionReply & { id?: number };
      try { msg = JSON.parse(text); } catch { return; } // ignore non-JSON diagnostics
      if (typeof msg.id === 'number') {
        const p = this.pending.get(msg.id);
        if (p) { this.pending.delete(msg.id); msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error ?? 'session error')); }
      }
    });
    child.on('exit', () => { for (const p of this.pending.values()) p.reject(new Error('session ended')); this.pending.clear(); });
    child.on('error', (e) => { for (const p of this.pending.values()) p.reject(e); this.pending.clear(); });
    const r = await this.send({ cmd: 'state' });
    return r.state!;
  }

  send(cmd: SessionCommand): Promise<SessionReply> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('no active session'));
    const id = ++this.seq;
    return new Promise<SessionReply>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.pending.delete(id)) reject(new Error('session command timed out')); }, 60000);
      this.pending.set(id, {
        resolve: (r: SessionReply) => { clearTimeout(timer); resolve(r); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(JSON.stringify({ id, ...cmd }) + '\n');
    });
  }

  dispose(): void {
    if (this.child) { try { this.child.stdin.write(JSON.stringify({ id: ++this.seq, cmd: 'stop' }) + '\n'); } catch { /* */ } try { this.child.kill(); } catch { /* */ } }
    this.rl?.close(); this.rl = null; this.child = null;
    for (const p of this.pending.values()) p.reject(new Error('session disposed'));
    this.pending.clear();
  }
}
const sessionHost = new SessionHost();

function runMatchRunner(req: SimRunRequest, runId: string, sender: Electron.WebContents): Promise<SimResult> {
  return new Promise<SimResult>((resolve, reject) => {
    const cfg = {
      teamA: req.teamA ?? { id: 'A', name: 'Team A' },
      teamB: req.teamB ?? { id: 'B', name: 'Team B' },
      map: req.mapId, seed: req.seed, options: req.options ?? {},
    };
    sender.send(IPC.simProgress, { runId, phase: 'start', pct: 0, message: 'match-runner (pistol → halves → 13 → OT)' } satisfies SimProgress);
    const child = spawn('npx', ['tsx', matchScript(), JSON.stringify(cfg)], { cwd: repoRoot(), env: process.env });
    let out = ''; let errBuf = '';
    const timeout = setTimeout(() => { try { child.kill(); } catch { /* */ } reject(new Error('match-runner timed out')); }, 90000);
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => {
      errBuf += String(d);
      // run-match.mts logs round progress to stderr; drop npx/npm bootstrap noise.
      const msg = String(d).split('\n').map((l) => l.trim())
        .filter((l) => l && !/^npm (warn|notice)/i.test(l)).join(' ').slice(0, 120);
      if (msg) sender.send(IPC.simProgress, { runId, phase: 'round', pct: 0.5, message: msg } satisfies SimProgress);
    });
    child.on('error', (e) => { clearTimeout(timeout); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`match-runner exited ${code}: ${errBuf.slice(-200)}`));
      try {
        const raw = JSON.parse(out) as RawMatch;
        const { events, summary, perception } = mergeMatch(raw);
        const replay = fromSimEventLog(events, {
          mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
          matchId: `${summary.teams.A.name} vs ${summary.teams.B.name}`,
          perception, // match-level fog-of-war / belief track (undefined if not recorded)
        });
        sender.send(IPC.simProgress, { runId, phase: 'done', pct: 1 } satisfies SimProgress);
        resolve({ runId, source: 'match-runner', replay, match: summary });
      } catch (e) { reject(new Error(`match-runner output parse failed: ${(e as Error).message}`)); }
    });
  });
}

// --- simulation: try the real match-runner subprocess; fall back to the bundled
//     round-simulator utilityProcess so Match Day always produces a replay. ---
ipcMain.handle(IPC.simRun, async (event, req: SimRunRequest): Promise<SimResult> => {
  const runId = randomUUID();
  const sender = event.sender;
  if (req.seriesGame) return runSeriesGame(req, runId, sender); // [series] next map of the live series
  try {
    return await runMatchRunner(req, runId, sender);
  } catch (err) {
    sender.send(IPC.simProgress, { runId, phase: 'start', pct: 0, message: `match-runner unavailable (${(err as Error).message.slice(0, 80)}); round-sim fallback` } satisfies SimProgress);
    return await runRoundSimFallback(req, runId, sender);
  }
});

function runRoundSimFallback(req: SimRunRequest, runId: string, sender: Electron.WebContents): Promise<SimResult> {
  const child: UtilityProcess = utilityProcess.fork(WORKER, [runId, JSON.stringify(req)], { stdio: 'ignore' });
  return new Promise<SimResult>((resolve, reject) => {
    const timeout = setTimeout(() => { try { child.kill(); } catch { /* */ } reject(new Error('sim worker timed out')); }, 30000);
    const onMsg = (m: { type: string; progress?: SimProgress; events?: SimEvent[]; message?: string }) => {
      if (m.type === 'progress' && m.progress) sender.send(IPC.simProgress, m.progress);
      else if (m.type === 'result') {
        clearTimeout(timeout);
        const replay = fromSimEventLog((m.events ?? []) as SimEvent[], {
          mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
        });
        child.kill();
        resolve({ runId, source: 'round-simulator', replay });
      } else if (m.type === 'error') { clearTimeout(timeout); child.kill(); reject(new Error(m.message)); }
    };
    child.on('message', onMsg);
    child.on('exit', (code) => { if (code && code !== 0) reject(new Error(`sim worker exited ${code}`)); });
    // the job is posted once the worker signals { type: 'ready' } (see onMsg)
  });
}

// [series] While a map of a series is open, the session channels talk to the series host (which
// speaks the same commands, reported from our team's seat); otherwise to the plain match session.
ipcMain.handle(IPC.sessionStart, async (_e, req: SessionStartRequest): Promise<SessionState> => {
  if (!req.seriesGame) { seriesHost.gameOpen = false; return sessionHost.start(req); }
  const r = await seriesHost.send({ cmd: 'startGame' });
  seriesHost.gameOpen = true;
  return r.state as SessionState;
});
ipcMain.handle(IPC.sessionCmd, async (_e, cmd: SessionCommand): Promise<SessionReply> =>
  (seriesHost.gameOpen ? (seriesHost.send({ ...cmd }) as Promise<SessionReply>) : sessionHost.send(cmd)));
ipcMain.handle(IPC.sessionStop, async (): Promise<void> => {
  if (seriesHost.gameOpen) { seriesHost.gameOpen = false; await seriesHost.send({ cmd: 'closeGame' }, 180000); return; } // plays the map out
  sessionHost.dispose();
});

// [series] veto + series state
ipcMain.handle(IPC.seriesStart, async (_e, req: SeriesStartRequest): Promise<SeriesView> => seriesHost.start(req));
ipcMain.handle(IPC.seriesCmd, async (_e, cmd: SeriesCommand): Promise<SeriesReply> => seriesHost.send({ ...cmd }) as Promise<SeriesReply>);
ipcMain.handle(IPC.seriesStop, async (): Promise<void> => { seriesHost.dispose(); });

/** [series] One map of the live series in one go: the host returns the same RawMatch as run-match.mts. */
async function runSeriesGame(req: SimRunRequest, runId: string, sender: Electron.WebContents): Promise<SimResult> {
  sender.send(IPC.simProgress, { runId, phase: 'start', pct: 0, message: 'series map (match-runner)' } satisfies SimProgress);
  const r = await seriesHost.send({ cmd: 'playGame' }, 180000);
  const { events, summary, perception } = mergeMatch(r.match as RawMatch);
  const replay = fromSimEventLog(events, {
    mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
    matchId: `${summary.teams.A.name} vs ${summary.teams.B.name}`, perception,
  });
  sender.send(IPC.simProgress, { runId, phase: 'done', pct: 1 } satisfies SimProgress);
  return { runId, source: 'match-runner', replay, match: summary };
}

// Optional real map mesh for the 3D team cams: apps/desktop/assets/maps/<map>.glb (gitignored —
// map geometry is third-party IP and is never committed). Absent → null → navgraph blockout.
ipcMain.handle(IPC.mapMesh, async (_e, mapId: string): Promise<Uint8Array | null> => {
  const safe = path.basename(String(mapId)).replace(/[^a-zA-Z0-9_-]/g, '');
  // app path is apps/desktop under electron-vite dev, but out/main when Electron is given the built entry.
  const dirs = process.env.PV_MAP_ASSETS_DIR
    ? [process.env.PV_MAP_ASSETS_DIR]
    : [path.join(app.getAppPath(), 'assets', 'maps'), path.join(dirname, '..', '..', 'assets', 'maps')];
  for (const dir of dirs) {
    try { return new Uint8Array(await readFile(path.join(dir, `${safe}.glb`))); } catch { /* try the next location */ }
  }
  return null;
});

ipcMain.handle(IPC.traceList, async (): Promise<string[]> => {
  try {
    const files = await readdir(tracesDir());
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch { return []; }
});

ipcMain.handle(IPC.traceLoad, async (_e, id: string): Promise<unknown> => {
  const safe = path.basename(id).replace(/[^a-zA-Z0-9_-]/g, '');
  return JSON.parse(await readFile(path.join(tracesDir(), `${safe}.json`), 'utf8'));
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
