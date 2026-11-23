// PROJECT V — perception-engine public API.
//
// Produces per-player and per-team Observations from the omniscient WorldState while
// enforcing the ground-truth boundary (DECISION-004, README §29). Backed by PV-4's
// spatial-engine for line-of-sight and sound propagation.

export * from "./types.js";
export { PerceptionEngine } from "./engine.js";
export type { PerceptionResult, PerceptionEngineOptions } from "./engine.js";
export {
  SpatialPerceptionOracle,
  observedEnemyFromVisible,
  healthBand,
} from "./oracle.js";
export type { VisibilityOracle, OracleOptions } from "./oracle.js";
export { canSee, facingAngleTo } from "./vision.js";
export type { VisionContext } from "./vision.js";
export { collectSoundSources, hearSounds, footstepConfidence } from "./hearing.js";
export type { SoundSource } from "./hearing.js";
export { EnemyMemory } from "./memory.js";
export { CommunicationHub } from "./communication.js";
export type { PlayerSightingInput } from "./communication.js";
export { DEFAULT_PARAMS, confidenceForAge } from "./params.js";
export type { PerceptionParams } from "./params.js";
export { mulberry32 } from "./rng.js";
export type { Rng } from "./rng.js";

// Re-export the shared-types mirror so consumers can build inputs in tests. On monorepo
// integration these come from `@pv/shared-types` instead (see shared-mirror.ts).
export type * from "./shared-mirror.js";
