// IPC contract shared by the Electron main and renderer. Keeping the channel
// names and payload shapes in one typed module is what the "IPC contract" unit
// test pins, so main and renderer can never drift.
import type { Replay } from '@pv/replay-engine';
import type { SeriesCommand, SeriesReply, SeriesStartRequest, SeriesView } from './series.ts';
import type { CareerSimOutcome, CareerSimProgress, CareerSimRequest, SaveSlot, SaveSlotInfo } from './career.ts';

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
  // [series] best-of-N series + map veto (scripts/series-session.mts; see ./series.ts)
  /** renderer → main (invoke): start a series (prepares mastery / scouting); resolves with the view. */
  seriesStart: 'pv:series:start',
  /** renderer → main (invoke): one veto command (view / chooseVeto / aiStep). */
  seriesCmd: 'pv:series:cmd',
  /** renderer → main (invoke): stop + dispose the series. */
  seriesStop: 'pv:series:stop',
  /** renderer → main (invoke): read the optional local map mesh (assets/maps/<map>.glb); null when absent. */
  mapMesh: 'pv:asset:map-mesh',
  // [career] background simulation of a day's AI fixtures + save slots (src/main/career-host.ts)
  /** renderer → main (invoke): play a batch of AI series through the engine; resolves with outcomes. */
  careerSim: 'pv:career:sim',
  /** main → renderer (event): progress of the batch in flight. */
  careerSimProgress: 'pv:career:sim-progress',
  saveList: 'pv:save:list',
  saveRead: 'pv:save:read',
  saveWrite: 'pv:save:write',
  saveDelete: 'pv:save:delete',
  /** renderer → main (invoke): quit the app (start menu). */
  appQuit: 'pv:app:quit',
  /** renderer → main (invoke): list the user's own loading-banner packs (assets/banners/<name>/<n>.<ext>). */
  bannerList: 'pv:asset:banner-list',
  /** renderer → main (invoke): read one file of a banner pack; null when absent. */
  bannerFile: 'pv:asset:banner-file',
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
  /** Pre-match options (opponent memory, minimum throw rates). Omitted = engine defaults. */
  options?: MatchOptions;
  /** [series] Play the NEXT MAP of the live series round by round (teams / map / seed come from the series). */
  seriesGame?: boolean;
}

// ── Pre-match options a team / organiser chooses (match-runner MatchConfig subset).
//    The physics tunables in MatchConfig.tuning are deliberately NOT exposed here. ──
export interface MatchOptions {
  /** Cross-round opponent memory. Default true; false = every round is played like the first. */
  opponentMemory?: boolean;
  /** Minimum throw rates (/s of holding a post-plant posture), keyed by game-data team / player id. */
  minThrowRates?: { teams?: Record<string, number>; players?: Record<string, number> };
}

// ── Round decisions: WHY a round went the way it did. Mirrors match-runner
//    RoundRecord.decisions (PlanSummary / OpponentRead from @pv/team-engine). ──
export type SiteKey = 'A' | 'B';
/** One mid-round call change. `atMs` is the round clock REMAINING; `reason` is engine English. */
export interface PlanRevision { atMs: number; from: string; to: string; reason: string }
export interface PlanSummary {
  opening: string; strategy: string;
  /** Zone id the attack is trying to plant on ("a-site"), or null. */
  objective: string | null;
  /** Zone id shown first on a fake, or null. */
  feint: string | null;
  revisions: PlanRevision[];
}
export interface TendencyEstimate { probability: Record<SiteKey, number>; confidence: number; samples: number }
export interface OpponentRead { attackSite: TendencyEstimate; defenseSite: TendencyEstimate }
export interface RoundObserved {
  plantSite: SiteKey | null;
  firstContactSite: SiteKey | null;
  /** Defenders the attackers killed on each site. */
  defendersMet: Partial<Record<SiteKey, number>>;
}
export interface RoundDecisions {
  plans: Record<TeamSlot, PlanSummary | null>;
  opponentReadBefore: Record<TeamSlot, OpponentRead | null>;
  observed: RoundObserved;
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

/** A folder of the user's own banner media: one file per build-up stage (1 = first step … 5, optional 6). */
export interface LocalBannerPack {
  id: string; files: Record<number, string>;
  /** Layered kill banner (frame / ring / emblem / pip images): composited by the app, one pip per step. */
  layers?: { frame: string; ring: string; emblem: string; pip: string };
}

export interface SimRunRequest {
  mapId: string;
  seed: number;
  rounds: number;
  /** Full-match team refs (match-runner). Optional; stub/round-sim ignore them. */
  teamA?: { id: string; name: string };
  teamB?: { id: string; name: string };
  /** Pre-match options (match-runner only; the stub / round-sim fallback ignore them). */
  options?: MatchOptions;
  /** [series] Play the NEXT MAP of the live series in one go (teams / map / seed come from the series). */
  seriesGame?: boolean;
}

/**
 * One thing the engine's navigation layer did for one player (mirrors @pv/round-simulator
 * NavTraceEvent). `elapsedMs` is ROUND-relative. Positions are game units.
 */
export interface NavTraceEvent {
  tick: number;
  elapsedMs: number;
  kind: 'planned' | 'replanned' | 'blocked' | 'unreachable';
  playerId: string;
  goalZone: string;
  reason?: string;
  pathLength?: number;
  estimatedTravelMs?: number;
  preference?: string;
  /** The order behind the move (the policy's sourceActionId): what the route is for. */
  intent?: string;
  from?: { x: number; y: number; z: number };
  waypoints?: Array<{ x: number; y: number; z: number }>;
  zones?: string[];
  /** Zones the planner was told to avoid, from the team's belief. */
  avoided?: Array<{ zoneId: string; cost: number }>;
  hazards?: Array<{ x: number; y: number; z: number; radius: number }>;
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
  /** Plans, pre-round opponent reads and observations. Absent on engines that predate it. */
  decisions?: RoundDecisions | null;
  /** Navigation trace of the round (developer view). Absent when the engine recorded none. */
  nav?: NavTraceEvent[] | null;
}

export interface MatchSummary {
  teams: { A: { id: string; name: string }; B: { id: string; name: string } };
  map: string;
  seed: number;
  winner: 'A' | 'B';
  score: { A: number; B: number };
  wentToOvertime: boolean;
  rounds: MatchRoundSummary[];
  /** The pre-match options the match was played with (echoed by the match scripts). */
  options?: MatchOptions;
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
  // [series]
  seriesStart(req: SeriesStartRequest): Promise<SeriesView>;
  seriesCmd(cmd: SeriesCommand): Promise<SeriesReply>;
  seriesStop(): Promise<void>;
  /** Optional real map mesh for the 3D team cams (never shipped in git); null → blockout. */
  loadMapMesh(mapId: string): Promise<Uint8Array | null>;
  // [career]
  careerSimulate(reqs: CareerSimRequest[], onProgress: (p: CareerSimProgress) => void): Promise<CareerSimOutcome[]>;
  saveList(): Promise<SaveSlotInfo[]>;
  saveRead(slot: SaveSlot): Promise<string | null>;
  saveWrite(slot: SaveSlot, text: string): Promise<void>;
  saveDelete(slot: SaveSlot): Promise<void>;
  quit(): Promise<void>;
  /** User-supplied loading banners (never shipped, never in git): pack name → stage (1..6) → file name. */
  listBanners(): Promise<LocalBannerPack[]>;
  loadBannerFile(pack: string, file: string): Promise<Uint8Array | null>;
  readonly platform: string;
  readonly isElectron: true;
}

declare global {
  interface Window { pv?: PvBridge }
}
