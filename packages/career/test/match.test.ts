// A generated player plays a real match through match-runner (MatchConfig.rosters).
import { describe, it, expect } from "vitest";
import { prepareSeries, runMatch, runSeries } from "@pv/match-runner";
import { getTeamMapRecords } from "@pv/game-data";
import { withPractice } from "../src/index.ts";
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

  it("plays a career lineup through a series (SeriesTeamConfig.roster → every game's rosters)", () => {
    const w = worldFromGameData(7);
    const teams = Object.values(w.teams).filter((t) => t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId));
    const [a, b] = [teams[0]!, teams[1]!];
    const fiveA = startingFive(w, a.teamId);
    const fiveB = startingFive(w, b.teamId);
    const r = runSeries({
      teamA: { id: a.teamId, name: a.name, scouting: false, roster: fiveA },
      teamB: { id: b.teamId, name: b.name, scouting: false, roster: fiveB },
      format: "bo1", seed: 3,
    });
    const g = r.games[0]!;
    expect(g.match.config.rosters?.[g.slots.A]?.map((p) => p.playerId)).toEqual(fiveA.map((p) => p.playerId));
    expect(g.match.config.rosters?.[g.slots.B]?.map((p) => p.playerId)).toEqual(fiveB.map((p) => p.playerId));
  });

  it("map practice reaches the series: mastery continuity rises with the practice records", () => {
    const w = worldFromGameData(7);
    const t = Object.values(w.teams).filter((x) => x.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!;
    const five = startingFive(w, t.teamId);
    const map = "Lotus";
    const practice = { [map]: Object.fromEntries(five.map((p) => [p.playerId, 12])) };
    const base = prepareSeries({ teamA: { id: t.teamId, name: t.name, scouting: false, roster: five }, teamB: { id: "x", name: "x", scouting: false }, seed: 1 });
    const prac = prepareSeries({ teamA: { id: t.teamId, name: t.name, scouting: false, roster: five, mapRecords: withPractice(getTeamMapRecords(t.teamId), practice) as ReturnType<typeof getTeamMapRecords> }, teamB: { id: "x", name: "x", scouting: false }, seed: 1 });
    expect(prac.mastery.A[map]!.continuity.value).toBeGreaterThan(base.mastery.A[map]!.continuity.value);
  });
});
