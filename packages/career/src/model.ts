// Career-world data model. A WorldPlayer is a superset of @pv/game-data's `Player`
// ({ playerId, handle, country, role, attributes, hasRatings }), so it can be handed to anything
// that takes a game-data player — e.g. match-runner's `MatchConfig.rosters`.
import type { Region } from "./regions.ts";

export type Role = "duelist" | "initiator" | "controller" | "sentinel";
export const ROLES: readonly Role[] = ["duelist", "initiator", "controller", "sentinel"];

/**
 * The attributes the dataset rates and the engine reads (match-runner/src/teams.ts):
 * the five mechanical CombatSkills, impact (→ gameSense, decisionMaking), trading, clutch,
 * consistency (→ round-form σ, discipline) and entryAggression (→ aggression).
 */
export const RATED_KEYS = [
  "aim", "crosshairPlacement", "firstBulletAccuracy", "reaction", "tracking",
  "impact", "entryAggression", "trading", "clutch", "consistency",
] as const;
export type RatedKey = (typeof RATED_KEYS)[number];

/**
 * Ability attributes: the ones that measure how GOOD a player is. Current ability (CA) and
 * potential ability (PA) are their equal-weight mean. entryAggression is a tendency (how a player
 * plays, not how well) and clutch has no spread in the data (every rated player is 0.6), so
 * neither is part of CA/PA and neither develops.
 */
export const ABILITY_KEYS = [
  "aim", "crosshairPlacement", "firstBulletAccuracy", "reaction", "tracking",
  "impact", "trading", "consistency",
] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

/** Mechanical attributes mature early and decline first; the rest are read-the-game attributes. */
export const MECHANICAL_KEYS: readonly AbilityKey[] = ["aim", "crosshairPlacement", "firstBulletAccuracy", "reaction", "tracking"];

/**
 * Attributes the dataset cannot estimate (no positional / comms / per-spray data). Real players
 * carry `{ value: null, reason }` for them and the engine falls back to league average; generated
 * players carry the same so the two populations are read identically.
 */
export const UNRATED_KEYS: Readonly<Record<string, string>> = {
  movement: "needs positional/replay data (no movement traces in VCT Reference)",
  weaponControl: "needs per-spray data (not in box scores)",
  positioning: "needs player positions (Layer B not available)",
  utilityUsage: "needs ability-usage/outcome data (not in VCT Reference)",
  mapAwareness: "needs positional/timing data",
  rotations: "needs positional/timing data",
  communication: "no comms data exists",
  teamworkDiscipline: "no setup/execution-timing data",
  lurking: "needs positional data",
  anchoring: "needs positional data",
  weaponPreference: "weapon-choice per round not in VCT Reference box scores",
  agentMastery: "needs per-agent skill baselines; only agent pool is observed",
};

export interface RatedAttr {
  value: number;
  uncertainty: number;
  nMaps?: number;
}
export interface UnratedAttr {
  value: null;
  reason: string;
}
export type AttrSlot = RatedAttr | UnratedAttr;

export type PlayerStatus = "rostered" | "academy" | "free";
export type Origin = "real" | "generated";

export interface WorldPlayer {
  // --- the @pv/game-data Player shape ---
  readonly playerId: string;
  readonly handle: string | null;
  readonly country: string | null;
  role: Role | null;
  attributes: Record<string, AttrSlot> | null;
  hasRatings: boolean;
  // --- career ---
  /** Real name. Generated people only (the dataset carries handles, not names). */
  readonly name: string | null;
  readonly region: Region;
  agentPool: string[];
  /** Where this person comes from. Generated people never existed. */
  readonly origin: Origin;
  /** Convenience mirror of `origin === "generated"`. */
  readonly generated: boolean;
  age: number;
  /** Real players' ages are estimated from their first season in the dataset. */
  readonly ageEstimated: boolean;
  /** Season the person entered the world (generated) or the world's first season (real). */
  readonly debutSeason: number;
  /**
   * The attribute values this player is heading for at full maturity (hidden, like FM's PA).
   * Null for players without ratings.
   */
  peak: Partial<Record<AbilityKey, number>> | null;
  /** Current ability: mean of ABILITY_KEYS values (0..1). Null without ratings. */
  ca: number | null;
  /** Potential ability: mean of `peak` (0..1), always ≥ ca. Null without ratings. */
  pa: number | null;
  teamId: string | null;
  status: PlayerStatus;
  /** Maps played over the whole career in this world (drives rating uncertainty). */
  careerMaps: number;
}

export type StaffRole = "headCoach" | "analyst" | "scout" | "physio";
export const STAFF_ROLES: readonly StaffRole[] = ["headCoach", "analyst", "scout", "physio"];

/**
 * Staff attributes — only the ones something reads:
 *   headCoach.development       → player development rate (season.ts, coach factor C)
 *   analyst.analysis            → match-runner series `staff.analyst` (scouting games reviewed,
 *                                 opponent-mastery estimate error); see teamStaffInputs()
 *   scout.judgingAbility        → error of the CA estimate shown for a player (scouting.ts here)
 *   scout.judgingPotential      → error of the PA estimate, and which prospects an academy picks
 *   headCoach.motivation        → the morale target (club/people.ts)
 *   physio.physiotherapy        → weekly fatigue recovery (club/training.ts)
 */
export const STAFF_ATTRS: Readonly<Record<StaffRole, readonly string[]>> = {
  headCoach: ["development", "motivation"],
  analyst: ["analysis"],
  scout: ["judgingAbility", "judgingPotential"],
  physio: ["physiotherapy"],
};

export interface WorldStaff {
  readonly staffId: string;
  readonly name: string;
  readonly country: string;
  readonly region: Region;
  readonly role: StaffRole;
  attributes: Record<string, number>;
  readonly origin: Origin;
  readonly generated: boolean;
  age: number;
  readonly debutSeason: number;
  teamId: string | null;
}

export interface WorldTeam {
  readonly teamId: string;
  readonly name: string;
  readonly country: string | null;
  readonly region: Region;
  /** Main roster, strongest first after each season's re-sort. The first five are the starters. */
  roster: string[];
  academy: string[];
  staff: Partial<Record<StaffRole, string>>;
}

export interface SeasonRecord {
  /** The season this record opens (the intake belongs to it). */
  readonly season: number;
  readonly newPlayers: string[];
  readonly newStaff: string[];
  readonly retiredPlayers: string[];
  readonly retiredStaff: string[];
  readonly signings: Array<{ playerId: string; teamId: string; from: "academy" | "free" }>;
  readonly academyPicks: Array<{ playerId: string; teamId: string }>;
  readonly releases: Array<{ playerId: string; teamId: string }>;
  readonly hires: Array<{ staffId: string; teamId: string }>;
  readonly population: Record<string, number>;
}

export interface RetiredRecord {
  readonly id: string;
  readonly kind: "player" | "staff";
  readonly label: string;
  readonly generated: boolean;
  readonly season: number;
  readonly age: number;
}

export interface World {
  readonly version: 1;
  readonly seed: number;
  readonly startSeason: number;
  season: number;
  players: Record<string, WorldPlayer>;
  staff: Record<string, WorldStaff>;
  teams: Record<string, WorldTeam>;
  /** Player population each region is held at (its size when the world was created). */
  readonly regionTargets: Record<Region, number>;
  /** Staff population the world is held at. */
  readonly staffTarget: number;
  readonly calibration: import("./calibration.ts").Calibration;
  /** Normalised handles no generated player may take (real players' + every handle ever issued). */
  reservedHandles: string[];
  /** Counter for generated ids. */
  nextGenId: number;
  history: SeasonRecord[];
  retired: RetiredRecord[];
  /** Club operations (contracts, finance, transfers, training) once a career has started them. */
  club?: import("./club/types.ts").ClubState;
}
