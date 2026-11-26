// Difficulty presets (backlog #9): the manager's budget, the board's patience and AI market
// aggressiveness scale with the chosen difficulty; every other club and the engine are untouched.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  newCareer, resolveDifficulty, DIFFICULTIES, boardOf,
  type CareerState, type DifficultyId, type World,
} from "../src/index.ts";

let base: World;
const fresh = (): World => JSON.parse(JSON.stringify(base)) as World;
const USER = (w: World): string => Object.values(w.teams).filter((t) => t.region === "pacific" && t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!.teamId;
function career(difficulty?: DifficultyId): CareerState {
  const w = fresh();
  return newCareer(w, { seed: 11, manager: { name: "T", nationality: "kr" }, userTeamId: USER(w), ...(difficulty ? { difficulty } : {}) });
}
const userBudget = (c: CareerState): number => {
  const f = c.world.club!.finances[c.userTeamId]!;
  return f.wageBudget + f.transferBudget;
};
const userBalance = (c: CareerState): number => c.world.club!.finances[c.userTeamId]!.balance;

beforeAll(() => { base = worldFromGameData(4242); });

describe("resolveDifficulty", () => {
  it("normal is the neutral identity preset", () => {
    expect(resolveDifficulty("normal")).toEqual({ finance: 1, boardTolerance: 1, aiStrength: 1 });
    expect(resolveDifficulty(undefined)).toEqual(DIFFICULTIES.normal);
    expect(resolveDifficulty("easy").finance).toBeGreaterThan(1);
    expect(resolveDifficulty("hard").finance).toBeLessThan(1);
  });
});

describe("finances", () => {
  it("easy gives the manager more starting cash, hard less", () => {
    const easy = userBalance(career("easy"));
    const normal = userBalance(career("normal"));
    const hard = userBalance(career("hard"));
    expect(easy).toBeGreaterThan(normal);
    expect(hard).toBeLessThan(normal);
    // The budget tracks the same way (wage is floored to payroll, so use >= / <=).
    expect(userBudget(career("easy"))).toBeGreaterThanOrEqual(normal === 0 ? 0 : userBudget(career("normal")));
    expect(userBudget(career("hard"))).toBeLessThanOrEqual(userBudget(career("normal")));
  });

  it("a career with no difficulty matches an explicit normal one (backward compatible)", () => {
    expect(userBudget(career())).toBe(userBudget(career("normal")));
    expect(userBalance(career())).toBe(userBalance(career("normal")));
  });

  it("only the manager's club is scaled — other clubs are identical across difficulties", () => {
    const easy = career("easy");
    const hard = career("hard");
    const other = Object.keys(easy.world.teams).find((id) => id !== easy.userTeamId && easy.world.club!.finances[id])!;
    const be = easy.world.club!.finances[other]!;
    const bh = hard.world.club!.finances[other]!;
    expect(be.wageBudget).toBe(bh.wageBudget);
    expect(be.transferBudget).toBe(bh.transferBudget);
  });

  it("records the resolved knobs on the club", () => {
    const c = career("hard");
    expect(c.world.club!.difficulty).toEqual(DIFFICULTIES.hard);
    expect(career("normal").world.club!.difficulty).toEqual(DIFFICULTIES.normal);
  });
});

describe("board patience", () => {
  it("a more patient board (easy) starts with at least as much confidence as normal", () => {
    const easy = boardOf(career("easy").world.club!).confidence;
    const normal = boardOf(career("normal").world.club!).confidence;
    const hard = boardOf(career("hard").world.club!).confidence;
    expect(easy).toBeGreaterThanOrEqual(normal);
    expect(hard).toBeLessThanOrEqual(normal);
  });
});
