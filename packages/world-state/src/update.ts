/**
 * Immutable World State updates (Handoff §12, DECISION-010).
 *
 * Every helper returns a NEW frozen WorldState and never mutates the input, so a world
 * snapshot can be kept for replay/branching (README §25 counterfactual simulation) while
 * the simulation advances a derived copy. Applying the same events to the same starting
 * world always yields the same result.
 */
import type { GameEvent, PlayerId, PlayerState, SpikeState, WorldState } from "@pv/shared-types";
import { deepFreeze } from "./create.js";

/** Replace a single player via an updater; no-op (returns same ref) if id is absent. */
export function updatePlayer(
  world: WorldState,
  id: PlayerId,
  updater: (p: PlayerState) => PlayerState,
): WorldState {
  let changed = false;
  const players = world.players.map((p) => {
    if (p.id !== id) return p;
    changed = true;
    return updater(p);
  });
  if (!changed) return world;
  return deepFreeze({ ...world, players });
}

/** Overwrite a set of fields on a player. */
export function patchPlayer(
  world: WorldState,
  id: PlayerId,
  patch: Partial<Omit<PlayerState, "id">>,
): WorldState {
  return updatePlayer(world, id, (p) => ({ ...p, ...patch }));
}

export function setSpike(world: WorldState, spike: SpikeState): WorldState {
  return deepFreeze({ ...world, spike });
}

/** Append events to the log immutably (does not advance the tick). */
export function appendEvents(world: WorldState, events: readonly GameEvent[]): WorldState {
  if (events.length === 0) return world;
  return deepFreeze({ ...world, events: [...world.events, ...events] });
}

/** Advance the world clock by one tick, decrementing remaining round time by `tickMs`. */
export function advanceTick(world: WorldState, tickMs: number): WorldState {
  return deepFreeze({
    ...world,
    tick: world.tick + 1,
    timeRemainingMs: Math.max(0, world.timeRemainingMs - tickMs),
  });
}

/** Mark a player dead (health 0). Convenience over patchPlayer for the common case. */
export function killPlayer(world: WorldState, id: PlayerId): WorldState {
  return patchPlayer(world, id, { alive: false, health: 0 });
}
