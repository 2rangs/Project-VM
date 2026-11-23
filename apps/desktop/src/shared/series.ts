// Series / map-veto contract shared by main, preload, renderer and scripts/series-session.mts.
// The view is a plain-JSON projection of @pv/match-runner's SeriesSession (prepareSeries +
// VetoProcess state), always from OUR team's seat: series team "A" is the team the user manages
// and it starts the map selection; "B" is the AI opponent.
export type SeriesTeam = 'A' | 'B';
export type SeriesFormat = 'bo1' | 'bo3' | 'bo5';
export type StartSide = 'attack' | 'defense';

export interface SeriesStartRequest {
  teamA: { id: string; name: string };
  teamB: { id: string; name: string };
  format: SeriesFormat;
  seed: number;
  /** Our analyst quality 0..1 (pre-match option). */
  analyst: number;
  /** Study the opponent before the series. */
  scouting: boolean;
  /**
   * [career] Today's five per team from the career world (generated players included), passed to
   * every map as MatchConfig.rosters. Omitted → the dataset rosters.
   */
  rosters?: { A?: Array<{ playerId: string; attributes: unknown; hasRatings: boolean }>; B?: Array<{ playerId: string; attributes: unknown; hasRatings: boolean }> };
  /** [career] Training map practice per team (map → playerId → game-equivalents) → map mastery. */
  practice?: { A?: Record<string, Record<string, number>>; B?: Record<string, Record<string, number>> };
}

export interface MasteryComponentView { value: number; uncertainty: number }
export interface MasteryView {
  value: number;
  uncertainty: number;
  history: MasteryComponentView & { games: number; wins: number | null; resultsKnown: boolean };
  continuity: MasteryComponentView & { measured: boolean };
  compFit: MasteryComponentView & { basis: 'comps' | 'roles'; bestComp: string[] | null };
}
export interface SiteShareView { shareA: number; rounds: number }
export interface ScoutedMapView {
  /** Our analysts' estimate of the opponent's mastery on this map. */
  estimatedMastery: number;
  verdict: 'strong' | 'average' | 'weak';
  /** Where they attack / where their defenders are met, as it would be seeded for this map. */
  attack: SiteShareView;
  defense: SiteShareView;
  /** Pseudo-observations the report puts into our opponent model on this map (0..6 each). */
  priorMass: { attack: number; defense: number };
}
export interface SeriesMapView {
  map: string;
  mastery: Record<SeriesTeam, MasteryView>;
  /** Our own estimate of our chance on this map (what the recommendation is based on). */
  winBelief: number;
  /** Attack-side round win rate of the map in the data, or null when there is none. */
  atkRoundWR: number | null;
  scouting: ScoutedMapView | null;
}
export interface VetoActionView {
  step: number;
  kind: 'ban' | 'pick' | 'side' | 'decider';
  team: SeriesTeam | null;
  map: string;
  side?: StartSide;
  by: 'human' | 'ai' | 'rule';
}
export interface VetoMapView {
  map: string;
  pickedBy: SeriesTeam | 'decider';
  sideChosenBy: SeriesTeam;
  startingSides: Record<SeriesTeam, StartSide>;
}
export interface VetoPendingView {
  step: number;
  kind: 'ban' | 'pick' | 'side';
  team: SeriesTeam;
  options: string[];
  map?: string;
  ai: boolean;
  /** The acting team's own best choice and the series estimate after each option. */
  recommendation: { choice: string; values: Record<string, number> };
}
export interface SeriesGameView {
  gameNumber: number;
  map: string;
  pickedBy: SeriesTeam | 'decider';
  startingSides: Record<SeriesTeam, StartSide>;
  winner: SeriesTeam;
  score: Record<SeriesTeam, number>;
  overtime: boolean;
  /** [career] Kills / deaths per player id (only when the series was given rosters). */
  players?: Record<string, { k: number; d: number }>;
}
export interface ScoutedPlayerView { handle: string | null; role: string | null; rating: number | null; threat: number; tag: 'danger' | 'liability' | null }
export interface SeriesView {
  phase: 'veto' | 'playing' | 'finished';
  teams: Record<SeriesTeam, { id: string; name: string }>;
  format: { id: string; games: number; steps: Array<{ kind: 'ban' | 'pick' | 'side' | 'decider'; team: SeriesTeam | null }> };
  pool: string[];
  /** League reference mastery M₀ (effects are measured from here). */
  reference: number;
  /** The map whose geometry every game is simulated on. */
  geometry: string;
  score: Record<SeriesTeam, number>;
  winsNeeded: number;
  maps: SeriesMapView[];
  veto: { actions: VetoActionView[]; maps: VetoMapView[]; banned: string[]; remaining: string[]; pending: VetoPendingView | null };
  games: SeriesGameView[];
  /** The next map to play (null during the veto / when the series is over). */
  nextGame: (VetoMapView & { gameNumber: number }) | null;
  gameInProgress: boolean;
  scouting: {
    enabled: boolean;
    analyst: number;
    gamesReviewed: number;
    gamesAvailable: number;
    uptake: number;
    players: ScoutedPlayerView[];
  };
  winner: SeriesTeam | null;
}

export interface SeriesCommand { cmd: 'view' | 'chooseVeto' | 'aiStep'; choice?: string }
export interface SeriesReply { ok: boolean; error?: string; view?: SeriesView; action?: VetoActionView }
