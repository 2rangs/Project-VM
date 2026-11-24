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
  lanchesterWinChance,
  throwChance,
  DEFAULT_POLICY_TUNING,
} from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { PolicyView, WeaponId } from "@pv/shared-types";
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
    const full = { ...loadView("01"), roundNumber: 5 }; // attack, bank 4200 (full); not a pistol round
    const eco: PolicyView = { ...full, economy: { ...full.economy, credits: 500 } };
    const fullStrat = selectStrategy(full, spatial, rng(1));
    const ecoStrat = selectStrategy(eco, spatial, rng(1));
    expect(ecoStrat).toBe("default"); // conservative on eco
    expect(fullStrat).not.toBe("default"); // commits on full
    // A pistol round is not an eco: both sides are equally poor.
    expect(selectStrategy({ ...eco, roundNumber: 1 }, spatial, rng(1))).not.toBe("default");
  });

  it("a partial buy (the match economy's force / half call) plays for picks on attack", () => {
    const full = { ...loadView("01"), roundNumber: 5 };
    const call = (buyCall: string) => selectStrategy({ ...full, economy: { ...full.economy, buyCall } }, spatial, rng(1));
    expect(call("force")).toBe("default");
    expect(call("half")).toBe("default");
    expect(call("eco")).toBe("default");
    expect(call("full")).not.toBe("default"); // a full buy commits
    expect(call("bonus")).not.toBe("default"); // a bonus round plays on its kept guns
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
    // The threshold-based reconsider no longer makes this call: the policy reads the evidence as a
    // belief (hit-belief.ts) and rotates in proportion, recording the reason on the plan.
    expect(reconsider(view, spatial, "defaultHold", rng(2)).changed).toBe(false);
    const { trace } = new TeamDecisionPolicy(spatial).decideWithTrace(view, rng(2));
    expect(trace.finalStrategy).toBe("stackA");
    expect(trace.plan.revisions.at(-1)!.reason).toMatch(/2 seen on A.*P\(hit A\)/);
    expect(trace.evidence.hitBelief!.hit["A"]).toBeGreaterThan(0.5);
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
    // Same seed AND same state: the policy carries a standing plan, so each run starts fresh.
    const a = new TeamDecisionPolicy(spatial).decide(view, rng(99));
    const b = new TeamDecisionPolicy(spatial).decide(view, rng(99));
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

describe("coach orders (tactical timeouts)", () => {
  it("a forced strategy order overrides the IGL's own pick", () => {
    const view = loadView("01");
    const policy = new TeamDecisionPolicy(spatial);
    const ownStrat = policy.decideWithTrace(view, rng(1)).trace.finalStrategy;
    policy.setOrder({ strategy: "midControl" });
    const { trace } = policy.decideWithTrace(view, rng(1));
    expect(trace.finalStrategy).toBe("midControl");
    expect(trace.reconsiderReason).toContain("order");
    // Clearing the order restores the IGL's own selection.
    policy.setOrder(null);
    expect(policy.decideWithTrace(view, rng(1)).trace.finalStrategy).toBe(ownStrat);
  });

  it("an order pins the entry role", () => {
    const view = loadView("01");
    const policy = new TeamDecisionPolicy(spatial);
    const pid = String(view.teammates[0]!.id);
    policy.setOrder({ roles: { entry: pid } });
    const { trace } = policy.decideWithTrace(view, rng(1));
    expect(trace.roles.find((r) => String(r.playerId) === pid)?.role).toBe("entry");
  });
});

describe("post-plant retake vs save (Lanchester)", () => {
  const A_SITE = { x: 780, y: 360, z: 0 };
  /** Defense view with the spike planted on A; only the first `alive` defenders are alive (at A main). */
  const postPlant = (alive: number, attackers: number, detonationInMs: number): PolicyView => {
    const base = loadView("03"); // deciding team is defense
    return {
      ...base,
      teammates: base.teammates.map((p, i) => ({ ...p, alive: i < alive, position: { x: 720, y: 615, z: 0 } })),
      spike: { phase: "planted", position: A_SITE, holderId: null, detonationInMs },
      knownEnemyAliveCount: attackers,
    };
  };
  const decide = (v: PolicyView, policy = new TeamDecisionPolicy(spatial)) => policy.decide(v, rng(5)).commands;
  const isSave = (cmds: ReturnType<typeof decide>) => cmds.length > 0 && cmds.every((c) => c.sourceActionId?.startsWith("postplant-save"));

  it("square law: strength grows with the square of the numbers", () => {
    expect(lanchesterWinChance(3, 3)).toBeCloseTo(0.5);
    expect(lanchesterWinChance(1, 2)).toBeCloseTo(0.2);
    expect(lanchesterWinChance(1, 3)).toBeCloseTo(0.1);
    expect(lanchesterWinChance(2, 5)).toBeCloseTo(4 / 29);
    expect(lanchesterWinChance(4, 2)).toBeGreaterThan(lanchesterWinChance(3, 2));
  });

  it("retakes a winnable post-plant as a group: stage first, never save", () => {
    const cmds = decide(postPlant(2, 2, 40_000));
    expect(isSave(cmds)).toBe(false);
    expect(cmds.every((c) => /^(retake-|defuser-commit|throw:)/.test(c.sourceActionId ?? ""))).toBe(true);
  });

  it("a lone defender retakes 1v2 but saves 1v3 (win chance 0.20 vs 0.10)", () => {
    expect(isSave(decide(postPlant(1, 2, 40_000)))).toBe(false);
    const cmds = decide(postPlant(1, 3, 40_000));
    expect(cmds).toHaveLength(1);
    expect(isSave(cmds)).toBe(true);
    expect(cmds[0]!.kind).not.toBe("defuse");
  });

  it("two defenders retake 2v4 but save 2v5", () => {
    expect(isSave(decide(postPlant(2, 4, 40_000)))).toBe(false);
    expect(isSave(decide(postPlant(2, 5, 40_000)))).toBe(true);
  });

  it("a hero-play profile still takes the 1v3", () => {
    const view = postPlant(1, 3, 40_000);
    const id = view.teammates[0]!.id;
    const policy = new TeamDecisionPolicy(spatial);
    policy.setProfiles(new Map([[String(id), { playerId: id, aggression: 0.9, discipline: 0.5, decisionMaking: 0.5, teamwork: 0.5 }]]));
    expect(isSave(decide(view, policy))).toBe(false);
  });

  it("saves when travel + full defuse cannot beat the detonation timer", () => {
    expect(isSave(decide(postPlant(3, 1, 6_000)))).toBe(true);
  });

  it("the save call is sticky until the man count is level again", () => {
    const policy = new TeamDecisionPolicy(spatial);
    expect(isSave(decide(postPlant(1, 3, 40_000), policy))).toBe(true);
    expect(isSave(decide(postPlant(1, 2, 39_500), policy))).toBe(true); // one pick does not reopen it
    expect(isSave(decide(postPlant(1, 1, 39_000), policy))).toBe(false);
  });
});

describe("throws (proportional hazard)", () => {
  const neutral = { aggression: 0.5, discipline: 0.5, decisionMaking: 0.5 };
  it("neutral profile: p = 1 − exp(−λ₀·Δt)", () => {
    expect(throwChance(neutral, 0.5)).toBeCloseTo(1 - Math.exp(-DEFAULT_POLICY_TUNING.throwRatePerSec * 0.5), 10);
  });
  it("aggressive, undisciplined, poor decision makers throw more; the composed throw less", () => {
    const wild = throwChance({ aggression: 0.9, discipline: 0.3, decisionMaking: 0.3 }, 0.5);
    const calm = throwChance({ aggression: 0.3, discipline: 0.9, decisionMaking: 0.9 }, 0.5);
    expect(wild).toBeGreaterThan(throwChance(neutral, 0.5) * 5);
    expect(calm).toBeLessThan(throwChance(neutral, 0.5) / 5);
  });
  it("a minimum throw rate floors even the most composed player, and never lowers a wild one", () => {
    const calm = { aggression: 0.3, discipline: 0.9, decisionMaking: 0.9 };
    const wild = { aggression: 0.9, discipline: 0.3, decisionMaking: 0.3 };
    expect(throwChance(calm, 0.5, DEFAULT_POLICY_TUNING, 0.05)).toBeCloseTo(1 - Math.exp(-0.05 * 0.5), 10);
    expect(throwChance(wild, 0.5, DEFAULT_POLICY_TUNING, 0.0001)).toBe(throwChance(wild, 0.5));
  });
  it("the base rate is a pre-match option", () => {
    const off = { ...DEFAULT_POLICY_TUNING, throwRatePerSec: 0 };
    expect(throwChance(neutral, 0.5, off)).toBe(0);
  });
  it("retake threshold is a pre-match option: a cautious team saves a 2v3", () => {
    const base = loadView("03");
    const view: PolicyView = {
      ...base,
      teammates: base.teammates.map((p, i) => ({ ...p, alive: i < 2, position: { x: 720, y: 615, z: 0 } })),
      spike: { phase: "planted", position: { x: 780, y: 360, z: 0 }, holderId: null, detonationInMs: 40_000 },
      knownEnemyAliveCount: 3,
    };
    const saves = (policy: TeamDecisionPolicy) =>
      policy.decide(view, rng(5)).commands.every((c) => c.sourceActionId?.startsWith("postplant-save"));
    expect(saves(new TeamDecisionPolicy(spatial))).toBe(false); // 4/13 ≈ 0.31 ≥ 0.15
    const cautious = new TeamDecisionPolicy(spatial);
    cautious.setTuning({ retakeMinWinChance: 0.4 });
    expect(saves(cautious)).toBe(true);
  });
});

describe("close-range guns hold up close (eco shotgun)", () => {
  it("a defender with a shotgun holds its angle up close; rifle holders do not", () => {
    const base = loadView("03"); // defense, before the plant
    const view: PolicyView = { ...base, teammates: base.teammates.map((t, i) => (i === 0 ? { ...t, weapon: { ...t.weapon!, weaponId: "bucky" as WeaponId } } : t)) };
    const policy = new TeamDecisionPolicy(spatial, { weaponFullDamageRangeM: (id) => (id === "bucky" ? 8 : 50) });
    let closeHolds = 0;
    for (const seed of [1, 2, 3]) {
      for (const c of policy.decide(view, rng(seed)).commands) {
        if (c.holdClose) {
          expect(String(c.playerId)).toBe(String(view.teammates[0]!.id));
          closeHolds++;
        }
      }
    }
    expect(closeHolds).toBeGreaterThan(0);
    // Without the range lookup nobody holds close.
    const plain = new TeamDecisionPolicy(spatial).decide(view, rng(1)).commands;
    expect(plain.some((c) => c.holdClose)).toBe(false);
  });
});
