/**
 * Counterfactual tests for the balance-recovery behaviours: the same state with ONE condition
 * changed must change the decision, for the stated reason.
 *   - retake approach (least exposure)          - attack rotation route / plant only on the objective
 *   - feint out of the site's sightline         - designated lurker
 *   - attack save (man count × gear at stake)   - defense exit-kill chase (throw hazard)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TeamDecisionPolicy, assignRoles, viewFromTeamContext, type TeamPolicyOptions } from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import { asZoneId, type PlayerProfile, type PolicyView, type SpatialQuery, type TeamStrategy, type Vector3 } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";
import { GraphStub, type GraphZone } from "./fixtures/graph-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const ascent = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));
const z = asZoneId;
const SPAWN = { x: 500, y: 905, z: 0 };

/** Attack view: full buy, mid-half round, nothing observed; the first `alive` attackers alive at `at`, the first carries. */
function attackView(at: Vector3, over: Partial<PolicyView> = {}, alive = 5, weaponId = "vandal"): PolicyView {
  const v = loadView("01");
  const teammates = v.teammates.map((p, i) => ({ ...p, alive: i < alive, position: at, weapon: { weaponId: weaponId as never, magazine: 25, reserve: 50 } }));
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
/** A policy whose own opening call is `strategy` (searching seeds; no coach order involved). */
function policyOpening(strategy: TeamStrategy, view: PolicyView, spatial: SpatialQuery = ascent, options: TeamPolicyOptions = {}): { policy: TeamDecisionPolicy; seed: number } {
  for (let seed = 0; seed < 300; seed++) {
    const policy = new TeamDecisionPolicy(spatial, options);
    if (policy.decideWithTrace(view, rng(seed)).trace.plan.opening === strategy) return { policy, seed };
  }
  throw new Error(`no seed opens ${strategy}`);
}
const profile = (id: PlayerProfile["playerId"], aggression: number, discipline = 0.5, decisionMaking = 0.5): PlayerProfile =>
  ({ playerId: id, aggression, discipline, decisionMaking, teamwork: 0.5 });

describe("retake approach: the entry the post-plant holders are not watching", () => {
  // The plant zone has two entries: market (short, in the site's sightline) and ct (long, hidden).
  const zones: GraphZone[] = [
    { id: "b-site", zoneType: "site", site: "B", at: { x: 0, y: 0 } },
    { id: "market", zoneType: "link", at: { x: 10, y: 0 } },
    { id: "ct", zoneType: "connector", at: { x: 0, y: 10 } },
    { id: "mid", zoneType: "mid", at: { x: 20, y: 0 } },
    { id: "heaven", zoneType: "connector", at: { x: 20, y: 10 } },
  ];
  const edges = [["mid", "market", 3000], ["market", "b-site", 4000], ["mid", "heaven", 5000], ["heaven", "ct", 5000], ["ct", "b-site", 4000]] as const;
  const watched = new TeamDecisionPolicy(new GraphStub(zones, edges, [["b-site", "market"]]));
  const unwatched = new TeamDecisionPolicy(new GraphStub(zones, edges, []));

  it("takes the longer, unwatched entry when the clock allows it", () => {
    const a = watched.retakeApproach(z("mid"), z("b-site"), 45_000);
    expect(a.entry).toBe("ct");
    expect(a.stage).toBe("ct");
    expect(a.exposedMs).toBe(0);
    expect(a.travelMs).toBe(14_000);
  });

  it("counterfactual — no sightline onto market: the short entry is taken (exposure, not habit, decides)", () => {
    const a = unwatched.retakeApproach(z("mid"), z("b-site"), 45_000);
    expect(a.entry).toBe("market");
    expect(a.travelMs).toBe(7_000);
  });

  it("counterfactual — the timer cannot afford the long way: the fast, watched entry, staged out of sight", () => {
    // long way 14 s + 7 s defuse + 3 s margin > 20 s; short way 7 + 7 + 3 fits.
    const a = watched.retakeApproach(z("mid"), z("b-site"), 20_000);
    expect(a.entry).toBe("market");
    expect(a.exposedMs).toBe(4_000);
    expect(a.stage).toBe("mid"); // last zone of that approach the plant cannot see
  });

  it("the retake is judged on the approach actually taken: viable by the long way, defenders stage at ct", () => {
    const base = loadView("03");
    const view: PolicyView = {
      ...base,
      teammates: base.teammates.map((p, i) => ({ ...p, alive: i < 3, position: { x: 20, y: 0, z: 0 } })),
      spike: { phase: "planted", position: { x: 0, y: 0, z: 0 }, holderId: null, detonationInMs: 40_000 },
      knownEnemyAliveCount: 3,
    };
    const cmds = new TeamDecisionPolicy(new GraphStub(zones, edges, [["b-site", "market"]])).decide(view, rng(1)).commands;
    const staging = cmds.filter((c) => c.sourceActionId === "retake-stage:move");
    expect(staging.length).toBeGreaterThanOrEqual(2);
    expect(staging.every((c) => c.targetZone === "ct")).toBe(true);
  });
});

describe("attack rotation: around through its own spawn, not across the site it is not hitting", () => {
  // The shortest path from A lobby to B site runs through A main and A site (9 s); the way back
  // through the attacker spawn takes 23 s but crosses nothing a site watches until B main.
  const zones: GraphZone[] = [
    { id: "attacker-spawn", zoneType: "spawn", at: { x: 50, y: 100 } },
    { id: "a-lobby", zoneType: "lobby", at: { x: 80, y: 80 } },
    { id: "a-main", zoneType: "main", at: { x: 80, y: 50 } },
    { id: "a-site", zoneType: "site", site: "A", at: { x: 80, y: 20 } },
    { id: "b-lobby", zoneType: "lobby", at: { x: 20, y: 80 } },
    { id: "b-main", zoneType: "main", at: { x: 20, y: 50 } },
    { id: "b-site", zoneType: "site", site: "B", at: { x: 20, y: 20 } },
    { id: "link", zoneType: "connector", at: { x: 50, y: 20 } },
  ];
  const edges = [
    ["attacker-spawn", "a-lobby", 9000], ["attacker-spawn", "b-lobby", 9000],
    ["a-lobby", "a-main", 2500], ["a-main", "a-site", 2500], ["b-lobby", "b-main", 2500], ["b-main", "b-site", 2500],
    ["a-site", "link", 2000], ["link", "b-site", 2000],
  ] as const;
  const map = new GraphStub(zones, edges, [["a-main", "a-site"], ["b-main", "b-site"], ["link", "a-site"], ["link", "b-site"]]);
  const A_LOBBY = { x: 80, y: 80, z: 0 };
  const A_SITE = { x: 80, y: 20, z: 0 };
  const planMoves = (policy: TeamDecisionPolicy, view: PolicyView, seed: number) =>
    policy.decide(view, rng(seed)).commands.filter((c) => c.sourceActionId?.startsWith("plan:"));

  it("a team at A lobby whose plan is B goes back through spawn; the same team with an A plan stays", () => {
    const view = attackView(A_LOBBY);
    const b = policyOpening("bExecute", view, map);
    const toB = planMoves(b.policy, { ...view, timeRemainingMs: 94_000 }, b.seed);
    expect(toB.length).toBeGreaterThan(0);
    expect(toB.every((c) => c.kind === "move" && c.targetZone === "attacker-spawn")).toBe(true);
    const a = policyOpening("aExecute", view, map);
    const toA = planMoves(a.policy, { ...view, timeRemainingMs: 94_000 }, a.seed);
    expect(toA.some((c) => c.targetZone === "attacker-spawn")).toBe(false);
  });

  it("the carrier plants on the plan's site only: standing on A with a B plan it keeps moving", () => {
    const view = attackView(A_SITE);
    const carrier = String(view.spike.holderId);
    const a = policyOpening("aExecute", view, map);
    expect(a.policy.decide({ ...view, timeRemainingMs: 94_000 }, rng(a.seed)).commands.find((c) => String(c.playerId) === carrier)?.kind).toBe("plant");
    const b = policyOpening("bExecute", view, map);
    expect(b.policy.decide({ ...view, timeRemainingMs: 94_000 }, rng(b.seed)).commands.find((c) => String(c.playerId) === carrier)?.kind).not.toBe("plant");
  });
});

describe("a fake shows presence without leaving a body in the site's sightline", () => {
  it("the showing players stop at the last zone the feint site cannot see", () => {
    const view = attackView(SPAWN);
    const { policy, seed } = policyOpening("fakeAtoB", view);
    const feint = policy.decide({ ...view, timeRemainingMs: 94_000 }, rng(seed)).commands.filter((c) => c.sourceActionId === "plan:feint-move");
    expect(feint.length).toBeGreaterThan(0);
    for (const c of feint) {
      expect(ascent.hasLineOfSight(c.targetZone!, z("a-site"))).toBe(false);
      expect(c.aimZone).toBe("a-site"); // and they watch the site they are showing on
    }
  });
});

describe("the lurker is one designated player, not whoever is last alive", () => {
  const view = attackView(SPAWN);
  const ids = view.teammates.map((p) => p.id);
  const profiles = new Map(ids.map((id, i) => [String(id), profile(id, 0.9 - i * 0.15)])); // last player is the least aggressive
  const lurkers = (v: PolicyView) => assignRoles(v, "default", profiles, rng(1)).filter((r) => r.role === "lurker").map((r) => String(r.playerId));
  const kill = (...dead: number[]): PolicyView => ({ ...view, teammates: view.teammates.map((p, i) => ({ ...p, alive: !dead.includes(i) })) });

  it("five alive: the least aggressive player lurks", () => {
    expect(lurkers(view)).toEqual([String(ids[4])]);
  });
  it("counterfactual — the lurker dies: nobody takes the role over (no trickle of lurkers)", () => {
    expect(lurkers(kill(4))).toEqual([]);
  });
  it("counterfactual — someone else dies: the same player still lurks", () => {
    expect(lurkers(kill(1))).toEqual([String(ids[4])]);
  });
  it("a team down to three keeps nobody back", () => {
    expect(lurkers(kill(0, 1))).toEqual([]);
  });

  it("in slow play the lurker holds the approach to the OTHER site, out of its sight", () => {
    const { policy, seed } = policyOpening("midControl", view);
    policy.setProfiles(profiles);
    const cmds = policy.decide({ ...view, timeRemainingMs: 94_000 }, rng(seed)).commands;
    const lurk = cmds.filter((c) => c.sourceActionId?.startsWith("plan:lurk"));
    const lanes = new Set(cmds.filter((c) => c.sourceActionId === "plan:slow-move").map((c) => c.targetZone));
    expect(lurk).toHaveLength(1);
    expect(String(lurk[0]!.playerId)).toBe(String(ids[4]));
    expect(lanes.size).toBe(1);
    expect(lanes.has(lurk[0]!.targetZone)).toBe(false);
    expect(ascent.hasLineOfSight(lurk[0]!.targetZone!, lurk[0]!.aimZone!)).toBe(false);
  });
});

describe("attack save: a lost round is given up only for gear worth keeping", () => {
  const decide = (view: PolicyView, policy = new TeamDecisionPolicy(ascent)) => policy.decideWithTrace(view, rng(3));
  const saves = (r: ReturnType<typeof decide>) => r.decision.commands.length > 0 && r.decision.commands.every((c) => c.sourceActionId?.startsWith("attack-save"));
  const down = (alive: number, enemies: number, weaponId = "vandal") => attackView(SPAWN, { knownEnemyAliveCount: enemies }, alive, weaponId);

  it("1v3 before the plant is saved (Lanchester 0.10 < 0.15) and the plan records why", () => {
    const r = decide(down(1, 3));
    expect(saves(r)).toBe(true);
    expect(r.trace.finalStrategy).toBe("save");
    expect(r.trace.plan.revisions.at(-1)!.reason).toMatch(/round lost 1v3.*Lanchester 0\.10/);
  });
  it("counterfactual — one enemy fewer (1v2, 0.20): the round is played", () => {
    expect(saves(decide(down(1, 2)))).toBe(false);
  });
  it("2v4 plays (0.20), 2v5 saves (0.14)", () => {
    expect(saves(decide(down(2, 4)))).toBe(false);
    expect(saves(decide(down(2, 5)))).toBe(true);
  });
  it("counterfactual — same 1v3 with a gun the loss bonus buys back: nothing to save, play it out", () => {
    const price = (id: string) => ({ vandal: 2900, spectre: 1600, classic: 0 })[id];
    const withPrices = () => new TeamDecisionPolicy(ascent, { weaponPrice: price });
    expect(saves(decide(down(1, 3, "vandal"), withPrices()))).toBe(true);
    expect(saves(decide(down(1, 3, "spectre"), withPrices()))).toBe(false);
    expect(saves(decide(down(1, 3, "classic"), withPrices()))).toBe(false);
    // The value a team still saves is a pre-match option.
    const thrifty = withPrices();
    thrifty.setTuning({ saveMinWeaponValue: 1500 });
    expect(saves(decide(down(1, 3, "spectre"), thrifty))).toBe(true);
  });
  it("counterfactual — a hero-play last man takes the 1v3", () => {
    const view = down(1, 3);
    const policy = new TeamDecisionPolicy(ascent);
    policy.setProfiles(new Map([[String(view.teammates[0]!.id), profile(view.teammates[0]!.id, 0.9)]]));
    expect(saves(decide(view, policy))).toBe(false);
  });
  it("the save holds through one pick and is lifted when the man count is even again", () => {
    const policy = new TeamDecisionPolicy(ascent);
    expect(saves(decide(down(1, 3), policy))).toBe(true);
    expect(saves(decide({ ...down(1, 2), timeRemainingMs: 94_000 }, policy))).toBe(true);
    const even = decide({ ...down(1, 1), timeRemainingMs: 93_000 }, policy);
    expect(saves(even)).toBe(false);
    expect(even.trace.plan.revisions.at(-1)!.reason).toMatch(/even again/);
  });
  it("after the plant the attack never saves", () => {
    const planted = attackView(SPAWN, { knownEnemyAliveCount: 3, spike: { phase: "planted", position: { x: 780, y: 360, z: 0 }, holderId: null, detonationInMs: 30_000 } }, 1);
    expect(saves(decide(planted))).toBe(false);
  });
});

describe("defense exit-kill chase: the throw hazard applied to a won round", () => {
  /** Pre-plant defense view: `alive` defenders vs `attackers`, nobody in sight. */
  const holding = (attackers: number, timeRemainingMs: number, over: Partial<PolicyView> = {}): PolicyView => {
    const base = loadView("03");
    return {
      ...base, roundNumber: 5, timeRemainingMs, knownEnemyAliveCount: attackers,
      economy: { ...base.economy, credits: 4500 },
      teammates: base.teammates.map((p) => ({ ...p, alive: true })),
      spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
      observation: { ...base.observation, visibleEnemies: [], audibleEvents: [] },
      belief: { ...base.belief, enemyPositionBeliefs: [] },
      ...over,
    };
  };
  /** Distinct players who chased within 40 s of holding (80 decisions), for one roster profile. */
  const chasers = (attackers: number, p: { aggression: number; discipline: number; decisionMaking: number }, mutate: (v: PolicyView) => PolicyView = (v) => v): number => {
    const policy = new TeamDecisionPolicy(ascent);
    const first = holding(attackers, 90_000);
    policy.setProfiles(new Map(first.teammates.map((t) => [String(t.id), { playerId: t.id, teamwork: 0.5, ...p }])));
    const stream = rng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      for (const c of policy.decide(mutate(holding(attackers, 90_000 - i * 500)), stream).commands) {
        if (c.sourceActionId?.startsWith("throw:chase")) seen.add(String(c.playerId));
      }
    }
    return seen.size;
  };
  const reckless = { aggression: 0.9, discipline: 0.2, decisionMaking: 0.2 };
  const composed = { aggression: 0.2, discipline: 0.9, decisionMaking: 0.9 };

  it("an aggressive, undisciplined roster leaves its angles to chase a beaten attack (5 defenders v 1)", () => {
    expect(chasers(1, reckless)).toBeGreaterThanOrEqual(3);
  });
  it("counterfactual — a disciplined roster in the same spot lets them go", () => {
    expect(chasers(1, composed)).toBe(0);
  });
  it("counterfactual — the round is not won yet (5v5): even the reckless roster holds", () => {
    expect(chasers(5, reckless)).toBe(0);
  });
  it("counterfactual — an attacker is in sight: the fight is finished first, nobody runs off", () => {
    const withContact = (v: PolicyView): PolicyView => ({
      ...v,
      observation: { ...v.observation, visibleEnemies: [{ playerId: "atk1" as never, agentId: null, lastSeenPosition: { x: 720, y: 615, z: 0 }, lastSeenAtMs: v.observation.timestampMs, healthBand: "unknown", observedWeaponId: null, currentlyVisible: true }] },
    });
    expect(chasers(1, reckless, withContact)).toBe(0);
  });
  it("a chase is recorded on the plan and sticks for the round", () => {
    const policy = new TeamDecisionPolicy(ascent);
    const first = holding(1, 90_000);
    policy.setProfiles(new Map(first.teammates.map((t) => [String(t.id), { playerId: t.id, teamwork: 0.5, ...reckless }])));
    const stream = rng(11);
    let chasing = 0;
    for (let i = 0; i < 80; i++) chasing = policy.decide(holding(1, 90_000 - i * 500), stream).commands.filter((c) => c.sourceActionId?.startsWith("throw:chase")).length;
    expect(chasing).toBeGreaterThanOrEqual(3);
    expect(policy.planSummary()!.revisions.some((r) => /chase the exit kill/.test(r.reason))).toBe(true);
  });
});
