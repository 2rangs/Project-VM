// Preload: the ONLY bridge between the sandboxed renderer and main. Exposes a
// minimal, explicit whitelist on window.pv via contextBridge — no ipcRenderer,
// no node, no remote module reach into the renderer.
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PvBridge, type SimProgress, type SimResult, type SimRunRequest } from '../shared/ipc.ts';

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
  platform: process.platform,
  isElectron: true,
};

contextBridge.exposeInMainWorld('pv', bridge);
