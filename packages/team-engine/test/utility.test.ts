import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TeamDecisionPolicy, viewFromTeamContext } from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { ActionCommand, PolicyView } from "@pv/shared-types";
import {
  enemyEvidenceByZone, planUtility, utilityWants, withinReach, STALL_EVIDENCE_MIN,
  type UtilityAbilityFact, type UtilityKnownEffect, type UtilityTransit, type UtilityView,
} from "../src/utility.js";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));

/** Zone anchors of the test map (minimap units). */
const AT: Record<string, { x: number; y: number; z: number }> = {
  "a-lobby": { x: 650, y: 820, z: 0 }, "a-main": { x: 720, y: 615, z: 0 }, "a-site": { x: 780, y: 360, z: 0 },
  "b-main": { x: 280, y: 615, z: 0 }, "b-site": { x: 230, y: 360, z: 0 }, "defender-spawn": { x: 500, y: 120, z: 0 },
};
const FIRE = "kj:fire", SLOW = "sage:slow", SMOKE = "omen:smoke", SHORT_SMOKE = "jett:smoke", FLASH = "kayo:flash", RECON = "sova:recon", DASH = "jett:dash";
const EFFECT: Record<string, string> = { [FIRE]: "molly", [SLOW]: "slow", [SMOKE]: "smoke", [SHORT_SMOKE]: "smoke", [FLASH]: "flash", [RECON]: "recon", [DASH]: "movement" };
const effectOf = (id: string): string | undefined => EFFECT[id];
const FACTS: Record<string, UtilityAbilityFact> = {
  [FIRE]: { effectType: "molly", durationMs: 5000 }, [SLOW]: { effectType: "slow", durationMs: 7000 },
  [SMOKE]: { effectType: "smoke", durationMs: 15000 }, [SHORT_SMOKE]: { effectType: "smoke", durationMs: 2500 },
  [FLASH]: { effectType: "flash", durationMs: 2000, flashDurationMs: 2000 }, [RECON]: { effectType: "recon", durationMs: null },
};

interface Mate { zone: string; abilities?: string[]; transit?: UtilityTransit }
interface Extra {
  heard?: Array<{ zone: string; kind?: "footstep" | "gunfire" | "abilityCast"; confidence: number; ageMs?: number }>;
  seen?: Array<{ zone: string; visible?: boolean }>;
  effects?: UtilityKnownEffect[];
  spike?: PolicyView["spike"];
}

/** A view of `side` with the given living teammates (the rest are dead) and observations. */
function view(side: "attack" | "defense", mates: Mate[], x: Extra = {}): UtilityView {
  const v = loadView(side === "attack" ? "01" : "03");
  const now = 60_000;
  const teammates = v.teammates.map((p, i) => {
    const m = mates[i];
    if (!m) return { ...p, alive: false };
    return {
      ...p, alive: true, position: AT[m.zone]!,
      abilities: { ...p.abilities, basic: (m.abilities ?? []).map((id) => ({ abilityId: id as never, charges: 1 })), signature: null },
      ...(m.transit ? { transit: m.transit } : {}),
    };
  });
  return {
    ...v, timeRemainingMs: now, teammates,
    spike: x.spike ?? { phase: "carried", position: null, holderId: side === "attack" ? teammates[4]!.id : null, detonationInMs: null },
    observation: {
      ...v.observation, timestampMs: now,
      visibleEnemies: (x.seen ?? []).map((e, i) => ({
        playerId: `enemy${i}` as never, agentId: null, lastSeenPosition: AT[e.zone]!, lastSeenAtMs: now,
        healthBand: "unknown" as const, observedWeaponId: null, currentlyVisible: e.visible ?? true,
      })),
      audibleEvents: (x.heard ?? []).map((h) => ({ kind: h.kind ?? "footstep", approxPosition: AT[h.zone]!, heardAtMs: now - (h.ageMs ?? 0), confidence: h.confidence })),
      knownMapChanges: [],
    },
    belief: { ...v.belief, enemyPositionBeliefs: [] },
    abilityFacts: FACTS,
    visibleEffects: x.effects ?? [],
  };
}
const holds = (v: PolicyView): ActionCommand[] => v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const }));
const casts = (cmds: readonly ActionCommand[]) => cmds.filter((c) => c.kind === "useAbility").map((c) => `${String(c.abilityId)}→${String(c.targetZone)}`);
const plan = (v: UtilityView, cmds: readonly ActionCommand[] = holds(v)) => planUtility(v, "defaultHold", cmds, spatial, effectOf);

/** Running footsteps at A main as a holder on A site hears them (0.8 loudness × 0.8 propagation). */
const STEPS_AT_A_MAIN = { zone: "a-main", confidence: 0.64 };

describe("abilities off: the utility layer does nothing", () => {
  it("with no ability knowledge the commands come back unchanged", () => {
    const v = { ...view("defense", [{ zone: "a-site", abilities: [FIRE] }], { heard: [STEPS_AT_A_MAIN] }), abilityFacts: undefined };
    const cmds = holds(v);
    expect(planUtility(v, "defaultHold", cmds, spatial, undefined)).toEqual(cmds);
    expect(utilityWants(v, spatial, undefined)).toEqual([]);
  });
});

describe("no cast without a purpose", () => {
  it("an untargeted cast drawn by a player is turned back into a hold", () => {
    const v = view("defense", [{ zone: "a-site", abilities: [FIRE] }]);
    const out = plan(v, [{ playerId: v.teammates[0]!.id, kind: "useAbility", abilityId: FIRE as never }]);
    expect(casts(out)).toEqual([]);
    expect(out[0]).toMatchObject({ kind: "hold", sourceActionId: "utility:no-purpose" });
  });

  it("a targeted request that serves no purpose is dropped too; a targeted dash is not ours to judge", () => {
    const v = view("attack", [{ zone: "a-lobby", abilities: [FLASH, DASH] }, { zone: "a-lobby", abilities: [DASH] }]);
    const out = plan(v, [
      { playerId: v.teammates[0]!.id, kind: "useAbility", abilityId: FLASH as never, targetZone: "a-main" as never }, // nobody is about to be exposed
      { playerId: v.teammates[1]!.id, kind: "useAbility", abilityId: DASH as never, targetZone: "a-main" as never },
    ]);
    expect(casts(out)).toEqual([`${DASH}→a-main`]);
  });

  it("plant and defuse are never replaced by a cast", () => {
    const v = view("defense", [{ zone: "a-site", abilities: [FIRE] }], { heard: [STEPS_AT_A_MAIN] });
    const out = plan(v, [{ playerId: v.teammates[0]!.id, kind: "defuse" }]);
    expect(out).toEqual([{ playerId: v.teammates[0]!.id, kind: "defuse" }]);
  });
});

describe("stall — utility on the door the enemy is coming through (counterfactuals on one holder)", () => {
  const holder: Mate = { zone: "a-site", abilities: [FIRE, SMOKE] };

  it("no evidence → nothing is spent", () => {
    expect(casts(plan(view("defense", [holder])))).toEqual([]);
  });

  it("footsteps heard at the door → fire on it, for that reason", () => {
    const v = view("defense", [holder], { heard: [STEPS_AT_A_MAIN] });
    expect(enemyEvidenceByZone(v, spatial).get("a-main")).toBeCloseTo(0.64 * 0.6);
    const out = plan(v);
    expect(casts(out)).toEqual([`${FIRE}→a-main`]);
    expect(out[0]!.sourceActionId).toBe("utility:stall:molly");
    expect(utilityWants(v, spatial, effectOf)[0]).toMatchObject({ purpose: "stall", target: "a-main" });
  });

  it("the same noise far from any door we hold → nothing", () => {
    const v = view("defense", [holder], { heard: [{ zone: "b-main", confidence: 0.64 }] });
    expect(withinReach(spatial, "a-site" as never, "b-main" as never)).toBe(false);
    expect(casts(plan(v))).toEqual([]);
  });

  it("evidence under the threshold (an old, faint sound) → nothing", () => {
    const v = view("defense", [holder], { heard: [{ zone: "a-main", confidence: 0.64, ageMs: 6000 }] });
    expect(enemyEvidenceByZone(v, spatial).get("a-main")!).toBeLessThan(STALL_EVIDENCE_MIN);
    expect(casts(plan(v))).toEqual([]);
  });

  it("a teammate is standing in that zone → we do not burn our own", () => {
    const v = view("defense", [holder, { zone: "a-main" }], { heard: [STEPS_AT_A_MAIN] });
    expect(casts(plan(v))).toEqual([]);
  });

  it("the door is already denied by us → the next ability waits (they chain, they are not stacked)", () => {
    const burning = view("defense", [holder], { heard: [STEPS_AT_A_MAIN], effects: [{ zoneId: "a-main", effectType: "molly", own: true, remainingMs: 3000 }] });
    expect(casts(plan(burning))).toEqual([]);
    // An ENEMY smoke on the door is not our denial: the stall still goes.
    const theirs = view("defense", [holder], { heard: [STEPS_AT_A_MAIN], effects: [{ zoneId: "a-main", effectType: "smoke", own: false, remainingMs: 9000 }] });
    expect(casts(plan(theirs))).toEqual([`${FIRE}→a-main`]);
  });

  it("no fire to throw → a slow field, then a smoke, serves the same purpose", () => {
    const steps = { heard: [STEPS_AT_A_MAIN] };
    expect(casts(plan(view("defense", [{ zone: "a-site", abilities: [SLOW, SMOKE] }], steps)))).toEqual([`${SLOW}→a-main`]);
    expect(casts(plan(view("defense", [{ zone: "a-site", abilities: [SMOKE] }], steps)))).toEqual([`${SMOKE}→a-main`]);
    expect(casts(plan(view("defense", [{ zone: "a-site", abilities: [RECON] }], steps)))).toEqual([]);
  });

  it("the holder who can reach the door throws it; one out of reach does not", () => {
    const v = view("defense", [{ zone: "defender-spawn", abilities: [FIRE] }, { zone: "a-site" }], { heard: [STEPS_AT_A_MAIN] });
    expect(casts(plan(v))).toEqual([]); // the only fire is in spawn, which neither neighbours nor sees A main
  });

  it("an ability cue is evidence like any other: a smoke SEEN landing on the door triggers the stall", () => {
    const quiet = view("defense", [holder]);
    const smokeSeen = view("defense", [holder], { heard: [{ zone: "a-main", kind: "abilityCast", confidence: 0.5 }] });
    expect(casts(plan(quiet))).toEqual([]);
    expect(casts(plan(smokeSeen))).toEqual([`${FIRE}→a-main`]);
  });

  it("a saving team spends nothing", () => {
    const v = view("defense", [holder], { heard: [STEPS_AT_A_MAIN] });
    expect(casts(planUtility(v, "save", holds(v), spatial, effectOf))).toEqual([]);
  });
});

describe("cover — a smoke on the zone a teammate is about to step into in open sight", () => {
  const entry = (eta: number): Mate => ({ zone: "a-lobby", transit: { path: ["a-main", "a-site"], nextZone: "a-main", nextArrivalMs: eta } });

  it("counterfactual — timing: not while the entry is still far, yes once it is about to step out", () => {
    const smoker: Mate = { zone: "a-lobby", abilities: [SMOKE] };
    expect(casts(plan(view("attack", [entry(4000), smoker])))).toEqual([]);
    const out = plan(view("attack", [entry(1200), smoker]));
    expect(casts(out)).toEqual([`${SMOKE}→a-main`]);
    expect(out.find((c) => c.kind === "useAbility")!.sourceActionId).toBe("utility:cover:smoke");
  });

  it("counterfactual — already cut: with our smoke standing there, no second one", () => {
    const v = view("attack", [entry(1200), { zone: "a-lobby", abilities: [SMOKE] }], { effects: [{ zoneId: "a-main", effectType: "smoke", own: true, remainingMs: 12000 }] });
    expect(casts(plan(v))).toEqual([]);
  });

  it("counterfactual — duration: a smoke that would be gone before the far side is reached is not thrown", () => {
    // 1.2 s to the zone + 2.5 s across it = 3.7 s; the short smoke lasts 2.5 s.
    expect(casts(plan(view("attack", [entry(1200), { zone: "a-lobby", abilities: [SHORT_SMOKE] }])))).toEqual([]);
    expect(casts(plan(view("attack", [entry(1200), { zone: "a-lobby", abilities: [SHORT_SMOKE, SMOKE] }])))).toEqual([`${SMOKE}→a-main`]);
  });

  it("counterfactual — the far zone is ours: nothing to hide from", () => {
    const v = view("attack", [entry(1200), { zone: "a-lobby", abilities: [SMOKE] }, { zone: "a-site" }]);
    expect(casts(plan(v))).toEqual([]);
  });
});

describe("blind — a flash timed from the teammate's own arrival", () => {
  const entry = (eta: number, waiting = false): Mate => ({
    zone: "a-main", abilities: [FLASH],
    transit: { path: ["a-site"], nextZone: "a-site", nextArrivalMs: eta, ...(waiting ? { waitingAtEdge: true } : {}) },
  });
  const support: Mate = { zone: "a-main", abilities: [FLASH] };

  it("counterfactual — timing: thrown only when the blind (2 s) will still hold at arrival", () => {
    expect(casts(plan(view("attack", [entry(2600), support])))).toEqual([]); // would be over before the entry appears
    expect(casts(plan(view("attack", [entry(1200), support])))).toEqual([`${FLASH}→a-site`]);
  });

  it("the thrower is the teammate NOT about to walk out", () => {
    const v = view("attack", [entry(1200), support]);
    const cast = plan(v).find((c) => c.kind === "useAbility")!;
    expect(String(cast.playerId)).toBe(String(v.teammates[1]!.id));
    expect(cast.sourceActionId).toBe("utility:blind:flash");
  });

  it("counterfactual — already flashing that zone: not thrown twice", () => {
    const v = view("attack", [entry(1200), support], { effects: [{ zoneId: "a-site", effectType: "flash", own: true, remainingMs: 1500 }] });
    expect(casts(plan(v))).toEqual([]);
  });

  it("held up at a fire's edge: the flash is re-timed to when the fire is out", () => {
    expect(casts(plan(view("attack", [entry(3500, true), support])))).toEqual([]); // 3.5 s of fire left: too early
    expect(casts(plan(view("attack", [entry(1000, true), support])))).toEqual([`${FLASH}→a-site`]);
  });

  it("out of reach of the zone: no flash", () => {
    const far = view("attack", [{ ...entry(1200), abilities: [] }, { zone: "a-lobby", abilities: [FLASH] }]);
    expect(casts(plan(far))).toEqual([]);
  });
});

describe("scout — a recon late enough to still be a fresh call at contact", () => {
  const entry = (eta: number): Mate => ({ zone: "a-main", transit: { path: ["a-site"], nextZone: "a-site", nextArrivalMs: eta } });
  const sova: Mate = { zone: "a-main", abilities: [RECON] };

  it("counterfactual — timing and need", () => {
    expect(casts(plan(view("attack", [entry(3000), sova])))).toEqual([]); // the call would be stale at contact
    expect(casts(plan(view("attack", [entry(1200), sova])))).toEqual([`${RECON}→a-site`]);
    // With eyes on the zone already, the dart is kept.
    expect(casts(plan(view("attack", [entry(1200), sova], { seen: [{ zone: "a-site", visible: true }] })))).toEqual([]);
  });
});

describe("wired into the team policy by one call", () => {
  const rng = (seed: number) => new SeededRng(seed).stream("policy");

  it("the policy stalls on the evidence, and not without it (same view otherwise)", () => {
    const quiet = view("defense", [{ zone: "a-site", abilities: [FIRE] }, { zone: "a-site" }, { zone: "b-site" }]);
    const steps = view("defense", [{ zone: "a-site", abilities: [FIRE] }, { zone: "a-site" }, { zone: "b-site" }], { heard: [STEPS_AT_A_MAIN] });
    for (let seed = 0; seed < 10; seed++) {
      const withSteps = new TeamDecisionPolicy(spatial, { abilityEffect: effectOf }).decide(steps, rng(seed)).commands;
      const without = new TeamDecisionPolicy(spatial, { abilityEffect: effectOf }).decide(quiet, rng(seed)).commands;
      expect(casts(withSteps)).toEqual([`${FIRE}→a-main`]);
      expect(casts(without)).toEqual([]);
    }
  });

  it("is deterministic and draws no random numbers of its own", () => {
    const v = view("defense", [{ zone: "a-site", abilities: [FIRE] }, { zone: "b-site" }], { heard: [STEPS_AT_A_MAIN] });
    const a = new TeamDecisionPolicy(spatial, { abilityEffect: effectOf }).decide(v, rng(7));
    const b = new TeamDecisionPolicy(spatial, { abilityEffect: effectOf }).decide(v, rng(7));
    expect(a).toEqual(b);
    expect(plan(v)).toEqual(plan(v));
  });
});
