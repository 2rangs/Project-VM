/**
 * Counterfactual tests for footsteps as information: the same state with ONE condition changed
 * must change the belief, or the decision, for the stated reason.
 *   - walk or run (movement.ts): intent × who can hear × the clock
 *   - the defense's belief over hit / fake / nothing (hit-belief.ts) and its proportional response
 *   - the cross-round fake rate (opponent-model.ts)
 *   - determinism
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  OpponentModel, TeamDecisionPolicy, chooseMoveMode, rotationCount, updateHitBelief, viewFromTeamContext, withinEarshot,
  BASE_FAKE_RATE, NO_EVIDENCE, type OpponentRead, type SiteEvidence, type TeamPolicyOptions,
} from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { PolicyView, TeamStrategy, Vector3 } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));

/** Stub-map positions (minimap units). */
const AT: Record<string, Vector3> = {
  "attacker-spawn": { x: 500, y: 905, z: 0 }, "a-lobby": { x: 650, y: 820, z: 0 }, "a-main": { x: 720, y: 615, z: 0 },
  "a-site": { x: 780, y: 360, z: 0 }, "b-lobby": { x: 350, y: 820, z: 0 }, "b-main": { x: 280, y: 615, z: 0 },
  "b-site": { x: 230, y: 360, z: 0 }, "mid-courtyard": { x: 500, y: 505, z: 0 },
};
const zonePosition = (id: string) => AT[id];

describe("walk or run is a decision (intent × audible × clock)", () => {
  it("a quiet move is walked only where it would be heard and the clock allows", () => {
    expect(chooseMoveMode({ intent: "quiet", audible: true, slackMs: 5000 })).toBe("walk");
    expect(chooseMoveMode({ intent: "quiet", audible: false, slackMs: 5000 })).toBe("run"); // nobody to hear: speed is free
    expect(chooseMoveMode({ intent: "quiet", audible: true, slackMs: -1 })).toBe("run"); // the clock outranks the noise
  });
  it("a fast move and a deliberately loud one are run", () => {
    expect(chooseMoveMode({ intent: "fast", audible: true, slackMs: 99_999 })).toBe("run");
    expect(chooseMoveMode({ intent: "loud", audible: true, slackMs: 99_999 })).toBe("run");
  });
  it("earshot is a 3D distance", () => {
    expect(withinEarshot({ x: 0, y: 0, z: 0 }, [{ x: 30, y: 40, z: 0 }], 50)).toBe(true);
    expect(withinEarshot({ x: 0, y: 0, z: 0 }, [{ x: 30, y: 40, z: 10 }], 50)).toBe(false);
  });

  /** Attack view: full buy, nothing observed, everyone at `at`. */
  function attackView(at: Vector3, over: Partial<PolicyView> = {}): PolicyView {
    const v = loadView("01");
    const teammates = v.teammates.map((p) => ({ ...p, alive: true, position: at }));
    return {
      ...v, roundNumber: 5, timeRemainingMs: 95_000, knownEnemyAliveCount: 5,
      economy: { ...v.economy, credits: 4500 }, teammates,
      spike: { phase: "carried", position: null, holderId: teammates[0]!.id, detonationInMs: null },
      observation: { ...v.observation, visibleEnemies: [], audibleEvents: [] },
      belief: { ...v.belief, enemyPositionBeliefs: [] },
      ...over,
    };
  }
  function opening(strategy: TeamStrategy, view: PolicyView, options: TeamPolicyOptions): { policy: TeamDecisionPolicy; seed: number } {
    for (let seed = 0; seed < 300; seed++) {
      const policy = new TeamDecisionPolicy(spatial, options);
      if (policy.decideWithTrace(view, rng(seed)).trace.plan.opening === strategy) return { policy, seed };
    }
    throw new Error(`no seed opens ${strategy}`);
  }
  const stageModes = (view: PolicyView, radius: number) => {
    const { policy, seed } = opening("aExecute", view, { zonePosition, footstepRadiusUnits: radius });
    return policy.decide({ ...view, timeRemainingMs: view.timeRemainingMs - 500 }, rng(seed)).commands
      .filter((c) => c.sourceActionId === "plan:stage-move").map((c) => c.moveMode);
  };

  it("counterfactual — staging for an execute: walked inside the site's hearing, run outside it", () => {
    // attacker spawn is ~613 units from A site on the stub map
    const view = attackView(AT["attacker-spawn"]!);
    const inside = stageModes(view, 700);
    const outside = stageModes(view, 300);
    expect(inside.length).toBeGreaterThan(0);
    expect(inside.every((m) => m === "walk")).toBe(true);
    expect(outside.every((m) => m === "run")).toBe(true);
  });

  it("counterfactual — same approach, no clock left to walk it: run", () => {
    expect(stageModes(attackView(AT["attacker-spawn"]!, { timeRemainingMs: 22_000 }), 700).every((m) => m === "run")).toBe(true);
  });

  it("the go call is run, whatever was walked before it", () => {
    const staged = attackView(AT["a-main"]!, { timeRemainingMs: 80_000 });
    const { policy, seed } = opening("aExecute", attackView(AT["attacker-spawn"]!), { zonePosition, footstepRadiusUnits: 700 });
    const go = policy.decide(staged, rng(seed)).commands.filter((c) => c.sourceActionId === "plan:go-move");
    expect(go.length).toBeGreaterThanOrEqual(3);
    expect(go.every((c) => c.moveMode === "run")).toBe(true);
  });

  it("a fake's showers run on purpose — inside hearing, with all the clock in the world — while the main group walks", () => {
    const view = attackView(AT["attacker-spawn"]!);
    const { policy, seed } = opening("fakeAtoB", view, { zonePosition, footstepRadiusUnits: 700 });
    const cmds = policy.decide({ ...view, timeRemainingMs: 94_000 }, rng(seed)).commands;
    const show = cmds.filter((c) => c.sourceActionId === "plan:feint-move");
    const stage = cmds.filter((c) => c.sourceActionId === "plan:stage-move");
    // (a player who drew an ability this tick casts instead of moving — hence "at least one")
    expect(policy.planSummary()!.showers).toBe(2);
    expect(show.length).toBeGreaterThanOrEqual(1);
    expect(show.length).toBeLessThanOrEqual(2);
    expect(show.every((c) => c.moveMode === "run")).toBe(true);
    expect(stage.length).toBeGreaterThanOrEqual(1);
    expect(stage.every((c) => c.moveMode === "walk")).toBe(true);
  });
});

describe("the belief over hit / fake / nothing (Bayes)", () => {
  const ev = (over: Partial<SiteEvidence>): SiteEvidence => ({ ...NO_EVIDENCE, ...over });
  const belief = (b: Partial<SiteEvidence>, a: Partial<SiteEvidence> = {}, over: Partial<Parameters<typeof updateHitBelief>[0]> = {}) =>
    updateHitBelief({ sites: ["A", "B"], evidence: { A: ev(a), B: ev(b) }, enemiesAlive: 5, ...over });

  it("nothing observed: nothing is under way, nobody moves", () => {
    const b = belief({});
    expect(b.none).toBeGreaterThan(0.95);
    expect(rotationCount(b.hit["B"]!, 3)).toBe(0);
  });

  it("the posterior is a distribution: hits + pending shows + nothing = 1", () => {
    const b = belief({ runners: 3 }, { runners: 1 });
    expect(b.hit["A"]! + b.hit["B"]! + b.fake + b.none).toBeCloseTo(1, 6);
  });

  it("counterfactual — five runners on B vs two runners on B, everything else equal", () => {
    const rush = belief({ runners: 5 });
    const show = belief({ runners: 2 });
    // five running: a real hit, and the defense stacks
    expect(rush.hit["B"]).toBeGreaterThan(0.9);
    expect(rush.fake).toBeLessThan(0.05);
    expect(rotationCount(rush.hit["B"]!, 3)).toBe(3);
    // two running, no contact, silence on A: more likely a fake than a hit — nobody is sent
    expect(show.fake).toBeGreaterThan(show.hit["B"]!);
    expect(show.show["B"]).toBeGreaterThan(0.5);
    expect(rotationCount(show.hit["B"]!, 3)).toBe(0);
  });

  it("one runner is a lurker, not a hit", () => {
    const b = belief({ runners: 1 });
    expect(b.none).toBeGreaterThan(b.hit["B"]! + b.fake);
  });

  it("counterfactual — the same two runners against a team that fakes often vs one that never does", () => {
    const fakesOften = belief({ runners: 2 }, {}, { fakeRate: 0.6 });
    const neverFakes = belief({ runners: 2 }, {}, { fakeRate: 0.02 });
    expect(fakesOften.fake).toBeGreaterThan(0.8);
    expect(rotationCount(fakesOften.hit["B"]!, 3)).toBe(0);
    expect(neverFakes.hit["B"]).toBeGreaterThan(neverFakes.fake);
    expect(rotationCount(neverFakes.hit["B"]!, 3)).toBeGreaterThanOrEqual(1);
  });

  it("counterfactual — the same two runners with no clock left for a fake: it is the hit", () => {
    const early = belief({ runners: 2 }, {}, { fakeFeasibility: 1 });
    const late = belief({ runners: 2 }, {}, { fakeFeasibility: 0 });
    expect(late.fake).toBe(0);
    expect(late.hit["B"]).toBeGreaterThan(early.hit["B"]! * 2);
  });

  it("counterfactual — contact turns a small presence from a show into a hit", () => {
    const quietShow = belief({ runners: 2, contact: false });
    const fighting = belief({ runners: 2, contact: true });
    expect(fighting.hit["B"]).toBeGreaterThan(quietShow.hit["B"]! * 3);
  });

  it("with fewer attackers alive the same two runners are most of the team — a hit", () => {
    expect(belief({ runners: 2 }, {}, { enemiesAlive: 2 }).hit["B"]).toBeGreaterThan(0.6);
    expect(belief({ runners: 2 }, {}, { enemiesAlive: 5 }).hit["B"]).toBeLessThan(0.3);
  });

  it("a known habit is the prior, not the verdict: the read follows the evidence", () => {
    const prior = { A: 0.85, B: 0.15 };
    expect(belief({ runners: 5 }, {}, { attackPrior: prior }).hit["B"]).toBeGreaterThan(0.85);
    // with ambiguous evidence the habit shows
    const amb = (p: Record<string, number>) => belief({ runners: 3 }, { runners: 3 }, { attackPrior: p });
    expect(amb(prior).hit["A"]).toBeGreaterThan(amb(prior).hit["B"]!);
  });

  it("pattern recognition: a sharper team lets the same evidence move it further — whichever way it points", () => {
    // four running: the evidence says hit → the sharper team is surer of the hit
    expect(belief({ runners: 4 }, {}, { sharpness: 1.4 }).hit["B"]).toBeGreaterThan(belief({ runners: 4 }, {}, { sharpness: 0.6 }).hit["B"]!);
    // two running, no contact: the evidence says show → the sharper team is surer it is a fake,
    // the duller one stays nearer its prior (which favours a straight hit)
    expect(belief({ runners: 2 }, {}, { sharpness: 1.4 }).fake).toBeGreaterThan(belief({ runners: 2 }, {}, { sharpness: 0.6 }).fake);
    expect(belief({ runners: 2 }, {}, { sharpness: 1.4 }).hit["B"]).toBeLessThan(belief({ runners: 2 }, {}, { sharpness: 0.6 }).hit["B"]!);
  });

  it("missing utility only counts against a hit when utility is in play", () => {
    const off = belief({ runners: 4 }, {}, { utilityInPlay: false });
    const onNone = belief({ runners: 4, utility: false }, {}, { utilityInPlay: true });
    const onSeen = belief({ runners: 4, utility: true }, {}, { utilityInPlay: true });
    expect(onSeen.hit["B"]).toBeGreaterThan(onNone.hit["B"]!);
    expect(off.hit["B"]).toBeGreaterThan(onNone.hit["B"]!);
  });

  it("the response is proportional: support, then more, then the stack", () => {
    expect([0.1, 0.3, 0.6, 0.9].map((p) => rotationCount(p, 3))).toEqual([0, 1, 2, 3]);
    expect(rotationCount(0.9, 0)).toBe(0);
  });

  it("three sites: a hit on C leaves A and B quiet", () => {
    const b = updateHitBelief({ sites: ["A", "B", "C"], evidence: { C: ev({ runners: 5 }) }, enemiesAlive: 5 });
    expect(b.likeliest).toBe("C");
    expect(b.hit["C"]).toBeGreaterThan(0.9);
  });
});

describe("the cross-round fake rate", () => {
  it("no data: the base rate; fakes seen raise it, straight hits lower it, never to 0 or 1", () => {
    const fresh = new OpponentModel().read().fakeRate!;
    expect(fresh.rate).toBeCloseTo(BASE_FAKE_RATE);
    expect(fresh.confidence).toBe(0);
    const faker = new OpponentModel();
    const honest = new OpponentModel();
    for (let i = 0; i < 6; i++) {
      faker.observeRound({ opponentSide: "attack", shownSite: "A", plantSite: "B" });
      honest.observeRound({ opponentSide: "attack", shownSite: "B", plantSite: "B" });
    }
    expect(faker.read().fakeRate!.rate).toBeGreaterThan(0.6);
    expect(faker.read().fakeRate!.rate).toBeLessThan(1);
    expect(honest.read().fakeRate!.rate).toBeLessThan(0.1);
    expect(honest.read().fakeRate!.rate).toBeGreaterThan(0);
  });
  it("a round with no plant, or where nothing showed, teaches nothing about fakes", () => {
    const m = new OpponentModel();
    m.observeRound({ opponentSide: "attack", shownSite: "A", plantSite: null });
    m.observeRound({ opponentSide: "attack", shownSite: null, plantSite: "B" });
    expect(m.read().fakeRate!.samples).toBe(0);
  });
});

describe("the defense acts on the read (policy)", () => {
  /** Defense pre-plant: 2 on A site, 2 on B site, 1 mid; `runners` footsteps heard at a zone right now. */
  function holding(heard: Array<{ zone: string; n: number }>, over: Partial<PolicyView> = {}): PolicyView {
    const base = loadView("03");
    const posts = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"];
    const now = over.timeRemainingMs ?? 80_000;
    return {
      ...base, roundNumber: 5, knownEnemyAliveCount: 5,
      economy: { ...base.economy, credits: 4500 },
      teammates: base.teammates.map((p, i) => ({ ...p, alive: true, position: AT[posts[i]!]! })),
      spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
      belief: { ...base.belief, enemyPositionBeliefs: [] },
      ...over,
      timeRemainingMs: now,
      observation: {
        ...base.observation, timestampMs: now, visibleEnemies: [],
        audibleEvents: heard.flatMap((h) => Array.from({ length: h.n }, () => ({ kind: "footstep" as const, approxPosition: AT[h.zone]!, heardAtMs: now, confidence: 0.5 }))),
      },
    };
  }
  /** A policy whose defense opening is the plain hold (so the rotation is the only thing moving anyone). */
  function holdPolicy(view: PolicyView, read?: OpponentRead): { policy: TeamDecisionPolicy; seed: number } {
    for (let seed = 0; seed < 300; seed++) {
      const policy = new TeamDecisionPolicy(spatial);
      if (read) policy.setOpponentRead(read);
      if (policy.decideWithTrace(holding([], { timeRemainingMs: view.timeRemainingMs + 500 }), rng(seed)).trace.plan.opening === "defaultHold") return { policy, seed };
    }
    throw new Error("no seed opens defaultHold");
  }
  const react = (view: PolicyView, read?: OpponentRead) => {
    const { policy, seed } = holdPolicy(view, read);
    const r = policy.decideWithTrace(view, rng(seed));
    return { ...r, rotating: r.decision.commands.filter((c) => c.sourceActionId?.startsWith("rotate:")), plan: policy.planSummary()! };
  };

  it("counterfactual — a real five-man run on B vs a two-man noisy fake on B, same state", () => {
    const rush = react(holding([{ zone: "b-main", n: 5 }]));
    const fake = react(holding([{ zone: "b-main", n: 2 }]));
    // belief
    expect(rush.trace.evidence.hitBelief!.hit["B"]).toBeGreaterThan(0.9);
    expect(fake.trace.evidence.hitBelief!.fake).toBeGreaterThan(fake.trace.evidence.hitBelief!.hit["B"]!);
    // response: everyone not posted on B is sent, and the plan says on what grounds
    expect(rush.rotating).toHaveLength(3);
    expect(rush.trace.finalStrategy).toBe("stackB");
    expect(rush.plan.revisions.at(-1)!.to).toBe("stack B ×3");
    expect(rush.plan.revisions.at(-1)!.reason).toMatch(/5 runners heard on B, no contact on A — P\(hit B\) 0\.\d+, fake 0\.\d+ — rotate 3/);
    expect(rush.plan.rotations).toEqual([{ atMs: 80_000, site: "B", count: 3 }]);
    // the fake moves nobody: the call stays the hold
    expect(fake.rotating).toHaveLength(0);
    expect(fake.trace.finalStrategy).toBe("defaultHold");
    expect(fake.plan.revisions).toHaveLength(0);
    // both are remembered as where the attack showed (what the cross-round model learns from)
    expect(rush.plan.shownSite).toBe("B");
    expect(fake.plan.shownSite).toBe("B");
  });

  it("a moderate read sends support and keeps the far anchors home", () => {
    // three of five running on B: likelier a hit than not, far from certain
    const r = react(holding([{ zone: "b-main", n: 3 }]));
    const p = r.trace.evidence.hitBelief!.hit["B"]!;
    expect(p).toBeGreaterThan(1 / 6);
    expect(p).toBeLessThan(5 / 6);
    expect(r.rotating.length).toBeGreaterThanOrEqual(1);
    expect(r.rotating.length).toBeLessThan(3);
    expect(r.plan.revisions.at(-1)!.to).toMatch(/^support B ×/);
    // the nearest goes first: the mid player is always among those sent
    expect(r.rotating.map((c) => String(c.playerId))).toContain(String(holding([]).teammates[4]!.id));
  });

  it("counterfactual — the same two-man fake against a defense that knows they never fake vs one that knows they often do", () => {
    const never = new OpponentModel();
    const often = new OpponentModel();
    for (let i = 0; i < 8; i++) {
      never.observeRound({ opponentSide: "attack", shownSite: i % 2 ? "A" : "B", plantSite: i % 2 ? "A" : "B" });
      often.observeRound({ opponentSide: "attack", shownSite: i % 2 ? "A" : "B", plantSite: i % 2 ? "B" : "A" });
    }
    const view = holding([{ zone: "b-main", n: 2 }]);
    const trusting = react(view, never.read());
    const wary = react(view, often.read());
    expect(trusting.trace.evidence.hitBelief!.hit["B"]).toBeGreaterThan(wary.trace.evidence.hitBelief!.hit["B"]! * 3);
    expect(trusting.rotating.length).toBeGreaterThanOrEqual(1); // takes the noise at face value → sends help
    expect(wary.rotating).toHaveLength(0); // has seen this before → holds
  });

  it("a sharper roster is surer of the same evidence", () => {
    const view = holding([{ zone: "b-main", n: 4 }]);
    const sent = (decisionMaking: number) => {
      const { policy, seed } = holdPolicy(view);
      policy.setProfiles(new Map(view.teammates.map((t) => [String(t.id), { playerId: t.id, aggression: 0.5, discipline: 0.5, decisionMaking, teamwork: 0.5 }])));
      return policy.decideWithTrace(view, rng(seed)).trace.evidence.hitBelief!.hit["B"]!;
    };
    expect(sent(0.9)).toBeGreaterThan(sent(0.2));
  });

  it("when the noise stops the rotation is stood down — after the commit window, not on the first quiet tick", () => {
    const { policy, seed } = holdPolicy(holding([], { timeRemainingMs: 80_000 }));
    const r = rng(seed);
    policy.decide(holding([{ zone: "b-main", n: 5 }], { timeRemainingMs: 80_000 }), r);
    // a quiet half-second later the rotators are still going
    const soon = policy.decide(holding([], { timeRemainingMs: 79_500 }), r).commands;
    expect(soon.filter((c) => c.sourceActionId === "rotate:move")).toHaveLength(3);
    // six seconds of silence: stood down, and on their way home
    const moved = holding([], { timeRemainingMs: 74_000 });
    const away = { ...moved, teammates: moved.teammates.map((p, i) => (i === 4 ? { ...p, position: AT["b-site"]! } : p)) };
    const later = policy.decide(away, r).commands;
    expect(later.filter((c) => c.sourceActionId === "rotate:move")).toHaveLength(0);
    expect(later.some((c) => c.sourceActionId === "rotate:return" && c.targetZone === "mid-courtyard")).toBe(true);
    expect(policy.planSummary()!.revisions.at(-1)!.to).toBe("hold");
  });

  it("deterministic: the same views and seed give the same decisions and the same plan", () => {
    const run = () => {
      const { policy, seed } = holdPolicy(holding([], { timeRemainingMs: 80_000 }));
      const r = rng(seed);
      const out: unknown[] = [];
      for (const [i, n] of [0, 2, 2, 5, 5, 0, 0].entries()) out.push(policy.decide(holding(n ? [{ zone: "b-main", n }] : [], { timeRemainingMs: 80_000 - i * 500 }), r).commands);
      return JSON.stringify({ out, plan: policy.planSummary() });
    };
    expect(run()).toBe(run());
  });
});
