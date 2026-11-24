// The manager's plant preference (TeamMatchInputs.plantPreference) reaches the carrier, and every
// planted round records where the spike went down (RoundRecord.plant, replay spikePlanted.at).
import { describe, it, expect } from "vitest";
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../src/index.js";

const teams = simulatableTeamRefs();
const base: MatchConfig = { teamA: teams[0]!, teamB: teams[1]!, map: "Ascent", seed: 7, maxRounds: 12 };

describe("plant position", () => {
  it("records the plant spot on every planted round, in the result and in the replay", () => {
    const m = runMatch(base);
    const planted = m.rounds.filter((r) => r.planted);
    expect(planted.length).toBeGreaterThan(0);
    for (const r of planted) {
      expect(r.plant).toBeDefined();
      expect(r.plant!.zoneId).toMatch(/site/);
      expect(["default", "safe", "open", "cover", "near", "other"]).toContain(r.plant!.spotKind);
      const ev = r.replay.events.find((e) => e.kind === "spikePlanted") as { at?: unknown; spotKind?: string } | undefined;
      expect(ev?.at).toEqual(r.plant!.position);
      expect(ev?.spotKind).toBe(r.plant!.spotKind);
    }
    for (const r of m.rounds.filter((x) => !x.planted)) expect(r.plant).toBeUndefined();
  }, 60000);

  it("a team that prefers the open spot sets out for it on every site it plants", () => {
    const pref = { A: "open", B: "open" } as const;
    const m = runMatch({ ...base, plantTactics: true, teamInputs: { A: { plantPreference: pref }, B: { plantPreference: pref } } });
    const planted = m.rounds.filter((r) => r.plant);
    expect(planted.length).toBeGreaterThan(0);
    for (const r of planted) {
      if (r.plant!.by === "manager") expect(r.plant!.intendedSpotId).toMatch(/\/plant\/open$/);
    }
    expect(planted.filter((r) => r.plant!.by === "manager").length).toBeGreaterThan(planted.length / 2);
  }, 60000);
});

describe("post-plant and retake plans", () => {
  it("the manager's plans are played and recorded; unset fields are the IGL's", () => {
    const post = { A: { "*": { hold: "offSpike", flankWatch: false, outnumbered: "hold" } }, B: { "*": { hold: "offSpike", flankWatch: false, outnumbered: "hold" } } } as const;
    const retake = { A: { "*": { approach: "stack", save: "never" } }, B: { "*": { approach: "stack", save: "never" } } } as const;
    const m = runMatch({ ...base, plantTactics: true, teamInputs: { A: { postPlantPlans: post, retakePlans: retake }, B: { postPlantPlans: post, retakePlans: retake } } });
    const planted = m.rounds.filter((r) => r.planted);
    expect(planted.length).toBeGreaterThan(0);
    for (const r of planted) {
      const def = r.attacker === "A" ? "B" : "A";
      const pp = r.decisions.plans[r.attacker]?.postPlant;
      if (!pp) continue; // the round ended before the attack decided after its plant
      expect(pp!.hold).toBe("offSpike");
      expect(pp!.flankWatch).toBe(false);
      expect(pp!.retreatedAtMs).toBeNull();
      expect([...pp!.byManager].sort()).toEqual(["flankWatch", "hold", "outnumbered"]);
      expect(pp!.utility).toBe("keepLast"); // left to the IGL
      const rt = r.decisions.plans[def]?.retake;
      if (!rt) continue;
      expect(rt!.approach).toBe("stack");
      expect(rt!.savedAtMs).toBeNull();
      expect(new Set(Object.values(rt!.entries)).size).toBeLessThanOrEqual(1);
    }
    expect(planted.filter((r) => r.decisions.plans[r.attacker]?.postPlant).length).toBeGreaterThan(planted.length / 2);
  }, 60000);

  it("without plantTactics the team inputs are not played (the default game is unchanged)", () => {
    const pref = { A: "open", B: "open" } as const;
    const m = runMatch({ ...base, teamInputs: { A: { plantPreference: pref }, B: { plantPreference: pref } } });
    for (const r of m.rounds.filter((x) => x.plant)) expect(r.plant!.by).toBeNull();
  }, 60000);

  it("planForSpot merges '*' < kind < spot id, field by field, dropping auto", async () => {
    const { planForSpot } = await import("../src/index.js");
    const plans = { A: { "*": { hold: "onSpike", flankWatch: true }, safe: { hold: "offSpike", utility: "auto" }, "a-site/plant/safe": { outnumbered: "retreat" } } } as const;
    expect(planForSpot(plans, { site: "A", id: "a-site/plant/safe", kind: "safe" })).toEqual({ hold: "offSpike", flankWatch: true, outnumbered: "retreat" });
    expect(planForSpot(plans, { site: "A", id: null, kind: "open" })).toEqual({ hold: "onSpike", flankWatch: true });
    expect(planForSpot(plans, { site: "B", id: null, kind: "open" })).toBeNull();
  });
});
