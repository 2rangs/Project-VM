import type { SpatialEngine } from "@project-v/spatial-engine";
import { AVERAGE_SKILLS, type CombatSkills } from "@project-v/combat-engine";
import type { SimPlayer, SimState } from "./types.js";

export interface SyntheticRoundOptions {
  readonly matchId?: string;
  readonly roundId?: string;
  readonly roundTimeMs?: number;
  /** weapon id each player holds (must exist in the weapons catalog given to the sim). */
  readonly attackerWeapon?: string;
  readonly defenderWeapon?: string;
  readonly skills?: CombatSkills;
  /** Assign a default Ascent-meta utility loadout (ability ids must exist in the sim catalog). */
  readonly withAbilities?: boolean;
}

/** One ability per attacker (ids match the ability-engine manual-approx fixture). */
const ATTACKER_ABILITIES: Readonly<Record<string, string>> = {
  atk1: "omen:Ability2", // smoke
  atk2: "breach:Ability2", // flash
  atk3: "sova:Ability2", // recon
  atk4: "brimstone:Ability1", // molly
  atk5: "omen:Ability2", // smoke
};
const DEFENDER_ABILITIES: Readonly<Record<string, string>> = {
  def1: "omen:Ability2", def3: "sova:Ability2", def5: "brimstone:Ability1",
};

function mkPlayer(spatial: SpatialEngine, id: string, side: "attack" | "defense", zoneId: string, weaponId: string, skills: CombatSkills, abilityId?: string): SimPlayer {
  const zone = spatial.getZone(zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "agent",
    position: { ...zone.position }, zoneId, facing: { x: 1, y: 0 },
    health: 100, armor: 50, alive: true, weaponId, skills,
    abilities: abilityId ? [{ abilityId, chargesRemaining: 1, lastUsedAtMs: null }] : [],
    ultimatePoints: 0, ultimateCost: 7,
    path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

/**
 * A SYNTHETIC 5v5 Ascent initial state placed on real spatial zones (valorant-api
 * callout centers). Attackers spawn together; defenders anchor A/B/mid. One attacker
 * carries the spike. This is a manual-approx test scaffold, not real match data.
 */
export function makeSyntheticRound(spatial: SpatialEngine, opts: SyntheticRoundOptions = {}): SimState {
  const skills = opts.skills ?? AVERAGE_SKILLS;
  const aw = opts.attackerWeapon ?? "Vandal";
  const dw = opts.defenderWeapon ?? "Vandal";
  const ab = (id: string, def?: string) => (opts.withAbilities ? ATTACKER_ABILITIES[id] ?? DEFENDER_ABILITIES[id] ?? def : undefined);

  const attackers = [
    mkPlayer(spatial, "atk1", "attack", "attacker-spawn", aw, skills, ab("atk1")),
    mkPlayer(spatial, "atk2", "attack", "attacker-spawn", aw, skills, ab("atk2")),
    mkPlayer(spatial, "atk3", "attack", "attacker-spawn", aw, skills, ab("atk3")),
    mkPlayer(spatial, "atk4", "attack", "attacker-spawn", aw, skills, ab("atk4")),
    mkPlayer(spatial, "atk5", "attack", "attacker-spawn", aw, skills, ab("atk5")),
  ];
  const defenders = [
    mkPlayer(spatial, "def1", "defense", "a-site", dw, skills, ab("def1")),
    mkPlayer(spatial, "def2", "defense", "a-site", dw, skills),
    mkPlayer(spatial, "def3", "defense", "b-site", dw, skills, ab("def3")),
    mkPlayer(spatial, "def4", "defense", "b-site", dw, skills),
    mkPlayer(spatial, "def5", "defense", "mid-courtyard", dw, skills, ab("def5")),
  ];
  const roundTimeMs = opts.roundTimeMs ?? 100000;

  return {
    matchId: opts.matchId ?? "synthetic", roundId: opts.roundId ?? "synthetic:1", mapId: "ascent",
    tick: 0, elapsedMs: 0, timeRemainingMs: roundTimeMs,
    players: [...attackers, ...defenders],
    spike: { phase: "carried", carrierId: "atk1", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
}

/** Default defender anchors for the synthetic round (for ScriptedPolicy). */
export const SYNTHETIC_DEFENSE_ANCHORS: Readonly<Record<string, string>> = {
  def1: "a-site", def2: "a-site", def3: "b-site", def4: "b-site", def5: "mid-courtyard",
};

/**
 * Structural adapter for PV-2 synthetic scenarios (datasets/synthetic/scenarios/).
 *
 * TODO(F3, coordinate reconciliation): PV-2's v1 scenarios use an *illustrative* 0..1000
 * minimap frame (origin top-left) that is NOT valorant-api's real minimap, so positions are
 * not geometrically convertible to PV-4 zones. Per the integration decision (PV-2-data §10,
 * INTEGRATION_REHEARSAL F1/F3), PV-2 is regenerating scenarios in **game world units + zoneId
 * (v2)**. When a player carries a `worldPos` (game units) or a `zoneId`, this adapter uses it
 * directly (worldPos → nearestZone; else zoneId). Until then it falls back to placing each
 * player at its side's spawn — a provenance-preserving import, not a spatial one.
 */
export function fromPv2Scenario(spatial: SpatialEngine, scenario: unknown, skills: CombatSkills = AVERAGE_SKILLS): SimState {
  const ws = (scenario as { worldState?: Record<string, unknown> }).worldState ?? (scenario as Record<string, unknown>);
  const attackingTeamIdx = (ws.attackingTeamIdx as number) ?? 0;
  const rawPlayers = (ws.players as Array<Record<string, unknown>>) ?? [];
  const players: SimPlayer[] = rawPlayers.map((rp) => {
    const side: "attack" | "defense" = (rp.teamIdx as number) === attackingTeamIdx ? "attack" : "defense";
    const loadout = (rp.loadout as Record<string, unknown>) ?? {};
    const weapon = capitalizeWeapon(String(loadout.weaponId ?? "Vandal"));
    // v2 (game units): use worldPos → nearest zone, or an explicit zoneId, when present.
    const worldPos = rp.worldPos as { x: number; y: number; z?: number } | undefined;
    const explicitZone = rp.zoneId as string | undefined;
    let zoneId: string;
    if (worldPos) zoneId = spatial.nearestZone({ x: worldPos.x, y: worldPos.y, z: worldPos.z ?? 0 }).id;
    else if (explicitZone && spatial.getZone(explicitZone)) zoneId = explicitZone;
    else zoneId = side === "attack" ? "attacker-spawn" : "defender-spawn"; // TODO(F3) fallback
    return mkPlayer(spatial, String(rp.playerId), side, zoneId, weapon, skills);
  });
  const carrier = players.find((p) => p.side === "attack");
  return {
    matchId: String(ws.matchId ?? "pv2"), roundId: String(ws.roundId ?? "pv2:1"), mapId: "ascent",
    tick: 0, elapsedMs: 0, timeRemainingMs: Number(ws.timeRemainingMs ?? 100000),
    players,
    spike: { phase: "carried", carrierId: carrier?.id ?? null, zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
}

function capitalizeWeapon(id: string): string {
  return id.length === 0 ? id : id[0].toUpperCase() + id.slice(1);
}
