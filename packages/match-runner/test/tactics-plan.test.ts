import { describe, it, expect } from "vitest";
import { loadSpatial } from "../src/setup.js";
import { plantSpotsOf, planTactics, planTeamInputs, runMatch, type MatchConfig, type MatchResult, type TacticsPlan } from "../src/index.js";

const base: MatchConfig = { teamA: { id: "624", name: "Paper Rex" }, teamB: { id: "7386", name: "MIBR" }, map: "Ascent", seed: 13 };
const LONG = 240_000;

/** Everything that is PLAY (not the passive plan records): who won each round, how, kills, economy, every event. */
const play = (r: MatchResult) => JSON.stringify(r.rounds.map((x) => ({ w: x.winner, why: x.reason, k: x.kills, s: x.score, eco: x.economy, buys: x.buys, ev: x.events })));

const spots = plantSpotsOf(loadSpatial("ascent"));
const aSpot = [...spots.values()].find((s) => s.site === "A")!.candidates.find((c) => c.kind !== "default")!;
/** Every tactics field set to something other than auto, for both sides. */
const TACTICS: TacticsPlan = {
  plantPreference: { A: { spotId: aSpot.id }, B: "safe" },
  postPlantPlans: { A: { "*": { hold: "offSpike", flankWatch: true, utility: "savePostPlant", outnumbered: "retreat" } }, B: { safe: { hold: "onSpike" } } },
  retakePlans: { A: { "*": { approach: "stack", save: "never" } }, B: { "*": { approach: "split", save: { maxManDeficit: 1 } } } },
  midPlans: { "*": { attack: { stance: "contest", count: 2 }, defense: { stance: "giveUp" } } },
};

describe("the tactics a plan carries", () => {
  it("are copied into the team inputs as they are, and listed", () => {
    const inputs = planTeamInputs(TACTICS);
    expect(inputs.plantPreference).toEqual(TACTICS.plantPreference);
    expect(inputs.postPlantPlans).toEqual(TACTICS.postPlantPlans);
    expect(inputs.retakePlans).toEqual(TACTICS.retakePlans);
    expect(inputs.midPlans).toEqual(TACTICS.midPlans);
    expect(planTactics(TACTICS)).toEqual(["plantPreference", "postPlantPlans", "retakePlans", "midPlans"]);
    expect(planTactics({ plantPreference: { A: "auto" }, midPlans: { "*": {} } })).toEqual([]);
  });

  it("signature: with plantTactics and midControl OFF (the default), a match with every tactic set plays byte-identically to one without", () => {
    const plain = runMatch(base);
    const withTactics = runMatch({ ...base, teamInputs: { A: planTeamInputs(TACTICS), B: planTeamInputs(TACTICS) } });
    expect(play(withTactics)).toBe(play(plain));
  }, LONG);

  it("with plantTactics ON the manager's plant choice is played and recorded as the manager's", () => {
    const r = runMatch({ ...base, plantTactics: true, teamInputs: { A: { plantPreference: { A: "safe", B: "safe" } } } });
    const ours = r.rounds.filter((x) => x.attacker === "A" && x.plant);
    const theirs = r.rounds.filter((x) => x.attacker === "B" && x.plant);
    expect(ours.length).toBeGreaterThan(3);
    // The carrier still overrides the plan when the situation forces it (e.g. the clock), so "mostly".
    const byManager = ours.filter((x) => x.plant!.by === "manager" && x.plant!.spotKind === "safe").length;
    expect(byManager / ours.length).toBeGreaterThan(0.7);
    // The team without a plan plants by its own call.
    expect(theirs.every((x) => x.plant!.by === "auto")).toBe(true);
  }, LONG);
});
