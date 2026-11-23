// Save / load. A World is plain data, so a save is its JSON with a format tag; loading checks the
// tag and version and returns the same World (generated people keep `origin: "generated"`).
import type { World } from "./model.ts";

export const SAVE_FORMAT = "pv-career-world";

export function serializeWorld(w: World): string {
  return JSON.stringify({ format: SAVE_FORMAT, world: w });
}

export function deserializeWorld(text: string): World {
  const parsed = JSON.parse(text) as { format?: unknown; world?: World };
  if (parsed.format !== SAVE_FORMAT || !parsed.world) throw new Error("not a PROJECT V career save");
  if (parsed.world.version !== 1) throw new Error(`unsupported career save version ${String(parsed.world.version)}`);
  return parsed.world;
}
