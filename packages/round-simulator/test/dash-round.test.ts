import { describe, it, expect } from "vitest";
import { buildAbilityCatalog, abilitySpecFromCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { loadSpatial, loadWeapons } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

// Jett-style dash: a movement effect with a generous range so the test target is reachable.
const catalog: AbilityCatalog = buildAbilityCatalog([
  abilitySpecFromCatalog({ abilityId: "jett:Ability2", slot: "Ability2", name: "Tailwind", effectTypes: ["movement"], params: { rangeMeters: 100, makesSound: true } }, { charges: 1 }),
]);

const DASH_TO = "a-main";

function dasher(zoneId: string): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id: "atk", teamId: "attackers", side: "attack", agentId: "jett",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 0, alive: true, weaponId: "Classic",
    skills: AVERAGE_SKILLS, abilities: [{ abilityId: "jett:Ability2", slot: "basic", chargesRemaining: 1, lastUsedAtMs: null }],
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

// idle defender far away so the round does not end before the dash resolves
function idleDefender(): SimPlayer {
  const z = spatial.getZone("b-site")!;
  return { ...dasher("b-site"), id: "def", teamId: "defenders", side: "defense", position: { ...z.position }, zoneId: "b-site", abilities: [] };
}

const dashPolicy: DecisionPolicy = {
  decide(view: PolicyView): PolicyDecision {
    const p = view.teammates.find((t) => t.alive && t.side === "attack");
    const commands = p && view.timeRemainingMs > 59000 ? [{ playerId: p.id, kind: "useAbility" as const, abilityId: "jett:Ability2", targetZone: DASH_TO }] : [];
    return { strategy: "default", roles: [], commands };
  },
};
const idlePolicy: DecisionPolicy = { decide: (v) => ({ strategy: "default", roles: [], commands: v.teammates.filter((t) => t.alive).map((t) => ({ playerId: t.id, kind: "hold" as const })) }) };

describe("movement ability displaces the caster (dash)", () => {
  it("teleports the caster to the commanded target zone within range", () => {
    const start = "a-site";
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [dasher(start), idleDefender()],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: catalog,
      policies: { attack: dashPolicy, defense: idlePolicy },
      config: { seed: 1, roundTimeMs: 4000, recordTracks: true, traceCommands: true },
    }).runRound(state);

    expect(r.commandTrace!.some((e) => e.playerId === "atk" && e.result === "displaced" && e.toZone === DASH_TO)).toBe(true);
    // the recorded track shows the attacker at the dash destination, not the start zone
    const destPos = spatial.getZone(DASH_TO)!.position;
    const lastAtk = r.tracks!.at(-1)!.players.find((p) => p.id === "atk")!;
    expect(lastAtk.x).toBeCloseTo(destPos.x, 3);
    expect(lastAtk.y).toBeCloseTo(destPos.y, 3);
  });

  it("rejects the dash as outOfRange when the target is beyond the ability range", () => {
    const shortCatalog: AbilityCatalog = buildAbilityCatalog([
      abilitySpecFromCatalog({ abilityId: "jett:Ability2", slot: "Ability2", name: "Tailwind", effectTypes: ["movement"], params: { rangeMeters: 0.1 } }, { charges: 1 }),
    ]);
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [dasher("a-site"), idleDefender()],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: shortCatalog,
      policies: { attack: dashPolicy, defense: idlePolicy },
      config: { seed: 1, roundTimeMs: 2000, traceCommands: true },
    }).runRound(state);
    expect(r.commandTrace!.some((e) => e.playerId === "atk" && e.result === "outOfRange")).toBe(true);
    expect(r.commandTrace!.some((e) => e.result === "displaced")).toBe(false);
  });
});
