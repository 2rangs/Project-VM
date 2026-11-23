// PROJECT V — perception tuning parameters.
//
// Every number here is a manual-approx tuning value, NOT a measured game constant,
// unless a source is cited. They are collected in one place so they can be calibrated
// later against real data (see docs/research/spatial-sources.md). Durations are ms,
// distances are VALORANT world units (100 units = 1 m, matching spatial-engine).

export interface PerceptionParams {
  readonly vision: {
    /** Half-angle of the detection cone, degrees. ~55 → 110° total. manual-approx. */
    readonly halfFovDeg: number;
    /** Max distance (world units) at which an enemy can be visually detected. manual-approx. */
    readonly maxViewDistanceUnits: number;
    /**
     * If true, an enemy in the SAME zone as the observer is considered visible
     * regardless of LoS (close-quarters awareness). FOV and distance still apply.
     */
    readonly sameZoneAlwaysVisible: boolean;
    /**
     * Decide sight from where the two bodies stand (the map's measured node-to-node line of
     * sight) when the map carries that data. false = always use the zone sightline table.
     */
    readonly positionalSight?: boolean;
    /**
     * Probability (0..1) of FAILING to detect a geometrically-visible enemy that is
     * farther than `uncertainBeyondFraction` of max view distance. Default 0 →
     * perception is fully deterministic. When > 0, a seeded Rng must be injected.
     */
    readonly detectionMissProbability: number;
    readonly uncertainBeyondFraction: number;
  };
  readonly hearing: {
    /**
     * Sound-propagation strength floors (0..1) below which a sound is inaudible — for sounds that
     * travel the zone sound graph (gunfire, casts, spike). `footstep` is no longer used: footsteps
     * follow the distance rule (`footstepRadiusUnits`).
     */
    readonly thresholds: {
      readonly footstep: number;
      readonly gunfire: number;
      readonly abilityCast: number;
      readonly spike: number;
      readonly reload: number;
      readonly other: number;
    };
    /**
     * Footsteps: a running player is heard by every enemy within this 3D distance (world units),
     * through walls. By the game's own rule this equals the spike's blast radius
     * (game-rules SPIKE_RULES.blastRadiusM — the round simulator passes that value in; the default
     * here mirrors it). The number itself is a manual approximation, see game-rules/src/spike.ts.
     */
    readonly footstepRadiusUnits: number;
    /** How many ticks back in the event log counts as "currently audible". manual-approx. */
    readonly eventWindowTicks: number;
    /** behaviorState substrings that classify movement for footstep emission. */
    readonly runningStates: readonly string[];
    readonly walkingStates: readonly string[];
  };
  readonly memory: {
    /**
     * Confidence half-life (ms): a remembered sighting's confidence halves every
     * this-many ms of staleness. manual-approx (README §17.3: ~10s-old info is weak).
     */
    readonly halfLifeMs: number;
    /** Drop a remembered enemy once its confidence falls below this. */
    readonly forgetBelowConfidence: number;
  };
  readonly communication: {
    /** Delay (ms) before a teammate's sighting becomes available to the team. manual-approx. */
    readonly commsDelayMs: number;
    /** If true, a dead player's last reports remain in the team picture. */
    readonly retainDeadPlayerReports: boolean;
  };
}

export const DEFAULT_PARAMS: PerceptionParams = {
  vision: {
    halfFovDeg: 55,
    maxViewDistanceUnits: 4500,
    sameZoneAlwaysVisible: true,
    positionalSight: true,
    detectionMissProbability: 0,
    uncertainBeyondFraction: 0.85,
  },
  hearing: {
    thresholds: {
      footstep: 0.45,
      gunfire: 0.1,
      abilityCast: 0.3,
      spike: 0.25,
      reload: 0.6,
      other: 0.4,
    },
    footstepRadiusUnits: 5000,
    eventWindowTicks: 1,
    runningStates: ["run", "running", "sprint", "rush"],
    walkingStates: ["walk", "walking", "crouch", "shift"],
  },
  memory: {
    halfLifeMs: 5000,
    forgetBelowConfidence: 0.1,
  },
  communication: {
    commsDelayMs: 600,
    retainDeadPlayerReports: true,
  },
};

/** Confidence in a sighting of the given staleness, by exponential half-life decay. 1 at age 0. */
export function confidenceForAge(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}
