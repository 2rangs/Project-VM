// Shared scene builders for the ability-realism counterfactual tests (smoke exit, ground patches,
// ability cues). Catalog values mirror the PV-1 records used by the match runner; anything not in
// the catalog is left out on purpose so the simulator's documented defaults apply.
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { abilitySpecFromCatalog, buildAbilityCatalog, type AbilityCatalog } from "@pv/ability-engine";
import type { ActionCommand, DecisionPolicy, PolicyDecision, PolicyView, SimPlayer, SimState } from "../../src/index.js";
import { loadSpatial, loadWeapons } from "./setup.js";

export const spatial = loadSpatial();
export const weapons = loadWeapons();

export const SMOKE = "omen:Ability2";
export const FLASH = "kay-o:Ability1";
export const RECON = "sova:Ability2";
export const FIRE = "killjoy:Grenade";
export const SLOW = "sage:Ability1";

export const catalog: AbilityCatalog = buildAbilityCatalog([
  abilitySpecFromCatalog({ abilityId: SMOKE, slot: "Ability2", name: "Dark Cover", effectTypes: ["smoke"], params: { rangeMeters: 80, radiusMeters: 4.1, durationMs: 15000, blocksVision: true, makesSound: true } }),
  abilitySpecFromCatalog({ abilityId: FLASH, slot: "Ability1", name: "FLASH/drive", effectTypes: ["flash"], params: { windupMs: 800, durationMs: 2250, makesSound: true } }),
  abilitySpecFromCatalog({ abilityId: RECON, slot: "Ability2", name: "Recon Bolt", effectTypes: ["recon"], params: { windupMs: 667, radiusMeters: 30, makesSound: true } }),
  abilitySpecFromCatalog({ abilityId: FIRE, slot: "Grenade", name: "Nanoswarm", effectTypes: ["molly"], params: { radiusMeters: 4, durationMs: 5000, makesSound: true } }),
  abilitySpecFromCatalog({ abilityId: SLOW, slot: "Ability1", name: "Slow Orb", effectTypes: ["slow"], params: { radiusMeters: 4, durationMs: 7000, makesSound: true } }),
]);

export function player(id: string, side: "attack" | "defense", zoneId: string, abilities: readonly string[] = []): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 50, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS,
    abilities: abilities.map((abilityId) => ({ abilityId, slot: "basic" as const, chargesRemaining: 1, lastUsedAtMs: null })),
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

export function scene(players: SimPlayer[], timeRemainingMs: number, carrierId: string | null = null): SimState {
  return {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs, players,
    spike: { phase: "carried", carrierId, zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
}

/** A policy from a per-player rule; players the rule returns nothing for hold. Records every view it is given. */
export function scripted(rule: (p: PolicyView["teammates"][number], v: PolicyView) => Omit<ActionCommand, "playerId"> | undefined, views?: PolicyView[]): DecisionPolicy {
  return {
    decide: (v: PolicyView): PolicyDecision => {
      views?.push(v);
      return {
        strategy: "default", roles: [],
        commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, ...(rule(p, v) ?? { kind: "hold" as const }) })),
      };
    },
  };
}

/** Charges a teammate still has of an ability (the policy's own view of it). */
export function charges(p: PolicyView["teammates"][number], abilityId: string): number {
  const slots = [...p.abilities.basic, ...(p.abilities.signature ? [p.abilities.signature] : [])];
  return slots.find((a) => String(a.abilityId) === abilityId)?.charges ?? 0;
}
