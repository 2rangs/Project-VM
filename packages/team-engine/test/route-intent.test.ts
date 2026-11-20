// Route intent (Phase 4): a move order says HOW it wants to get there, by what it is for, and what
// it avoids comes from the team's belief — never from true enemy positions.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TeamDecisionPolicy, annotateRoutes, beliefZoneCosts, routeIntentOf, viewFromTeamContext } from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { ActionCommand, PolicyView, TeamStrategy } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const SPAWN = { x: 500, y: 905, z: 0 };

function attackView(over: Partial<PolicyView> = {}, weaponId = "Vandal"): PolicyView {
  const v = viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", "scenario_01.json"), "utf8"))));
  const teammates = v.teammates.map((p) => ({ ...p, alive: true, position: SPAWN, weapon: { ...p.weapon, weaponId } })) as unknown as PolicyView["teammates"];
  return {
    ...v, roundNumber: 5, timeRemainingMs: 95_000, knownEnemyAliveCount: 5,
    economy: { ...v.economy, credits: 4500 },
    teammates,
    spike: { phase: "carried", position: null, holderId: teammates[0]!.id, detonationInMs: null },
    observation: { ...v.observation, visibleEnemies: [], audibleEvents: [] },
    belief: { ...v.belief, enemyPositionBeliefs: [], threatZones: [] },
    ...over,
  };
}
const withThreat = (v: PolicyView, threat: Record<string, number>): PolicyView =>
  ({ ...v, belief: { ...v.belief, threatZones: Object.entries(threat).map(([zoneId, threatLevel]) => ({ zoneId, threatLevel })) } });
const move = (v: PolicyView, i: number, over: Partial<ActionCommand> = {}): ActionCommand =>
  ({ playerId: v.teammates[i]!.id, kind: "move", targetZone: "b-site", moveMode: "run", executeAtMs: 0, ...over } as ActionCommand);
const roles = (v: PolicyView, r: Record<number, string>) => new Map(Object.entries(r).map(([i, role]) => [String(v.teammates[Number(i)]!.id), role]));
const forced = (strategy: TeamStrategy) => { const p = new TeamDecisionPolicy(spatial); p.setOrder({ strategy }); return p; };

describe("route intent: the purpose of an order picks its route preference", () => {
  it("entry, execute, retake, defuser, spike recovery and chase all take the fastest route and carry no zone costs", () => {
    const v = withThreat(attackView(), { "mid-courtyard": 0.9 });
    const cmds = annotateRoutes(v, "aExecute", roles(v, { 0: "entry" }), [
      move(v, 0, { sourceActionId: "plan:exec-move" }),
      move(v, 1, { sourceActionId: "retake-go:move" }),
      move(v, 2, { sourceActionId: "defuser-commit:move" }),
      move(v, 3, { sourceActionId: "spike-recover" }),
      move(v, 4, { sourceActionId: "throw:chase" }),
    ]);
    expect(cmds.map((c) => c.routePreference)).toEqual(["FASTEST", "FASTEST", "FASTEST", "FASTEST", "FASTEST"]);
    for (const c of cmds) expect(c.zoneCosts).toBeUndefined();
    expect(routeIntentOf(cmds[0]!, "entry", "aExecute")).toBe("entry");
    expect(routeIntentOf(cmds[1]!, undefined, "retakeA")).toBe("retake");
    expect(routeIntentOf(cmds[3]!, undefined, "default")).toBe("recover");
    expect(routeIntentOf(cmds[4]!, undefined, "defaultHold")).toBe("chase");
  });

  it("a saver with a rifle takes the safest route from the team's belief; with a pistol it does not pay for the detour", () => {
    const threat = { "mid-courtyard": 0.8, "b-main": 0.25 };
    const rifle = withThreat(attackView({}, "Vandal"), threat);
    const pistol = withThreat(attackView({}, "Classic"), threat);
    const [r] = annotateRoutes(rifle, "default", new Map(), [move(rifle, 1, { sourceActionId: "attack-save:move", targetZone: "attacker-spawn" })]);
    const [p] = annotateRoutes(pistol, "default", new Map(), [move(pistol, 1, { sourceActionId: "attack-save:move", targetZone: "attacker-spawn" })]);
    expect(r!.routePreference).toBe("SAFEST");
    expect(p!.routePreference).toBe("TACTICAL");
    // the costs are the belief's threat levels, scaled — nothing else
    expect(r!.zoneCosts).toEqual(beliefZoneCosts(rifle));
    expect(Object.keys(r!.zoneCosts!).sort()).toEqual(["b-main", "mid-courtyard"]);
    expect(r!.zoneCosts!["mid-courtyard"]!).toBeGreaterThan(r!.zoneCosts!["b-main"]!);
    // a post-plant save is a save too, and so is every move of a round the team called a save
    expect(annotateRoutes(rifle, "default", new Map(), [move(rifle, 2, { sourceActionId: "postplant-save:move" })])[0]!.routePreference).toBe("SAFEST");
    expect(annotateRoutes(rifle, "save", new Map(), [move(rifle, 2, { sourceActionId: "plan:slow-move" })])[0]!.routePreference).toBe("SAFEST");
  });

  it("a lurker keeps off the lanes the rest of the team is taking, and away from believed enemies", () => {
    const base = withThreat(attackView(), { "a-main": 0.5 });
    const teammates = base.teammates.map((p, i) => (i === 1 ? { ...p, transit: { path: ["attacker-spawn", "b-lobby", "b-main", "b-site"] } } : p)) as PolicyView["teammates"];
    const v = { ...base, teammates };
    const [c] = annotateRoutes(v, "bExecute", roles(v, { 3: "lurker" }), [move(v, 3, { sourceActionId: "plan:lurk-move", targetZone: "b-site" })]);
    expect(c!.routePreference).toBe("SAFEST");
    expect(c!.zoneCosts!["b-lobby"]).toBeGreaterThan(0);
    expect(c!.zoneCosts!["b-main"]).toBeGreaterThan(0);
    expect(c!.zoneCosts!["b-site"]).toBeUndefined(); // its own goal is not priced
    expect(c!.zoneCosts!["a-main"]).toBeGreaterThan(0);
    // the same order for a player who is not the lurker goes the fast way with the team
    expect(annotateRoutes(v, "bExecute", new Map(), [move(v, 3, { sourceActionId: "plan:lurk-move" })])[0]!.routePreference).toBe("FASTEST");
  });

  it("a walked approach is a stealth route; holds, plants and orders that already chose are left alone", () => {
    const v = withThreat(attackView(), { "mid-top": 0.4 });
    const hold: ActionCommand = { playerId: v.teammates[0]!.id, kind: "hold", executeAtMs: 0 } as ActionCommand;
    const chosen = move(v, 2, { routePreference: "TACTICAL" });
    const out = annotateRoutes(v, "default", new Map(), [move(v, 1, { moveMode: "walk" }), hold, chosen]);
    expect(out[0]!.routePreference).toBe("STEALTH");
    expect(out[0]!.zoneCosts).toEqual({ "mid-top": 0.4 * 4 });
    expect(out[1]).toBe(hold);
    expect(out[2]).toBe(chosen);
  });

  it("the same order under a different belief asks for a different route; with no belief there is nothing to avoid", () => {
    const calm = attackView();
    const a = annotateRoutes(withThreat(calm, { "b-main": 0.9 }), "save", new Map(), [move(calm, 1)])[0]!;
    const b = annotateRoutes(withThreat(calm, { "mid-courtyard": 0.9 }), "save", new Map(), [move(calm, 1)])[0]!;
    const none = annotateRoutes(calm, "save", new Map(), [move(calm, 1)])[0]!;
    expect(a.zoneCosts).not.toEqual(b.zoneCosts);
    expect(none.routePreference).toBe("SAFEST");
    expect(none.zoneCosts).toEqual({});
  });
});

describe("route intent: what the policy really emits", () => {
  it("every move order of a decision carries a route preference", () => {
    for (const strategy of ["aExecute", "bExecute", "default", "save"] as const) {
      const d = forced(strategy).decide(attackView(), rng(3));
      const moves = d.commands.filter((c) => c.kind === "move");
      expect(moves.length, strategy).toBeGreaterThan(0);
      for (const c of moves) expect(c.routePreference, `${strategy} ${c.sourceActionId}`).toBeDefined();
    }
  });

  it("an execute runs in on the fastest route; a called save with rifles routes away from where the enemy is believed to be", () => {
    const view = withThreat(attackView(), { "a-main": 0.7 });
    const exec = forced("aExecute").decide(view, rng(3)).commands.filter((c) => c.kind === "move" && c.moveMode !== "walk");
    for (const c of exec) if (routeIntentOf(c, undefined, "aExecute") !== "lurk") expect(["FASTEST", "SAFEST"]).toContain(c.routePreference);
    expect(exec.some((c) => c.routePreference === "FASTEST")).toBe(true);
    const save = forced("save").decide(view, rng(3)).commands.filter((c) => c.kind === "move");
    expect(save.length).toBeGreaterThan(0);
    for (const c of save) {
      expect(c.routePreference).toBe("SAFEST");
      expect(c.zoneCosts!["a-main"]).toBeCloseTo(0.7 * 4);
    }
  });
});
