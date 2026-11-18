/**
 * ObservationProvider adapter over PV-4's perception-engine.
 *
 * MIRROR SOURCE: origin/claude/pv-spatial @ e3ad1c541e4c5834a2cd4e438199a3ad9557a927
 *   packages/perception-engine/src/engine.ts (PerceptionEngine.perceive → PerceptionResult).
 * At merge, import { PerceptionEngine } from "@pv/perception-engine".
 *
 * perception-engine already emits ObservationState-shaped objects (its shared-mirror of
 * @pv/shared-types), so this is largely a pass-through keyed by observer. The round-
 * simulator calls `perceive(world)` each tick and hands the per-player result here;
 * `observe(teamId, atMs)` returns that player's observation (perception is per-observer, so
 * bind one provider per player).
 */
import type { ObservationProvider, ObservationState, PlayerId } from "@pv/shared-types";

/** Structural mirror of PerceptionResult: per-observer ObservationStates. */
export interface PerceptionResultLike {
  readonly players: ReadonlyMap<string, ObservationState>;
}

/** An ObservationProvider that serves a single observer's latest perception. */
export function observationProviderForPlayer(
  result: PerceptionResultLike,
  playerId: PlayerId,
): ObservationProvider {
  return {
    observe(_teamId, _atMs): ObservationState {
      const obs = result.players.get(String(playerId));
      if (!obs) throw new Error(`no perception for player ${String(playerId)}`);
      return obs;
    },
  };
}

/** Pull one observer's ObservationState out of a PerceptionResult, or undefined. */
export function observationForPlayer(
  result: PerceptionResultLike,
  playerId: PlayerId,
): ObservationState | undefined {
  return result.players.get(String(playerId));
}
