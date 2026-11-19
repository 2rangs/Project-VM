import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TeamDecisionPolicy, viewFromTeamContext } from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { ActionCommand, PolicyView, TeamStrategy } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const ZONE = { spawn: { x: 500, y: 905, z: 0 }, aMain: { x: 720, y: 615, z: 0 }, bMain: { x: 280, y: 615, z: 0 }, aSite: { x: 780, y: 360, z: 0 } };

/** Attack view, full buy, mid-round number, nothing observed; every attacker at `at`, first one carries. */
function attackView(at: { x: number; y: number; z: number }, over: Partial<PolicyView> = {}): PolicyView {
  const v = viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", "scenario_01.json"), "utf8"))));
  const teammates = v.teammates.map((p) => ({ ...p, alive: true, position: at }));
  return {
    ...v, roundNumber: 5, timeRemainingMs: 95_000, knownEnemyAliveCount: 5,
    economy: { ...v.economy, credits: 4500 },
    teammates,
    spike: { phase: "carried", position: null, holderId: teammates[0]!.id, detonationInMs: null },
    observation: { ...v.observation, visibleEnemies: [], audibleEvents: [] },
    belief: { ...v.belief, enemyPositionBeliefs: [] },
    ...over,
  };
}
const forced = (strategy: TeamStrategy) => { const p = new TeamDecisionPolicy(spatial); p.setOrder({ strategy }); return p; };
/** Team movement only: where the non-lurker, non-ability commands send players. */
const targets = (cmds: readonly ActionCommand[]) => cmds.filter((c) => c.sourceActionId?.startsWith("plan:") || c.sourceActionId?.startsWith("carrier-commit")).map((c) => `${c.sourceActionId}→${c.targetZone ?? c.aimZone ?? ""}`);

/** A policy whose own opening call is `strategy` (searching seeds; no coach order involved). */
function policyOpening(strategy: TeamStrategy, view: PolicyView): { policy: TeamDecisionPolicy; seed: number } {
  for (let seed = 0; seed < 200; seed++) {
    const policy = new TeamDecisionPolicy(spatial);
    if (policy.decideWithTrace(view, rng(seed)).trace.plan.opening === strategy) return { policy, seed };
  }
  throw new Error(`no seed opens ${strategy}`);
}

describe("the plan decides where the team goes (counterfactual: same state, different call)", () => {
  it("an A execute and a B execute send the same team to different sites", () => {
    const view = attackView(ZONE.spawn);
    const a = policyOpening("aExecute", view).policy.planSummary()!;
    const b = policyOpening("bExecute", view).policy.planSummary()!;
    expect(a.objective).toBe("a-site");
    expect(b.objective).toBe("b-site");
    expect(a.feint).toBeNull();
  });

  it("a fake shows on one site and plants on the other", () => {
    const view = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("fakeAtoB", view);
    const plan = policy.planSummary()!;
    expect(plan.objective).toBe("b-site");
    expect(plan.feint).toBe("a-site");
    // While showing: non-carriers head for A's doorstep; the carrier does not show.
    const showing = new TeamDecisionPolicy(spatial).decide(view, rng(seed)).commands;
    const carrierId = String(view.spike.holderId);
    expect(showing.some((c) => c.sourceActionId === "plan:feint-move" && String(c.playerId) !== carrierId)).toBe(true);
    expect(showing.find((c) => String(c.playerId) === carrierId)?.sourceActionId).not.toMatch(/feint/);
    // After the show window the same plan turns to the real objective.
    const later = policy.decide({ ...view, timeRemainingMs: 60_000 }, rng(seed)).commands;
    expect(later.some((c) => c.sourceActionId?.startsWith("plan:feint"))).toBe(false);
    expect(targets(later).some((t) => t.includes("b-") )).toBe(true);
  });
});

describe("execution phases: stage together, then go", () => {
  it("does not send anyone onto the site before the team is staged, then everyone goes", () => {
    const far = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("aExecute", far);
    const staging = policy.decide({ ...far, timeRemainingMs: 94_000 }, rng(seed)).commands;
    expect(staging.some((c) => c.kind === "move" && c.targetZone === "a-site")).toBe(false);
    expect(staging.some((c) => c.sourceActionId === "plan:stage-move")).toBe(true);
    // Everyone has reached A main (the staging zone): the execute is called.
    const staged = policy.decide(attackView(ZONE.aMain, { timeRemainingMs: 80_000 }), rng(seed)).commands;
    expect(staged.filter((c) => c.kind === "move" && c.targetZone === "a-site").length).toBeGreaterThanOrEqual(3);
  });

  it("the clock forces the execute even if the team never finished staging", () => {
    const view = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("aExecute", view);
    const late = policy.decide({ ...view, timeRemainingMs: 9_000 }, rng(seed)).commands;
    expect(late.some((c) => c.kind === "move" && c.targetZone === "a-site")).toBe(true);
  });

  it("once the execute is called, enemies seen on the site do not make the team leave it", () => {
    const { policy, seed } = policyOpening("aExecute", attackView(ZONE.spawn));
    policy.decide(attackView(ZONE.aMain, { timeRemainingMs: 80_000 }), rng(seed)); // staged → go
    const base = attackView(ZONE.aMain, { timeRemainingMs: 79_500 });
    const enemy = (i: number) => ({ playerId: base.teammates[i]!.id, agentId: null, lastSeenPosition: ZONE.aSite, lastSeenAtMs: base.observation.timestampMs, healthBand: "unknown" as const, observedWeaponId: null, currentlyVisible: true });
    const t = policy.decideWithTrace({ ...base, observation: { ...base.observation, visibleEnemies: [enemy(1), enemy(2), enemy(3)] } }, rng(seed)).trace;
    expect(t.finalStrategy).toBe("aExecute");
    expect(t.plan.objective).toBe("a-site");
    expect(t.reconsiderReason).toMatch(/committed/);
  });
});

describe("slow play: hold, burn clock, commit on evidence", () => {
  it("with no site named the team holds a lane and nobody runs the spike in", () => {
    const view = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("midControl", view);
    const plan = policy.planSummary()!;
    expect(plan.objective).toBeNull();
    const cmds = policy.decide({ ...view, timeRemainingMs: 90_000 }, rng(seed)).commands;
    expect(cmds.some((c) => c.sourceActionId?.startsWith("plan:slow"))).toBe(true);
    expect(cmds.some((c) => c.sourceActionId?.startsWith("carrier-commit"))).toBe(false);
  });

  it("a pick turns the slow play into a hit, and the plan records why", () => {
    const view = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("midControl", view);
    const t = policy.decideWithTrace({ ...view, timeRemainingMs: 85_000, knownEnemyAliveCount: 4 }, rng(seed)).trace;
    expect(t.plan.objective).not.toBeNull();
    expect(t.plan.revisions.at(-1)!.reason).toMatch(/player advantage 5v4/);
  });

  it("without a pick it still commits when the clock runs down — but not before", () => {
    const view = attackView(ZONE.spawn);
    const { policy, seed } = policyOpening("midControl", view);
    expect(policy.decideWithTrace({ ...view, timeRemainingMs: 60_000 }, rng(seed)).trace.plan.objective).toBeNull();
    const t = policy.decideWithTrace({ ...view, timeRemainingMs: 39_000 }, rng(seed)).trace;
    expect(t.plan.objective).not.toBeNull();
    expect(t.plan.revisions.at(-1)!.reason).toMatch(/clock/);
  });
});

describe("the spike", () => {
  it("a dropped spike is recovered by the nearest attacker", () => {
    const view = attackView(ZONE.aMain, { spike: { phase: "carried", position: ZONE.bMain, holderId: null, detonationInMs: null } });
    const cmds = forced("aExecute").decide(view, rng(1)).commands;
    const recover = cmds.filter((c) => c.sourceActionId === "spike-recover");
    expect(recover).toHaveLength(1);
    expect(recover[0]!.targetZone).toBe("b-main");
  });

  it("the carrier plants once it stands on a plantable site", () => {
    const view = attackView(ZONE.aSite);
    const cmds = forced("aExecute").decide(view, rng(1)).commands;
    expect(cmds.find((c) => String(c.playerId) === String(view.spike.holderId))?.kind).toBe("plant");
  });
});
