/**
 * @pv/simulation-core — deterministic foundations shared by every engine package.
 *
 * Contains no game rules and no world mutation logic of its own: only the primitives
 * that make the simulation reproducible (DECISION-010) — the stream-separated RNG, the
 * fixed-tick clock, and the ordered event log.
 */
export { SeededRng, RngStream, normalizeSeed } from "./rng.js";
export { SimulationClock } from "./clock.js";
export type { ClockState } from "./clock.js";
export { EventLog } from "./event-log.js";
export type { EventInput } from "./event-log.js";
