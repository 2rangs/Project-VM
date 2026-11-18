import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateActions, type GenerationResult } from "@pv/action-generator";
import { loadDecisionContext } from "@pv/world-state";
import { buildTeamBelief, enemyPressureOnZone } from "@pv/decision-engine";
import type { EnemyPressureFn } from "@pv/action-generator";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (s: string) =>
  loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8")));

function run(s: string): GenerationResult {
  const team = load(s);
  const spatial = new AscentSpatialStub();
  const belief = buildTeamBelief(team.observation, spatial, { knownEnemyAliveCount: team.knownEnemyAliveCount });
  const enemyPressure: EnemyPressureFn = (z) => enemyPressureOnZone(belief, z);
  return generateActions({ team, spatial, enemyPressure });
}

const ids = (r: GenerationResult, where: "feasible" | "excluded") =>
  where === "feasible" ? r.feasible.map((a) => a.id) : r.excluded.map((e) => e.candidate.id);

describe("Action Generator (TASK 007)", () => {
  it("scenario 01: generates layered candidates and selects a strategic action", () => {
    const r = run("01");
    expect(r.feasible.length).toBeGreaterThan(0);
    // Strategic executes for both sites are feasible at round start (100s).
    expect(ids(r, "feasible")).toContain("A_EXECUTE");
    expect(ids(r, "feasible")).toContain("B_EXECUTE");
    expect(ids(r, "feasible")).toContain("MID_CONTROL");
    // Individual layer present too.
    expect(r.feasible.some((a) => a.category === "individual")).toBe(true);
    // Selected is a feasible strategic action with an explanation.
    expect(r.selected).not.toBeNull();
    expect(r.selected!.category).toBe("strategic");
    expect(r.selectionRationale).toContain(r.selected!.id);
  });

  it("every feasible action carries the §19 evaluation outputs", () => {
    const r = run("01");
    for (const a of r.feasible) {
      expect(a.feasibility.feasible).toBe(true);
      expect(typeof a.evaluation.requiredTimeMs).toBe("number");
      expect(a.evaluation.estimatedRisk).toBeGreaterThanOrEqual(0);
      expect(a.evaluation.estimatedRisk).toBeLessThanOrEqual(1);
      expect(typeof a.evaluation.expectedUtility).toBe("number");
      expect(a.evaluation.rationale.length).toBeGreaterThan(0);
    }
  });

  it("scenario 04 (time pressure): B execute is excluded as infeasible, A execute feasible", () => {
    const r = run("04");
    expect(ids(r, "feasible")).toContain("A_EXECUTE");
    expect(ids(r, "excluded")).toContain("B_EXECUTE");
    const bExec = r.excluded.find((e) => e.candidate.id === "B_EXECUTE")!;
    expect(bExec.reasons).toContain("insufficientTime");
  });

  it("scenario 05 (plant): the carrier on A site can plant", () => {
    const r = run("05");
    const plant = r.feasible.find((a) => a.id === "PLANT@atk1");
    expect(plant).toBeDefined();
    expect(plant!.feasibility.feasible).toBe(true);
  });

  it("scenario 04: plant is rejected off a plantable zone (carrier at A main, not a site)", () => {
    const r = run("04");
    const plant = r.excluded.find((e) => e.candidate.id === "PLANT@atk1");
    expect(plant).toBeDefined();
    expect(plant!.reasons).toContain("blocked");
  });

  it("generates individual actions (hold/move/save) for each alive player", () => {
    const r = run("01");
    expect(ids(r, "feasible").filter((id) => id.startsWith("HOLD@")).length).toBe(5);
    expect(ids(r, "feasible").some((id) => id.startsWith("SAVE_RETREAT@"))).toBe(true);
  });

  it("delegates SAVE/EXIT_KILL valuation to an EconomyEvaluator when supplied", () => {
    const team = load("07"); // 1v4 operator save
    const spatial = new AscentSpatialStub();
    const belief = buildTeamBelief(team.observation, spatial, { knownEnemyAliveCount: team.knownEnemyAliveCount });
    const economy = {
      saveValue: () => 0.95,
      exitKillValue: () => 0.1,
      hasFutureRounds: () => true,
    };
    const r = generateActions({ team, spatial, enemyPressure: (z) => enemyPressureOnZone(belief, z), economy });
    const save = r.feasible.find((a) => a.id === "SAVE")!;
    expect(save).toBeDefined();
    // Base value now comes from the evaluator (0.95), so utility is high and rationale cites it.
    expect(save.evaluation.rationale.join(" ")).toContain("economy-engine");
    expect(save.evaluation.expectedUtility).toBeGreaterThan(0.5);
  });

  it("without an EconomyEvaluator, SAVE rationale marks the valuation as delegated/provisional", () => {
    const r = run("07");
    const save = r.feasible.find((a) => a.id === "SAVE")!;
    expect(save.evaluation.rationale.join(" ")).toMatch(/delegated to economy-engine/i);
  });

  it("is deterministic: identical input yields identical result", () => {
    expect(run("01")).toEqual(run("01"));
  });

  it("feasible actions are sorted by expected utility (desc)", () => {
    const r = run("01");
    for (let i = 1; i < r.feasible.length; i++) {
      expect(r.feasible[i - 1]!.evaluation.expectedUtility).toBeGreaterThanOrEqual(
        r.feasible[i]!.evaluation.expectedUtility,
      );
    }
  });
});
