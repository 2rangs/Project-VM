import type { AbilityState } from "@pv/perception-engine";
import type { AbilityEngine } from "./engine.js";
import type { RevealSnapshot } from "./types.js";

/**
 * Adapters bridging ability effects into the other engines. They never expose live
 * ground truth: reveals are frozen snapshots, and vision blockers are just origins.
 */

/** Predicate to pass to perception's SpatialPerceptionOracle so vision-blockers occlude LoS. */
export const visionBlockerIsSmoke = (a: AbilityState): boolean =>
  a.abilityId === "smoke" || a.abilityId === "wall";

/**
 * Vision-blocking effects (any effect with blocksVision, i.e. smokes + standing walls) as
 * perception `AbilityState`s. Wire with:
 *   new SpatialPerceptionOracle(spatial, { isSmoke: visionBlockerIsSmoke })
 * and pass these on `world.activeAbilities`. abilityId is set to the occluder kind so the
 * predicate matches regardless of the ability's other effect types (e.g. slow+smoke).
 */
export function toPerceptionAbilityStates(engine: AbilityEngine): AbilityState[] {
  const out: AbilityState[] = [];
  for (const e of engine.activeEffects()) {
    if (!e.blocksVision) continue;
    out.push({
      instanceId: e.instanceId,
      ownerId: e.ownerId,
      abilityId: e.effectType === "wall" ? "wall" : "smoke", // matches visionBlockerIsSmoke
      origin: e.origin,
      expiresAtMs: e.expiresAtMs,
    });
  }
  return out;
}

/** Zones denied by active molly/area effects — pass as spatial `PathOptions.blockedZones`. */
export function deniedZoneIds(engine: AbilityEngine): string[] {
  return engine.effectsOfType("molly").map((e) => e.zoneId);
}

/** All currently-active reveal snapshots (recon + triggered traps), frozen at reveal time. */
export function revealedEnemies(engine: AbilityEngine): RevealSnapshot[] {
  const out: RevealSnapshot[] = [];
  for (const e of engine.activeEffects()) {
    if (e.effectType === "recon" || e.effectType === "trap") out.push(...e.reveals);
  }
  return out;
}

/** flashBlindMs to drop into a combat `EngagePosture` for a player. */
export function combatFlashBlindMs(engine: AbilityEngine, playerId: string, nowMs: number): number {
  return engine.blindRemainingMs(playerId, nowMs);
}
