/**
 * @pv/game-rules — patch-versioned VALORANT rule data.
 *
 * IMPORTANT: every numeric rule here is `verified: false` (see rule-value.ts). This
 * Simulation-Core agent did not perform live source verification; the Data agent (PV-2)
 * or a later pass must confirm each value against its cited Riot source and flip the
 * flag. Do not treat an unverified value as fact (README §29).
 */
export * from "./rule-value.js";
export * from "./economy.js";
export * from "./weapons.js";
export * from "./rounds.js";
export * from "./spike.js";
export * from "./ultimate.js";
