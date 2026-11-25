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
  /** Distance-rule sounds (footstep, landing): heard by every enemy within this radius. Default: the footstep radius. */
  readonly radiusUnits?: number;
  /** Source level (dB re the reference distance) — what masking compares. Default: the kind's level. */
  readonly levelDb?: number;
}

/**
 * Sound masking (signal detection, deterministic form): a quiet cue is not picked out when a louder
 * sound reaches the same listener in the same window and is louder there by more than the margin:
 *     masked ⇔ max over maskers [L_m − 20·log10(d_m / d₀)] − [L_c − 20·log10(d_c / d₀)] > M
 * (inverse-square spreading in dB; d clamped to d₀). Levels, d₀ and M are params.hearing.masking.
 */
export function isMasked(listener: Vector3, cue: { position: Vector3; levelDb: number }, maskers: readonly { position: Vector3; levelDb: number }[] | undefined, params: PerceptionParams): boolean {
  if (!maskers || maskers.length === 0) return false;
  const m = params.hearing.masking;
  const at = (pos: Vector3, level: number) => level - 20 * Math.log10(Math.max(m.refDistanceUnits, Math.hypot(pos.x - listener.x, pos.y - listener.y, pos.z - listener.z)) / m.refDistanceUnits);
  const cueAt = at(cue.position, cue.levelDb);
  for (const k of maskers) if (at(k.position, k.levelDb) - cueAt > m.marginDb) return true;
  return false;
}

/**
 * Landing off a drop of height h (uu): silent below the threshold h₀ (a walked step-down); above it
 * the impact is loud and its reach grows with the fall — impact energy ∝ h (v² = 2gh), and under
 * inverse-square spreading the radius at which it falls to a given level ∝ √energy:
 *     radius(h) = footstepRadius · √(h / h₀),   level(h) = L_step + 10·log10(h / h₀)   (h ≥ h₀)
 * h₀ is manual-approx (params.hearing.landing.silentBelowUnits) until checked in game.
 */
/** Sound of entering / leaving an authored link at one end (params.hearing.traversal). */
export function traversalSound(via: string, params: PerceptionParams): { radiusUnits: number; levelDb: number } {
  const t = params.hearing.traversal;
  const radiusUnits = via === "teleporter" ? t.teleporterRadiusUnits : via === "zipline" ? t.ziplineRadiusUnits : t.ropeRadiusUnits;
  return { radiusUnits, levelDb: t.levelDb };
}

export function landingSound(heightUnits: number, params: PerceptionParams): { radiusUnits: number; levelDb: number } | null {
  const h0 = params.hearing.landing.silentBelowUnits;
  if (heightUnits < h0) return null;
  return {
    radiusUnits: params.hearing.footstepRadiusUnits * Math.sqrt(heightUnits / h0),
    levelDb: params.hearing.masking.footstepDb + 10 * Math.log10(heightUnits / h0),
  };
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
  landing: 0.8,
  traversal: 0.9,
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

  for (const s of world.extraSounds ?? []) {
    sources.push({ kind: s.kind, position: s.position, loudness: LOUDNESS[s.kind] ?? LOUDNESS.other, teamId: s.teamId, radiusUnits: s.radiusUnits, levelDb: s.levelDb });
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
  maskers?: readonly { position: Vector3; levelDb: number }[],
): SoundObservation[] {
  const observerZone = spatial.nearestZone(observerPos).id;
  const out: SoundObservation[] = [];

  for (const src of sources) {
    // The source's zone is looked up only for a sound that is actually heard (most footsteps are
    // out of range or the listener's own team's); nearestZone has no side effect on the answer.
    if (src.kind === "footstep" || src.kind === "landing" || src.kind === "traversal") {
      if (observerTeamId !== undefined && src.teamId === observerTeamId) continue; // own team's steps
      const dx = src.position.x - observerPos.x, dy = src.position.y - observerPos.y, dz = src.position.z - observerPos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const radius = src.radiusUnits ?? params.hearing.footstepRadiusUnits;
      if (d > radius) continue;
      if (isMasked(observerPos, { position: src.position, levelDb: src.levelDb ?? params.hearing.masking.footstepDb }, maskers, params)) continue;
      const srcZone = spatial.nearestZone(src.position);
      out.push({
        kind: src.kind,
        approxPosition: { x: srcZone.position.x, y: srcZone.position.y, z: srcZone.position.z },
        heardAtMs: atMs,
        confidence: Number(footstepConfidence(d, radius).toFixed(3)),
      });
      continue;
    }
    // strength of the source signal as it reaches the observer's zone
    const srcZone = spatial.nearestZone(src.position);
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
