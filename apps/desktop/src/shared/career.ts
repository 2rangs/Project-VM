// Career-mode contract shared by main, preload, renderer and scripts/career-sim.mts:
// background simulation of a day's AI fixtures (whole series through @pv/match-runner, one at a
// time, in a separate process) and the save slots.

/** A game-data-shaped player as match-runner `MatchConfig.rosters` takes it. */
export interface SimRosterPlayer { playerId: string; attributes: unknown; hasRatings: boolean }

export interface CareerSimSide {
  teamId: string;
  name: string;
  analyst: number;
  /** Today's five, in lineup order (attributes already scaled by match readiness). */
  roster: SimRosterPlayer[];
  /** Training map practice (map → playerId → game-equivalents) added to the team's map records. */
  practice?: Record<string, Record<string, number>>;
}

export interface CareerSimRequest {
  fixtureId: string;
  seed: number;
  format: 'bo1' | 'bo3' | 'bo5';
  home: CareerSimSide;
  away: CareerSimSide;
}

export interface CareerSimMap {
  map: string;
  score: [number, number];
  overtime?: boolean;
  /** Kills / deaths per player id (from the engine's kill events). */
  players?: Record<string, { k: number; d: number }>;
}

export interface CareerSimOutcome {
  fixtureId: string;
  winner: string;
  mapsWon: [number, number];
  maps: CareerSimMap[];
}

export interface CareerSimProgress {
  /** Series finished so far in this batch, and the batch size. */
  done: number;
  total: number;
  /** The series being played now (null when the batch is done). */
  current: { home: string; away: string } | null;
}

/** Save-slot ids: three manual slots. A career autosaves into its own slot. */
export const SAVE_SLOTS = ['slot1', 'slot2', 'slot3'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

export interface SaveSlotInfo {
  slot: SaveSlot;
  /** Null when the slot is empty or unreadable. */
  meta: { manager: string; teamId: string; teamName: string; date: string; season: number; savedAt: string } | null;
}
