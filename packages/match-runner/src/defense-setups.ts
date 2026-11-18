/**
 * Defender setup diversification (PV-2 `datasets/synthetic/setups/ascent-defense.json`).
 *
 * The synthetic round previously spawned defenders 2-2-1 at a-site/b-site/mid, so a 5-man attack
 * funnel met only 2 site defenders (a 5v2 that favours attack ~0.62 regardless of policy —
 * HARNESS_REALISM_AUDIT). PV-2 provides realistic VCT defense setups; we pick one per round
 * (seed-weighted, deterministic) and place each defender on its setup zone, so attackers meet
 * resistance at the entries. Applied with abilities both OFF and ON.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { deriveSeed } from "@pv/round-simulator";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

interface RawDefender {
  readonly zoneId: string;
  readonly role?: string;
  readonly abilityId?: string;
}
interface RawSetup {
  readonly id: string;
  readonly weight?: number;
  readonly defenders: Record<string, RawDefender>;
}

export interface DefenseSetup {
  readonly id: string;
  /** def1..def5 spawn zone ids, in order. */
  readonly spawns: readonly string[];
  /** def1..def5 util agent (from abilityId prefix) or null. */
  readonly agents: readonly (string | null)[];
}

let CACHE: DefenseSetup[] | null = null;

function load(): DefenseSetup[] {
  if (CACHE) return CACHE;
  const raw = JSON.parse(
    readFileSync(resolve(repoRoot, "datasets/synthetic/setups/ascent-defense.json"), "utf8"),
  ) as { setups: RawSetup[] };
  CACHE = raw.setups.map((s): DefenseSetup => {
    const order = ["def1", "def2", "def3", "def4", "def5"];
    return {
      id: s.id,
      spawns: order.map((k) => s.defenders[k]?.zoneId ?? "defender-spawn"),
      agents: order.map((k) => {
        const ab = s.defenders[k]?.abilityId;
        return ab ? (ab.split(":")[0] ?? null) : null;
      }),
    };
  });
  return CACHE;
}

/** Pick a setup for a round, weighted by `weight`, deterministic in the match seed + round. */
export function selectDefenseSetup(matchSeed: number, roundNumber: number): DefenseSetup {
  const setups = load();
  const raw = JSON.parse(
    readFileSync(resolve(repoRoot, "datasets/synthetic/setups/ascent-defense.json"), "utf8"),
  ) as { setups: RawSetup[] };
  const weights = raw.setups.map((s) => Math.max(1, s.weight ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const r = deriveSeed(matchSeed, `defense-setup:${roundNumber}`) % total;
  let acc = 0;
  for (let i = 0; i < setups.length; i++) {
    acc += weights[i]!;
    if (r < acc) return setups[i]!;
  }
  return setups[0]!;
}
