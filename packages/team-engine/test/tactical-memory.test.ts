import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OpponentModel, Tendency, TeamDecisionPolicy, selectStrategy, tendencyLean, viewFromTeamContext,
  type OpponentRead,
} from "@pv/team-engine";
import { enemySiteBias } from "../src/igl.js";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { PolicyView, TeamStrategy } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");

/** Opening-call distribution over many seeds for one view + (optional) opponent read. */
function openingMix(view: PolicyView, read?: OpponentRead, n = 400): Record<string, number> {
  const mix: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const s = selectStrategy(view, spatial, rng(i), read);
    mix[s] = (mix[s] ?? 0) + 1 / n;
  }
  return mix;
}
const share = (mix: Record<string, number>, ...keys: TeamStrategy[]) => keys.reduce((s, k) => s + (mix[k] ?? 0), 0);

/** A full-buy view with nothing seen or heard yet (round start). */
function blank(scenario: string): PolicyView {
  const v = loadView(scenario);
  return {
    ...v,
    economy: { ...v.economy, credits: 4500 },
    observation: { ...v.observation, visibleEnemies: [], audibleEvents: [] },
    belief: { ...v.belief, enemyPositionBeliefs: [] },
  };
}

describe("opponent model — Dirichlet tendency with decay", () => {
  it("no data: even split, zero confidence, zero lean", () => {
    const est = new Tendency(["A", "B"] as const).estimate();
    expect(est.probability.A).toBeCloseTo(0.5);
    expect(est.confidence).toBe(0);
    expect(tendencyLean(est, "A")).toBe(0);
  });

  it("one observation barely moves it; repeated observations build confidence without certainty", () => {
    const one = new Tendency(["A", "B"] as const);
    one.observe("A");
    const many = new Tendency(["A", "B"] as const);
    for (let i = 0; i < 8; i++) many.observe("A");
    expect(tendencyLean(one.estimate(), "A")).toBeGreaterThan(0);
    expect(tendencyLean(one.estimate(), "A")).toBeLessThan(0.15);
    expect(tendencyLean(many.estimate(), "A")).toBeGreaterThan(tendencyLean(one.estimate(), "A") * 3);
    expect(many.estimate().probability.A).toBeLessThan(1);
    expect(many.estimate().confidence).toBeLessThan(1);
  });

  it("old habits fade: after the opponent switches sites the read follows", () => {
    const t = new Tendency(["A", "B"] as const);
    for (let i = 0; i < 6; i++) t.observe("A");
    expect(tendencyLean(t.estimate(), "A")).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) t.observe("B");
    expect(tendencyLean(t.estimate(), "A")).toBeLessThan(0);
  });

  it("a sharper team (pattern recognition) trusts the same evidence sooner", () => {
    const feed = (m: OpponentModel) => { for (let i = 0; i < 3; i++) m.observeRound({ opponentSide: "attack", plantSite: "B" }); return m.read().attackSite; };
    const sharp = feed(new OpponentModel(0.95));
    const dull = feed(new OpponentModel(0.25));
    expect(sharp.confidence).toBeGreaterThan(dull.confidence);
    expect(tendencyLean(sharp, "B")).toBeGreaterThan(tendencyLean(dull, "B"));
  });

  it("only observed facts teach: a round with no plant and no contact changes nothing", () => {
    const m = new OpponentModel();
    m.observeRound({ opponentSide: "attack", plantSite: null, firstContactSite: null });
    expect(m.read().attackSite.samples).toBe(0);
    m.observeRound({ opponentSide: "attack", plantSite: null, firstContactSite: "A" }); // unconfirmed → half weight
    expect(m.read().attackSite.samples).toBeCloseTo(0.5);
  });
});

describe("memory changes the opening call (counterfactual: same view, with vs without memory)", () => {
  it("defense: an opponent that kept hitting B gets a B-leaning setup; without memory it does not", () => {
    const view = blank("03"); // defense
    const model = new OpponentModel();
    for (let i = 0; i < 6; i++) model.observeRound({ opponentSide: "attack", plantSite: "B" });
    const without = openingMix(view);
    const withMemory = openingMix(view, model.read());
    expect(share(without, "stackB")).toBe(0);
    expect(share(withMemory, "stackB")).toBeGreaterThan(0.2);
    expect(share(withMemory, "stackA")).toBe(0);
    // Never a certainty: the default hold is still on the table.
    expect(share(withMemory, "defaultHold")).toBeGreaterThan(0.2);
  });

  it("defense: a single round of evidence shifts the setup far less than six", () => {
    const view = blank("03");
    const one = new OpponentModel();
    one.observeRound({ opponentSide: "attack", plantSite: "B" });
    const six = new OpponentModel();
    for (let i = 0; i < 6; i++) six.observeRound({ opponentSide: "attack", plantSite: "B" });
    expect(share(openingMix(view, one.read()), "stackB")).toBeLessThan(share(openingMix(view, six.read()), "stackB") / 2);
  });

  it("attack: defenders repeatedly found on A push the executes toward B, and fakes toward A", () => {
    const view = blank("01"); // attack
    const model = new OpponentModel();
    for (let i = 0; i < 6; i++) model.observeRound({ opponentSide: "defense", defendersMet: { A: 3 } });
    const without = openingMix(view);
    const withMemory = openingMix(view, model.read());
    expect(share(withMemory, "bExecute")).toBeGreaterThan(share(without, "bExecute") + 0.1);
    expect(share(withMemory, "aExecute")).toBeLessThan(share(without, "aExecute"));
    expect(share(withMemory, "aExecute")).toBeGreaterThan(0); // still unpredictable
  });

  it("this round's evidence outranks the memory: seeing them on A overrides a B habit", () => {
    const base = blank("03");
    const model = new OpponentModel();
    for (let i = 0; i < 6; i++) model.observeRound({ opponentSide: "attack", plantSite: "B" });
    const seenOnA: PolicyView = {
      ...base,
      observation: {
        ...base.observation,
        visibleEnemies: [{ playerId: base.teammates[0]!.id, agentId: null, lastSeenPosition: { x: 780, y: 360, z: 0 }, lastSeenAtMs: base.observation.timestampMs, healthBand: "unknown", observedWeaponId: null, currentlyVisible: true }],
      },
    };
    expect(openingMix(seenOnA, model.read())["stackA"]).toBeCloseTo(1);
  });
});

describe("unseen evidence: a heard / tracer cue informs the site read", () => {
  const cue = (confidence: number, ageMs = 0) => {
    const base = blank("03");
    return {
      ...base,
      observation: {
        ...base.observation,
        audibleEvents: [{ kind: "gunfire" as const, approxPosition: { x: 720, y: 615, z: 0 }, heardAtMs: base.observation.timestampMs - ageMs, confidence }],
      },
    } satisfies PolicyView;
  };

  it("no cue → no read; a firmer cue → a stronger read; never as strong as a sighting", () => {
    expect(enemySiteBias(blank("03"), spatial)).toEqual({ A: 0, B: 0 });
    const loose = enemySiteBias(cue(0.48), spatial).A;
    const firm = enemySiteBias(cue(0.9), spatial).A;
    expect(loose).toBeGreaterThan(0);
    expect(firm).toBeGreaterThan(loose);
    expect(firm).toBeLessThan(1);
  });

  it("a tracer-grade cue is enough to set up toward the site; a faint sound is not", () => {
    expect(openingMix(cue(0.9))["stackA"]).toBeCloseTo(1);
    expect(share(openingMix(cue(0.48)), "stackA")).toBe(0);
  });

  it("cues go stale", () => {
    expect(enemySiteBias(cue(0.9, 9000), spatial).A).toBe(0);
  });
});

describe("standing plan: persistent, revised only on information", () => {
  it("the opening call is made once and kept while nothing changes", () => {
    const view = blank("01");
    const policy = new TeamDecisionPolicy(spatial);
    const r = rng(3);
    const first = policy.decideWithTrace(view, r).trace;
    for (let i = 1; i <= 12; i++) {
      const t = policy.decideWithTrace({ ...view, timeRemainingMs: view.timeRemainingMs - i * 500 }, r).trace;
      expect(t.finalStrategy).toBe(first.finalStrategy);
      expect(t.plan.opening).toBe(first.plan.opening);
      expect(t.plan.revisions).toHaveLength(0);
    }
  });

  it("decisive new information revises the plan, and the trace says why", () => {
    const view = blank("03");
    const policy = new TeamDecisionPolicy(spatial);
    const r = rng(1);
    const before = policy.decideWithTrace(view, r).trace;
    expect(before.finalStrategy).not.toBe("stackA");
    const enemy = (i: number) => ({ playerId: view.teammates[i]!.id, agentId: null, lastSeenPosition: { x: 780, y: 360, z: 0 }, lastSeenAtMs: view.observation.timestampMs, healthBand: "unknown" as const, observedWeaponId: null, currentlyVisible: true });
    const after = policy.decideWithTrace({
      ...view, timeRemainingMs: view.timeRemainingMs - 500,
      observation: { ...view.observation, visibleEnemies: [enemy(0), enemy(1)] },
    }, r).trace;
    expect(after.finalStrategy).toBe("stackA");
    expect(after.plan.revisions).toHaveLength(1);
    expect(after.plan.revisions[0]!.reason).toMatch(/A/);
    expect(after.evidence.seenEnemies).toBe(2);
    expect(after.evidence.siteBias.A).toBeGreaterThan(after.evidence.siteBias.B);
  });

  it("a new round starts a new plan", () => {
    const view = blank("01");
    const policy = new TeamDecisionPolicy(spatial);
    const openings = new Set<string>();
    for (let round = 0; round < 30; round++) {
      openings.add(policy.decideWithTrace({ ...view, contextId: `r${round}` }, rng(round)).trace.plan.opening);
    }
    expect(openings.size).toBeGreaterThan(1);
  });

  it("the trace carries the opponent read the call rested on", () => {
    const model = new OpponentModel();
    model.observeRound({ opponentSide: "attack", plantSite: "A" });
    const policy = new TeamDecisionPolicy(spatial);
    policy.setOpponentRead(model.read());
    const t = policy.decideWithTrace(blank("03"), rng(1)).trace;
    expect(t.evidence.opponentRead?.attackSite.samples).toBe(1);
  });
});
