/**
 * Belief State v0 — zone-level enemy position beliefs (Handoff §12.4, README §17.3).
 *
 * The team believes enemies are somewhere, with uncertainty that GROWS with time since
 * the last sighting. README §17.3: an enemy seen 10 s ago is not assumed to still be
 * there — the belief spreads over every zone that enemy could have reached in the elapsed
 * time. We model this as a probability distribution over zones:
 *   - a freshly observed enemy collapses to a spike at its zone (prob ≈ 1),
 *   - as staleness grows, mass diffuses to zones reachable within that time (via
 *     SpatialQuery travel times), weighted so nearer zones stay more likely.
 *
 * TYPE BOUNDARY (DECISION-004): this module takes an {@link ObservationState} and a
 * {@link SpatialQuery} ONLY. It never imports or accepts WorldState, so it is structurally
 * impossible to seed a belief from omniscient ground truth here.
 */
import type {
  AudibleZoneResult,
  ObservationState,
  PlayerId,
  SoundObservation,
  SpatialQuery,
  TeamId,
  Vector2,
  Vector3,
  ZoneId,
} from "@pv/shared-types";

export interface ZoneBelief {
  readonly enemyId: PlayerId;
  /** Zone where the enemy was last localised (anchor for diffusion). */
  readonly originZone: ZoneId;
  /** ms since the supporting observation; drives how far the belief has spread. */
  readonly stalenessMs: number;
  /** Normalised probability over zones (sums to ~1). */
  readonly distribution: ReadonlyMap<ZoneId, number>;
  readonly mostLikelyZone: ZoneId;
}

export interface TeamBeliefModel {
  readonly teamId: TeamId;
  readonly atMs: number;
  readonly enemyBeliefs: readonly ZoneBelief[];
  /** Zones with sound contact this snapshot (kind → from heard sounds), weighted 0..1. */
  readonly contactZones: ReadonlyMap<ZoneId, number>;
  /** How many enemies the team believes are alive (kill-feed certainty), if known. */
  readonly knownEnemyAliveCount: number | null;
}

const v2 = (v: Vector3 | Vector2): Vector2 => ({ x: v.x, y: v.y });

function normalize(weights: Map<ZoneId, number>): Map<ZoneId, number> {
  let sum = 0;
  for (const w of weights.values()) sum += w;
  if (sum <= 0) return weights;
  const out = new Map<ZoneId, number>();
  for (const [z, w] of weights) out.set(z, w / sum);
  return out;
}

/**
 * Diffuse probability from `origin` over every zone reachable within `maxAgeMs` of run
 * travel. Weight falls off linearly with travel time; the origin keeps the peak. With
 * `maxAgeMs <= 0` the distribution is a point mass at `origin`.
 */
export function spreadFromZone(
  origin: ZoneId,
  maxAgeMs: number,
  spatial: SpatialQuery,
): Map<ZoneId, number> {
  const weights = new Map<ZoneId, number>([[origin, 1]]);
  if (maxAgeMs <= 0) return weights;
  for (const z of spatial.allZones()) {
    if (z === origin) continue;
    const t = spatial.shortestTravelTimeMs(origin, z, "run");
    if (t === null || t > maxAgeMs) continue; // unreachable, or too far in the time
    const w = 1 - t / maxAgeMs; // nearer → heavier; at the horizon → ~0
    if (w > 0) weights.set(z, w);
  }
  return normalize(weights);
}

function argmax(dist: ReadonlyMap<ZoneId, number>, fallback: ZoneId): ZoneId {
  let best = fallback;
  let bestW = -Infinity;
  for (const [z, w] of dist) {
    if (w > bestW) {
      bestW = w;
      best = z;
    }
  }
  return best;
}

function contactZonesFromSounds(
  sounds: readonly SoundObservation[],
  spatial: SpatialQuery,
  nowMs: number,
): Map<ZoneId, number> {
  const out = new Map<ZoneId, number>();
  for (const s of sounds) {
    const zone = spatial.nearestZone(v2(s.approxPosition));
    const ageMs = Math.max(0, nowMs - s.heardAtMs);
    // Recent, confident sounds weigh more; decay linearly over ~10s.
    const weight = Math.max(0, s.confidence * (1 - ageMs / 10_000));
    if (weight > 0) out.set(zone, Math.max(out.get(zone) ?? 0, weight));
  }
  return out;
}

export interface BuildBeliefOptions {
  readonly knownEnemyAliveCount?: number | null;
}

/**
 * Build a team belief from a single observation snapshot. Each observed enemy with a
 * last-known position seeds a zone belief diffused by its own staleness.
 */
export function buildTeamBelief(
  obs: ObservationState,
  spatial: SpatialQuery,
  options: BuildBeliefOptions = {},
): TeamBeliefModel {
  const enemyBeliefs: ZoneBelief[] = [];
  for (const e of obs.visibleEnemies) {
    const originZone = spatial.nearestZone(v2(e.lastSeenPosition));
    const stalenessMs = Math.max(0, obs.timestampMs - e.lastSeenAtMs);
    const distribution = spreadFromZone(originZone, stalenessMs, spatial);
    enemyBeliefs.push({
      enemyId: e.playerId,
      originZone,
      stalenessMs,
      distribution,
      mostLikelyZone: argmax(distribution, originZone),
    });
  }
  return {
    teamId: obs.teamId,
    atMs: obs.timestampMs,
    enemyBeliefs,
    contactZones: contactZonesFromSounds(obs.audibleEvents, spatial, obs.timestampMs),
    knownEnemyAliveCount: options.knownEnemyAliveCount ?? null,
  };
}

/**
 * Advance a belief by `deltaMs` with no new observation: staleness grows and each enemy
 * belief diffuses further from its origin (README §17.3). Pure — returns a new model.
 */
export function advanceTeamBelief(
  model: TeamBeliefModel,
  deltaMs: number,
  spatial: SpatialQuery,
): TeamBeliefModel {
  if (deltaMs < 0) throw new RangeError("deltaMs must be non-negative");
  const enemyBeliefs = model.enemyBeliefs.map((b) => {
    const stalenessMs = b.stalenessMs + deltaMs;
    const distribution = spreadFromZone(b.originZone, stalenessMs, spatial);
    return { ...b, stalenessMs, distribution, mostLikelyZone: argmax(distribution, b.originZone) };
  });
  return { ...model, atMs: model.atMs + deltaMs, enemyBeliefs };
}

/**
 * Fold a fresh observation into an existing belief: re-observed enemies collapse back to
 * a tight distribution at their new zone; unobserved enemies keep diffusing.
 */
export function observeTeamBelief(
  model: TeamBeliefModel,
  obs: ObservationState,
  spatial: SpatialQuery,
  options: BuildBeliefOptions = {},
): TeamBeliefModel {
  const fresh = buildTeamBelief(obs, spatial, options);
  const observedIds = new Set(fresh.enemyBeliefs.map((b) => b.enemyId));
  const carried = model.enemyBeliefs.filter((b) => !observedIds.has(b.enemyId));
  return {
    teamId: fresh.teamId,
    atMs: fresh.atMs,
    enemyBeliefs: [...fresh.enemyBeliefs, ...carried],
    contactZones: fresh.contactZones,
    knownEnemyAliveCount: options.knownEnemyAliveCount ?? model.knownEnemyAliveCount,
  };
}

/** Total believed enemy pressure on a zone: sum of per-enemy probability + sound contact. */
export function enemyPressureOnZone(model: TeamBeliefModel, zone: ZoneId): number {
  let p = 0;
  for (const b of model.enemyBeliefs) p += b.distribution.get(zone) ?? 0;
  p += model.contactZones.get(zone) ?? 0;
  return p;
}

/** Convenience: the audible zones a SpatialQuery reports, re-exported shape for callers. */
export type { AudibleZoneResult };
