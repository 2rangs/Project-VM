// Preload: the ONLY bridge between the sandboxed renderer and main. Exposes a
// minimal, explicit whitelist on window.pv via contextBridge — no ipcRenderer,
// no node, no remote module reach into the renderer.
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC, type PvBridge, type SessionCommand, type SessionReply, type SessionStartRequest,
  type SessionState, type SimProgress, type SimResult, type SimRunRequest, type TeamOrder, type TeamSlot,
} from '../shared/ipc.ts';
import type { SeriesCommand, SeriesReply, SeriesStartRequest, SeriesView } from '../shared/series.ts';

const cmd = (c: SessionCommand): Promise<SessionReply> => ipcRenderer.invoke(IPC.sessionCmd, c);

const bridge: PvBridge = {
  async runSimulation(req: SimRunRequest, onProgress: (p: SimProgress) => void): Promise<SimResult> {
    const handler = (_e: unknown, p: SimProgress) => onProgress(p);
    ipcRenderer.on(IPC.simProgress, handler);
    try {
      return await ipcRenderer.invoke(IPC.simRun, req);
    } finally {
      ipcRenderer.removeListener(IPC.simProgress, handler);
    }
  },
  loadTrace: (id: string) => ipcRenderer.invoke(IPC.traceLoad, id),
  listTraces: () => ipcRenderer.invoke(IPC.traceList),
  sessionStart: (req: SessionStartRequest): Promise<SessionState> => ipcRenderer.invoke(IPC.sessionStart, req),
  sessionState: async () => (await cmd({ cmd: 'state' })).state!,
  sessionCallTimeout: async (team: TeamSlot) => (await cmd({ cmd: 'callTimeout', team })).state!,
  sessionSetOrders: async (team: TeamSlot, order: TeamOrder) => (await cmd({ cmd: 'setOrders', team, order })).state!,
  sessionPlayNextRound: async () => { const r = await cmd({ cmd: 'playNextRound' }); return { round: r.round!, state: r.state! }; },
  sessionResult: async () => (await cmd({ cmd: 'result' })).result!,
  sessionStop: () => ipcRenderer.invoke(IPC.sessionStop),
  // [series]
  seriesStart: (req: SeriesStartRequest): Promise<SeriesView> => ipcRenderer.invoke(IPC.seriesStart, req),
  seriesCmd: (c: SeriesCommand): Promise<SeriesReply> => ipcRenderer.invoke(IPC.seriesCmd, c),
  seriesStop: () => ipcRenderer.invoke(IPC.seriesStop),
  platform: process.platform,
  isElectron: true,
};

contextBridge.exposeInMainWorld('pv', bridge);
