// A third site (Haven, Lotus): the IGL reasons over three sites only when the map has three.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { selectStrategy, reconsider, viewFromTeamContext } from "@pv/team-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { PolicyView, TeamStrategy } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const THREE = ["A", "B", "C"] as const;

/** A map whose zones are told by the x coordinate: x < 100 → A, < 200 → B, else C. */
const base = new AscentSpatialStub();
const spatial = Object.assign(Object.create(base) as AscentSpatialStub, {
  nearestZone: (p: { x: number }) => (p.x < 100 ? "a-site" : p.x < 200 ? "b-site" : "c-site"),
});
const seenAt = (view: PolicyView, xs: number[]): PolicyView => ({
  ...view,
  observation: {
    ...view.observation, audibleEvents: [],
    visibleEnemies: xs.map((x, i) => ({ playerId: `e${i}`, agentId: null, lastSeenPosition: { x, y: 0, z: 0 }, lastSeenAtMs: view.observation.timestampMs, healthBand: "unknown", observedWeaponId: null, currentlyVisible: true })) as unknown as PolicyView["observation"]["visibleEnemies"],
  },
  belief: { ...view.belief, enemyPositionBeliefs: [], threatZones: [] },
});
const attack = (): PolicyView => seenAt({ ...loadView("01"), roundNumber: 5 }, []);
const defense = (): PolicyView => seenAt({ ...loadView("03"), roundNumber: 5, economy: { ...loadView("03").economy, credits: 4500 } }, []);
const count = (f: (i: number) => TeamStrategy, n = 400): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const s = f(i); out[s] = (out[s] ?? 0) + 1; }
  return out;
};

describe("three sites", () => {
  it("attack: with no read, all three sites are executed; a two-site map never calls C", () => {
    const three = count((i) => selectStrategy(attack(), spatial, rng(i), undefined, THREE));
    for (const s of ["aExecute", "bExecute", "cExecute"]) expect(three[s] ?? 0, s).toBeGreaterThan(40);
    const two = count((i) => selectStrategy(attack(), spatial, rng(i)));
    expect(two["cExecute"]).toBeUndefined();
    expect(two["stackC"]).toBeUndefined();
  });

  it("attack: the site that looks thin is called more often than the one that looks defended", () => {
    const stackedC = count((i) => selectStrategy(seenAt(attack(), [250, 250, 250]), spatial, rng(i), undefined, THREE));
    expect(stackedC["cExecute"] ?? 0).toBeLessThan(Math.min(stackedC["aExecute"]!, stackedC["bExecute"]!));
    const stackedA = count((i) => selectStrategy(seenAt(attack(), [50, 50, 50]), spatial, rng(i), undefined, THREE));
    expect(stackedA["cExecute"]!).toBeGreaterThan(stackedA["aExecute"] ?? 0);
  });

  it("defense: enemies shown on C make it the stack; on a two-site map the same view does not", () => {
    const v = seenAt(defense(), [250, 250]);
    expect(selectStrategy(v, spatial, rng(1), undefined, THREE)).toBe("stackC");
    expect(count((i) => selectStrategy(v, spatial, rng(i)))["stackC"]).toBeUndefined();
  });

  it("attack mid-round: swings off a stacked C onto the thinner of A and B, and onto C when A is stacked", () => {
    const offC = reconsider(seenAt(attack(), [250, 250, 150]), spatial, "cExecute", rng(1), THREE);
    expect(offC).toMatchObject({ changed: true, strategy: "aExecute" });
    const offA = reconsider(seenAt(attack(), [50, 50, 150]), spatial, "aExecute", rng(1), THREE);
    expect(offA).toMatchObject({ changed: true, strategy: "cExecute" });
    expect(reconsider(seenAt(attack(), [250]), spatial, "cExecute", rng(1), THREE).changed).toBe(false); // one sighting is not a stack
  });
});
