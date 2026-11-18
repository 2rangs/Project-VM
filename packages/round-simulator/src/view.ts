import type { SpatialEngine } from "@pv/spatial-engine";
import type { ObservationState, PlayerState as PPlayerState, SpikeState as PSpikeState, Vector2 } from "@pv/perception-engine";
import type { PerceptionEngine } from "@pv/perception-engine";
import { buildBelief } from "@pv/decision-engine";
import type {
  BeliefState as SharedBeliefState,
  ObservationState as SharedObservationState,
  SpatialQuery as SharedSpatialQuery,
} from "@pv/shared-types";
import { mulberry32, type Rng } from "./rng.js";
import type {
  AudibleZoneResult,
  BeliefState,
  PolicyTeammate,
  PolicyView,
  RandomSource,
  SpatialQuery,
  TeamEconomyState,
  ZoneId,
  ZoneMeta,
  ZonePath,
  ZoneType,
} from "./policy-contract.js";
import type { SimPlayer, SimState, Side } from "./types.js";

/**
 * Adapter exposing PV-4's SpatialEngine as PV-3's SpatialQuery (the dependency-inversion
 * seam). NOTE: PV-3's contract documents minimapUnits for position inputs; this adapter
 * works in the engine's native game-world units (the frame the round-simulator uses), so
 * callers must pass game-unit positions to nearestZone. Zone-id queries are frame-free.
 */
export class SpatialQueryAdapter implements SpatialQuery {
  readonly mapId: string;
  constructor(private readonly engine: SpatialEngine) {
    this.mapId = engine.mapId;
  }
  nearestZone(position: Vector2): ZoneId {
    return this.engine.nearestZone({ x: position.x, y: position.y, z: 0 }).id;
  }
  getZoneMeta(zoneId: ZoneId): ZoneMeta | undefined {
    const z = this.engine.getZone(zoneId);
    if (!z) return undefined;
    return { id: z.id, zoneType: z.zoneType as ZoneType, site: z.zoneType === "site" ? z.superRegion : null, plantable: z.plantable, callout: z.callout };
  }
  allZones(): readonly ZoneId[] {
    return this.engine.zones.map((z) => z.id);
  }
  zonesByType(type: ZoneType): readonly ZoneId[] {
    return this.engine.zonesByType(type).map((z) => z.id);
  }
  findPath(from: ZoneId, to: ZoneId, mode: "run" | "walk" = "run"): ZonePath | null {
    const r = this.engine.findPath(from, to, mode);
    return r ? { path: r.path, timeMs: r.timeMs, distanceMeters: r.distanceMeters, mode } : null;
  }
  shortestTravelTimeMs(from: ZoneId, to: ZoneId, mode: "run" | "walk" = "run"): number | null {
    return this.engine.shortestTravelTimeMs(from, to, mode);
  }
  isReachable(from: ZoneId, to: ZoneId): boolean {
    return this.engine.isReachable(from, to);
  }
  hasLineOfSight(a: ZoneId, b: ZoneId, opts?: { smokedPairs?: ReadonlyArray<readonly [ZoneId, ZoneId]> }): boolean {
    return this.engine.hasLineOfSight(a, b, { smokedPairs: opts?.smokedPairs as Array<[string, string]> | undefined });
  }
  visibleZonesFrom(zoneId: ZoneId): readonly ZoneId[] {
    return this.engine.visibleZonesFrom(zoneId);
  }
  isPlantableZone(zoneId: ZoneId): boolean {
    return this.engine.isPlantableZone(zoneId);
  }
  audibleZones(originZone: ZoneId, threshold?: number): readonly AudibleZoneResult[] {
    return this.engine.audibleZones(originZone, threshold);
  }
}

/** Seeded RandomSource (PV-3 contract) backed by mulberry32. */
export class SeededRandomSource implements RandomSource {
  private readonly rng: Rng;
  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }
  nextFloat(): number {
    return this.rng();
  }
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.rng() * (maxExclusive - minInclusive));
  }
}

function toTeammate(p: SimPlayer): PolicyTeammate {
  return {
    id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
    position: p.position, facing: p.facing, health: p.health, armor: p.armor, alive: p.alive,
    weapon: p.weaponId ? { weaponId: p.weaponId } : null,
    abilities: p.abilities.map((a) => ({ abilityId: a.abilityId, chargesRemaining: a.chargesRemaining, cooldownRemainingMs: 0 })),
    credits: 0, // TODO(econ): the sim does not model per-player economy yet
    ultimatePoints: p.ultimatePoints, ultimateCost: p.ultimateCost,
  };
}

function publicSpike(state: SimState): PSpikeState {
  const s = state.spike;
  const phase = s.phase === "planting" ? "planting" : s.phase; // perception SpikePhase superset
  return {
    phase,
    position: s.position,
    holderId: s.carrierId,
    detonationInMs: s.detonateAtElapsedMs != null ? s.detonateAtElapsedMs - state.elapsedMs : null,
  };
}

/**
 * Build the observable PolicyView for one side. Enemies appear ONLY through `observation`
 * (last-seen snapshots) and `belief`; `teammates` is own-team players only. There is no
 * field carrying an unseen enemy's live state (DECISION-004) — asserted in test/leak.test.ts.
 *
 * `belief` is produced by PV-3's real `@pv/decision-engine` `buildBelief(prev, observation,
 * spatial, dtMs)` — zone-probability distributions with time diffusion — not a local
 * placeholder. The caller (RoundSimulator) threads the previous tick's belief as `prevBelief`
 * and the elapsed `dtMs` so unseen enemies age correctly across decisions (README §17.3).
 */
export function buildPolicyView(
  side: Side,
  state: SimState,
  perception: PerceptionEngine,
  spatial: SpatialQuery,
  prevBelief: BeliefState | null = null,
  dtMs = 0,
): PolicyView {
  const result = perception.perceive(toPerceptionWorldForView(state));
  const teamId = side === "attack" ? "attackers" : "defenders";
  const team = result.teams.get(teamId);
  const teammates = state.players.filter((p) => p.side === side).map(toTeammate);

  // team-level observation assembled from the per-team picture (no live enemy truth)
  const observation: ObservationState = {
    observerId: teamId,
    teamId,
    timestampMs: state.timeRemainingMs,
    visibleEnemies: team?.teamEnemyPicture ?? [],
    audibleEvents: team ? Object.values(team.perPlayer).flatMap((o) => o.audibleEvents) : [],
    teammateReports: team?.sharedReports ?? [],
    knownMapChanges: [],
  };
  const perPlayerObservation: Record<string, ObservationState> = team ? { ...team.perPlayer } : {};

  return {
    contextId: state.roundId,
    scenarioRef: null,
    teamId,
    side,
    roundNumber: 1,
    timeRemainingMs: state.timeRemainingMs,
    mapId: state.mapId,
    patchVersion: "synthetic",
    spike: publicSpike(state),
    teammates,
    observation,
    perPlayerObservation,
    // buildBelief is the real @pv/decision-engine implementation. Its params are
    // shared-types' BRANDED-id shapes; the round-simulator still carries the string-aliased
    // mirrors (perception-engine shared-mirror / policy-contract). A branded PlayerId IS a
    // string at runtime and we only pass ids through, so bridging the two with a cast at this
    // single boundary is sound. The RESULT (branded) assigns back to our mirror BeliefState
    // because a brand is a subtype of string. (Removed once the mirrors are deleted in favour
    // of importing @pv/shared-types everywhere.)
    belief: buildBelief(
      prevBelief as unknown as SharedBeliefState | null,
      observation as unknown as SharedObservationState,
      spatial as unknown as SharedSpatialQuery,
      dtMs,
    ),
    economy: economyStub(teamId, side),
    knownEnemyAliveCount: state.players.filter((p) => p.side !== side && p.alive).length,
    matchScore: null,
  };
}

function economyStub(teamId: string, side: Side): TeamEconomyState {
  return { teamId, side, credits: 0, lossBonusTier: 0, consecutiveLosses: 0 };
}

// Local perception-world builder (mirror of simulator's; kept here so view is self-contained).
function toPerceptionWorldForView(state: SimState) {
  const players: PPlayerState[] = state.players.map((p) => ({
    id: p.id, teamId: p.teamId, side: p.side, agentId: p.agentId,
    position: p.position, velocity: { x: 0, y: 0, z: 0 }, facing: p.facing,
    health: p.health, armor: p.armor, alive: p.alive, weapon: null,
    behaviorState: p.pathIndex < p.path.length ? (p.moveMode === "run" ? "running" : "walking") : "still",
  }));
  return {
    matchId: state.matchId, roundId: state.roundId, roundNumber: 1, tick: state.tick,
    timeRemainingMs: state.timeRemainingMs, mapId: state.mapId, patchVersion: "synthetic",
    players, spike: { phase: "carried" as const, position: null, holderId: null, detonationInMs: null },
    activeAbilities: [], events: [],
  };
}

export { SeededRandomSource as RandomSourceImpl };
