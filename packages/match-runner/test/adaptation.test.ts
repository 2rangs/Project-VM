import { describe, it, expect } from "vitest";
import { listSimulatableTeams } from "@pv/game-data";
import { observedTendencies, runMatch, renderDecisionTrace, type MatchConfig } from "../src/index.js";

const teams = listSimulatableTeams();
const base: MatchConfig = {
  teamA: { id: teams[0]!.id, name: teams[0]!.name ?? "A" },
  teamB: { id: teams[1]!.id, name: teams[1]!.name ?? "B" },
  map: "Ascent",
  seed: 21,
};
const signature = (c: MatchConfig) =>
  runMatch(c).rounds.map((r) => `${r.winner}:${r.reason}:${r.decisions.plans.A?.opening}/${r.decisions.plans.B?.opening}`).join(",");

describe("what a round lets both teams observe", () => {
  it("plant site, first contact and defenders met come from public / mutual events only", () => {
    const seen = observedTendencies([
      { kind: "kill", tick: 1, elapsedMs: 100, actor: "atk1", target: "def2", zoneId: "b-site" },
      { kind: "kill", tick: 2, elapsedMs: 200, actor: "def3", target: "atk1", zoneId: "b-main" },
      { kind: "kill", tick: 3, elapsedMs: 300, actor: "atk2", target: "def3", zoneId: "mid-market" },
      { kind: "planted", tick: 4, elapsedMs: 400, actor: "atk2", zoneId: "b-site" },
    ]);
    expect(seen).toEqual({ plantSite: "B", firstContactSite: "B", defendersMet: { B: 1 } });
  });
});

describe("cross-round adaptation in a full match", () => {
  const result = runMatch(base);

  it("teams use more than one opening call over a match (the IGL sees its real economy)", () => {
    const openings = new Set(result.rounds.flatMap((r) => [r.decisions.plans.A?.opening, r.decisions.plans.B?.opening]));
    expect(openings.size).toBeGreaterThan(3);
  });

  it("round 1 is played with no read; later rounds carry a read built from earlier ones", () => {
    const first = result.rounds[0]!.decisions.opponentReadBefore;
    expect(first.A?.attackSite.samples).toBe(0);
    expect(first.B?.defenseSite.samples).toBe(0);
    const last = result.rounds.at(-1)!.decisions.opponentReadBefore;
    const learned = (last.A?.attackSite.samples ?? 0) + (last.A?.defenseSite.samples ?? 0) + (last.B?.attackSite.samples ?? 0) + (last.B?.defenseSite.samples ?? 0);
    expect(learned).toBeGreaterThan(2);
    // …and stays uncertain: no tendency is ever held as a certainty.
    for (const read of [last.A, last.B]) {
      expect(read!.attackSite.confidence).toBeLessThan(1);
      expect(read!.attackSite.probability.A).toBeGreaterThan(0);
      expect(read!.attackSite.probability.A).toBeLessThan(1);
    }
  });

  it("counterfactual: the same match without memory plays out differently", () => {
    expect(signature({ ...base, opponentMemory: false })).not.toBe(signature(base));
  });

  it("deterministic: same seed and options → the same match, plans included", () => {
    expect(signature(base)).toBe(signature(base));
    expect(signature({ ...base, opponentMemory: false })).toBe(signature({ ...base, opponentMemory: false }));
  });

  it("the decision trace explains each round: plan, read and observations", () => {
    const row = renderDecisionTrace(result).at(-1)!;
    expect(row["planA"]).toBeTruthy();
    expect(row["readA"]).toHaveProperty("attackConfidence");
    expect(row["observed"]).toHaveProperty("defendersMet");
  });
});
