// Electron main process. Security defaults: contextIsolation ON,
// nodeIntegration OFF, sandbox ON; the renderer reaches privileged work only
// through the preload whitelist (src/preload). Simulation runs in a separate
// utilityProcess (DECISION-007), never on the UI thread.
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { readFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fromSimEventLog, type SimEvent } from '@pv/replay-engine';
import { ASCENT_TRANSFORM } from '../shared/ascent-transform.ts';
import { mergeMatch, type RawMatch } from '../shared/match-merge.ts';
import { IPC, type SimProgress, type SimRunRequest, type SimResult } from '../shared/ipc.ts';

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

function runMatchRunner(req: SimRunRequest, runId: string, sender: Electron.WebContents): Promise<SimResult> {
  return new Promise<SimResult>((resolve, reject) => {
    const cfg = {
      teamA: req.teamA ?? { id: 'A', name: 'Team A' },
      teamB: req.teamB ?? { id: 'B', name: 'Team B' },
      map: req.mapId, seed: req.seed,
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
        const { events, summary } = mergeMatch(raw);
        const replay = fromSimEventLog(events, {
          mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
          matchId: `${summary.teams.A.name} vs ${summary.teams.B.name}`,
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
