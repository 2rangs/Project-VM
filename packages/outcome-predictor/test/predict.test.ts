import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { predictOutcomes, heuristicCombatEstimator } from "@pv/outcome-predictor";
import { loadDecisionContext } from "@pv/world-state";
import { buildTeamBelief, enemyPressureOnZone } from "@pv/decision-engine";
import { viewFromTeamContext } from "@pv/team-engine";
import { generateActions, type EvaluatedAction } from "@pv/action-generator";
import type { CombatEstimator, EconomyEvaluator, PolicyView, ZoneId } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();

function setup(): { view: PolicyView; candidates: EvaluatedAction[] } {
  const team = loadDecisionContext(
    JSON.parse(readFileSync(join(here, "fixtures", "scenarios", "scenario_01.json"), "utf8")),
  );
  const belief = buildTeamBelief(team.observation, spatial, { knownEnemyAliveCount: team.knownEnemyAliveCount });
  const gen = generateActions({ team, spatial, enemyPressure: (z) => enemyPressureOnZone(belief, z) });
  return { view: viewFromTeamContext(team), candidates: [...gen.feasible] };
}

// Contact only at a-site, so candidates targeting A trigger a combat lookahead.
const pressure = (z: ZoneId) => (String(z) === "a-site" ? 1 : 0);
const stubCombat: CombatEstimator = { estimateDuelWinProb: () => 0.7 };

describe("Outcome Predictor v0 (README §25)", () => {
  it("runs a combat lookahead for contact candidates within budget", () => {
    const { view, candidates } = setup();
    const r = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, budget: { maxNodes: 100, topK: 10 } });
    expect(r.predictions.length).toBeLessThanOrEqual(10);
    const contact = r.predictions.find((p) => p.projectedWinProb !== null);
    expect(contact).toBeDefined();
    expect(contact!.projectedWinProb).toBe(0.7);
    expect(contact!.usedFallback).toBe(false);
    expect(r.nodesUsed).toBeGreaterThan(0);
  });

  it("falls back to static utility when the compute budget is exceeded (§25.2)", () => {
    const { view, candidates } = setup();
    const r = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, budget: { maxNodes: 0, topK: 10 } });
    expect(r.nodesUsed).toBe(0);
    const contactCandidates = r.predictions.filter((p) =>
      // A-targeting candidates would have had contact; with budget 0 they must fall back.
      p.rationale.join(" ").includes("fallback"),
    );
    expect(contactCandidates.length).toBeGreaterThan(0);
    for (const p of contactCandidates) {
      expect(p.usedFallback).toBe(true);
      expect(p.projectedWinProb).toBeNull();
      // Projected value is just static (+0 economy here).
      expect(p.projectedValue).toBeCloseTo(p.staticUtility, 5);
    }
  });

  it("limits exploration to top-K candidates", () => {
    const { view, candidates } = setup();
    const r = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, budget: { topK: 3 } });
    expect(r.predictions).toHaveLength(3);
  });

  it("is deterministic", () => {
    const { view, candidates } = setup();
    const a = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, budget: { maxNodes: 5, topK: 8 } });
    const b = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, budget: { maxNodes: 5, topK: 8 } });
    expect(a).toEqual(b);
  });

  it("folds economy value into economy-sensitive actions", () => {
    const { view, candidates } = setup();
    const economy: EconomyEvaluator = {
      saveOptions: () => [{ action: "SAVE_WEAPON", currentRoundValue: -0.1, futureValue: 0.8, economicDelta: 2000, ultDelta: 1, explanation: "preserve" }],
      exitKillOptions: () => [],
    };
    const r = predictOutcomes({ candidates, view, spatial, combat: stubCombat, enemyPressure: pressure, economy, budget: { topK: 100 } });
    const save = r.predictions.find((p) => p.actionId === "SAVE");
    expect(save).toBeDefined();
    expect(save!.economyValue).toBeCloseTo((-0.1 + 0.8) / 2, 5);
  });

  it("heuristic combat estimator favors the better weapon", () => {
    const strong = heuristicCombatEstimator.estimateDuelWinProb({
      attackerWeapon: "vandal", defenderWeapon: "classic", attackerHealth: 100, defenderHealth: 100,
      distanceMeters: null, attackerHasCover: false, defenderHasCover: false, attackerFlashed: false, defenderFlashed: false, attackerAim: 0.5, defenderAim: 0.5,
    });
    expect(strong).toBeGreaterThan(0.5);
  });
});
