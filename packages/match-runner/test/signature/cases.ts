/**
 * Match signatures: a fixed set of short matches whose full `runMatch` output is hashed. A
 * performance change (caching, data-structure swaps) must leave every hash unchanged — the
 * simulation is deterministic, so "faster" may never mean "different".
 *
 * The cases cover the default game (Ascent geometry, real rosters), unseen seeds, agent
 * abilities, the per-player trace paths (tracks, stats), and other maps on their own geometry.
 * Each match is capped at 13 rounds (it crosses the half: side swap, economy reset).
 *
 * Regenerate ONLY when the simulation's behaviour is meant to change:
 *   npx tsx packages/match-runner/test/signature/capture.mts
 */
import { createHash } from "node:crypto";
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../../src/index.js";

export interface SignatureCase {
  readonly id: string;
  readonly config: (teams: ReturnType<typeof simulatableTeamRefs>) => MatchConfig;
}

const pair = (teams: ReturnType<typeof simulatableTeamRefs>, i: number) => ({ teamA: teams[(2 * i) % teams.length]!, teamB: teams[(2 * i + 1) % teams.length]! });
const MAX_ROUNDS = 13;

export const SIGNATURE_CASES: readonly SignatureCase[] = [
  { id: "ascent-seed1", config: (t) => ({ ...pair(t, 0), map: "Ascent", seed: 1, maxRounds: MAX_ROUNDS }) },
  { id: "ascent-seed161", config: (t) => ({ ...pair(t, 7), map: "Ascent", seed: 161, maxRounds: MAX_ROUNDS }) },
  { id: "ascent-abilities", config: (t) => ({ ...pair(t, 3), map: "Ascent", seed: 42, maxRounds: MAX_ROUNDS, enableAbilities: true }) },
  { id: "ascent-tracks-stats", config: (t) => ({ ...pair(t, 5), map: "Ascent", seed: 7, maxRounds: MAX_ROUNDS, recordTracks: true, collectStats: true }) },
  { id: "haven-own", config: (t) => ({ ...pair(t, 2), map: "Haven", seed: 3, maxRounds: MAX_ROUNDS, geometry: "own" }) },
  { id: "bind-own", config: (t) => ({ ...pair(t, 4), map: "Bind", seed: 5, maxRounds: MAX_ROUNDS, geometry: "own" }) },
];

/** Stable JSON: object keys sorted, non-finite numbers spelled out, functions dropped. */
export function stableStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (x: unknown): unknown => {
    if (typeof x === "number") return Number.isFinite(x) ? x : `__${String(x)}`;
    if (typeof x === "function" || x === undefined) return undefined;
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x as object)) return "__cycle";
    seen.add(x as object);
    if (Array.isArray(x)) return x.map(walk);
    if (x instanceof Map) return { __map: [...x.entries()].map(([k, val]) => [walk(k), walk(val)]) };
    if (x instanceof Set) return { __set: [...x].map(walk) };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort()) {
      const w = walk((x as Record<string, unknown>)[k]);
      if (w !== undefined) out[k] = w;
    }
    return out;
  };
  return JSON.stringify(walk(v));
}

export interface Signature { readonly rounds: number; readonly score: string; readonly sha256: string }

export function signatureOf(c: SignatureCase): Signature {
  const m = runMatch(c.config(simulatableTeamRefs()));
  const sha256 = createHash("sha256").update(stableStringify(m)).digest("hex");
  return { rounds: m.rounds.length, score: `${m.score.A}-${m.score.B}`, sha256 };
}
