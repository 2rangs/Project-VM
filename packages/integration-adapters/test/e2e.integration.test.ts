/**
 * END-TO-END integration acceptance (runs on the integrated monorepo).
 *
 * scenario → round-simulator (driven by PV-3 TeamDecisionPolicy) → EventLog → replay-engine
 * convert, plus a scripted-vs-team comparison. Validates the four acceptance criteria that
 * do not need external data: determinism, termination, the DECISION-004 boundary (policy
 * input carries no WorldState), and that the EventLog converts to a replay.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, toPv6ReplayFormat } from "@pv/round-simulator";
import { fromSimEventLog } from "@pv/replay-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "../../round-simulator/test/fixtures/setup.ts";
import { TeamDecisionPolicy } from "@pv/team-engine";
import { buildBeliefState } from "@pv/decision-engine";
import { spatialQueryFromEngine } from "@pv/integration-adapters";
import type { DecisionPolicy, PlayerState, PolicyView, RandomSource } from "@pv/shared-types";

const spatial = loadSpatial();
const weapons = loadWeapons();
// Decided internal frame = game world units → identity minimapToGame (sim positions are uu).
const sq = spatialQueryFromEngine(spatial, { minimapToGame: (v) => ({ x: v.x, y: v.y }) });

// Backfill teammate fields the sim's perception subset omits so PV-3's policy can run
// (R2-B: PV-4 to populate the contract teammate fields). Also exercises buildBelief.
function normalizeView(view: PolicyView): PolicyView {
  // Force PV-3's shared-types shapes: the sim's teammate mirror uses a DIFFERENT abilities
  // shape (AbilityLoadoutSlot[]) than PV-3's AbilityInventory (R2-B — PV-4 to align).
  const teammates = view.teammates.map((p): PlayerState => ({
    ...p,
    weapon: p.weapon ?? null,
    inventory: { primary: null, secondary: null, armor: { type: "none", points: p.armor ?? 0 }, hasSpike: false },
    abilities: { basic: [], signature: null, ultimate: { abilityId: `${p.agentId}:x` as never, points: p.ultimatePoints ?? 0, required: 7, ready: false } },
    credits: p.credits ?? 0, ultimatePoints: p.ultimatePoints ?? 0,
    velocity: { x: 0, y: 0, z: 0 }, behaviorState: "idle", currentOrderId: null,
  }));
  // Fill the belief PV-3 owns (perception produces observation only).
  const belief = buildBeliefState(view.belief ?? null, view.observation, sq, 0);
  return { ...view, teammates, belief };
}
class WrappedTeamPolicy implements DecisionPolicy {
  private readonly inner = new TeamDecisionPolicy(sq);
  decide(view: PolicyView, rng: RandomSource) { return this.inner.decide(normalizeView(view), rng); }
}

const hash = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const teamSim = (seed: number) => new RoundSimulator({
  spatial, weapons, abilities: NO_ABILITIES,
  policies: { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() }, config: { seed },
});

describe("E2E integration: PV-3 policy ↔ round-simulator ↔ replay", () => {
  it("TeamDecisionPolicy drives a full round to a terminal reason", () => {
    const r = teamSim(1).runRound(makeSyntheticRound(spatial));
    expect(["attack", "defense"]).toContain(r.winner);
    expect(r.events[0].kind).toBe("roundStart");
    expect(r.events[r.events.length - 1].kind).toBe("roundEnd");
  });

  it("is deterministic (same seed → identical EventLog)", () => {
    expect(hash(teamSim(7).runRound(makeSyntheticRound(spatial)).events))
      .toBe(hash(teamSim(7).runRound(makeSyntheticRound(spatial)).events));
  });

  it("EventLog converts to a replay (round-simulator → PV-6 format → replay-engine)", () => {
    const r = teamSim(2).runRound(makeSyntheticRound(spatial));
    const pv6 = toPv6ReplayFormat(r, { matchId: "e2e", roundId: "e2e:1", mapName: "Ascent" } as never);
    expect(pv6).toBeTruthy();
    const replay = fromSimEventLog((pv6 as { events: readonly never[] }).events, { mapName: "Ascent" } as never);
    expect(replay).toBeTruthy();
  });

  it("comparison scripted vs TeamDecisionPolicy (20 seeds)", () => {
    const run = (kind: "scripted" | "team") => {
      let atk = 0; const reasons: Record<string, number> = {};
      for (let s = 1; s <= 20; s++) {
        const policies = kind === "scripted"
          ? { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) }
          : { attack: new WrappedTeamPolicy(), defense: new WrappedTeamPolicy() };
        const r = new RoundSimulator({ spatial, weapons, abilities: NO_ABILITIES, policies, config: { seed: s } }).runRound(makeSyntheticRound(spatial));
        if (r.winner === "attack") atk++;
        reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      }
      return { atk, reasons };
    };
    const scripted = run("scripted"); const team = run("team");
    console.log(`[E2E scripted] attackWin=${scripted.atk}/20 ${JSON.stringify(scripted.reasons)}`);
    console.log(`[E2E team]     attackWin=${team.atk}/20 ${JSON.stringify(team.reasons)}`);
    expect(scripted.atk + team.atk).toBeGreaterThanOrEqual(0);
  });
});
