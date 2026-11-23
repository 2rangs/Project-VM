// MatchConfig.rosters: fielding explicit players instead of the game-data roster.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { getPlayer, getTeam } from "@pv/game-data";
import { runMatch, type MatchResult } from "../src/index.js";
import { rosterSkills } from "../src/teams.js";

const hash = (m: MatchResult) => createHash("sha256").update(JSON.stringify(m.rounds.map((r) => [r.winner, r.reason, r.events]))).digest("hex");
const rostered = (id: string) => getTeam(id)!.roster.map((r) => getPlayer(r.playerId)!).filter(Boolean);

describe("MatchConfig.rosters", () => {
  it("fielding the team's own game-data roster is byte-identical to the default", () => {
    const [a, b] = ["1034", "2"];
    const base = { teamA: { id: a, name: a }, teamB: { id: b, name: b }, map: "ascent", seed: 11, maxRounds: 6 };
    expect(hash(runMatch({ ...base, rosters: { A: rostered(a), B: rostered(b) } }))).toBe(hash(runMatch(base)));
  });

  it("reads an override player's ratings for that slot", () => {
    const players = rostered("1034");
    const swapped = [players[4]!, players[1]!, players[2]!, players[3]!, players[0]!];
    expect(rosterSkills("1034", 5, swapped)[0]).toEqual(rosterSkills("1034", 5)[4]);
  });
});
