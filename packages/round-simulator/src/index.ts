// PROJECT V — round-simulator public API.
//
// A deterministic fixed-tick 5v5 round loop wiring spatial + perception + combat +
// ability engines (Handoff §17, README §28.1). Decisions are behind the DecisionPolicy
// interface (observation-only input; no WorldState — DECISION-004), so PV-3's Decision
// Engine can replace the scripted stand-in.

export * from "./types.js";
export { RoundSimulator } from "./simulator.js";
export type { RoundSimulatorDeps } from "./simulator.js";
export { ScriptedPolicy } from "./policy.js";
export type { ScriptedPolicyOptions } from "./policy.js";
export { makeSyntheticRound, fromPv2Scenario, SYNTHETIC_DEFENSE_ANCHORS } from "./scenario.js";
export type { SyntheticRoundOptions } from "./scenario.js";
export { toRoundReplay, toPv6ReplayFormat, ROUND_REPLAY_VERSION } from "./replay.js";
export type { RoundReplay } from "./replay.js";
export { mulberry32, deriveSeed } from "./rng.js";
