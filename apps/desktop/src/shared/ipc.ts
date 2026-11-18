// IPC contract shared by the Electron main and renderer. Keeping the channel
// names and payload shapes in one typed module is what the "IPC contract" unit
// test pins, so main and renderer can never drift.
import type { Replay } from '@pv/replay-engine';

export const IPC = {
  /** renderer → main (invoke): start a simulation, resolves with the result replay. */
  simRun: 'pv:sim:run',
  /** main → renderer (event): streamed progress for an in-flight run. */
  simProgress: 'pv:sim:progress',
  /** renderer → main (invoke): read a bundled decision-trace fixture by id. */
  traceLoad: 'pv:trace:load',
  /** renderer → main (invoke): list available trace fixture ids. */
  traceList: 'pv:trace:list',
} as const;

export interface SimRunRequest {
  mapId: string;
  seed: number;
  rounds: number;
}

export interface SimProgress {
  runId: string;
  phase: 'start' | 'round' | 'done' | 'error';
  pct: number; // 0..1
  round?: number;
  message?: string;
}

export interface SimResult {
  runId: string;
  source: 'stub' | 'round-simulator';
  replay: Replay;
}

/** The preload-exposed, contextIsolated API surface (window.pv). */
export interface PvBridge {
  runSimulation(req: SimRunRequest, onProgress: (p: SimProgress) => void): Promise<SimResult>;
  loadTrace(id: string): Promise<unknown>;
  listTraces(): Promise<string[]>;
  readonly platform: string;
  readonly isElectron: true;
}

declare global {
  interface Window { pv?: PvBridge }
}
