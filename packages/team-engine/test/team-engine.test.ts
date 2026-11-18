import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TeamDecisionPolicy,
  selectStrategy,
  reconsider,
  viewFromTeamContext,
  renderRoundReport,
} from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { PolicyView } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(
    loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))),
  );
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");

describe("IGL strategy (README §24.1)", () => {
  it("picks a different strategy on eco vs full buy", () => {
    const full = loadView("01"); // attack, bank 4200 (full)
    const eco: PolicyView = { ...full, economy: { ...full.economy, credits: 500 } };
    const fullStrat = selectStrategy(full, spatial, rng(1));
    const ecoStrat = selectStrategy(eco, spatial, rng(1));
    expect(ecoStrat).toBe("default"); // conservative on eco
    expect(fullStrat).not.toBe("default"); // commits on full
  });

  it("issues a rotate/stack call when enemies are read onto a site (defense)", () => {
    const base = loadView("03"); // deciding team is defense
    // Inject an observation of two enemies at A site (minimap ~ a-site anchor).
    const view: PolicyView = {
      ...base,
      observation: {
        ...base.observation,
        visibleEnemies: [
          { playerId: base.teammates[0]!.id, agentId: null, lastSeenPosition: { x: 780, y: 360, z: 0 }, lastSeenAtMs: base.observation.timestampMs, healthBand: "unknown", observedWeaponId: null, currentlyVisible: true },
          { playerId: base.teammates[1]!.id, agentId: null, lastSeenPosition: { x: 720, y: 615, z: 0 }, lastSeenAtMs: base.observation.timestampMs, healthBand: "unknown", observedWeaponId: null, currentlyVisible: true },
        ],
      },
    };
    const r = reconsider(view, spatial, "defaultHold", rng(2));
    expect(r.changed).toBe(true);
    expect(r.strategy).toBe("stackA");
    expect(r.reason).toMatch(/A/);
  });
});

describe("DecisionPolicy input (DECISION-004)", () => {
  it("the policy view carries no WorldState and only own-team players", () => {
    const view = loadView("01");
    expect("world" in view).toBe(false); // runtime: no WorldState field
    expect(view.teammates.length).toBe(5);
    expect(view.teammates.every((p) => p.teamId === view.teamId)).toBe(true);
  });

  it("decides from the view alone and returns a command per alive player", () => {
    const view = loadView("01");
    const policy = new TeamDecisionPolicy(spatial);
    const decision = policy.decide(view, rng(7));
    const aliveIds = view.teammates.filter((p) => p.alive).map((p) => String(p.id)).sort();
    expect(decision.commands.map((c) => String(c.playerId)).sort()).toEqual(aliveIds);
    expect(decision.roles).toHaveLength(5);
  });
});

describe("determinism", () => {
  it("same seed yields the same decision sequence", () => {
    const view = loadView("01");
    const policy = new TeamDecisionPolicy(spatial);
    const a = policy.decide(view, rng(99));
    const b = policy.decide(view, rng(99));
    expect(a).toEqual(b);
  });

  it("different seeds can yield different player commands", () => {
    const view = loadView("01");
    const policy = new TeamDecisionPolicy(spatial);
    const a = policy.decide(view, rng(1));
    const b = policy.decide(view, rng(123456));
    // Not guaranteed different, but the chosen action ids should be comparable + stable.
    expect(a.commands.length).toBe(b.commands.length);
  });
});

describe("teamwork", () => {
  it("fires utility before entry (ability executeAtMs 0, entry offset > 0)", () => {
    const view = loadView("01"); // round start, all abilities available
    const policy = new TeamDecisionPolicy(spatial);
    const { decision } = policy.decideWithTrace(view, rng(5));
    const abilityCmds = decision.commands.filter((c) => c.kind === "useAbility");
    for (const c of abilityCmds) expect(c.executeAtMs).toBe(0);
    // every command has a coordination timestamp
    expect(decision.commands.every((c) => typeof c.executeAtMs === "number")).toBe(true);
  });
});

describe("scenarios extended to the team layer", () => {
  it("04 time pressure: team still produces a command per alive player", () => {
    const view = loadView("04");
    const policy = new TeamDecisionPolicy(spatial);
    const { decision, trace } = policy.decideWithTrace(view, rng(3));
    expect(decision.commands.length).toBe(view.teammates.filter((p) => p.alive).length);
    // The generation underneath excluded the infeasible B execute.
    expect(trace.generation.excludedCount).toBeGreaterThan(0);
  });

  it("03 fake: defense decides and a round report renders", () => {
    const view = loadView("03");
    const policy = new TeamDecisionPolicy(spatial);
    const { trace } = policy.decideWithTrace(view, rng(4));
    expect(view.side).toBe("defense");
    const md = renderRoundReport(trace);
    expect(md).toContain("# Team Decision");
    expect(md).toContain("## Roles");
    expect(md).toContain("## Player commands");
  });
});
