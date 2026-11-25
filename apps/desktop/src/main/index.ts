// Electron main process. Security defaults: contextIsolation ON,
// nodeIntegration OFF, sandbox ON; the renderer reaches privileged work only
// through the preload whitelist (src/preload). Simulation runs in a separate
// utilityProcess (DECISION-007), never on the UI thread.
import { app, BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
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
import type { OpponentReportView, PrematchRequest, TacticsMapView } from '../shared/manager.ts'; // [manager]
// [career]
import { registerCareerIpc } from './career-host.ts';
import { EngineWorker } from './engine-worker.ts';

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

// The match engine (@pv/match-runner and every engine under it) is bundled into
// out/main/engine-host.js and runs in Electron utility processes (src/main/engine-worker.ts) — no
// tsx, no workspace at run time. One worker per kind of work, so they never wait on each other.
// [series]
const seriesHost = new SeriesHost();
// [career] background simulation of AI fixtures + save slots
const disposeCareer = registerCareerIpc();
/** One-shot matches ("run the whole map"). */
const matchWorker = new EngineWorker('match');

// --- interactive match session: a stateful @pv/match-runner MatchSession living in its own
//     engine worker (src/engine/match-session.ts). One session at a time; starting a new one
//     replaces the old. ---
class SessionHost {
  private readonly worker = new EngineWorker('session');
  private started = false;

  async start(req: SessionStartRequest): Promise<SessionState> {
    this.dispose();
    const cfg = {
      teamA: req.teamA, teamB: req.teamB, map: req.mapId, seed: req.seed, aiTeams: req.aiTeams ?? ['B'],
      options: req.options ?? {},
      // [manager] our pre-match plan and the opponent film the report was read from
      ...(req.plan ? { plan: req.plan } : {}),
      ...(req.scouting ? { scouting: req.scouting } : {}),
    };
    this.started = true;
    const r = await this.worker.request<{ state: SessionState }>('session.start', cfg, { timeoutMs: 60000 });
    return r.state;
  }

  async send(cmd: SessionCommand): Promise<SessionReply> {
    if (!this.started) throw new Error('no active session');
    const r = await this.worker.request<Omit<SessionReply, 'ok'>>('session.cmd', cmd, { timeoutMs: 60000 });
    return { ok: true, ...r };
  }

  dispose(): void {
    const wasStarted = this.started;
    this.started = false;
    // a round being played cannot be interrupted, only ended with its process
    if (this.worker.inFlight > 0) this.worker.kill('session disposed');
    else if (wasStarted && this.worker.alive) void this.worker.request('session.stop').catch(() => undefined);
  }

  shutdown(): void { this.started = false; this.worker.kill('session disposed'); }
}
const sessionHost = new SessionHost();
// Diagnostics: a process that disappears leaves a line on stderr (the e2e prints it with
// PV_E2E_VERBOSE=1). Monitor-only: none of these changes how the app behaves or exits.
process.on('uncaughtExceptionMonitor', (e, origin) => console.error(`[main] uncaught ${origin}: ${(e as Error)?.stack ?? String(e)}`));
process.on('unhandledRejection', (r) => console.error(`[main] unhandled rejection: ${(r as Error)?.stack ?? String(r)}`));
app.on('render-process-gone', (_e, _wc, d) => console.error(`[main] renderer gone: ${d.reason} (exit ${d.exitCode})`));
app.on('child-process-gone', (_e, d) => console.error(`[main] child process gone: ${d.type} ${d.name ?? ''} ${d.reason} (exit ${d.exitCode})`));
app.on('before-quit', () => console.error('[main] before-quit'));
app.on('will-quit', () => { disposeCareer(); seriesHost.shutdown(); sessionHost.shutdown(); matchWorker.kill('app quit'); prematchWorker.kill('app quit'); });

async function runMatchRunner(req: SimRunRequest, runId: string, sender: Electron.WebContents): Promise<SimResult> {
  const cfg = {
    teamA: req.teamA ?? { id: 'A', name: 'Team A' },
    teamB: req.teamB ?? { id: 'B', name: 'Team B' },
    map: req.mapId, seed: req.seed, options: req.options ?? {},
  };
  const send = (p: SimProgress) => { try { sender.send(IPC.simProgress, p); } catch { /* window gone */ } };
  send({ runId, phase: 'start', pct: 0, message: 'match-runner (pistol → halves → 13 → OT)' });
  const raw = await matchWorker.request<RawMatch>('match.run', cfg, {
    timeoutMs: 180000,
    onEvent: (data) => {
      const p = data as { round: number; score: { A: number; B: number } };
      // first to 13: the leader's score is the best available estimate of how far along the map is
      const pct = Math.min(0.98, Math.max(p.score.A, p.score.B) / 13);
      send({ runId, phase: 'round', pct, round: p.round, score: p.score });
    },
  });
  send({ runId, phase: 'round', pct: 0.99, message: `match: ${raw.winner} wins ${raw.score.A}-${raw.score.B} (${raw.rounds.length} rounds, OT=${raw.wentToOvertime})` });
  const { events, summary, perception } = mergeMatch(raw);
  const replay = fromSimEventLog(events, {
    mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
    matchId: `${summary.teams.A.name} vs ${summary.teams.B.name}`,
    perception, // match-level fog-of-war / belief track (undefined if not recorded)
  });
  send({ runId, phase: 'done', pct: 1 });
  return { runId, source: 'match-runner', replay, match: summary };
}

// --- simulation: the real match-runner in the engine worker; if that fails, fall back to the
//     bundled round-simulator utilityProcess so Match Day always produces a replay. ---
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

// [manager] Pre-match opponent report (simulates the opponent's film): its own engine worker, so a
// report being prepared never holds up a match.
const prematchWorker = new EngineWorker('prematch');
ipcMain.handle(IPC.prematchReport, async (_e, req: PrematchRequest): Promise<OpponentReportView> =>
  (await prematchWorker.request<{ report: OpponentReportView }>('prematch.report', req, { timeoutMs: 180000 })).report);
// [tactics] the map's plant spots / retake entries / mid, read by the same worker (plays nothing)
ipcMain.handle(IPC.tacticsMap, async (_e, mapId: string): Promise<TacticsMapView> =>
  prematchWorker.request<TacticsMapView>('tactics.map', { mapId }, { timeoutMs: 60000 }));

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
// map geometry is third-party IP and is never committed), else the shared local asset store
// ~/ProjectV-assets/maps/glb/<map>.glb that tools/map-mesh/blender/export-web-glb.py writes to, so
// every checkout and worktree finds it. Absent → null → navgraph blockout.
ipcMain.handle(IPC.mapMesh, async (_e, mapId: string): Promise<Uint8Array | null> => {
  const safe = path.basename(String(mapId)).replace(/[^a-zA-Z0-9_-]/g, '');
  // app path is apps/desktop under electron-vite dev, but out/main when Electron is given the built entry.
  const dirs = process.env.PV_MAP_ASSETS_DIR
    ? [process.env.PV_MAP_ASSETS_DIR]
    : [path.join(app.getAppPath(), 'assets', 'maps'), path.join(dirname, '..', '..', 'assets', 'maps'), path.join(os.homedir(), 'ProjectV-assets', 'maps', 'glb')];
  for (const dir of dirs) {
    try { return new Uint8Array(await readFile(path.join(dir, `${safe}.glb`))); } catch { /* try the next location */ }
  }
  return null;
});

// User-supplied loading banners: apps/desktop/assets/banners/<pack>/<stage>.<ext> (gitignored). The app
// never downloads or ships banner media; it only plays what the user has put there themselves.
const BANNER_FILE = /^([1-6])\.(webm|mp4|png|webp|gif|jpg|jpeg)$/i;
// layered kill banners (frame / ring / emblem / pip images, as composited in game)
const BANNER_LAYER = /(frame|ring|emblem|pip)[^/]*\.(png|webp)$/i;
// optional per-step sounds of a layered banner (kill1.mp3 … kill5.mp3)
const BANNER_SOUND = /^kill([1-6])\.(mp3|ogg|wav)$/i;
function bannerDirs(): string[] {
  return process.env.PV_BANNER_ASSETS_DIR
    ? [process.env.PV_BANNER_ASSETS_DIR]
    : [path.join(app.getAppPath(), 'assets', 'banners'), path.join(dirname, '..', '..', 'assets', 'banners')];
}
ipcMain.handle(IPC.bannerList, async (): Promise<Array<{ id: string; files: Record<number, string>; layers?: Record<string, string>; sounds?: Record<number, string> }>> => {
  for (const dir of bannerDirs()) {
    try {
      const packs: Array<{ id: string; files: Record<number, string>; layers?: Record<string, string>; sounds?: Record<number, string> }> = [];
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        if (!ent.isDirectory() || !/^[\w .-]{1,48}$/.test(ent.name)) continue;
        const files: Record<number, string> = {};
        const layers: Record<string, string> = {};
        const sounds: Record<number, string> = {};
        for (const f of await readdir(path.join(dir, ent.name))) {
          const m = BANNER_FILE.exec(f); if (m) files[Number(m[1])] = f;
          const l = BANNER_LAYER.exec(f); if (l) layers[l[1].toLowerCase()] = f;
          const snd = BANNER_SOUND.exec(f); if (snd) sounds[Number(snd[1])] = f;
        }
        const layered = ['frame', 'ring', 'emblem', 'pip'].every((k) => layers[k]);
        if (Object.keys(files).length > 0 || layered) packs.push({ id: ent.name, files, ...(layered ? { layers } : {}), ...(Object.keys(sounds).length ? { sounds } : {}) });
      }
      return packs.sort((a, b) => a.id.localeCompare(b.id));
    } catch { /* try the next location */ }
  }
  return [];
});
ipcMain.handle(IPC.bannerFile, async (_e, pack: string, file: string): Promise<Uint8Array | null> => {
  const p = path.basename(String(pack)); const f = path.basename(String(file));
  if (!/^[\w .-]{1,48}$/.test(p) || !(BANNER_FILE.test(f) || BANNER_LAYER.test(f) || BANNER_SOUND.test(f))) return null;
  for (const dir of bannerDirs()) {
    try { return new Uint8Array(await readFile(path.join(dir, p, f))); } catch { /* try the next location */ }
  }
  return null;
});

// Kingdom Archives media the user fetched with scripts/fetch-playercards.mjs:
// apps/desktop/assets/playercards/ (committed). Read-only; the app never downloads it itself.
const MEDIA_KINDS = new Set(['playercards']);
const MEDIA_FILE = /^(?:[\w-]{1,40}\/)?[\w-]{1,60}\.png$/i;
function mediaDirs(kind: string): string[] {
  const env = process.env.PV_MEDIA_ASSETS_DIR;
  return env ? [path.join(env, kind)] : [path.join(app.getAppPath(), 'assets', kind), path.join(dirname, '..', '..', 'assets', kind)];
}
ipcMain.handle(IPC.mediaManifest, async (_e, kind: string): Promise<unknown | null> => {
  if (!MEDIA_KINDS.has(String(kind))) return null;
  for (const dir of mediaDirs(String(kind))) {
    try { return JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* try the next location */ }
  }
  return null;
});
ipcMain.handle(IPC.mediaFile, async (_e, kind: string, file: string): Promise<Uint8Array | null> => {
  if (!MEDIA_KINDS.has(String(kind)) || !MEDIA_FILE.test(String(file))) return null;
  for (const dir of mediaDirs(String(kind))) {
    try { return new Uint8Array(await readFile(path.join(dir, String(file)))); } catch { /* try the next location */ }
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
