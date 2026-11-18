import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  loadDecisionContext,
  validateDecisionContext,
  ScenarioValidationError,
  SCENARIO_ENUMS,
  serializeWorld,
  deserializeWorld,
  getPlayer,
} from "@pv/world-state";
import { asPlayerId } from "@pv/shared-types";

const here = dirname(fileURLToPath(import.meta.url));
const readFixture = (p: string) => JSON.parse(readFileSync(join(here, "fixtures", p), "utf8"));
const scenario01 = () => readFixture("scenarios/scenario_01.json");
const scenario04 = () => readFixture("scenarios/scenario_04.json");

describe("loadDecisionContext (TASK 006)", () => {
  it("reconstructs a WorldState from scenario 01", () => {
    const ctx = loadDecisionContext(scenario01());
    expect(ctx.contextId).toBe("scenario-01-basic-attack");
    expect(ctx.world.players).toHaveLength(10);
    expect(ctx.world.mapId).toBe("ascent");
    expect(ctx.decidingTeamId).toBe("team-0");
    expect(ctx.decidingSide).toBe("attack");
    expect(ctx.coordinateSpace).toBe("minimapUnits");
  });

  it("maps teamIdx to branded TeamId and derives side from attackingTeamIdx", () => {
    const ctx = loadDecisionContext(scenario01());
    const atk = getPlayer(ctx.world, asPlayerId("atk1"))!;
    const def = getPlayer(ctx.world, asPlayerId("def1"))!;
    expect(atk.teamId).toBe("team-0");
    expect(atk.side).toBe("attack");
    expect(def.side).toBe("defense");
  });

  it("converts minimap vector2 to Vector3 (z=0) and loadout to inventory/abilities", () => {
    const ctx = loadDecisionContext(scenario01());
    const atk1 = getPlayer(ctx.world, asPlayerId("atk1"))!;
    expect(atk1.position).toEqual({ x: 500, y: 905, z: 0 });
    expect(atk1.weapon?.weaponId).toBe("operator");
    expect(atk1.inventory.armor.type).toBe("heavy");
    expect(atk1.credits).toBe(400);
    expect(atk1.abilities.ultimate.points).toBe(2);
    expect(atk1.abilities.ultimate.required).toBe(7);
    expect(atk1.abilities.ultimate.ready).toBe(false);
  });

  it("flags the spike carrier's inventory", () => {
    const ctx = loadDecisionContext(scenario01());
    const carrier = getPlayer(ctx.world, asPlayerId("atk1"))!;
    expect(ctx.world.spike.phase).toBe("carried");
    expect(ctx.world.spike.holderId).toBe("atk1");
    expect(carrier.inventory.hasSpike).toBe(true);
  });

  it("retains provenance including the synthetic flag", () => {
    const ctx = loadDecisionContext(scenario01());
    expect(ctx.provenance.synthetic).toBe(true);
    expect(ctx.provenance.evidenceType).toBe("simulated");
    expect(ctx.provenance.verified).toBe(false);
    expect(ctx.provenance.notes.length).toBeGreaterThan(0);
  });

  it("builds observation/belief only from the scenario belief (never ground truth)", () => {
    // Scenario 04 has empty visibleEnemies; the loaded observation must also be empty.
    const ctx = loadDecisionContext(scenario04());
    expect(ctx.observation.visibleEnemies).toHaveLength(0);
    expect(ctx.world.timeRemainingMs).toBe(8000); // time-pressure scenario
  });

  it("is deterministic across repeated loads and serializes round-trip", () => {
    const a = loadDecisionContext(scenario01());
    const b = loadDecisionContext(scenario01());
    expect(a).toEqual(b);
    const restored = deserializeWorld(serializeWorld(a.world));
    expect(restored).toEqual(a.world);
  });
});

describe("validateDecisionContext", () => {
  it("passes valid scenarios", () => {
    expect(validateDecisionContext(scenario01())).toEqual([]);
    expect(validateDecisionContext(scenario04())).toEqual([]);
  });

  it("collects problems for malformed input", () => {
    const bad = { contextId: 5, decidingTeamIdx: 3, worldState: { players: [] } };
    const problems = validateDecisionContext(bad);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes("decidingTeamIdx"))).toBe(true);
  });

  it("throws ScenarioValidationError from loadDecisionContext on invalid input", () => {
    expect(() => loadDecisionContext({ contextId: "x" })).toThrow(ScenarioValidationError);
  });

  it("rejects an invalid map name", () => {
    const s = scenario01();
    s.worldState.mapName = "Nonexistent";
    expect(validateDecisionContext(s).some((p) => p.includes("mapName"))).toBe(true);
  });
});

describe("enum drift guard vs PV-2 schema files", () => {
  const common = () => readFixture("schema/common.schema.json");
  const worldSchema = () => readFixture("schema/world-state.schema.json");

  it("mapName matches common.schema.json", () => {
    expect([...SCENARIO_ENUMS.mapName]).toEqual(common().$defs.mapName.enum);
  });

  it("armorKind and evidenceType match common.schema.json", () => {
    expect([...SCENARIO_ENUMS.armorKind]).toEqual(common().$defs.armorKind.enum);
    expect([...SCENARIO_ENUMS.evidenceType]).toEqual(common().$defs.evidenceType.enum);
  });

  it("roundPhase and spike status match world-state.schema.json", () => {
    const w = worldSchema();
    expect([...SCENARIO_ENUMS.roundPhase]).toEqual(w.$defs.worldState.properties.roundPhase.enum);
    expect([...SCENARIO_ENUMS.spikeStatus]).toEqual(w.$defs.spikeState.properties.status.enum);
  });
});
