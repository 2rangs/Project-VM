// Mid control: the state (mid-control.ts), the decision to fight for it, and what a team does with
// it (policy.ts). Counterfactuals: the same situation with and without control of mid.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DEFAULT_MID_CONTROL_TUNING, MidControlTracker, TeamDecisionPolicy, decideMidCall, defenderStartsFor, midCallWeight, midHolder, stepMidControl, viewFromTeamContext,
} from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import { resolveMidPlan, type MapTactics, type PolicyView, type ResolvedMidSidePlan } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const AT = {
  spawn: { x: 500, y: 905, z: 0 }, midBottom: { x: 500, y: 650, z: 0 }, midCourt: { x: 500, y: 505, z: 0 }, midTop: { x: 500, y: 250, z: 0 },
  aMain: { x: 720, y: 615, z: 0 }, aSite: { x: 780, y: 360, z: 0 }, bSite: { x: 230, y: 360, z: 0 },
};
const AUTO: ResolvedMidSidePlan = { stance: "auto", count: "auto", who: "auto", byManager: [] };

/** The stub map's tactics with a mid: three mid zones, the courtyard opens onto both sites. */
const MID: NonNullable<MapTactics["midArea"]> = {
  zones: ["mid-bottom", "mid-courtyard", "mid-top"],
  attackEntry: "mid-bottom", attackMs: 2500, defenseEntry: "mid-top", defenseMs: 2500, contest: "mid-courtyard",
  chokes: [{ zone: "mid-courtyard", onto: "a-site", leadsTo: "A", first: "attack" }, { zone: "mid-courtyard", onto: "b-site", leadsTo: "B", first: "attack" }],
  siteLinks: {
    A: { from: "mid-courtyard", path: ["mid-courtyard", "a-site"], entry: "mid-courtyard", travelMs: 4000 },
    B: { from: "mid-courtyard", path: ["mid-courtyard", "b-site"], entry: "mid-courtyard", travelMs: 4000 },
  },
  attackSwitch: [{ from: "A", to: "B", throughMs: 12_000, aroundMs: 15_000 }],
  defenseRotate: [{ from: "A", to: "B", throughMs: 8000, aroundMs: 10_000 }],
  attackValue: 0.2, defenseValue: 0.2,
};
const TACTICS: MapTactics = {
  mapId: "ascent", attackerSpawn: "attacker-spawn", defenderSpawn: "defender-spawn",
  sites: [
    { site: "A", zone: "a-site", mainEntry: "a-main", entries: ["a-main", "mid-courtyard"], smokes: ["a-main"], attackTravelMs: 9000, defenseTravelMs: 4000 },
    { site: "B", zone: "b-site", mainEntry: "b-main", entries: ["b-main", "mid-courtyard"], smokes: ["b-main"], attackTravelMs: 9000, defenseTravelMs: 4000 },
  ],
  mid: { zone: "mid-top", aim: "mid-courtyard" },
  aim: { "a-site": "a-main", "b-site": "b-main", "mid-top": "mid-courtyard" },
  smokes: { "a-site": ["a-main"], "b-site": ["b-main"], "mid-top": ["mid-courtyard"] },
  defenderStarts: ["a-site", "a-site", "b-site", "b-site", "mid-top"],
  attackerGround: ["a-lobby", "b-lobby", "mid-bottom"],
  approachSide: {},
  midArea: MID,
  authored: [],
};

function baseView(side: "attack" | "defense", positions: ReadonlyArray<{ x: number; y: number; z: number }>, over: Partial<PolicyView> = {}): PolicyView {
  const v = viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", "scenario_01.json"), "utf8"))));
  const teammates = v.teammates.map((p, i) => ({ ...p, alive: true, side, position: positions[i % positions.length]! }));
  return {
    ...v, side, roundNumber: 5, timeRemainingMs: 95_000, knownEnemyAliveCount: 5,
    // a partial buy: the attack's own call is the slow default (no site named at the start)
    economy: { ...v.economy, side, credits: 4500, ...(side === "attack" ? { buyCall: "half" } : {}) },
    teammates,
    spike: { phase: "carried", position: null, holderId: side === "attack" ? teammates[0]!.id : null, detonationInMs: null },
    observation: { ...v.observation, visibleEnemies: [], audibleEvents: [] },
    belief: { ...v.belief, enemyPositionBeliefs: [] },
    ...over,
  } as PolicyView;
}
const at = (view: PolicyView, clockMs: number, positions?: ReadonlyArray<{ x: number; y: number; z: number }>): PolicyView => ({
  ...view, timeRemainingMs: clockMs, teammates: positions ? view.teammates.map((p, i) => ({ ...p, position: positions[i % positions.length]! })) : view.teammates,
});

describe("mid control: the state", () => {
  it("presence takes mid; an equal presence on both sides takes it from nobody", () => {
    let c = 0;
    for (let t = 0; t < 12_000; t += 500) c = stepMidControl(c, { attack: 2, defense: 0 }, 500);
    expect(c).toBeGreaterThan(0.8);
    expect(midHolder(c)).toBe("attack");
    let even = 0;
    for (let t = 0; t < 12_000; t += 500) even = stepMidControl(even, { attack: 1, defense: 1 }, 500);
    expect(even).toBeCloseTo(0, 6);
    expect(midHolder(even)).toBeNull();
  });

  it("more bodies hold more of it: 2 v 1 settles at one third, short of holding", () => {
    let c = 0;
    for (let t = 0; t < 60_000; t += 500) c = stepMidControl(c, { attack: 2, defense: 1 }, 500);
    expect(c).toBeCloseTo(1 / 3, 2);
    expect(midHolder(c)).toBeNull();
  });

  it("a kill in mid moves control at once toward the killer; utility counts as half a body", () => {
    const before = stepMidControl(0, { attack: 1, defense: 1 }, 500);
    const after = stepMidControl(0, { attack: 1, defense: 1, killsByDefense: 1 }, 500);
    expect(before).toBeCloseTo(0, 6);
    expect(after).toBeCloseTo(-DEFAULT_MID_CONTROL_TUNING.killGain, 6);
    let smoke = 0, body = 0;
    for (let t = 0; t < 3000; t += 500) { smoke = stepMidControl(smoke, { attack: 0, defense: 1, attackUtility: 1 }, 500); body = stepMidControl(body, { attack: 1, defense: 1 }, 500); }
    expect(smoke).toBeLessThan(0);
    expect(smoke).toBeGreaterThan(stepMidControl(0, { attack: 0, defense: 1 }, 3000));
    expect(body).toBeGreaterThan(smoke);
  });

  it("control that is not kept up decays — slower than it was taken", () => {
    let c = 0;
    for (let t = 0; t < 12_000; t += 500) c = stepMidControl(c, { attack: 2, defense: 0 }, 500);
    const held = c;
    for (let t = 0; t < 12_000; t += 500) c = stepMidControl(c, { attack: 0, defense: 0 }, 500);
    expect(c).toBeLessThan(held);
    expect(c).toBeGreaterThan(1 - held); // 12 s took it; 12 s empty has not given all of it back
    for (let t = 0; t < 60_000; t += 500) c = stepMidControl(c, { attack: 0, defense: 0 }, 500);
    expect(Math.abs(c)).toBeLessThan(0.02);
  });

  it("a sharper reader updates faster on the same evidence", () => {
    expect(stepMidControl(0, { attack: 1, defense: 0 }, 2000, 1.4)).toBeGreaterThan(stepMidControl(0, { attack: 1, defense: 0 }, 2000, 0.6));
  });

  it("the tracker records who held mid first and for how long", () => {
    const t = new MidControlTracker();
    for (let ms = 500; ms <= 10_000; ms += 500) t.step({ attack: 0, defense: 1 }, 500, ms);
    for (let ms = 10_500; ms <= 40_000; ms += 500) t.step({ attack: 2, defense: 0, ...(ms === 10_500 ? { killsByAttack: 1 } : {}) }, 500, ms);
    const s = t.summary();
    expect(s.firstHeld?.side).toBe("defense");
    expect(s.final.holder).toBe("attack");
    expect(s.heldMs.attack).toBeGreaterThan(s.heldMs.defense);
    expect(s.samples.length).toBeGreaterThan(10);
  });
});

describe("mid control: the call", () => {
  const ctx = { eco: false, partialBuy: false, calledMid: false, alive: 5 };
  it("auto: the attack contests when the call is mid control; the defence holds on a gun round and gives it up on an eco", () => {
    expect(decideMidCall(AUTO, MID, { ...ctx, side: "attack", calledMid: true })).toMatchObject({ stance: "contest", by: "auto", count: 2 });
    expect(decideMidCall(AUTO, MID, { ...ctx, side: "attack" })).toMatchObject({ stance: "giveUp", by: "auto" });
    expect(decideMidCall(AUTO, MID, { ...ctx, side: "defense" })).toMatchObject({ stance: "hold", by: "auto", count: 1 });
    expect(decideMidCall(AUTO, MID, { ...ctx, side: "defense", eco: true })).toMatchObject({ stance: "giveUp", by: "auto" });
  });
  it("the manager's stance wins over the IGL, on either side; a map without mid has nothing to contest", () => {
    const contest = resolveMidPlan({ "*": { attack: { stance: "contest", count: 3 }, defense: { stance: "contest", count: 2 } } }, "ascent", "attack");
    expect(decideMidCall(contest, MID, { ...ctx, side: "attack" })).toMatchObject({ stance: "contest", by: "manager", count: 3 });
    const give = resolveMidPlan({ ascent: { defense: { stance: "giveUp" } } }, "ascent", "defense");
    expect(decideMidCall(give, MID, { ...ctx, side: "defense" })).toMatchObject({ stance: "giveUp", by: "manager" });
    expect(decideMidCall(contest, null, { ...ctx, side: "attack", calledMid: true }).stance).toBe("giveUp");
  });
  it("plans resolve field by field: the map's entry over \"*\"", () => {
    const plans = { "*": { attack: { stance: "contest" as const, count: 3 } }, ascent: { attack: { count: 1, who: { roles: ["lurker"] } } } };
    expect(resolveMidPlan(plans, "ascent", "attack")).toEqual({ stance: "contest", count: 1, who: { roles: ["lurker"] }, byManager: ["stance", "count", "who"] });
    expect(resolveMidPlan(plans, "bind", "attack")).toMatchObject({ stance: "contest", count: 3, who: "auto" });
    expect(resolveMidPlan(plans, "ascent", "defense")).toEqual({ stance: "auto", count: "auto", who: "auto", byManager: [] });
  });
  it("the mid call is drawn more often where mid saves the attack more", () => {
    expect(midCallWeight(MID)).toBeCloseTo(0.8, 6); // Ascent's value: the weight the IGL always used
    expect(midCallWeight({ ...MID, attackValue: 0 })).toBeCloseTo(0.4, 6);
    expect(midCallWeight({ ...MID, attackValue: 1 })).toBeCloseTo(2.4, 6);
    expect(midCallWeight(null)).toBe(0.8);
  });
  it("defender starts: the mid player goes to a site when mid is given up; a second one comes off a site when it is contested", () => {
    expect(defenderStartsFor(TACTICS, "hold", 1)).toEqual(TACTICS.defenderStarts);
    const gave = defenderStartsFor(TACTICS, "giveUp", 0);
    expect(gave).not.toContain("mid-top");
    expect(gave.filter((z) => z === "a-site").length + gave.filter((z) => z === "b-site").length).toBe(5);
    const two = defenderStartsFor(TACTICS, "contest", 2);
    expect(two.filter((z) => z === "mid-top")).toHaveLength(2);
    expect(two).toContain("a-site");
    expect(two).toContain("b-site");
  });
});

describe("mid control: what the attack does with it", () => {
  const contest: ResolvedMidSidePlan = { stance: "contest", count: 2, who: "auto", byManager: ["stance", "count"] };
  const policyWith = (plan: ResolvedMidSidePlan | null, midControl = true) => {
    const p = new TeamDecisionPolicy(spatial, { tactics: TACTICS, midControl });
    p.setMidPlan(plan);
    return p;
  };

  it("a contest sends two players — never the carrier — to where the sides meet; without it nobody goes", () => {
    const view = baseView("attack", [AT.spawn]);
    const p = policyWith(contest);
    const cmds = p.decide(view, rng(1)).commands;
    const party = p.planSummary()!.mid!.party;
    expect(party).toHaveLength(2);
    expect(party).not.toContain(String(view.spike.holderId));
    // each of them is sent to the meeting zone (a player's own choice to cast an ability is kept)
    const theirs = cmds.filter((c) => party.includes(String(c.playerId)) && c.kind !== "useAbility");
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((c) => c.sourceActionId === "mid:take-move" && c.targetZone === "mid-courtyard")).toBe(true);
    expect(cmds.filter((c) => c.sourceActionId?.startsWith("mid:")).every((c) => party.includes(String(c.playerId)))).toBe(true);
    expect(policyWith(null).decide(view, rng(1)).commands.some((c) => c.sourceActionId?.startsWith("mid:"))).toBe(false);
    expect(policyWith(contest, false).decide(view, rng(1)).commands.some((c) => c.sourceActionId?.startsWith("mid:"))).toBe(false);
  });

  it("the manager names who goes", () => {
    const view = baseView("attack", [AT.spawn]);
    const ids = view.teammates.map((p) => String(p.id));
    const named: ResolvedMidSidePlan = { stance: "contest", count: 1, who: { players: [ids[3]!] }, byManager: ["stance", "count", "who"] };
    const p = policyWith(named);
    p.decide(view, rng(1));
    expect(p.planSummary()!.mid!.party).toEqual([ids[3]]);
    expect(p.planSummary()!.mid!.by).toBe("manager");
  });

  it("standing in mid unopposed, the team comes to believe it holds mid — and then commits early: a split hit, or the party sells the other site", () => {
    const outcomes = { split: 0, fake: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      const p = policyWith(contest);
      const start = baseView("attack", [AT.spawn]);
      p.decide(start, rng(seed));
      const party = new Set(p.planSummary()!.mid!.party);
      const where = start.teammates.map((t) => (party.has(String(t.id)) ? AT.midCourt : AT.aMain));
      let cmds = p.decide(at(start, 94_500, where), rng(seed)).commands;
      for (let clock = 94_000; clock >= 80_000; clock -= 500) cmds = p.decide(at(start, clock, where), rng(seed)).commands;
      const s = p.planSummary()!;
      expect(s.mid!.estimate.holder).toBe("attack");
      expect(s.mid!.heldAtMs).not.toBeNull();
      expect(s.objective).not.toBeNull(); // the slow play has named its site long before the 40 s clock
      expect(s.revisions.some((r) => r.reason.includes("mid is held"))).toBe(true);
      expect(p.midState()!.attack).toBeGreaterThan(0.4);
      expect(s.mid!.split !== s.mid!.fake).toBe(true);
      const mine = cmds.filter((c) => party.has(String(c.playerId)) && c.kind !== "useAbility");
      if (s.mid!.fake) {
        outcomes.fake++;
        expect(s.feint).not.toBeNull();
        expect(mine.every((c) => c.sourceActionId?.startsWith("plan:feint"))).toBe(true);
      } else {
        outcomes.split++;
        // the party's orders are its own (mid:), onto the site from mid; the others are the team's (plan:)
        expect(mine.every((c) => c.sourceActionId?.startsWith("mid:"))).toBe(true);
      }
    }
    expect(outcomes.split).toBeGreaterThan(outcomes.fake); // the fake is the exception
    expect(outcomes.split).toBeGreaterThan(0);
  });

  it("the same stand with a defender seen in mid is a fight, not control; losing a player there loses mid and the party gives it up", () => {
    const p = policyWith(contest);
    const start = baseView("attack", [AT.spawn]);
    p.decide(start, rng(1));
    const party = new Set(p.planSummary()!.mid!.party);
    const where = start.teammates.map((t) => (party.has(String(t.id)) ? AT.midCourt : AT.aMain));
    const enemy = (clock: number) => [
      { playerId: "def5", agentId: null, lastSeenPosition: AT.midTop, lastSeenAtMs: 100_000 - clock, healthBand: "full", observedWeaponId: null, currentlyVisible: true },
      { playerId: "def4", agentId: null, lastSeenPosition: AT.midTop, lastSeenAtMs: 100_000 - clock, healthBand: "full", observedWeaponId: null, currentlyVisible: true },
    ];
    const seeing = (clock: number, dead: ReadonlySet<string> = new Set()): PolicyView => {
      const v = at(start, clock, where);
      return { ...v, teammates: v.teammates.map((t) => ({ ...t, alive: !dead.has(String(t.id)) })), observation: { ...v.observation, timestampMs: 100_000 - clock, visibleEnemies: enemy(clock) } } as unknown as PolicyView;
    };
    for (let clock = 94_500; clock >= 88_000; clock -= 500) p.decide(seeing(clock), rng(1));
    expect(p.planSummary()!.mid!.estimate.holder).toBeNull(); // 2 v 2: nobody holds it
    expect(p.planSummary()!.objective).toBeNull();
    // both of the party die in mid
    for (let clock = 87_500; clock >= 86_000; clock -= 500) p.decide(seeing(clock, party), rng(1));
    const s = p.planSummary()!;
    expect(s.mid!.estimate.value).toBeLessThan(-0.4);
    expect(s.mid!.lostAtMs).not.toBeNull();
    expect(s.revisions.some((r) => r.to === "mid: give up")).toBe(true);
  });
});

describe("mid control: what the defence does with it", () => {
  const defence = (plan: ResolvedMidSidePlan | null = null) => {
    const p = new TeamDecisionPolicy(spatial, { tactics: TACTICS });
    p.setMidPlan(plan);
    return p;
  };
  const posts = [AT.aSite, AT.aSite, AT.bSite, AT.bSite, AT.midTop];

  it("its mid players are the ones who start in mid; holding it unopposed it believes it holds mid", () => {
    const p = defence();
    const start = baseView("defense", posts);
    p.decide(start, rng(3));
    expect(p.planSummary()!.mid).toMatchObject({ stance: "hold", by: "auto", party: [String(start.teammates[4]!.id)] });
    for (let clock = 94_500; clock >= 85_000; clock -= 500) p.decide(at(start, clock), rng(3));
    expect(p.planSummary()!.mid!.estimate.holder).toBe("defense");
    expect(p.midState()!.defense).toBeGreaterThan(0.4);
  });

  it("attackers seen in mid with no defender there: mid is lost, and a move between sites is priced round it", () => {
    const start = baseView("defense", [AT.aSite, AT.aSite, AT.bSite, AT.bSite, AT.bSite]);
    const seen = (clock: number): PolicyView => ({
      ...at(start, clock),
      observation: { ...start.observation, timestampMs: 100_000 - clock, visibleEnemies: ["atk1", "atk2"].map((id) => ({ playerId: id, agentId: null, lastSeenPosition: AT.midCourt, lastSeenAtMs: 100_000 - clock, healthBand: "full", observedWeaponId: null, currentlyVisible: true })) },
    } as unknown as PolicyView);
    const lost = defence();
    const kept = defence();
    lost.decide(start, rng(3));
    kept.decide(start, rng(3));
    let a = lost.decide(seen(94_500), rng(3)).commands;
    let b = kept.decide(at(start, 94_500), rng(3)).commands;
    for (let clock = 94_000; clock >= 86_000; clock -= 500) { a = lost.decide(seen(clock), rng(3)).commands; b = kept.decide(at(start, clock), rng(3)).commands; }
    expect(lost.planSummary()!.mid!.estimate.holder).toBe("attack");
    expect(lost.planSummary()!.mid!.lostAtMs).not.toBeNull();
    expect(kept.planSummary()!.mid!.lostAtMs).toBeNull();
    const priced = (cmds: typeof a) => cmds.filter((c) => c.kind === "move" && c.zoneCosts && "mid-courtyard" in c.zoneCosts).length;
    const moves = (cmds: typeof a) => cmds.filter((c) => c.kind === "move" && c.zoneCosts).length;
    if (moves(a) > 0) expect(priced(a)).toBe(moves(a));
    expect(priced(b)).toBe(0);
  });

  it("short-handed, the mid player falls back to a site", () => {
    const p = defence();
    const start = baseView("defense", posts);
    p.decide(start, rng(3));
    const three = { ...at(start, 80_000), teammates: start.teammates.map((t, i) => ({ ...t, alive: i >= 2 })) } as PolicyView;
    p.decide(three, rng(3));
    expect(p.planSummary()!.revisions.some((r) => r.to === "mid: give up")).toBe(true);
  });
});
