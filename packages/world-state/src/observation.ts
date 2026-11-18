/**
 * World → Observation boundary (DECISION-004, README §29, §15.1; TASK skeleton).
 *
 * This is the single sanctioned gate between omniscient ground truth (WorldState) and
 * what a decision maker is allowed to know (ObservationState). The rule it enforces: an
 * AI may learn an enemy's position ONLY for enemies it can currently see or has heard;
 * it never reads the live omniscient position of an unseen enemy.
 *
 * The boundary is also a TYPE boundary. `observeWorld` returns an ObservationState whose
 * enemy entries are {@link import("@pv/shared-types").ObservedEnemy} — a strict subset of
 * PlayerState with no live position, exact HP, inventory or intent. Decision code is
 * expected to consume ObservationState, never WorldState, so the absence of those fields
 * makes omniscient play unrepresentable rather than merely discouraged.
 *
 * Actual line-of-sight and sound propagation are the spatial-engine's job (PV-4). This
 * module takes a pluggable {@link VisibilityOracle}; the DEFAULT oracle is conservative
 * (sees/hears nothing), so wiring it up wrong fails safe — it under-informs the AI rather
 * than leaking ground truth.
 */
import type {
  HealthBand,
  ObservationState,
  ObservedEnemy,
  PlayerId,
  PlayerState,
  SoundObservation,
  WorldState,
} from "@pv/shared-types";
import { getPlayer } from "./create.js";

/** Pluggable perception, to be implemented by the spatial-engine (PV-4). */
export interface VisibilityOracle {
  /** True if `observer` currently has line of sight to `target`. */
  canSee(observer: PlayerState, target: PlayerState, world: WorldState): boolean;
  /** Optional: sounds the observer can currently hear this tick. */
  hearableSounds?(observer: PlayerState, world: WorldState): readonly SoundObservation[];
}

/** Default oracle: no vision, no hearing. Fails safe (never leaks unseen enemies). */
export const BLIND_ORACLE: VisibilityOracle = {
  canSee: () => false,
};

/** Map an exact HP value to a coarse, perceivable band (never expose exact enemy HP). */
export function healthBand(health: number): HealthBand {
  if (health <= 0) return "unknown";
  if (health >= 100) return "full";
  if (health >= 50) return "hurt";
  return "low";
}

export interface ObserveOptions {
  /** Observations carrying forward a previous belief could widen this; skeleton ignores it. */
  readonly oracle?: VisibilityOracle;
}

/**
 * Produce the ObservationState for `observerId` from the world. Only enemies the oracle
 * reports as visible are included, and only as {@link ObservedEnemy}. Teammates are not
 * enemies and are excluded here (team information flows via teammateReports, not vision).
 */
export function observeWorld(
  world: WorldState,
  observerId: PlayerId,
  options: ObserveOptions = {},
): ObservationState {
  const observer = getPlayer(world, observerId);
  if (observer === undefined) {
    throw new Error(`observer ${observerId} not found in world`);
  }
  const oracle = options.oracle ?? BLIND_ORACLE;

  const visibleEnemies: ObservedEnemy[] = [];
  for (const target of world.players) {
    if (target.teamId === observer.teamId) continue; // allies are not "observed enemies"
    if (!target.alive) continue;
    if (!oracle.canSee(observer, target, world)) continue;
    // Sighted this tick: last-seen position legitimately equals the current position,
    // because the observer is looking at it right now.
    visibleEnemies.push({
      playerId: target.id,
      agentId: target.agentId,
      lastSeenPosition: target.position,
      lastSeenAtMs: world.timeRemainingMs,
      healthBand: healthBand(target.health),
      observedWeaponId: target.weapon?.weaponId ?? null,
      currentlyVisible: true,
    });
  }

  const audibleEvents = oracle.hearableSounds?.(observer, world) ?? [];

  return {
    observerId,
    teamId: observer.teamId,
    timestampMs: world.timeRemainingMs,
    visibleEnemies,
    audibleEvents,
    teammateReports: [],
    knownMapChanges: [],
  };
}
