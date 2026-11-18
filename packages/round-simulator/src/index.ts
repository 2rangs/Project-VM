// PROJECT V — round-simulator public API.
//
// A deterministic fixed-tick 5v5 round loop wiring spatial + perception + combat +
// ability engines (Handoff §17, README §28.1). Decisions go through PV-3's team-level
// DecisionPolicy contract (observation-only PolicyView; no WorldState — DECISION-004),
// mirrored in ./policy-contract.ts.

export * from "./types.js";
export * from "./policy-contract.js";
export { RoundSimulator } from "./simulator.js";
export type { RoundSimulatorDeps } from "./simulator.js";
// Match-level round-execution API (PV-3 Match Runner entry point).
export { runMatchRound } from "./match-round.js";
export type {
  MatchRoundInput,
  MatchRoundOutput,
  MatchRoundTeam,
  MatchRoundPlayer,
  PlayerLoadout,
  RoundAbilityLoadout,
  LoadoutAbilitySlot,
  PlayerRoundOutcome,
} from "./match-round.js";
export { ScriptedPolicy } from "./policy.js";
export type { ScriptedPolicyOptions } from "./policy.js";
export { buildPolicyView, SpatialQueryAdapter, SeededRandomSource, toPerceptionSnapshot } from "./view.js";
export { makeSyntheticRound, fromPv2Scenario, SYNTHETIC_DEFENSE_ANCHORS } from "./scenario.js";
export type { SyntheticRoundOptions } from "./scenario.js";
export { toRoundReplay, toPv6ReplayFormat, ROUND_REPLAY_VERSION } from "./replay.js";
export type { RoundReplay, Pv6SimEventLog, Pv6SimMeta } from "./replay.js";
export { toValidationRun, toSimGameEvents } from "./export.js";
export type { SimRun, SimRunRound, SimGameEvent } from "./export.js";
export { ASCENT_OPENING_DUEL_CALIBRATION } from "./calibration.js";
export { mulberry32, deriveSeed } from "./rng.js";
