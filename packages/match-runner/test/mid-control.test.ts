// Mid control through a match: the pre-match option reaches the round, the record carries what
// each team did and believed, and turning it off leaves mid a label.
import { describe, expect, it } from "vitest";
import { runMatch, type MatchConfig } from "../src/index.js";

const base: MatchConfig = { teamA: { id: "sen", name: "Sentinels" }, teamB: { id: "lev", name: "LEV" }, map: "Ascent", seed: 5, maxRounds: 6, collectStats: true };
const MID = new Set(["mid-bottom", "mid-catwalk", "mid-courtyard", "mid-cubby", "mid-link", "mid-market", "mid-pizza", "mid-top"]);
const defenderOf = (r: { attacker: "A" | "B" }): "A" | "B" => (r.attacker === "A" ? "B" : "A");

describe("mid control in a match", () => {
  const auto = runMatch(base);

  it("every round records both teams' mid decision and the true control over the round", () => {
    for (const r of auto.rounds) {
      const atk = r.decisions.plans[r.attacker]!.mid!;
      const def = r.decisions.plans[defenderOf(r)]!.mid!;
      expect(["contest", "giveUp"]).toContain(atk.stance);
      expect(["hold", "giveUp"]).toContain(def.stance);
      expect(atk.by).toBe("auto");
      expect(atk.estimate.value).toBeGreaterThanOrEqual(-1);
      expect(atk.estimate.value).toBeLessThanOrEqual(1);
      expect(r.mid!.samples.length).toBeGreaterThan(0);
      expect(r.mid!.heldMs.attack + r.mid!.heldMs.defense).toBeGreaterThanOrEqual(0);
      // the defence's mid players are those who started in mid
      const first = r.stats!.zonePresence[0]!;
      expect(def.party.length).toBe(first.defense.filter((z) => MID.has(z)).length);
    }
  });

  it("a team that gives mid up on defence starts nobody there; one that contests starts two", () => {
    const plans = (stance: "giveUp" | "contest") => ({ teamInputs: { A: { midPlans: { "*": { defense: { stance, ...(stance === "contest" ? { count: 2 } : {}) } } } }, B: { midPlans: { ascent: { defense: { stance, ...(stance === "contest" ? { count: 2 } : {}) } } } } } });
    const gave = runMatch({ ...base, ...plans("giveUp") });
    for (const r of gave.rounds) {
      expect(r.stats!.zonePresence[0]!.defense.filter((z) => MID.has(z))).toHaveLength(0);
      expect(r.decisions.plans[defenderOf(r)]!.mid).toMatchObject({ stance: "giveUp", by: "manager", party: [] });
    }
    const two = runMatch({ ...base, ...plans("contest") });
    for (const r of two.rounds) {
      expect(r.stats!.zonePresence[0]!.defense.filter((z) => MID.has(z))).toHaveLength(2);
      expect(r.decisions.plans[defenderOf(r)]!.mid).toMatchObject({ stance: "contest", by: "manager" });
    }
  });

  it("a team told to contest on attack sends the players the manager named", () => {
    const named = runMatch({ ...base, teamInputs: { A: { midPlans: { Ascent: { attack: { stance: "contest", count: 1, who: { roles: ["lurker"] } } } } }, B: { midPlans: { "*": { attack: { stance: "contest", count: 3 } } } } } });
    for (const r of named.rounds) {
      const mid = r.decisions.plans[r.attacker]!.mid!;
      expect(mid).toMatchObject({ stance: "contest", by: "manager" });
      expect(mid.party).toHaveLength(r.attacker === "A" ? 1 : 3);
      expect(mid.party.every((id) => id.startsWith("atk"))).toBe(true);
    }
  });

  it("off: no mid decision and no record; the same seed is still deterministic either way", () => {
    const off = runMatch({ ...base, midControl: false });
    for (const r of off.rounds) {
      expect(r.decisions.plans[r.attacker]!.mid).toBeUndefined();
      expect(r.mid).toBeUndefined();
    }
    expect(JSON.stringify(runMatch(base).rounds.map((r) => [r.winner, r.reason, r.decisions]))).toBe(JSON.stringify(auto.rounds.map((r) => [r.winner, r.reason, r.decisions])));
  });
});
