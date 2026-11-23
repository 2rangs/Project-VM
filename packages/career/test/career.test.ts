import { describe, it, expect, beforeAll } from "vitest";
import { worldFromGameData, realPlayersFromGameData } from "../src/game-data.ts";
import {
  ABILITY_KEYS, RATED_KEYS, STAFF_ROLES, STAFF_ATTRS, REGIONS,
  advanceSeason, coachFactor, createWorld, deriveCalibration, deserializeWorld, developPlayer, generatePlayer,
  generateStaff, isBlockedHandle, maturity, newProspects, normalizeHandle, populationSummary, serializeWorld,
  startingFive, teamStaffInputs, estimateAbility, type World, type WorldPlayer, type RatedAttr,
} from "../src/index.ts";

const SEED = 20261123;
const real = realPlayersFromGameData();
const realHandles = new Set(real.map((p) => p.handle).filter((h): h is string => !!h).map(normalizeHandle));

let start: World;
let seasons: World[];
beforeAll(() => {
  start = worldFromGameData(SEED);
  seasons = [start];
  for (let i = 0; i < 10; i++) seasons.push(advanceSeason(seasons[seasons.length - 1]!));
});

const val = (p: WorldPlayer, k: string): number => (p.attributes![k] as RatedAttr).value;

describe("generation", () => {
  it("is deterministic by seed and id", () => {
    const cal = deriveCalibration(real);
    const a = generatePlayer({ seed: 1, id: "gp-x", region: "pacific", season: 2026, calibration: cal, reserved: new Set(realHandles) });
    const b = generatePlayer({ seed: 1, id: "gp-x", region: "pacific", season: 2026, calibration: cal, reserved: new Set(realHandles) });
    const c = generatePlayer({ seed: 2, id: "gp-x", region: "pacific", season: 2026, calibration: cal, reserved: new Set(realHandles) });
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect(generateStaff({ seed: 1, id: "gs-x", region: "emea", role: "analyst", season: 2026, calibration: cal }))
      .toEqual(generateStaff({ seed: 1, id: "gs-x", region: "emea", role: "analyst", season: 2026, calibration: cal }));
  });

  it("builds the same world and seasons from the same seed", () => {
    const again = advanceSeason(advanceSeason(worldFromGameData(SEED)));
    expect(serializeWorld(again)).toBe(serializeWorld(seasons[2]!));
    expect(serializeWorld(worldFromGameData(SEED + 1))).not.toBe(serializeWorld(start));
  });

  it("keeps every generated attribute inside the real players' range, with PA ≥ CA", () => {
    const cal = start.calibration;
    let checked = 0;
    for (const w of seasons) {
      for (const p of Object.values(w.players).filter((x) => x.generated)) {
        for (const k of RATED_KEYS) {
          expect(val(p, k)).toBeGreaterThanOrEqual(cal.min[k] - 1e-9);
          expect(val(p, k)).toBeLessThanOrEqual(cal.max[k] + 1e-9);
        }
        for (const k of ABILITY_KEYS) expect(val(p, k)).toBeLessThanOrEqual(p.peak![k]! + 1e-9);
        expect(p.pa!).toBeGreaterThanOrEqual(p.ca!);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("draws prospects mostly 16–19 from an archetype × potential × age formula", () => {
    const pros = newProspects(start);
    expect(pros.length).toBeGreaterThan(20);
    for (const p of pros) {
      expect(p.age).toBeGreaterThanOrEqual(16);
      expect(p.age).toBeLessThanOrEqual(19);
      expect(p.generated).toBe(true);
      expect(p.origin).toBe("generated");
      expect(p.agentPool.length).toBeGreaterThan(0);
    }
    // Younger prospects are further from their peak (maturity curve).
    expect(maturity(16, "aim")).toBeLessThan(maturity(19, "aim"));
    const gap = (p: WorldPlayer) => p.pa! - p.ca!;
    const young = pros.filter((p) => p.age <= 17), old = pros.filter((p) => p.age >= 19);
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean(young.map(gap))).toBeGreaterThan(mean(old.map(gap)));
    // Role archetypes survive: generated duelists out-aim generated controllers on average.
    const gens = Object.values(seasons[10]!.players).filter((p) => p.generated);
    const aimOf = (role: string) => mean(gens.filter((p) => p.role === role).map((p) => val(p, "aim")));
    expect(aimOf("duelist")).toBeGreaterThan(aimOf("controller"));
  });

  it("never issues a real player's handle, a duplicate, or a blocked fragment", () => {
    const seen = new Set<string>();
    for (const p of Object.values(seasons[10]!.players).concat(Object.values(start.players)).filter((x) => x.generated)) {
      const n = normalizeHandle(p.handle!);
      expect(realHandles.has(n)).toBe(false);
      expect(isBlockedHandle(n)).toBe(false);
      seen.add(`${p.playerId}:${n}`);
    }
    const byHandle = new Map<string, string>();
    for (const w of seasons) for (const p of Object.values(w.players).filter((x) => x.generated)) {
      const n = normalizeHandle(p.handle!);
      const prev = byHandle.get(n);
      if (prev) expect(prev).toBe(p.playerId);
      byHandle.set(n, p.playerId);
    }
    expect(byHandle.size).toBeGreaterThan(1000);
  });

  it("matches nationalities to the real regional distribution", () => {
    const gens = Object.values(seasons[10]!.players).filter((p) => p.generated);
    for (const r of REGIONS) {
      const countries = new Set(Object.keys(start.calibration.countries[r]));
      for (const p of gens.filter((x) => x.region === r)) expect(countries.has(p.country!)).toBe(true);
    }
    const kr = gens.filter((p) => p.country === "kr").length;
    const sg = gens.filter((p) => p.country === "sg").length;
    expect(kr).toBeGreaterThan(sg); // 47 real Korean pros vs 6 Singaporean
  });
});

describe("staff", () => {
  it("gives every team a head coach, analyst and scout with the attributes the engine reads", () => {
    for (const w of [start, seasons[10]!]) {
      for (const t of Object.values(w.teams)) {
        for (const role of STAFF_ROLES) {
          const s = w.staff[t.staff[role]!]!;
          expect(s.role).toBe(role);
          expect(s.generated).toBe(true);
          for (const k of STAFF_ATTRS[role]) expect(s.attributes[k]).toBeGreaterThanOrEqual(0.05);
        }
        const inputs = teamStaffInputs(w, t.teamId);
        expect(inputs.analyst).toBe(w.staff[t.staff.analyst!]!.attributes.analysis);
      }
    }
  });

  it("a better scout misjudges less", () => {
    const w = seasons[3]!;
    const scouts = Object.values(w.staff).filter((s) => s.role === "scout");
    const best = scouts.reduce((a, b) => (a.attributes.judgingPotential! > b.attributes.judgingPotential! ? a : b));
    const worst = scouts.reduce((a, b) => (a.attributes.judgingPotential! < b.attributes.judgingPotential! ? a : b));
    const pros = Object.values(w.players).filter((p) => p.generated && p.careerMaps === 0);
    const err = (s: typeof best) => pros.reduce((sum, p) => sum + Math.abs(estimateAbility(w, s, p).pa - p.pa!), 0) / pros.length;
    expect(err(best)).toBeLessThan(err(worst));
  });
});

describe("season flow", () => {
  it("keeps the population stable over ten seasons", () => {
    const target = start.regionTargets;
    for (const w of seasons.slice(1)) {
      const s = populationSummary(w);
      for (const r of REGIONS) {
        expect(Math.abs(s.byRegion[r] - target[r]) / target[r]).toBeLessThan(0.05);
      }
      expect(Math.abs(s.staff - w.staffTarget) / w.staffTarget).toBeLessThan(0.15);
      for (const t of Object.values(w.teams)) {
        expect(t.roster.length).toBeGreaterThanOrEqual(5);
        expect(t.roster.length).toBeLessThanOrEqual(8);
      }
      const rec = w.history[w.history.length - 1]!;
      expect(rec.season).toBe(w.season);
      expect(rec.newPlayers.length).toBeGreaterThan(0);
      expect(rec.retiredPlayers.length).toBeGreaterThan(0);
    }
    // Generated people replace the real ones over time; teams sign them.
    const end = seasons[10]!;
    const gens = Object.values(end.players).filter((p) => p.generated);
    expect(gens.length).toBeGreaterThan(Object.keys(end.players).length / 2);
    expect(gens.filter((p) => p.status === "rostered").length).toBeGreaterThan(100);
    // The level of the starting fives stays where the real league is (no drift up or down).
    const starterCa = (w: World) => {
      const cas = Object.values(w.teams).flatMap((t) => startingFive(w, t.teamId)).map((p) => p.ca).filter((v): v is number => v !== null);
      return cas.reduce((s, v) => s + v, 0) / cas.length;
    };
    expect(Math.abs(starterCa(end) - starterCa(start))).toBeLessThan(0.05);
  });

  it("ages, develops toward potential and declines", () => {
    const a = start, b = seasons[1]!;
    const stayed = Object.values(b.players).filter((p) => a.players[p.playerId]);
    for (const p of stayed.slice(0, 200)) expect(p.age).toBe(a.players[p.playerId]!.age + 1);
    const youngGen = stayed.filter((p) => p.generated && a.players[p.playerId]!.age <= 18);
    const grew = youngGen.filter((p) => p.ca! > a.players[p.playerId]!.ca!).length;
    expect(grew / youngGen.length).toBeGreaterThan(0.9);
    const vets = stayed.filter((p) => p.hasRatings && a.players[p.playerId]!.age >= 30);
    if (vets.length) expect(vets.filter((p) => p.ca! < a.players[p.playerId]!.ca!).length / vets.length).toBeGreaterThan(0.9);
  });

  it("develops faster with playing time and a better coach", () => {
    const w = JSON.parse(JSON.stringify(start)) as World;
    const base = newProspects(w).find((p) => p.age === 17)!;
    const grow = (maps: number, coach: number) => {
      const p = JSON.parse(JSON.stringify(base)) as WorldPlayer;
      developPlayer(w, p, maps, coach, w.season);
      return p.ca! - base.ca!;
    };
    expect(grow(40, 0.9)).toBeGreaterThan(grow(40, 0.1));
    expect(grow(40, 0.5)).toBeGreaterThan(grow(4, 0.5));
    expect(coachFactor(0.5)).toBe(1);
  });

  it("round-trips a save and continues identically after loading", () => {
    const w = seasons[4]!;
    const loaded = deserializeWorld(serializeWorld(w));
    expect(loaded).toEqual(w);
    expect(Object.values(loaded.players).some((p) => p.generated && p.origin === "generated")).toBe(true);
    expect(serializeWorld(advanceSeason(loaded))).toBe(serializeWorld(seasons[5]!));
    expect(() => deserializeWorld(JSON.stringify({ format: "x" }))).toThrow();
  });

  it("does not mutate the world it advances", () => {
    const before = serializeWorld(start);
    advanceSeason(start);
    expect(serializeWorld(start)).toBe(before);
  });

  it("works with an empty team list (no rosters, no staff)", () => {
    const w = createWorld({ seed: 3, season: 2026, players: real.slice(0, 300), teams: [] });
    const n = advanceSeason(advanceSeason(w));
    expect(Object.keys(n.players).length).toBeGreaterThan(0);
  });
});
