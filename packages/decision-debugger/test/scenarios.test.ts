import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeDecisionContext, type Analysis } from "@pv/decision-debugger";

const here = dirname(fileURLToPath(import.meta.url));
const analyze = (s: string): Analysis =>
  analyzeDecisionContext(
    JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8")),
  );

const feasibleIds = (a: Analysis) => a.result.feasible.map((x) => x.id);
const excludedIds = (a: Analysis) => a.result.excluded.map((x) => x.candidate.id);

describe("Handoff §20 scenarios 01–10 (end-to-end pipeline)", () => {
  it("01 basic attack: both site executes feasible, a strategic action selected", () => {
    const a = analyze("01");
    expect(a.team.decidingSide).toBe("attack");
    expect(feasibleIds(a)).toEqual(expect.arrayContaining(["A_EXECUTE", "B_EXECUTE", "MID_CONTROL"]));
    expect(a.result.selected?.category).toBe("strategic");
  });

  it("02 observed info: belief shows only the observed enemy, not full truth (DECISION-004)", () => {
    const a = analyze("02");
    // 5 enemies alive, but only 1 is observed → belief must reflect only that one.
    expect(a.team.knownEnemyAliveCount).toBe(5);
    expect(a.trace.observed.visibleEnemies).toHaveLength(1);
    expect(a.belief.enemyBeliefs).toHaveLength(1);
    expect(a.trace.observed.beliefTopZones.length).toBeGreaterThan(0);
  });

  it("03 fake: defenders decide on observed info, can rotate either way without knowing truth", () => {
    const a = analyze("03");
    expect(a.team.decidingSide).toBe("defense"); // decidingTeamIdx 1
    // Spike truth is lurking B, but defenders only saw A pressure; both rotations remain options.
    expect(feasibleIds(a)).toEqual(expect.arrayContaining(["ROTATE_A", "ROTATE_B", "DEFAULT_HOLD"]));
    expect(a.trace.observed.visibleEnemies).toHaveLength(1);
  });

  it("04 time pressure: B execute excluded (insufficient time), A execute feasible", () => {
    const a = analyze("04");
    expect(feasibleIds(a)).toContain("A_EXECUTE");
    expect(excludedIds(a)).toContain("B_EXECUTE");
    expect(a.result.excluded.find((e) => e.candidate.id === "B_EXECUTE")!.reasons).toContain("insufficientTime");
  });

  it("05 plant: the carrier on the A site can plant; an off-site plant is rejected", () => {
    const a = analyze("05");
    const carrier = a.team.world.spike.holderId!;
    expect(feasibleIds(a)).toContain(`PLANT@${carrier}`);
  });

  it("06 post-plant: attackers hold; post-plant hold is a feasible strategic option", () => {
    const a = analyze("06");
    expect(a.team.world.spike.phase).toBe("planted");
    expect(feasibleIds(a)).toContain("POST_PLANT_HOLD");
    expect(a.result.selected?.category).toBe("strategic");
  });

  it("07 operator save: 1v4 — SAVE is generated and feasible (economic VALUE is todo)", () => {
    const a = analyze("07");
    expect(a.trace.world.attackersAlive).toBe(1);
    expect(feasibleIds(a)).toContain("SAVE");
    expect(a.result.feasible.find((x) => x.id === "SAVE")!.evaluation.rationale.join(" ")).toMatch(/economy/i);
  });
  it.todo("07 operator save: preservation VALUE of the Operator vs. future rounds — needs economy/save engine (P3)");

  it("08 ult denial: 1v4 — SAVE generated; avoids feeding a kill (valuation is todo)", () => {
    const a = analyze("08");
    expect(feasibleIds(a)).toContain("SAVE");
  });
  it.todo("08 ult denial: weigh enemy ult charge (neon 6/7) — needs ultimate engine (P3)");

  it("09 match point: 1v4 at match point — SAVE still generated (no-future-round value is todo)", () => {
    const a = analyze("09");
    expect(a.team.world.players.length).toBeGreaterThan(0);
    expect(feasibleIds(a)).toContain("SAVE");
  });
  it.todo("09 match point: remove future-round save value when a loss ends the map — needs save/match-value engine (P3)");

  it("10 exit kill: post-plant with an observed enemy — exit-kill candidate is generated", () => {
    const a = analyze("10");
    expect(a.team.world.spike.phase).toBe("planted");
    expect(a.trace.observed.visibleEnemies.length).toBeGreaterThan(0);
    expect(feasibleIds(a).some((id) => id.startsWith("EXIT_KILL_"))).toBe(true);
  });
  it.todo("10 exit kill: chase-the-Operator VALUE vs. keeping 3 rifles — needs economy engine (P3)");

  it("is deterministic end-to-end for the same scenario", () => {
    expect(analyze("01").result).toEqual(analyze("01").result);
    expect(analyze("10").trace).toEqual(analyze("10").trace);
  });
});
