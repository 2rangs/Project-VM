import { describe, it, expect } from "vitest";
import {
  spatialQueryFromEngine,
  MinimapUnitsConverter,
  combatEstimatorFromEngine,
  economyEvaluatorFromEngine,
  availabilityToFeasibility,
  abilityFeasibility,
  observationProviderForPlayer,
  normalizeAgentSlug,
  teamIdToIdx,
  teamIdxToId,
  KNOWN_MISMATCHES,
  BRANCH_NOTATION_SURVEY,
  type SpatialEngineLike,
  type MapCoordinateSystemLike,
} from "@pv/integration-adapters";
import {
  asPlayerId,
  asTeamId,
  asZoneId,
  type EconomyContext,
  type ObservationState,
} from "@pv/shared-types";

// ---- fake spatial-engine ----
const fakeCoords: MapCoordinateSystemLike = {
  toGame: (m) => ({ x: m.x * 1000, y: m.y * 1000 }), // normalized → "game" (identity ×1000)
  toMinimap: (g) => ({ x: g.x / 1000, y: g.y / 1000 }),
};
const Z = [
  { id: "a-site", zoneType: "site", site: "A", plantable: true, position: { x: 780, y: 360, z: 0 }, callout: "A Site" },
  { id: "b-site", zoneType: "site", site: "B", plantable: false, position: { x: 230, y: 360, z: 0 } },
  { id: "mid", zoneType: "mid", site: null, plantable: false, position: { x: 500, y: 505, z: 0 } },
];
const fakeEngine: SpatialEngineLike = {
  mapId: "ascent",
  coords: fakeCoords,
  zones: Z,
  getZone: (id) => Z.find((z) => z.id === id),
  zonesByType: (t) => Z.filter((z) => z.zoneType === t),
  nearestZone: (p) => {
    let best = Z[0]!;
    let bd = Infinity;
    for (const z of Z) {
      const d = (z.position.x - p.x) ** 2 + (z.position.y - p.y) ** 2;
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  },
  findPath: (from, to) => ({ path: [from, to], timeMs: 2500, distanceMeters: 16.8 }),
  shortestTravelTimeMs: () => 2500,
  isReachable: () => true,
  hasLineOfSight: (_a, _b, opts) => !opts?.smokedPairs?.length,
  visibleZonesFrom: (id) => Z.filter((z) => z.id !== id).map((z) => z.id),
  isPlantableZone: (id) => Z.find((z) => z.id === id)?.plantable ?? false,
  audibleZones: () => [{ zoneId: "mid", strength: 0.5 }],
};

describe("spatial adapter", () => {
  const sq = spatialQueryFromEngine(fakeEngine);
  it("converts minimapUnits → game and resolves the nearest zone", () => {
    // minimapUnits {500,360} → norm {0.5,0.36} → game {500,360} → nearest a-site? b-site?
    expect(String(sq.nearestZone({ x: 780, y: 360 }))).toBe("a-site");
    expect(String(sq.nearestZone({ x: 230, y: 360 }))).toBe("b-site");
  });
  it("delegates path, LoS, plant and audible queries", () => {
    expect(sq.shortestTravelTimeMs(asZoneId("a-site"), asZoneId("mid"))).toBe(2500);
    expect(sq.isPlantableZone(asZoneId("a-site"))).toBe(true);
    expect(sq.isPlantableZone(asZoneId("b-site"))).toBe(false);
    expect(sq.hasLineOfSight(asZoneId("a-site"), asZoneId("mid"))).toBe(true);
    expect(sq.hasLineOfSight(asZoneId("a-site"), asZoneId("mid"), { smokedPairs: [[asZoneId("a-site"), asZoneId("mid")]] })).toBe(false);
    expect(sq.audibleZones(asZoneId("a-site"))[0]!.strength).toBe(0.5);
  });
  it("MinimapUnitsConverter round-trips", () => {
    const conv = new MinimapUnitsConverter(fakeCoords, { minimapScale: 1000 });
    const g = conv.toGame({ x: 500, y: 905 });
    expect(conv.fromGame(g)).toEqual({ x: 500, y: 905 });
  });
});

describe("combat adapter", () => {
  const TIER: Record<string, number> = { vandal: 2, classic: 0, operator: 2.4 };
  const estimator = combatEstimatorFromEngine({
    monteCarloDuel: (duel, trials) => {
      const a = TIER[String(duel.a.weapon)] ?? 1;
      const b = TIER[String(duel.b.weapon)] ?? 1;
      const aWins = Math.round(trials * Math.max(0.05, Math.min(0.95, 0.5 + 0.1 * (a - b))));
      return { trials, wins: { a: aWins, b: trials - aWins } };
    },
    requireWeapon: (_c, slug) => slug, // spec == slug for the fake
    catalog: {},
    makeSkills: (aim) => ({ aim }),
    trials: 200,
  });
  it("returns wins[attacker]/trials", () => {
    const p = estimator.estimateDuelWinProb({
      attackerWeapon: "vandal", defenderWeapon: "classic", attackerHealth: 100, defenderHealth: 100,
      distanceMeters: 15, attackerHasCover: false, defenderHasCover: false, attackerFlashed: false, defenderFlashed: false, attackerAim: 0.5, defenderAim: 0.5,
    });
    expect(p).toBeGreaterThan(0.6);
  });
  it("blends toward an opening-duel prior when provided", () => {
    const biased = combatEstimatorFromEngine({
      monteCarloDuel: (duel, trials) => ({ trials, wins: { a: trials, b: 0 } }), // 1.0
      requireWeapon: (_c, s) => s, catalog: {}, makeSkills: () => ({}), trials: 100,
      openingDuelPrior: 0.5, priorWeight: 0.5,
    });
    const p = biased.estimateDuelWinProb({
      attackerWeapon: "vandal", defenderWeapon: "vandal", attackerHealth: 100, defenderHealth: 100,
      distanceMeters: 15, attackerHasCover: false, defenderHasCover: false, attackerFlashed: false, defenderFlashed: false, attackerAim: 0.5, defenderAim: 0.5,
    });
    expect(p).toBeCloseTo(0.75, 5); // 0.5*1.0 + 0.5*0.5
  });
});

describe("economy adapter", () => {
  const evaluator = economyEvaluatorFromEngine({
    evaluateEconomy: (decision) => {
      const teamIdx = decision.phase === "save" ? decision.context.teamIdx : 0;
      return [{
        action: decision.phase === "save" ? "SAVE_WEAPON" : "EXIT_KILL",
        currentRoundValue: 0.1, futureValue: 0.5, economicDelta: 1000, ultDelta: teamIdx, explanation: `phase ${decision.phase}`,
      }];
    },
  });
  const ctx: EconomyContext = { roundNumber: 5, side: "defense", aliveSelf: 1, aliveEnemy: 4, timeRemainingMs: 35000, matchScore: [6, 6], selfLoadoutValue: null };
  it("maps EconomyContext to save/exit contexts and returns EconomyOption[]", () => {
    const save = evaluator.saveOptions(ctx);
    expect(save[0]!.action).toBe("SAVE_WEAPON");
    expect(save[0]!.ultDelta).toBe(1); // teamIdx derived from side "defense" → 1
    const exit = evaluator.exitKillOptions(ctx);
    expect(exit[0]!.action).toBe("EXIT_KILL");
  });
});

describe("ability adapter", () => {
  it("maps availability to feasibility", () => {
    expect(availabilityToFeasibility({ usable: true })).toEqual({ feasible: true });
    const infeasible = availabilityToFeasibility({ usable: false, reason: "no-charges" });
    expect(infeasible.feasible).toBe(false);
    if (!infeasible.feasible) expect(infeasible.reasons).toContain("missingAbility");
  });
  it("abilityFeasibility runs the injected check", () => {
    const check = (_c: unknown, e: { charges: number }) => ({ usable: e.charges > 0 });
    expect(abilityFeasibility(check, {}, { abilityId: "x", charges: 0 }).feasible).toBe(false);
    expect(abilityFeasibility(check, {}, { abilityId: "x", charges: 1 }).feasible).toBe(true);
  });
});

describe("observation adapter", () => {
  it("serves a player's observation from a perception result", () => {
    const obs: ObservationState = {
      observerId: asPlayerId("atk1"), teamId: asTeamId("team-0"), timestampMs: 1000,
      visibleEnemies: [], audibleEvents: [], teammateReports: [], knownMapChanges: [],
    };
    const provider = observationProviderForPlayer({ players: new Map([["atk1", obs]]) }, asPlayerId("atk1"));
    expect(provider.observe(asTeamId("team-0"), 1000)).toBe(obs);
    const missing = observationProviderForPlayer({ players: new Map() }, asPlayerId("ghost"));
    expect(() => missing.observe(asTeamId("team-0"), 0)).toThrow();
  });
});

describe("normalization", () => {
  it("canonicalizes agent slugs", () => {
    expect(normalizeAgentSlug("kayo")).toBe("kay-o");
    expect(normalizeAgentSlug("KAY/O")).toBe("kay-o");
    expect(normalizeAgentSlug("Jett")).toBe("jett");
  });
  it("maps team ids", () => {
    expect(teamIdToIdx("team-1")).toBe(1);
    expect(teamIdToIdx("team-0")).toBe(0);
    expect(teamIdxToId(1)).toBe("team-1");
  });
  it("documents known mismatches and the branch survey", () => {
    expect(KNOWN_MISMATCHES.length).toBeGreaterThan(0);
    expect(BRANCH_NOTATION_SURVEY.some((b) => b.branch.includes("pv-spatial"))).toBe(true);
  });
});
