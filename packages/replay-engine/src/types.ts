/**
 * PROJECT V — Replay format (PV-6 phase 3; Handoff Phase 11 "Replay Recorder",
 * §24.5). ONE format replays both decoded real `.vrf` trajectories and
 * simulation-engine output, so the viewer never needs to know which it is.
 *
 * Conventions (match PV-2/PV-core): camelCase; all times in milliseconds;
 * positions in VALORANT world units (uu ≈ 1 cm, Z-up). World→minimap projection
 * is PV-4's transform, carried in meta.coordinateTransform (not recomputed here).
 *
 * Erasable TypeScript only (interfaces + unions, no enums/namespaces) so the
 * same source runs under Node --experimental-strip-types and Vite.
 */

export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }

/** Where a replay came from — the hard real/synthetic/simulated separator. */
export type ReplaySource = 'real' | 'synthetic' | 'simulated';

/** Per-player liveness at a keyframe. 'unknown' = not decodable (real .vrf). */
export type PlayerState = 'alive' | 'dead' | 'unknown';

/**
 * valorant-api axis-swapped world→minimap transform (PV-4 coordinate-system):
 *   minimapX = gameY * xMultiplier + xScalarToAdd
 *   minimapY = gameX * yMultiplier + yScalarToAdd   (result in [0,1])
 */
export interface CoordinateTransform {
  readonly xMultiplier: number;
  readonly yMultiplier: number;
  readonly xScalarToAdd: number;
  readonly yScalarToAdd: number;
}

export interface ReplayMeta {
  readonly mapId: string;
  readonly mapDisplayName?: string | null;
  readonly patch: string | null;
  readonly source: ReplaySource;
  /** RNG seed for a simulated replay (DECISION-010); null for decoded/real. */
  readonly seed: number | null;
  readonly matchId: string | null;
  readonly generatedAt: string;
  /** Movement sample rate of the source, if known (e.g. 128 for .vrf). */
  readonly tickRateHz?: number | null;
  /** PV-4 world→minimap transform; null when the map/transform is unknown. */
  readonly coordinateTransform?: CoordinateTransform | null;
  /** Free-form provenance (source id, evidenceType, verificationLevel, notes). */
  readonly provenance?: Record<string, unknown> | null;
}

export interface ReplayPlayer {
  /** Stable, ANONYMIZED id (player_N). Never a real RiotID. */
  readonly id: string;
  readonly teamIdx: number | null;
  readonly agentId?: string | null;
  /** Anonymized display label only. */
  readonly displayName?: string | null;
}

export interface ReplayRound {
  readonly roundNum: number;
  readonly startMs: number;
  readonly endMs: number | null;
  /** When the round's buy phase began (barrier up), if the replay has one; it ends at `startMs`. */
  readonly buyStartMs?: number;
}

export interface TrackKeyframe {
  readonly tMs: number;
  readonly pos: Vec3;
  /** View yaw in degrees [0,360); null when unavailable. */
  readonly facingDeg: number | null;
  /** Liveness at this instant; carried forward between keyframes. */
  readonly state?: PlayerState;
}

export interface PlayerTrack {
  readonly playerId: string;
  /** Keyframes sorted ascending by tMs (loadReplay enforces this). */
  readonly keyframes: readonly TrackKeyframe[];
}

export type ReplayEventKind =
  | 'roundStart' | 'roundEnd'
  | 'kill' | 'plant' | 'defuse'
  | 'abilitySpawn' | 'abilityExpire'
  | 'shot' | 'hit';

export interface ReplayEvent {
  readonly tMs: number;
  readonly roundNum?: number | null;
  readonly kind: ReplayEventKind;
  readonly actorId?: string | null;
  readonly victimId?: string | null;
  readonly pos?: Vec3 | null;
  /** Kind-specific extras (weapon, abilityCls, site, etc). */
  readonly data?: Record<string, unknown>;
}

// ── Perception / Belief (information warfare; DECISION-004) ──────────────────
// What each TEAM observes and believes, sampled over time and kept SEPARATE from
// the ground-truth `tracks`. This is the data a fog-of-war match view and a
// Belief heatmap render from. Optional: decoded `.vrf` replays have no belief;
// only the simulator (PV-4 `recordPerception`) populates it.

/** An enemy as a team currently sees or last saw them (never ground truth). */
export interface ObservedEnemy {
  /** Enemy player id if identified; null when only a contact is known. */
  readonly enemyId: string | null;
  /** PV-4 zone id of the (last-known) contact. */
  readonly zone: string;
  /** Last-seen world position, if any. */
  readonly pos?: Vec3 | null;
  /** Milliseconds since this enemy was last seen (0 = visible now). */
  readonly lastSeenMsAgo: number;
  readonly currentlyVisible: boolean;
}

/** Probability mass this team assigns to an enemy being in a zone (0..1). */
export interface ZoneBelief {
  readonly zone: string;
  readonly p: number;
}

/** A sound contact localized to a zone (optional). */
export interface SoundCue {
  readonly zone: string;
  readonly kind?: string | null; // e.g. 'footstep', 'ability', 'spike'
  readonly tMsAgo?: number;
}

/** One team's belief at an instant (sampled; not every tick). */
export interface PerceptionSnapshot {
  readonly tMs: number;
  readonly roundNum?: number | null;
  readonly observedEnemies: readonly ObservedEnemy[];
  /** Enemy-location belief as a zone→probability distribution (need not sum to 1). */
  readonly beliefZones: readonly ZoneBelief[];
  readonly sounds?: readonly SoundCue[];
}

/** A whole team's perception time series. */
export interface PerceptionTrack {
  readonly teamIdx: number; // 0 or 1 — whose belief this is
  readonly side?: 'attack' | 'defense' | null;
  /** Sampling interval in sim ticks, if fixed (informational). */
  readonly intervalTicks?: number | null;
  /** Snapshots in ascending tMs (loadReplay enforces the order). */
  readonly snapshots: readonly PerceptionSnapshot[];
}

export interface Replay {
  readonly schemaVersion: '1';
  readonly meta: ReplayMeta;
  readonly players: readonly ReplayPlayer[];
  readonly rounds: readonly ReplayRound[];
  readonly tracks: readonly PlayerTrack[];
  readonly events: readonly ReplayEvent[];
  /**
   * OPTIONAL per-team perception/belief, separate from ground-truth `tracks`
   * (DECISION-004). Populated by the simulator; absent for decoded `.vrf`.
   */
  readonly perception?: readonly PerceptionTrack[];
}

/** A single-instant snapshot produced by the engine's stateAt(). */
export interface PlayerSnapshot {
  readonly playerId: string;
  readonly pos: Vec3;
  readonly facingDeg: number | null;
  readonly state: PlayerState;
  /** True when tMs is outside this track's keyframe span (clamped). */
  readonly extrapolated: boolean;
}

export interface ReplaySnapshot {
  readonly tMs: number;
  readonly roundNum: number | null;
  readonly players: readonly PlayerSnapshot[];
}
