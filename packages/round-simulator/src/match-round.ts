// PROJECT V — round-execution API for PV-3's Match Runner (`pnpm sim:match`).
//
// `runMatchRound(input)` is the clean, match-level entry point over the low-level
// `RoundSimulator.runRound(SimState)`. The Match Runner owns the match loop (score, economy,
// buy phases) and calls this once per round with:
//   INPUT  — both teams' rosters + loadouts (weapon/armor/abilities/ult points), economy
//            snapshot, the two team policies, and the RNG seed.
//   OUTPUT — the winner + reason, the full EventLog, and per-player end-of-round state the
//            Match Runner needs to set up the NEXT round: survival, equipment preservation
//            (weapon/armor/ability charges a survivor keeps), and ultimate-point changes.
//
// This module only ASSEMBLES a SimState, runs the deterministic round loop, and READS the
// mutated final state + event log back out. It does not apply economy rules (buy, loss bonus,
// refunds) — those are the Match Runner's job (PV-1 @pv/game-rules). Ultimate-point AWARD
// values come from @pv/game-rules ULTIMATE_POINT_RULES (PV-1), not invented here.
//
// Determinism: identical input (same rosters, seed, policies) ⇒ identical output (DECISION-010).

import type { SpatialEngine } from "@pv/spatial-engine";
import type { WeaponSpec, CombatSkills } from "@pv/combat-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import type { AbilityCatalog } from "@pv/ability-engine";
import { ULTIMATE_POINT_RULES } from "@pv/game-rules";
import type {
  AbilityLoadoutSlot,
  RoundEndReason,
  RoundResult,
  SimConfig,
  SimEvent,
  SimPlayer,
  SimState,
  Side,
} from "./types.js";
import type { DecisionPolicy, TeamEconomyState } from "./policy-contract.js";
import { RoundSimulator } from "./simulator.js";

/** A neutral ability-slot descriptor on the loadout (maps to AbilityInventory basic/sig/ult). */
export type LoadoutAbilitySlot = "basic" | "signature" | "ultimate";

export interface RoundAbilityLoadout {
  readonly abilityId: string;
  /** Which inventory slot this ability occupies. The `ultimate` one is the player's ult. */
  readonly slot?: LoadoutAbilitySlot;
  /** Charges available at round start. */
  readonly charges: number;
}

export interface PlayerLoadout {
  readonly weaponId: string;
  /** Armor points at round start (0 = no shield). */
  readonly armor?: number;
  readonly abilities?: readonly RoundAbilityLoadout[];
  /** Ultimate points carried into this round. */
  readonly ultimatePoints?: number;
  /** Points required to cast the ultimate (agent-specific; @pv/game-rules ULTIMATE_COSTS). */
  readonly ultimateCost?: number;
}

export interface MatchRoundPlayer {
  readonly id: string;
  readonly agentId: string;
  /** Per-player skill profile; defaults to AVERAGE_SKILLS. */
  readonly skills?: CombatSkills;
  /** Starting zone id; defaults to the side's spawn ("attacker-spawn"/"defender-spawn"). */
  readonly spawnZoneId?: string;
  readonly loadout: PlayerLoadout;
}

export interface MatchRoundTeam {
  readonly teamId?: string;
  readonly players: readonly MatchRoundPlayer[];
  /** Team economy snapshot (surfaced to policies via PolicyView.economy). */
  readonly economy?: TeamEconomyState;
}

export interface MatchRoundInput {
  // engines (shared across the whole match; construct once, reuse each round)
  readonly spatial: SpatialEngine;
  readonly weapons: Readonly<Record<string, WeaponSpec>>;
  readonly abilities: AbilityCatalog;
  readonly policies: Readonly<Record<Side, DecisionPolicy>>;

  readonly attackers: MatchRoundTeam;
  readonly defenders: MatchRoundTeam;

  /** RNG seed — the single source of this round's determinism. */
  readonly seed: number;

  readonly mapId?: string;
  readonly matchId?: string;
  readonly roundId?: string;
  readonly roundNumber?: number;

  /** Which attacker starts with the spike; defaults to the first attacker in the roster. */
  readonly spikeCarrierId?: string;

  /** Round-loop tuning (tick size, timers, calibration, recordTracks …). seed is taken from `seed`. */
  readonly config?: Partial<Omit<SimConfig, "seed">>;
}

/** End-of-round state for one player — what the Match Runner carries into the next round. */
export interface PlayerRoundOutcome {
  readonly id: string;
  readonly side: Side;
  readonly agentId: string;

  readonly alive: boolean;
  readonly died: boolean;
  readonly kills: number;

  // ---- equipment preservation (for the next buy phase) ----
  /** Weapon a SURVIVOR keeps into next round; null if the player died (gun is dropped). */
  readonly weaponRetained: string | null;
  /** Armor points retained; survivors keep their remaining shield, dead players keep none. */
  readonly armorRetained: number;
  /** Remaining ability charges (survivors only; dead players re-equip next round). */
  readonly abilitiesRemaining: readonly { readonly abilityId: string; readonly charges: number }[];

  // ---- ultimate-point changes ----
  readonly ultimatePointsStart: number;
  readonly ultimatePointsEarned: number;
  readonly ultimatePointsSpent: number;
  readonly ultimatePointsEnd: number;
  readonly ultimateUsed: boolean;
}

export interface MatchRoundOutput {
  readonly winner: Side;
  readonly reason: RoundEndReason;
  readonly endedAtElapsedMs: number;
  readonly endedAtTick: number;
  /** The canonical ordered EventLog for this round (replay/validation source). */
  readonly events: readonly SimEvent[];
  readonly survivors: Readonly<Record<Side, string[]>>;
  readonly players: readonly PlayerRoundOutcome[];
  /** The raw low-level RoundResult (roster, optional position tracks). */
  readonly round: RoundResult;
}

const DEFAULT_SPAWN: Readonly<Record<Side, string>> = {
  attack: "attacker-spawn",
  defense: "defender-spawn",
};

function buildSimPlayer(spatial: SpatialEngine, p: MatchRoundPlayer, side: Side): SimPlayer {
  const zoneId = p.spawnZoneId && spatial.getZone(p.spawnZoneId) ? p.spawnZoneId : DEFAULT_SPAWN[side];
  const zone = spatial.getZone(zoneId);
  if (!zone) throw new Error(`runMatchRound: no spawn zone '${zoneId}' for ${p.id}`);
  const abilities: AbilityLoadoutSlot[] = (p.loadout.abilities ?? []).map((a) => ({
    abilityId: a.abilityId,
    chargesRemaining: a.charges,
    lastUsedAtMs: null,
  }));
  return {
    id: p.id,
    teamId: side === "attack" ? "attackers" : "defenders",
    side,
    agentId: p.agentId,
    position: { ...zone.position },
    zoneId,
    facing: { x: 1, y: 0 },
    health: 100,
    armor: p.loadout.armor ?? 0,
    alive: true,
    weaponId: p.loadout.weaponId,
    skills: p.skills ?? AVERAGE_SKILLS,
    abilities,
    ultimatePoints: p.loadout.ultimatePoints ?? 0,
    ultimateCost: p.loadout.ultimateCost ?? 7,
    path: [],
    pathIndex: 0,
    edgeProgressMs: 0,
    moveMode: "run",
  };
}

/**
 * Run a single round for the Match Runner. Pure w.r.t. its input: it builds a fresh SimState,
 * runs the deterministic round loop, and returns the outcome. Same input ⇒ same output.
 */
export function runMatchRound(input: MatchRoundInput): MatchRoundOutput {
  const mapId = input.mapId ?? input.spatial.mapId;
  const attackers = input.attackers.players.map((p) => buildSimPlayer(input.spatial, p, "attack"));
  const defenders = input.defenders.players.map((p) => buildSimPlayer(input.spatial, p, "defense"));
  const players = [...attackers, ...defenders];

  const carrierId = input.spikeCarrierId ?? attackers[0]?.id ?? null;

  const state: SimState = {
    matchId: input.matchId ?? "match",
    roundId: input.roundId ?? `${input.matchId ?? "match"}:${input.roundNumber ?? 1}`,
    mapId,
    tick: 0,
    elapsedMs: 0,
    timeRemainingMs: input.config?.roundTimeMs ?? 100000,
    players,
    spike: {
      phase: "carried",
      carrierId,
      zoneId: null,
      position: null,
      plantProgressMs: 0,
      defuseProgressMs: 0,
      defuserId: null,
      detonateAtElapsedMs: null,
    },
  };

  const sim = new RoundSimulator({
    spatial: input.spatial,
    weapons: input.weapons,
    abilities: input.abilities,
    policies: input.policies,
    config: { ...input.config, seed: input.seed },
  });
  // runRound mutates `state` in place, so after it returns `state.players` is the final state.
  const round = sim.runRound(state);

  const outcomes = players.map((p) =>
    outcomeFor(p, round.events, input),
  );

  return {
    winner: round.winner,
    reason: round.reason,
    endedAtElapsedMs: round.endedAtElapsedMs,
    endedAtTick: round.endedAtTick,
    events: round.events,
    survivors: round.survivors,
    players: outcomes,
    round,
  };
}

function outcomeFor(p: SimPlayer, events: readonly SimEvent[], input: MatchRoundInput): PlayerRoundOutcome {
  const loadout = findLoadout(p.id, input);
  const start = loadout?.ultimatePoints ?? 0;
  const cost = p.ultimateCost;

  const kills = events.filter((e) => e.kind === "kill" && e.actor === p.id).length;
  const died = events.some((e) => e.kind === "kill" && e.target === p.id);
  const planted = events.some((e) => e.kind === "planted" && e.actor === p.id);
  const defused = events.some((e) => e.kind === "defused" && e.actor === p.id);

  // Ultimate-point AWARDS (PV-1 @pv/game-rules ULTIMATE_POINT_RULES; orbs not modelled by the
  // sim → 0). Death grants a point only if that rule's value is non-zero.
  const r = ULTIMATE_POINT_RULES;
  let earned = kills * r.pointForKill.value;
  if (died) earned += r.pointForDeath.value;
  if (planted) earned += r.pointForSpikePlant.value;
  if (defused) earned += r.pointForSpikeDefuse.value;

  // Which ability (if any) is the ultimate, and did the player cast it this round?
  const ultId = loadout?.abilities?.find((a) => a.slot === "ultimate")?.abilityId;
  const ultimateUsed = ultId != null && events.some((e) => e.kind === "abilityUsed" && e.actor === p.id && e.detail === ultId);

  const raw = start + earned;
  // Points are capped at the ult cost; casting the ult consumes `cost` points.
  const ultimatePointsEnd = ultimateUsed ? Math.max(0, raw - cost) : Math.min(raw, cost);
  const ultimatePointsSpent = ultimateUsed ? Math.min(raw, cost) : 0;

  const survived = p.alive;
  return {
    id: p.id,
    side: p.side,
    agentId: p.agentId,
    alive: survived,
    died,
    kills,
    weaponRetained: survived ? p.weaponId : null,
    armorRetained: survived ? p.armor : 0,
    abilitiesRemaining: survived
      ? p.abilities.map((a) => ({ abilityId: a.abilityId, charges: a.chargesRemaining }))
      : [],
    ultimatePointsStart: start,
    ultimatePointsEarned: earned,
    ultimatePointsSpent,
    ultimatePointsEnd,
    ultimateUsed,
  };
}

function findLoadout(id: string, input: MatchRoundInput): PlayerLoadout | undefined {
  const all = [...input.attackers.players, ...input.defenders.players];
  return all.find((p) => p.id === id)?.loadout;
}
