/**
 * World State serialization (Handoff §24.4 "경기 로그", §12).
 *
 * The world is already a tree of plain JSON-safe values (branded ids are strings,
 * durations are numbers, no BigInt/Date/Map), so serialization is JSON with a version
 * envelope. The round-trip is lossless: deserialize(serialize(w)) deep-equals w. The
 * envelope's schemaVersion lets later agents migrate persisted logs.
 */
import type { WorldState } from "@pv/shared-types";
import { deepFreeze } from "./create.js";

export const WORLD_STATE_SCHEMA_VERSION = 1 as const;

export interface SerializedWorld {
  readonly schemaVersion: typeof WORLD_STATE_SCHEMA_VERSION;
  readonly world: WorldState;
}

/** Serialize to a JSON string with a version envelope. */
export function serializeWorld(world: WorldState, pretty = false): string {
  const payload: SerializedWorld = { schemaVersion: WORLD_STATE_SCHEMA_VERSION, world };
  return JSON.stringify(payload, null, pretty ? 2 : undefined);
}

/** Parse a string produced by {@link serializeWorld}; returns a deep-frozen world. */
export function deserializeWorld(json: string): WorldState {
  const parsed = JSON.parse(json) as Partial<SerializedWorld>;
  if (parsed.schemaVersion !== WORLD_STATE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported world schemaVersion: ${String(parsed.schemaVersion)} ` +
        `(expected ${WORLD_STATE_SCHEMA_VERSION})`,
    );
  }
  if (parsed.world === undefined) {
    throw new Error("serialized payload is missing `world`");
  }
  return deepFreeze(parsed.world);
}
