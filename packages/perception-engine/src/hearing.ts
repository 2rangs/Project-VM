import type { SpatialEngine } from "@pv/spatial-engine";
import type {
  GameEvent,
  PlayerState,
  SoundKind,
  SoundObservation,
  Vector3,
  WorldState,
} from "./shared-mirror.js";
import type { PerceptionParams } from "./params.js";

/** A sound emitted in the world this tick, before propagation. */
export interface SoundSource {
  readonly kind: SoundKind;
  readonly position: Vector3;
  /** Base loudness 0..1 at the source (manual-approx per kind). */
  readonly loudness: number;
  /** Team of the player who made the sound, when a player made it (footsteps). */
  readonly teamId?: string;
}

/**
 * How firmly a footstep heard at distance `d` localises the runner to a zone: certain next to the
 * listener, nothing at the edge of the audio range — a linear fall-off,
 *     confidence = 1 − d / R        (0 ≤ d ≤ R; beyond R the step is not heard at all).
 * Being heard is all-or-nothing inside the radius (the game's attenuation is deliberately flat so
 * a step in range is always audible); what distance costs is knowing WHERE it is.
 */
export function footstepConfidence(distanceUnits: number, radiusUnits: number): number {
  if (radiusUnits <= 0 || distanceUnits > radiusUnits) return 0;
  return Math.max(0, 1 - distanceUnits / radiusUnits);
}

const LOUDNESS: Record<SoundKind, number> = {
  gunfire: 1.0,
  footstep: 0.8,
  spikePlant: 0.75,
  spikeDefuse: 0.75,
  abilityCast: 0.7,
  reload: 0.5,
  other: 0.5,
};

function classifyMovement(p: PlayerState, params: PerceptionParams): "run" | "walk" | "still" {
  const s = p.behaviorState.toLowerCase();
  if (params.hearing.runningStates.some((k) => s.includes(k))) return "run";
  if (params.hearing.walkingStates.some((k) => s.includes(k))) return "walk";
  return "still";
}

function playerById(world: WorldState, id: string | null): PlayerState | undefined {
  if (id === null) return undefined;
  return world.players.find((p) => p.id === id);
}

/**
 * Collect the sound sources active in the world this tick:
 * - running players emit footsteps (walking/still are silent — shift-walk is quiet);
 * - recent events emit gunfire / abilityCast / spike plant+defuse.
 * Event recency is tick-based to avoid the round-clock mismatch between event.timeMs
 * (elapsed) and world.timeRemainingMs (remaining).
 */
export function collectSoundSources(world: WorldState, params: PerceptionParams): SoundSource[] {
  const sources: SoundSource[] = [];

  for (const p of world.players) {
    if (!p.alive) continue;
    if (classifyMovement(p, params) === "run") {
      sources.push({ kind: "footstep", position: p.position, loudness: LOUDNESS.footstep, teamId: p.teamId });
    }
  }

  const minTick = world.tick - Math.max(0, params.hearing.eventWindowTicks - 1);
  for (const ev of world.events) {
    if (ev.tick < minTick || ev.tick > world.tick) continue;
    const src = eventSound(ev, world);
    if (src) sources.push(src);
  }
  return sources;
}

function eventSound(ev: GameEvent, world: WorldState): SoundSource | null {
  switch (ev.kind) {
    case "kill":
    case "damage": {
      if (ev.cause !== "weapon") return null;
      const shooter = playerById(world, ev.kind === "kill" ? ev.killer : ev.source);
      const pos = shooter?.position ?? playerById(world, ev.kind === "kill" ? ev.victim : ev.target)?.position;
      return pos ? { kind: "gunfire", position: pos, loudness: LOUDNESS.gunfire } : null;
    }
    case "abilityUse": {
      const pos = ev.at ?? playerById(world, ev.playerId)?.position;
      return pos ? { kind: "abilityCast", position: pos, loudness: LOUDNESS.abilityCast } : null;
    }
    case "spikePlantStart":
    case "spikePlanted": {
      const pos = ev.at ?? playerById(world, ev.playerId)?.position ?? world.spike.position;
      return pos ? { kind: "spikePlant", position: pos, loudness: LOUDNESS.spikePlant } : null;
    }
    case "spikeDefuseStart":
    case "spikeDefused": {
      const pos = ev.at ?? playerById(world, ev.playerId)?.position ?? world.spike.position;
      return pos ? { kind: "spikeDefuse", position: pos, loudness: LOUDNESS.spikeDefuse } : null;
    }
    default:
      return null;
  }
}

function thresholdFor(kind: SoundKind, params: PerceptionParams): number {
  const t = params.hearing.thresholds;
  switch (kind) {
    case "footstep": return t.footstep;
    case "gunfire": return t.gunfire;
    case "abilityCast": return t.abilityCast;
    case "spikePlant":
    case "spikeDefuse": return t.spike;
    case "reload": return t.reload;
    default: return t.other;
  }
}

/**
 * Which sources an observer at `observerPos` can hear.
 *
 * FOOTSTEPS follow the game's distance rule: a running player is heard by every ENEMY within
 * `params.hearing.footstepRadiusUnits` (3D distance — walls do not stop footsteps), and by nobody
 * beyond it. Each distinct runner is one observation: steps from two players are two sources, but
 * the observation carries no identity. A teammate's steps are not a cue (`observerTeamId` filters
 * them; omit it to hear every runner).
 *
 * Everything else (gunfire, casts, spike) is propagated over the spatial sound graph as before.
 *
 * Localisation is ZONE-LEVEL in both cases: approxPosition is the source zone's center, never the
 * exact source coordinate. confidence is the propagated signal strength (graph sounds) or the
 * distance fall-off (footsteps).
 */
export function hearSounds(
  observerPos: Vector3,
  sources: readonly SoundSource[],
  spatial: SpatialEngine,
  params: PerceptionParams,
  atMs: number,
  observerTeamId?: string,
): SoundObservation[] {
  const observerZone = spatial.nearestZone(observerPos).id;
  const out: SoundObservation[] = [];

  for (const src of sources) {
    const srcZone = spatial.nearestZone(src.position);
    if (src.kind === "footstep") {
      if (observerTeamId !== undefined && src.teamId === observerTeamId) continue; // own team's steps
      const dx = src.position.x - observerPos.x, dy = src.position.y - observerPos.y, dz = src.position.z - observerPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const radius = params.hearing.footstepRadiusUnits;
      if (d > radius) continue;
      out.push({
        kind: "footstep",
        approxPosition: { x: srcZone.position.x, y: srcZone.position.y, z: srcZone.position.z },
        heardAtMs: atMs,
        confidence: Number(footstepConfidence(d, radius).toFixed(3)),
      });
      continue;
    }
    // strength of the source signal as it reaches the observer's zone
    let reachStrength: number;
    if (srcZone.id === observerZone) {
      reachStrength = 1;
    } else {
      const audible = spatial.audibleZones(srcZone.id, 0.01);
      reachStrength = audible.find((a) => a.zoneId === observerZone)?.strength ?? 0;
    }
    const effective = src.loudness * reachStrength;
    if (effective >= thresholdFor(src.kind, params)) {
      out.push({
        kind: src.kind,
        approxPosition: { x: srcZone.position.x, y: srcZone.position.y, z: srcZone.position.z },
        heardAtMs: atMs,
        confidence: Math.min(1, Number(effective.toFixed(3))),
      });
    }
  }
  return out;
}
