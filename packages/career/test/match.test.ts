// A generated player plays a real match through match-runner (MatchConfig.rosters).
import { describe, it, expect } from "vitest";
import { runMatch } from "@pv/match-runner";
import { rosterSkills } from "../../match-runner/src/teams.ts";
import { worldFromGameData } from "../src/game-data.ts";
import { advanceSeason, startingFive, type RatedAttr } from "../src/index.ts";

describe("generated players in a match", () => {
  it("fields a generated prospect and plays the match to a result", () => {
    let w = worldFromGameData(99);
    for (let i = 0; i < 3; i++) w = advanceSeason(w);
    const teams = Object.values(w.teams).filter((t) => t.roster.length >= 5);
    const withGen = teams.find((t) => startingFive(w, t.teamId).some((p) => p.generated))!;
    expect(withGen).toBeDefined();
    const other = teams.find((t) => t.teamId !== withGen.teamId)!;
    const five = startingFive(w, withGen.teamId);
    const gi = five.findIndex((p) => p.generated);
    const gen = five[gi]!;

    // The generated player's ratings are what the engine reads for that slot.
    const skills = rosterSkills(withGen.teamId, 5, five);
    expect(skills[gi]!.aim).toBe((gen.attributes!.aim as RatedAttr).value);
    expect(skills[gi]!.reaction).toBe((gen.attributes!.reaction as RatedAttr).value);

    const m = runMatch({
      teamA: { id: withGen.teamId, name: withGen.name },
      teamB: { id: other.teamId, name: other.name },
      map: "ascent",
      seed: 5,
      rosters: { A: five, B: startingFive(w, other.teamId) },
    });
    expect(["A", "B"]).toContain(m.winner);
    expect(Math.max(m.score.A, m.score.B)).toBeGreaterThanOrEqual(13);
  });
});
