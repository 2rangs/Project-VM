// Platform bridge. In Electron the real bridge is window.pv (from the preload
// whitelist). In a plain browser (the fallback verification path when Electron
// can't run) we provide an in-page equivalent that runs the StubRunner directly
// and serves the bundled trace fixtures — so the renderer is testable either way.
import { fromSimEventLog, type SimEvent } from '@pv/replay-engine';
import { StubRunner } from '../shared/sim.ts';
import { ASCENT_TRANSFORM } from '../shared/ascent-transform.ts';
import type { PvBridge, SimProgress, SimResult, SimRunRequest } from '../shared/ipc.ts';
import { SAVE_SLOTS, type SaveSlot, type SaveSlotInfo } from '../shared/career.ts';
import traceScenario01 from '../../test/fixtures/traces/trace-scenario-01.json';
import traceScenario04 from '../../test/fixtures/traces/trace-scenario-04.json';

function lsMeta(slot: SaveSlot): SaveSlotInfo['meta'] {
  try {
    const text = localStorage.getItem(`pv-save-${slot}`);
    const m = text ? /"meta":(\{[^{}]*\})/.exec(text.slice(0, 4096)) : null;
    return m ? JSON.parse(m[1]!) : null;
  } catch { return null; }
}

const FALLBACK_TRACES: Record<string, unknown> = {
  'trace-scenario-01': traceScenario01,
  'trace-scenario-04': traceScenario04,
};

const browserBridge: PvBridge = {
  // Browser fallback only (no Electron): the real round-simulator reads node:fs
  // and runs in the Electron worker, so here we use the in-page stub.
  async runSimulation(req: SimRunRequest, onProgress: (p: SimProgress) => void): Promise<SimResult> {
    const runId = 'browser-' + Date.now();
    const events = await new StubRunner().run(req, (x) => onProgress({ ...x, runId }));
    const replay = fromSimEventLog(events as SimEvent[], {
      mapId: req.mapId, mapDisplayName: 'Ascent', seed: req.seed, coordinateTransform: ASCENT_TRANSFORM,
    });
    return { runId, source: 'stub', replay };
  },
  async loadTrace(id: string) {
    if (!(id in FALLBACK_TRACES)) throw new Error(`unknown trace ${id}`);
    return FALLBACK_TRACES[id];
  },
  async listTraces() { return Object.keys(FALLBACK_TRACES); },
  // Interactive session needs the match-runner subprocess → Electron only.
  async sessionStart() { throw new Error('interactive session requires Electron'); },
  async sessionState() { throw new Error('interactive session requires Electron'); },
  async sessionCallTimeout() { throw new Error('interactive session requires Electron'); },
  async sessionSetOrders() { throw new Error('interactive session requires Electron'); },
  async sessionPlayNextRound() { throw new Error('interactive session requires Electron'); },
  async sessionResult() { throw new Error('interactive session requires Electron'); },
  async sessionStop() { /* no-op */ },
  // [series] needs the match-runner subprocess → Electron only.
  async seriesStart() { throw new Error('series requires Electron'); },
  async seriesCmd() { throw new Error('series requires Electron'); },
  async seriesStop() { /* no-op */ },
  async loadMapMesh() { return null; }, // browser fallback: the cams use the navgraph blockout
  // [career] no engine process in the browser: the career falls back to the quick estimate.
  async careerSimulate() { throw new Error('engine simulation requires Electron'); },
  async saveList() { return SAVE_SLOTS.map((slot) => ({ slot, meta: lsMeta(slot) })); },
  async saveRead(slot) { try { return localStorage.getItem(`pv-save-${slot}`); } catch { return null; } },
  async saveWrite(slot, text) { localStorage.setItem(`pv-save-${slot}`, text); },
  async saveDelete(slot) { try { localStorage.removeItem(`pv-save-${slot}`); } catch { /* */ } },
  async quit() { window.close(); },
  async listBanners() { return []; },
  async loadBannerFile() { return null; },
  async mediaManifest() { return null; },
  async mediaFile() { return null; },
  platform: 'browser',
  isElectron: true, // satisfies the interface; `runtime` below is the honest flag
};

export const runtime: 'electron' | 'browser' = typeof window !== 'undefined' && window.pv ? 'electron' : 'browser';
export const bridge: PvBridge = (typeof window !== 'undefined' && window.pv) ? window.pv : browserBridge;
