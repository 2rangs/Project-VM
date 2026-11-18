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
}

function mkPlayer(spatial: SpatialEngine, id: string, side: "attack" | "defense", zoneId: string, weaponId: string, skills: CombatSkills): SimPlayer {
  const zone = spatial.getZone(zoneId);
  if (!zone) throw new Error(`no zone ${zoneId}`);
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "agent",
    position: { ...zone.position }, zoneId, facing: { x: 1, y: 0 },
    health: 100, armor: 50, alive: true, weaponId, skills,
    abilities: [], ultimatePoints: 0, ultimateCost: 7,
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

  const attackers = [
    mkPlayer(spatial, "atk1", "attack", "attacker-spawn", aw, skills),
    mkPlayer(spatial, "atk2", "attack", "attacker-spawn", aw, skills),
    mkPlayer(spatial, "atk3", "attack", "attacker-spawn", aw, skills),
    mkPlayer(spatial, "atk4", "attack", "attacker-spawn", aw, skills),
    mkPlayer(spatial, "atk5", "attack", "attacker-spawn", aw, skills),
  ];
  const defenders = [
    mkPlayer(spatial, "def1", "defense", "a-site", dw, skills),
    mkPlayer(spatial, "def2", "defense", "a-site", dw, skills),
    mkPlayer(spatial, "def3", "defense", "b-site", dw, skills),
    mkPlayer(spatial, "def4", "defense", "b-site", dw, skills),
    mkPlayer(spatial, "def5", "defense", "mid-courtyard", dw, skills),
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
 * Structural adapter for PV-2 synthetic scenarios (datasets/synthetic/scenarios/). PV-2's
 * scenario coordinate space differs from PV-4's spatial zones, so positions are NOT
 * imported; each player is placed at its side's spawn zone and only the structured fields
 * (id, side, weapon, skills default) are carried. This is a provenance-preserving import,
 * not a spatial one — a shared coordinate agreement with PV-2 is needed for true positions.
 */
export function fromPv2Scenario(spatial: SpatialEngine, scenario: unknown, skills: CombatSkills = AVERAGE_SKILLS): SimState {
  const ws = (scenario as { worldState?: Record<string, unknown> }).worldState ?? (scenario as Record<string, unknown>);
  const attackingTeamIdx = (ws.attackingTeamIdx as number) ?? 0;
  const rawPlayers = (ws.players as Array<Record<string, unknown>>) ?? [];
  const players: SimPlayer[] = rawPlayers.map((rp) => {
    const side: "attack" | "defense" = (rp.teamIdx as number) === attackingTeamIdx ? "attack" : "defense";
    const spawn = side === "attack" ? "attacker-spawn" : "defender-spawn";
    const loadout = (rp.loadout as Record<string, unknown>) ?? {};
    const p = mkPlayer(spatial, String(rp.playerId), side, spawn, capitalizeWeapon(String(loadout.weaponId ?? "Vandal")), skills);
    return p;
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
