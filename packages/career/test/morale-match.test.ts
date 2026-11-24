// Morale → match, measured (docs/CLUB_OPERATIONS.md §10). A small paired counterfactual: the same
// five, the same opponent, the same seeds; only the five's morale differs (1 vs 0). It runs the real
// engine, so it is opt-in: PV_MORALE_MATCH=1, run through the heavy-run lock.
import { describe, it, expect } from "vitest";
import { runMatch } from "@pv/match-runner";
import { worldFromGameData } from "../src/game-data.ts";
import { matchRoster, newCareer, setClubFlags, teamStrength } from "../src/index.ts";

const RUN = process.env.PV_MORALE_MATCH === "1";
const N = Number(process.env.PV_MORALE_N ?? 30);

describe.skipIf(!RUN)("morale in the engine (paired, real matches)", () => {
  it("high morale wins more rounds than low morale with everything else equal", () => {
    setClubFlags({ moraleInMatch: true });
    const base = worldFromGameData(31);
    const ids = Object.keys(base.teams).filter((id) => base.teams[id]!.roster.length >= 5).sort((a, b) => teamStrength(base, b) - teamStrength(base, a));
    const a = ids[Math.floor(ids.length / 2)]!, b = ids[Math.floor(ids.length / 2) + 1]!;
    const career = newCareer(structuredClone(base), { seed: 31, manager: { name: "T", nationality: "kr" }, userTeamId: a });
    const five = career.world.teams[a]!.roster.slice(0, 5);
    const roster = (m: number) => { career.world.club!.morale = Object.fromEntries(five.map((id) => [id, m])); return matchRoster(career, five); };
    const hi = roster(1), lo = roster(0), neutral = roster(0.5);
    const opp = matchRoster(career, career.world.teams[b]!.roster.slice(0, 5));
    let hiRounds = 0, loRounds = 0, neRounds = 0, total = 0, hiWins = 0, loWins = 0;
    for (let seed = 1; seed <= N; seed++) {
      const play = (r: typeof hi) => runMatch({ teamA: { id: a, name: "A" }, teamB: { id: b, name: "B" }, map: "ascent", seed, rosters: { A: r, B: opp } });
      const mh = play(hi), ml = play(lo), mn = play(neutral);
      hiRounds += mh.score.A; loRounds += ml.score.A; neRounds += mn.score.A; total += mh.score.A + mh.score.B;
      hiWins += mh.winner === "A" ? 1 : 0; loWins += ml.winner === "A" ? 1 : 0;
    }
    console.log(`[morale] N=${N} rounds won by the five: high ${hiRounds}, neutral ${neRounds}, low ${loRounds} (high-match rounds ${total}); maps won high ${hiWins} / low ${loWins}`);
    expect(hiRounds).toBeGreaterThan(loRounds);
  });
});
