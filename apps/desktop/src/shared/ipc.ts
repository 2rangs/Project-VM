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
  /** renderer → main (invoke): start an interactive (tactical-timeout) match session. */
  sessionStart: 'pv:session:start',
  /** renderer → main (invoke): send one command to the live session (state/timeout/orders/round/result). */
  sessionCmd: 'pv:session:cmd',
  /** renderer → main (invoke): stop + dispose the live session. */
  sessionStop: 'pv:session:stop',
  /** renderer → main (invoke): read the optional local map mesh (assets/maps/<map>.glb); null when absent. */
  mapMesh: 'pv:asset:map-mesh',
} as const;

// ── Interactive match session (tactical timeouts; @pv/match-runner MatchSession) ──
export type TeamSlot = 'A' | 'B';
/** Coach order set during a timeout. Mirrors match-runner TeamOrder (strategy strings per side). */
export interface TeamOrder {
  strategy?: 'aExecute' | 'bExecute' | 'midControl' | 'default' | 'split'
    | 'defaultHold' | 'stackA' | 'stackB' | 'aggroPush';
  economy?: 'save' | 'force' | 'full';
  tempo?: 'slow' | 'normal' | 'fast';
  roles?: { entry?: string; lurker?: string };
  durationRounds?: number;
}
export interface SessionStartRequest {
  mapId: string; seed: number;
  teamA: { id: string; name: string }; teamB: { id: string; name: string };
  /** Teams driven by the AI (the human team is excluded). Default ['B']. */
  aiTeams?: TeamSlot[];
}
export interface TeamEconomyState { credits: number; ultPoints: number; consecutiveLosses?: number }
export interface SessionState {
  roundNumber: number;
  score: Record<TeamSlot, number>;
  attacker: TeamSlot;
  economy: Record<TeamSlot, TeamEconomyState>;
  timeoutsRemaining: Record<TeamSlot, number>;
  timeoutActive: Record<TeamSlot, boolean>;
  finished: boolean;
}
export interface TimeoutLogEntry { round: number; team: TeamSlot; by: 'human' | 'ai'; order: TeamOrder | null }
export interface SessionResultSummary {
  winner: TeamSlot; score: Record<TeamSlot, number>; wentToOvertime: boolean;
  timeoutLog: TimeoutLogEntry[];
}
/** A command to the live session and its reply (reply shape depends on cmd). */
export interface SessionCommand { cmd: 'state' | 'callTimeout' | 'setOrders' | 'playNextRound' | 'result'; team?: TeamSlot; order?: TeamOrder }
export interface SessionReply {
  ok: boolean;
  error?: string;
  state?: SessionState;
  /** Present for playNextRound: the raw round (RawRound shape for mergeMatch). */
  round?: Record<string, unknown>;
  result?: SessionResultSummary;
}

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
  /** Score after `round`, when the runner reports it (loading screen counter). */
  score?: { A: number; B: number };
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
  /** Interactive session (tactical timeouts). sessionStart resolves with the opening state. */
  sessionStart(req: SessionStartRequest): Promise<SessionState>;
  sessionState(): Promise<SessionState>;
  sessionCallTimeout(team: TeamSlot): Promise<SessionState>;
  sessionSetOrders(team: TeamSlot, order: TeamOrder): Promise<SessionState>;
  sessionPlayNextRound(): Promise<{ round: Record<string, unknown>; state: SessionState }>;
  sessionResult(): Promise<SessionResultSummary>;
  sessionStop(): Promise<void>;
  /** Optional real map mesh for the 3D team cams (never shipped in git); null → blockout. */
  loadMapMesh(mapId: string): Promise<Uint8Array | null>;
  readonly platform: string;
  readonly isElectron: true;
}

declare global {
  interface Window { pv?: PvBridge }
}
