// PROJECT V — combat-engine local types.
//
// NOTE: local to keep this package standalone. Ids mirror @pv/shared-types (PV-3)
// structurally (string-aliased branded ids); candidates to move to shared-types later.

export type PlayerId = string;
export type TeamId = string;
export type WeaponId = string;

export type WeaponCategory = "Rifles" | "Snipers" | "Sidearms" | "SMGs" | "Shotguns" | "Heavy" | "Melee";

/** A single distance band of a weapon's damage profile. */
export interface DamageBand {
  readonly maxRangeMeters: number;
  readonly head: number;
  readonly body: number;
  readonly leg: number;
}

export interface WeaponSpec {
  readonly id: WeaponId;
  readonly name: string;
  readonly category: WeaponCategory;
  readonly cost: number | null;
  /** rounds per second */
  readonly fireRate: number;
  readonly magazineSize: number;
  readonly reloadTimeMs: number;
  readonly equipTimeMs: number;
  /**
   * Observability (not a combat value): whether this weapon's bullet tracers are visible to
   * ENEMIES. A visible tracer lets an enemy with a sightline localise the shooter even without
   * seeing them (e.g. through smoke); without it only the sound remains. Default true.
   */
  readonly tracerVisible?: boolean;
  /** Observability: gunfire loudness multiplier at the source (1 = unsuppressed). Default 1. */
  readonly fireLoudness?: number;
  /** movement speed multiplier while equipped (unitless). */
  readonly runSpeedMultiplier: number;
  /** damage bands sorted ascending by maxRangeMeters; last band caps the range. */
  readonly damageBands: readonly DamageBand[];
  readonly provenance: string;
}

/** Mechanical ability ratings in [0,1] (README §23.1). Higher is better. */
export interface CombatSkills {
  readonly aim: number; // overall hit tendency
  readonly reaction: number; // faster reaction when higher
  readonly tracking: number; // sustained hit chance on moving targets
  readonly firstBulletAccuracy: number; // first-shot precision
  readonly crosshairPlacement: number; // headshot tendency
  readonly movement: number; // reduces own moving penalty
  readonly weaponControl: number; // spray/recoil control over a burst
}

export const AVERAGE_SKILLS: CombatSkills = {
  aim: 0.6,
  reaction: 0.6,
  tracking: 0.6,
  firstBulletAccuracy: 0.6,
  crosshairPlacement: 0.6,
  movement: 0.6,
  weaponControl: 0.6,
};

export type HitLocation = "head" | "body" | "leg";

/** Per-combatant engagement posture — the information/positioning layer. */
export interface EngagePosture {
  /** Already aiming at the expected angle when the fight starts (huge first-shot edge). */
  readonly preAim: boolean;
  /**
   * Moving when the fight starts (accuracy penalty; VALORANT punishes moving fire). The penalty
   * lasts until the shooter has stopped — see CombatParams.accuracy.stopMs.
   */
  readonly moving: boolean;
  /** How it was moving at contact (default "run"): a walker stops sooner than a runner. */
  readonly pace?: "run" | "walk";
  /** ms after t0 before this side first perceives the enemy (info advantage = smaller). */
  readonly seesEnemyAtMs: number;
  /** Remaining blind time (ms) from a flash at t0; delays and degrades fire. */
  readonly flashBlindMs: number;
  /** Cover/angle disadvantage against this combatant in [0,1]; reduces incoming hit chance. */
  readonly behindCover: number;
  /**
   * Angle (degrees) between where this combatant's crosshair points and the enemy when it first
   * perceives it — the gaze error. When given, the time to the first shot is perception (reaction)
   * plus a Fitts aim time over this angle (skills.aimTimeMs), and `preAim` is ignored for timing:
   * a pre-aimed holder is simply one whose offset is ≈ 0. Absent → the legacy flag model.
   */
  readonly aimOffsetDeg?: number;
}

export const OPEN_POSTURE: EngagePosture = {
  preAim: false,
  moving: false,
  seesEnemyAtMs: 0,
  flashBlindMs: 0,
  behindCover: 0,
};

export interface Combatant {
  readonly id: PlayerId;
  readonly teamId: TeamId;
  readonly health: number; // 0..100
  readonly armor: number; // shield points
  readonly weapon: WeaponSpec;
  readonly skills: CombatSkills;
  readonly posture: EngagePosture;
  /** rounds currently in magazine; defaults to full. */
  readonly ammo?: number;
}

export interface Duel {
  readonly a: Combatant;
  readonly b: Combatant;
  readonly distanceMeters: number;
}

// ---- Event log ----

export type CombatEventKind = "shot" | "hit" | "damage" | "kill" | "reloadStart" | "reloadEnd";

export interface CombatEvent {
  readonly kind: CombatEventKind;
  readonly timeMs: number;
  readonly actor: PlayerId; // shooter (or reloader)
  readonly target?: PlayerId;
  readonly location?: HitLocation;
  readonly amount?: number; // damage dealt (after armor)
  readonly targetHealthAfter?: number;
  readonly targetArmorAfter?: number;
}

export interface CombatantOutcome {
  readonly id: PlayerId;
  readonly alive: boolean;
  readonly health: number;
  readonly armor: number;
  readonly ammo: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
}

export interface DuelResult {
  /** Winner id, or null if neither died within the time budget. */
  readonly winner: PlayerId | null;
  readonly loser: PlayerId | null;
  readonly timeToKillMs: number | null;
  readonly events: readonly CombatEvent[];
  readonly outcomes: Readonly<Record<PlayerId, CombatantOutcome>>;
}
