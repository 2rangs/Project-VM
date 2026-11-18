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
  /** Full-match team refs (match-runner). Optional; stub/round-sim ignore them. */
  teamA?: { id: string; name: string };
  teamB?: { id: string; name: string };
}

/** Per-round summary from @pv/match-runner (real economy / ultimate / score). */
export interface MatchRoundSummary {
  roundNumber: number;
  phase: 'pistol' | 'regulation' | 'overtime';
  attacker: 'A' | 'B';
  winner: 'A' | 'B';
  winnerSide: string;
  reason: string;
  planted: boolean;
  score: { A: number; B: number };
  kills: { A: number; B: number };
  economy: { A: { credits: number; ultPoints: number }; B: { credits: number; ultPoints: number } };
  buys: { A: { tier: string; weapon: string }; B: { tier: string; weapon: string } };
}

export interface MatchSummary {
  teams: { A: { id: string; name: string }; B: { id: string; name: string } };
  map: string;
  seed: number;
  winner: 'A' | 'B';
  score: { A: number; B: number };
  wentToOvertime: boolean;
  rounds: MatchRoundSummary[];
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
  source: 'stub' | 'round-simulator' | 'match-runner';
  replay: Replay;
  /** Present when the real match-runner produced the result. */
  match?: MatchSummary;
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
