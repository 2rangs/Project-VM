// In-match management + match prep contract (renderer ⇄ main ⇄ engine hosts). Plain JSON
// projections of @pv/match-runner's managed session (manager.ts / managed-session.ts / prep.ts),
// always from OUR seat: "A" is the team the user manages.
export type Seat = 'A' | 'B';
export type TempoShout = 'slow' | 'normal' | 'fast';
export type RiskShout = 'less' | 'normal' | 'more';
export type DefenseShout = 'spread' | 'normal' | 'stack';
export interface Shouts { tempo: TempoShout; risk: RiskShout; defense: DefenseShout }
export type TeamTalk = 'calm' | 'encourage' | 'demand' | 'praise';
export type TalkSituation = 'leading' | 'level' | 'trailing';
export type AttackStrategy = 'aExecute' | 'bExecute' | 'midControl' | 'default' | 'split';
export type DefenseStrategy = 'defaultHold' | 'stackA' | 'stackB' | 'aggroPush';

export interface PlayerMindView {
  index: number; handle: string | null;
  personality: { composure: number; drive: number };
  mood: number; tilt: number; confidence: number; key: boolean;
}
export interface TeamMindView { players: PlayerMindView[]; tilt: number; confidence: number }
export type AlertKind = 'lossRun' | 'economyBroken' | 'playerTilt' | 'halfTime';
export interface AlertView {
  kind: AlertKind; team: Seat; round: number;
  streak?: number; creditsPerPlayer?: number;
  player?: { index: number; handle: string | null; tilt: number; key: boolean };
}
export interface ManagerStateView {
  half: 1 | 2 | 3;
  timeoutsLeftThisHalf: Record<Seat, number>;
  shouts: Record<Seat, Shouts>;
  minds: Record<Seat, TeamMindView>;
  alerts: AlertView[];
  halfTime: { pending: Record<Seat, boolean>; situation: Record<Seat, TalkSituation> } | null;
  strategy: Record<Seat, { attack?: AttackStrategy; defense?: DefenseStrategy; roundsLeft: number } | null>;
  pendingPlanOptions: Record<Seat, string[]>;
}
export interface TalkReaction { index: number; handle: string | null; delta: number }
export type DecisionKind = 'timeout' | 'orders' | 'strategy' | 'shouts' | 'talk';
export interface DecisionView {
  round: number; team: Seat; by: 'human' | 'ai'; kind: DecisionKind;
  order?: Record<string, unknown>; shouts?: Shouts; talk?: TeamTalk; reason?: string;
  strategy?: { attack?: AttackStrategy; defense?: DefenseStrategy; rounds: number };
  perPlayer?: TalkReaction[];
  before: { score: Record<Seat, number>; tilt: number; confidence: number };
  roundsBefore: { won: number; played: number };
  roundsAfter: { won: number; played: number };
  tiltAfter: number;
}
export interface ManagerResultView {
  decisions: DecisionView[];
  minds: Record<Seat, TeamMindView>;
  tiltByRound: Record<Seat, number[]>;
}

// ── pre-match plan (mirrors match-runner MatchPlan) ──
export type PlantSpotKind = 'auto' | 'default' | 'safe' | 'open' | 'cover' | 'near';
export interface PendingPlanOptions {
  plantPreference?: Partial<Record<'A' | 'B', PlantSpotKind>>;
  postPlantPlans?: Partial<Record<'A' | 'B', { hold?: 'auto' | 'onSpike' | 'offSpike'; outnumbered?: 'auto' | 'hold' | 'retreat' }>>;
  retakePlans?: Partial<Record<'A' | 'B', { approach?: 'auto' | 'stack' | 'split' }>>;
  midControl?: 'auto' | 'contest' | 'concede';
}
export interface MatchPlan {
  attackLean?: { site: 'A' | 'B'; strength: number } | null;
  defenseLean?: { site: 'A' | 'B'; strength: number } | null;
  tempo?: TempoShout; risk?: RiskShout; defense?: DefenseShout;
  pistol?: { attack?: AttackStrategy; defense?: DefenseStrategy };
  afterPistolLoss?: 'save' | 'force';
  useScouting?: boolean;
  pending?: PendingPlanOptions;
}

// ── pre-match opponent report (mirrors match-runner OpponentReport) ──
export interface Rate { n: number; rate: number | null }
export interface SiteEvidenceView { counts: Record<'A' | 'B', number>; rounds: number; share: Record<'A' | 'B', number> }
export interface OpponentReportView {
  us: { id: string; name: string }; them: { id: string; name: string }; map: string;
  gamesReviewed: number; analyst: number;
  sites: { map: { attack: SiteEvidenceView; defense: SiteEvidenceView }; all: { attack: SiteEvidenceView; defense: SiteEvidenceView } };
  pistol: { won: Rate; attackSiteA: Rate; forceAfterLoss: Rate };
  eco: { forceAfterLoss: Rate; fullBuy: Rate };
  players: Array<{ playerId: string | null; handle: string | null; role: string | null; rating: number | null; rounds: number; kills: number; deaths: number; firstKills: number; firstDeaths: number; threat: number; tag: 'danger' | 'liability' | null }>;
  maps: Array<{ map: string; theirs: number; ours: number; games: number; wins: number | null; verdict: 'strong' | 'average' | 'weak' }>;
  suggestedPlan: MatchPlan;
  /** The film the report was read from (passed back on session start to seed the opponent model). */
  logs: unknown[];
}
export interface PrematchRequest {
  us: { id: string; name: string }; them: { id: string; name: string };
  map: string; seed: number; analyst: number;
  /** Games of the opponent's film to simulate (default 2). */
  film?: number;
}
