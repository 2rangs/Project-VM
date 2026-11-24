// Development, decline and retirement over many seasons, and the new drivers (personality, morale,
// mentors). docs/GENERATED_PEOPLE.md §3, §10.
import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData } from "../src/game-data.ts";
import {
  advanceSeason, developmentFactors, developPlayer, DEVELOPMENT_MODEL, leadership, mentorBlocker, mentorFactor, developmentMorale,
  newProspects, personalityOf, setMentorMut, type RatedAttr, type World, type WorldPlayer,
} from "../src/index.ts";

const SEASONS = 15;
let worlds: World[];
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };
const val = (p: WorldPlayer, k: string) => (p.attributes![k] as RatedAttr).value;

/** Season-on-season change by age (age during the season that ended). */
function byAge(f: (prev: WorldPlayer, next: WorldPlayer) => number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 1; i < worlds.length; i++) {
    for (const p of Object.values(worlds[i]!.players)) {
      const q = worlds[i - 1]!.players[p.playerId];
      if (!q || q.ca === null || p.ca === null) continue;
      (out.get(q.age) ?? out.set(q.age, []).get(q.age)!).push(f(q, p));
    }
  }
  return out;
}

beforeAll(() => {
  worlds = [worldFromGameData(77)];
  for (let i = 0; i < SEASONS; i++) worlds.push(advanceSeason(worlds[worlds.length - 1]!));
});

describe("multi-season distributions", () => {
  it("grows young players, levels off in the mid-twenties and declines after", () => {
    const d = byAge((q, p) => p.ca! - q.ca!);
    for (const age of [16, 17, 18, 19, 20, 21, 22]) expect(mean(d.get(age)!)).toBeGreaterThan(0.008);
    expect(Math.abs(mean(d.get(26)!))).toBeLessThan(0.006);
    for (const age of [28, 29]) expect(mean(d.get(age)!)).toBeLessThan(-0.005);
    expect(mean(d.get(29)!)).toBeLessThan(mean(d.get(27)!)); // decline accelerates
    // Not everyone develops alike: the spread at 18 is real.
    const at18 = d.get(18)!;
    const sd = Math.sqrt(mean(at18.map((x) => (x - mean(at18)) ** 2)));
    expect(sd).toBeGreaterThan(0.004);
  });

  it("peaks mechanics early and game sense late", () => {
    const aim = byAge((q, p) => val(p, "aim") - val(q, "aim"));
    const sense = byAge((q, p) => val(p, "impact") - val(q, "impact"));
    const firstDecline = (m: Map<number, number[]>) => [...m.keys()].sort((a, b) => a - b).find((a) => a >= 20 && (m.get(a)?.length ?? 0) > 30 && mean(m.get(a)!) < -0.002)!;
    const aimDown = firstDecline(aim);
    const senseDown = firstDecline(sense);
    expect(aimDown).toBeGreaterThanOrEqual(25);
    expect(aimDown).toBeLessThanOrEqual(28);
    expect(senseDown).toBeGreaterThanOrEqual(aimDown + 2);
    // Game sense still grows at 24–25 while aim has stopped.
    expect(mean(sense.get(24)!)).toBeGreaterThan(mean(aim.get(24)!) + 0.01);
  });

  it("brings most generated players near their potential by their mid-twenties, not all", () => {
    const end = worlds[worlds.length - 1]!;
    const prime = Object.values(end.players).filter((p) => p.generated && p.age >= 25 && p.age <= 27);
    expect(prime.length).toBeGreaterThan(50);
    const reached = prime.filter((p) => p.pa! - p.ca! < 0.03).length / prime.length;
    expect(reached).toBeGreaterThan(0.5);
    expect(reached).toBeLessThan(0.97);
  });

  it("retires signed players around thirty and unsigned ones earlier", () => {
    const signed: number[] = [];
    const unsigned: number[] = [];
    for (let i = 1; i < worlds.length; i++) {
      for (const id of worlds[i]!.history.at(-1)!.retiredPlayers) {
        const q = worlds[i - 1]!.players[id]!;
        (q.status === "rostered" ? signed : unsigned).push(q.age + 1);
      }
    }
    expect(signed.length).toBeGreaterThan(200);
    expect(median(signed)).toBeGreaterThanOrEqual(28);
    expect(median(signed)).toBeLessThanOrEqual(32);
    expect(median(unsigned)).toBeLessThan(median(signed));
    expect(Math.max(...signed)).toBeLessThanOrEqual(40);
  });

  it("records a development history per player", () => {
    const end = worlds[worlds.length - 1]!;
    const vet = Object.values(end.players).find((p) => (p.history?.length ?? 0) >= 10)!;
    expect(Math.max(...Object.values(end.players).map((p) => p.history?.length ?? 0))).toBeLessThanOrEqual(12);
    expect(vet).toBeDefined();
    const seasons = vet.history!.map((h) => h.season);
    expect(seasons).toEqual([...seasons].sort((a, b) => a - b));
    expect(vet.history!.at(-1)!.season).toBe(end.season - 1);
    for (const h of vet.history!) expect(h.morale).toBeGreaterThanOrEqual(0);
  });
});

describe("development drivers", () => {
  const w0 = () => JSON.parse(JSON.stringify(worlds[0])) as World;

  it("personality is fixed per player and professional players grow faster and decline slower", () => {
    const w = w0();
    expect(personalityOf(w, "x1")).toEqual(personalityOf(w, "x1"));
    const pro = newProspects(w)[0]!;
    const grow = (growth: number) => {
      const p = JSON.parse(JSON.stringify(pro)) as WorldPlayer;
      developPlayer(w, p, 20, 0.5, w.season, undefined, { growth, decline: 1 });
      return p.ca! - pro.ca!;
    };
    const DM = DEVELOPMENT_MODEL;
    expect(grow(DM.persBase + DM.persSpan * 1)).toBeGreaterThan(grow(DM.persBase));
    const f = (prof: number) => DM.declineBase - DM.declineSpan * prof;
    expect(f(1)).toBeLessThan(f(0));
  });

  it("morale follows form and the role against ambition", () => {
    const w = w0();
    const team = Object.values(w.teams).find((t) => t.roster.length >= 7)!;
    const starter = w.players[team.roster[0]!]!;
    const bench = w.players[team.roster[6]!]!;
    expect(developmentMorale(w, starter, 0.8)).toBeGreaterThan(developmentMorale(w, starter, 0.2));
    // Same player, starter vs bench role.
    const asBench = { ...starter, playerId: starter.playerId } as WorldPlayer;
    const t2 = JSON.parse(JSON.stringify(w)) as World;
    t2.teams[team.teamId]!.roster = [...team.roster.slice(1, 7), starter.playerId];
    expect(developmentMorale(w, starter, 0.5)).toBeGreaterThan(developmentMorale(t2, asBench, 0.5));
    void bench;
    // Growth rises with morale.
    expect(developmentFactors(w, starter, 0.9).growth).toBeGreaterThan(developmentFactors(w, starter, 0.1).growth);
  });

  it("a mentor speeds a young player up; the pairing rules hold", () => {
    const w = w0();
    const team = Object.values(w.teams).find((t) => {
      const ps = [...t.roster, ...t.academy].map((id) => w.players[id]!);
      return ps.some((p) => p.age <= 21) && ps.some((p) => p.age >= 26);
    })!;
    const ps = [...team.roster, ...team.academy].map((id) => w.players[id]!).filter((p) => p.ca !== null);
    const young = ps.filter((p) => p.age <= 21).sort((a, b) => a.ca! - b.ca!)[0]!;
    const vet = ps.filter((p) => p.age >= 26 && p.ca! >= young.ca!).sort((a, b) => leadership(w, b) - leadership(w, a))[0]!;
    expect(mentorBlocker(w, team.teamId, young.playerId, vet.playerId)).toBeNull();
    expect(mentorBlocker(w, team.teamId, vet.playerId, young.playerId)).not.toBeNull();
    expect(mentorFactor(w, young, vet.playerId)).toBeGreaterThan(1);
    expect(mentorFactor(w, young, undefined)).toBe(1);
    expect(setMentorMut(w, team.teamId, young.playerId, vet.playerId)).toBeNull();
    const withM = advanceSeason(w);
    const without = advanceSeason(w0());
    expect(withM.players[young.playerId]!.ca!).toBeGreaterThanOrEqual(without.players[young.playerId]!.ca!);
    expect(withM.players[young.playerId]!.ca!).not.toBe(without.players[young.playerId]!.ca!);
  });

  it("is deterministic and keeps PA ≥ CA", () => {
    const a = advanceSeason(w0());
    const b = advanceSeason(w0());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const p of Object.values(worlds[worlds.length - 1]!.players)) if (p.ca !== null) expect(p.pa!).toBeGreaterThanOrEqual(p.ca);
  });
});
