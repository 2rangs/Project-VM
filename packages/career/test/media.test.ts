// Media, press conferences, 1:1 interactions and promises (backlog #7). Every effect lands in the
// club layer's tracked morale (club.morale) and the media chemistry; nothing touches the engine.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  newCareer, moraleOf, serializeCareer, deserializeCareer,
  mediaOf, initMedia, applyPressMut, interactMut, promiseMut, canInteract,
  resolveMatchPromisesMut, resolveTrophyPromisesMut, settlePromiseMut, judgePromise, chemistryWeekMut,
  MEDIA_MODEL, type CareerState, type World,
} from "../src/index.ts";

let base: World;
const fresh = (): World => JSON.parse(JSON.stringify(base)) as World;
const USER = (w: World): string => Object.values(w.teams).filter((t) => t.region === "pacific" && t.roster.length >= 5).sort((a, b) => a.teamId.localeCompare(b.teamId))[0]!.teamId;
function career(seed = 11): CareerState {
  const w = fresh();
  return newCareer(w, { seed, manager: { name: "Test Manager", nationality: "kr" }, userTeamId: USER(w) });
}
const squadId = (c: CareerState): string => c.world.teams[c.userTeamId]!.roster[0]!;

beforeAll(() => { base = worldFromGameData(4242); });

describe("media state", () => {
  it("initialises neutral and is created on first use", () => {
    const c = career();
    const m = mediaOf(c);
    expect(m.chemistry).toBe(MEDIA_MODEL.chemistryStart);
    expect(m.promises).toEqual([]);
    expect(initMedia().chemistry).toBe(0.5);
  });

  it("survives a save/load round trip in the career ext", () => {
    const c = career();
    const m = mediaOf(c);
    interactMut(c.world, m, squadId(c), "praise", c.date);
    m.chemistry = 0.73; // set after the interaction so the round-trip value is exact
    const back = deserializeCareer(serializeCareer(c));
    const m2 = mediaOf(back);
    expect(m2.chemistry).toBe(0.73);
    expect(m2.log.length).toBe(1);
  });
});

describe("press conferences", () => {
  it("a negative post-loss press drops the squad's morale and chemistry", () => {
    const c = career();
    const m = mediaOf(c);
    const roster = c.world.teams[c.userTeamId]!.roster;
    const before = roster.map((id) => moraleOf(c.world.club, id));
    const chemBefore = m.chemistry;
    const delta = applyPressMut(c.world, m, "afterLoss", "criticise", c.date);
    expect(delta).toBeLessThan(0);
    for (let i = 0; i < roster.length; i++) expect(moraleOf(c.world.club, roster[i]!)).toBeLessThan(before[i]!);
    expect(m.chemistry).toBeLessThan(chemBefore);
  });

  it("a positive press lifts morale and chemistry", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    const before = moraleOf(c.world.club, id);
    const delta = applyPressMut(c.world, m, "afterWin", "praiseTeam", c.date);
    expect(delta).toBeGreaterThan(0);
    expect(moraleOf(c.world.club, id)).toBeGreaterThan(before);
    expect(m.chemistry).toBeGreaterThan(0.5);
  });
});

describe("1:1 interactions", () => {
  it("praise raises and criticism lowers the target's morale, with a cool-off", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    const before = moraleOf(c.world.club, id);
    const r1 = interactMut(c.world, m, id, "praise", c.date);
    expect(typeof r1 === "object" && r1.newMorale > before).toBe(true);
    // Same day again → cool-off.
    expect(interactMut(c.world, m, id, "praise", c.date)).toBe("cooldown");
    // A different player can be criticised, dropping morale.
    const other = c.world.teams[c.userTeamId]!.roster[1]!;
    const b2 = moraleOf(c.world.club, other);
    const r2 = interactMut(c.world, m, other, "criticise", c.date);
    expect(typeof r2 === "object" && r2.newMorale < b2).toBe(true);
  });

  it("rejects a player who is not ours", () => {
    const c = career();
    const foreign = Object.values(c.world.players).find((p) => p.teamId && p.teamId !== c.userTeamId)!;
    expect(canInteract(c.world, mediaOf(c), foreign.playerId, c.date)).toBe("notOurPlayer");
    expect(interactMut(c.world, mediaOf(c), foreign.playerId, "praise", c.date)).toBe("notOurPlayer");
  });
});

describe("promises", () => {
  it("making a promise lifts morale and blocks a second open promise", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    const before = moraleOf(c.world.club, id);
    const pr = promiseMut(c.world, m, id, "winMatch", c.date);
    expect(typeof pr === "object" && pr.status === "open").toBe(true);
    expect(moraleOf(c.world.club, id)).toBeGreaterThan(before);
    expect(promiseMut(c.world, m, id, "trophy", c.date)).toBe("alreadyOpen");
  });

  it("a kept win promise raises morale; a broken one lowers it", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    promiseMut(c.world, m, id, "winMatch", c.date);
    const before = moraleOf(c.world.club, id);
    const kept = resolveMatchPromisesMut(c.world, m, true, c.date);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.kept).toBe(true);
    expect(moraleOf(c.world.club, id)).toBeGreaterThan(before);

    // A fresh promise, broken this time.
    const id2 = c.world.teams[c.userTeamId]!.roster[2]!;
    promiseMut(c.world, m, id2, "winMatch", c.date);
    const b2 = moraleOf(c.world.club, id2);
    const broken = resolveMatchPromisesMut(c.world, m, false, c.date);
    expect(broken[0]!.kept).toBe(false);
    expect(moraleOf(c.world.club, id2)).toBeLessThan(b2);
  });

  it("a playing-time promise is judged kept when the player's map share is high", () => {
    const c = career();
    const uid = c.userTeamId;
    const id = squadId(c);
    const m = mediaOf(c);
    const pr = promiseMut(c.world, m, id, "playTime", c.date);
    if (typeof pr !== "object") throw new Error("promise failed");
    // No minutes yet → not kept.
    (c.world.club!.playTime ??= { players: {}, teams: {} });
    expect(judgePromise(c.world, pr, false)).toBe(false);
    // Give the player most of the club's maps → kept.
    c.world.club!.playTime!.teams[uid] = 20;
    c.world.club!.playTime!.players[id] = 18;
    expect(judgePromise(c.world, pr, false)).toBe(true);
  });

  it("trophy promises settle at season end on a regional title", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    promiseMut(c.world, m, id, "trophy", c.date);
    const resolved = resolveTrophyPromisesMut(c.world, m, true, c.date);
    expect(resolved[0]!.kept).toBe(true);
  });
});

describe("chemistry", () => {
  it("relaxes toward neutral each week", () => {
    const c = career();
    const m = mediaOf(c);
    m.chemistry = 0.9;
    chemistryWeekMut(c.world, m);
    expect(m.chemistry).toBeLessThan(0.9);
    expect(m.chemistry).toBeGreaterThan(0.5);
  });

  it("settlePromiseMut records the outcome and logs it", () => {
    const c = career();
    const m = mediaOf(c);
    const id = squadId(c);
    const pr = promiseMut(c.world, m, id, "trophy", c.date);
    if (typeof pr !== "object") throw new Error("promise failed");
    const before = m.log.length;
    settlePromiseMut(c.world, m, pr, false, c.date);
    expect(pr.status).toBe("broken");
    expect(m.log.length).toBe(before + 1);
  });
});
