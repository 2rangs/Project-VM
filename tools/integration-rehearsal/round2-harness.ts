import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "@pv/round-simulator";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "../../round-simulator/test/fixtures/setup.ts";
import { TeamDecisionPolicy } from "@pv/team-engine";
import { spatialQueryFromEngine } from "@pv/integration-adapters";
import type { PolicyView, PlayerState, DecisionPolicy, RandomSource } from "@pv/shared-types";

const spatial = loadSpatial();
const weapons = loadWeapons();
// Decided frame: world units internally → identity transform (sim positions are game uu).
const sq = spatialQueryFromEngine(spatial, { minimapToGame: (v) => ({ x: v.x, y: v.y }) });

// Backfill teammate fields the sim's perception subset omits (F3/#3 finding), so PV-3's
// policy — which reads abilities/inventory — can run against the current round-simulator.
function normalizeView(view: PolicyView): PolicyView {
  const teammates = view.teammates.map((p): PlayerState => ({
    ...p,
    weapon: p.weapon ?? null,
    inventory: p.inventory ?? { primary: null, secondary: null, armor: { type: "none", points: p.armor ?? 0 }, hasSpike: false },
    abilities: p.abilities ?? { basic: [], signature: null, ultimate: { abilityId: `${p.agentId}:x` as never, points: p.ultimatePoints ?? 0, required: 7, ready: false } },
    credits: p.credits ?? 0,
    ultimatePoints: p.ultimatePoints ?? 0,
    velocity: p.velocity ?? { x: 0, y: 0, z: 0 },
    behaviorState: p.behaviorState ?? "idle",
    currentOrderId: p.currentOrderId ?? null,
  }));
  return { ...view, teammates };
}
// Wrap PV-3's TeamDecisionPolicy so it tolerates the sim's current teammate subset.
class WrappedTeamPolicy implements DecisionPolicy {
  private readonly inner = new TeamDecisionPolicy(sq);
  decide(view: PolicyView, rng: RandomSource) { return this.inner.decide(normalizeView(view), rng); }
}

const hash = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
function run(policyKind: "scripted" | "team", seeds: number) {
  let atk = 0; const reasons: Record<string, number> = {};
  for (let s = 1; s <= seeds; s++) {
    const policies = policyKind === "scripted"
      ? { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) }
      : { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() };
    const r = new RoundSimulator({ spatial, weapons, abilities: NO_ABILITIES, policies, config: { seed: s } }).runRound(makeSyntheticRound(spatial));
    if (r.winner === "attack") atk++;
    reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  }
  return { atk, seeds, reasons };
}

describe("Rehearsal round 2: PV-3 TeamDecisionPolicy ↔ aligned round-simulator", () => {
  it("TeamDecisionPolicy drives a full round to a terminal state", () => {
    const r = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() }, config: { seed: 1 },
    }).runRound(makeSyntheticRound(spatial));
    expect(["attack", "defense"]).toContain(r.winner);
    expect(r.events[0].kind).toBe("roundStart");
  });
  it("is deterministic (same seed → identical EventLog)", () => {
    const a = new RoundSimulator({ spatial, weapons, abilities: NO_ABILITIES, policies: { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() }, config: { seed: 5 } }).runRound(makeSyntheticRound(spatial));
    const b = new RoundSimulator({ spatial, weapons, abilities: NO_ABILITIES, policies: { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() }, config: { seed: 5 } }).runRound(makeSyntheticRound(spatial));
    expect(hash(a.events)).toBe(hash(b.events));
  });
  it("COMPARISON scripted vs TeamDecisionPolicy over 20 seeds", () => {
    const scripted = run("scripted", 20);
    const team = run("team", 20);
    console.log(`[cmp scripted] attackWin=${scripted.atk}/20 reasons=${JSON.stringify(scripted.reasons)}`);
    console.log(`[cmp team]     attackWin=${team.atk}/20 reasons=${JSON.stringify(team.reasons)}`);
    expect(team.seeds).toBe(20);
  });
});
