/**
 * Match-level simulation (README §28, Handoff §17): extends the round loop to a full map.
 *
 *   pistol → first half → side swap after `roundsPerHalf` → second half → first to
 *   `roundsToWinRegulation` with a 2-round lead → overtime (win by `overtimeWinMargin`).
 *
 * Economy, loss-bonus ladder and ultimate points carry ACROSS rounds (see ./economy.ts);
 * credits reset at the half and each OT round. Decisions go through PV-3's
 * TeamDecisionPolicy for both sides (DECISION-004: policy input is a PolicyView — no
 * WorldState). Per-round RNG is derived from the match seed so the whole match is
 * deterministic (DECISION-010) yet rounds differ.
 */
import { ROUND_RULES } from "@pv/game-rules";
import {
  runMatchRound,
  deriveSeed,
  mulberry32,
  type TacticalTraits,
  toPv6ReplayFormat,
  type RoundEndReason,
  type SimEvent,
  type Pv6SimEventLog,
  type MatchRoundPlayer,
  type MatchRoundTeam,
} from "@pv/round-simulator";
import { lossBonusTierFor, type TeamEconomyState } from "@pv/economy-engine";
import {
  loadSpatial,
  loadWeapons,
  makeSpatialQuery,
  makeSimPolicies,
  toSimPolicies,
  NO_ABILITIES,
} from "./setup.js";
import { loadAbilityCatalog, agentAbilityLoadout, ASCENT_COMP } from "./abilities.js";
import {
  newTeamEconomy,
  decideBuyForCall,
  applyRoundOutcome,
  halfReset,
  overtimeReset,
  spend,
  type TeamEconomy,
  type BuyDecision,
} from "./economy.js";
import { applyRoundForm, rosterConsistency, rosterPlayerIds, rosterProfiles, rosterSkills, rosterTraits, type RosterProfile } from "./teams.js";
import type { PlayerProfile } from "@pv/shared-types";
import type { PolicyTuning } from "@pv/team-engine";
import { selectDefenseSetup } from "./defense-setups.js";
import { toPolicyOrder, type TeamOrder } from "./orders.js";

/** Defender anchor spawns (mirror of the round-simulator's SYNTHETIC_DEFENSE_ANCHORS). */
const DEFENDER_SPAWNS = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"] as const;
const ULT_COST = 7; // provisional default ult cost (per-agent costs are a later refinement).
/** Precomputed per-slot agent + ability loadout for the fixed comp (both teams use it). */
const COMP_LOADOUTS = ASCENT_COMP.map((agent) => ({ agent, abilities: agentAbilityLoadout(agent) }));

export type TeamSlot = "A" | "B";
export type Side = "attack" | "defense";

export interface TeamRef {
  readonly id: string;
  readonly name: string;
}

/**
 * Pre-match engine options (all optional; omitted fields use the calibrated defaults). See
 * docs/STAT_OUTCOME_MATRIX.md for the formula each one feeds.
 */
export interface MatchTuning extends Partial<PolicyTuning> {
  /** Crossfire (Hick–Hyman) slope b in ms per bit. Default 60. */
  readonly crossfireMsPerBit?: number;
  /** Info half-life in ms. Default 2000. */
  readonly infoHalfLifeMs?: number;
  /** Round-form σ for a player with consistency 0. Default 0.08. */
  readonly formSigmaMax?: number;
  /** Attrition: share of duel damage a survivor carries into the next fight (0..1). Default 0. */
  readonly damageCarryover?: number;
}

export interface MatchConfig {
  readonly teamA: TeamRef;
  readonly teamB: TeamRef;
  readonly map: string;
  readonly seed: number;
  /** Safety cap on total rounds (OT can in principle run long). Default 60. */
  readonly maxRounds?: number;
  /**
   * Record per-tick perception (observation/belief) time series for PV-6's fog-of-war + belief
   * heatmap. Default false — off has no effect on determinism or performance. When on, each
   * round's `replay.meta.perception` is populated (round-simulator → toPv6ReplayFormat).
   */
  readonly recordPerception?: boolean;
  /**
   * Deploy agent abilities (game-data comp + ability catalog). Default false. WIP: abilities
   * deploy correctly and bring opening-duel to the real rate (~0.45), but the policy does not yet
   * coordinate ATTACKER utility to execute, so enabling it makes defense dominant (attack win
   * ~0.02). Kept off until attacker util-for-executes is modelled; on is for ability experiments.
   */
  readonly enableAbilities?: boolean;
  /** Pre-match engine options: override any of the calibrated formula constants. */
  readonly tuning?: MatchTuning;
  /**
   * Minimum throw rates (throws per second of holding a post-plant posture). A player's floor is
   * the larger of their team's and their own entry; nobody throws less often than their floor,
   * however disciplined their ratings. Keys are game-data team ids / player ids.
   */
  readonly minThrowRates?: {
    readonly teams?: Readonly<Record<string, number>>;
    readonly players?: Readonly<Record<string, number>>;
  };
}

export interface RoundRecord {
  readonly roundNumber: number;
  readonly phase: "pistol" | "regulation" | "overtime";
  readonly attacker: TeamSlot;
  readonly buys: Readonly<Record<TeamSlot, BuyDecision>>;
  readonly winner: TeamSlot;
  readonly winnerSide: Side;
  readonly reason: RoundEndReason;
  readonly planted: boolean;
  readonly kills: Readonly<Record<TeamSlot, number>>;
  readonly score: Readonly<Record<TeamSlot, number>>;
  readonly economy: Readonly<Record<TeamSlot, TeamEconomy>>;
  readonly events: readonly SimEvent[];
  /** PV-6 replay-engine bridge input for this round (EventLog → replay). */
  readonly replay: Pv6SimEventLog;
}

/**
 * IGL opponent memory (README §18): what each team has observed of the other across the
 * match. v0 records the opponent's buy tiers and round outcomes; a later pass can feed this
 * into strategy selection (the TeamDecisionPolicy does not yet consume it — TODO).
 */
export interface OpponentMemory {
  readonly buyTiers: string[];
  pistolWon: boolean | null;
  roundsWon: number;
  roundsLost: number;
}

export interface MatchResult {
  readonly config: MatchConfig;
  readonly winner: TeamSlot;
  readonly score: Readonly<Record<TeamSlot, number>>;
  readonly rounds: readonly RoundRecord[];
  readonly memory: Readonly<Record<TeamSlot, OpponentMemory>>;
  readonly wentToOvertime: boolean;
}

export interface RunMatchOptions {
  /** Progress callback invoked after each round resolves (PV-6 desktop drives the UI from this). */
  readonly onRound?: (record: RoundRecord, score: Readonly<Record<TeamSlot, number>>) => void;
}

const ROUNDS_PER_HALF = ROUND_RULES.roundsPerHalf.value; // 12
const ROUNDS_TO_WIN = ROUND_RULES.roundsToWinRegulation.value; // 13
const OT_MARGIN = ROUND_RULES.overtimeWinMargin.value; // 2
const REGULATION_ROUNDS = ROUNDS_PER_HALF * 2; // 24

/** Which team attacks in a given 1-based round. A attacks the first half; swap at the half; alternate in OT. */
export function attackerFor(roundNumber: number): TeamSlot {
  if (roundNumber <= ROUNDS_PER_HALF) return "A";
  if (roundNumber <= REGULATION_ROUNDS) return "B";
  // OT: round 25 → A, 26 → B, 27 → A, ...
  return (roundNumber - REGULATION_ROUNDS) % 2 === 1 ? "A" : "B";
}

function isPistol(roundNumber: number): boolean {
  return roundNumber === 1 || roundNumber === ROUNDS_PER_HALF + 1;
}
function isOvertime(roundNumber: number): boolean {
  return roundNumber > REGULATION_ROUNDS;
}

/** A team has won iff it has ≥13 rounds and leads by ≥2 (covers regulation first-to-13 and OT win-by-2). */
function matchWinner(score: Record<TeamSlot, number>): TeamSlot | null {
  if (score.A >= ROUNDS_TO_WIN && score.A - score.B >= OT_MARGIN) return "A";
  if (score.B >= ROUNDS_TO_WIN && score.B - score.A >= OT_MARGIN) return "B";
  return null;
}

function other(slot: TeamSlot): TeamSlot {
  return slot === "A" ? "B" : "A";
}

function emptyMemory(): OpponentMemory {
  return { buyTiers: [], pistolWon: null, roundsWon: 0, roundsLost: 0 };
}

/** Our light TeamEconomy → the economy-engine TeamEconomyState surfaced to PolicyView.economy. */
function toEconomyState(eco: TeamEconomy, side: Side): TeamEconomyState {
  return { teamId: "", side, credits: eco.credits, consecutiveLosses: eco.consecutiveLosses, lossBonusTier: lossBonusTierFor(eco.consecutiveLosses) };
}

/** Armor points a buy tier equips (heavy 50 / light 25 / none). */
function armorFor(tier: BuyDecision["tier"]): number {
  if (tier === "full") return 50;
  if (tier === "force" || tier === "pistol") return 25;
  return 0; // eco
}

/**
 * Build a 5-player roster for one side (ids atk1..5 / def1..5 so the SimRun roster is stable).
 * Defenders spawn on their anchors (a/b/mid); attackers use the default attacker spawn. Per-player
 * skills come from the team's real ratings. Abilities/ults are the next layer (Stage 2).
 */
function makeRoster(side: Side, buy: BuyDecision, skills: readonly ReturnType<typeof rosterSkills>[number][], withAbilities: boolean, defenderSpawns: readonly string[] = DEFENDER_SPAWNS, traits: readonly TacticalTraits[] = []): MatchRoundPlayer[] {
  const prefix = side === "attack" ? "atk" : "def";
  const armor = armorFor(buy.tier);
  return Array.from({ length: 5 }, (_, i): MatchRoundPlayer => {
    const comp = COMP_LOADOUTS[i]!;
    return {
      id: `${prefix}${i + 1}`,
      agentId: comp.agent,
      skills: skills[i],
      ...(traits[i] ? { traits: traits[i] } : {}),
      ...(side === "defense" ? { spawnZoneId: defenderSpawns[i] ?? DEFENDER_SPAWNS[i] } : {}),
      loadout: {
        weaponId: buy.weapon,
        armor,
        ...(withAbilities ? { abilities: comp.abilities } : {}),
        ultimatePoints: 0,
        ultimateCost: ULT_COST,
      },
    };
  });
}

/**
 * Run a full match. Pure given its config: no I/O, no clock — only the seeded RNG.
 */
export function runMatch(config: MatchConfig, options: RunMatchOptions = {}): MatchResult {
  const engine = new MatchEngine(config, options);
  while (!engine.isFinished()) engine.playRound();
  return engine.result();
}

/**
 * The shared match engine: owns the mutable match state and plays one round at a time. `runMatch`
 * loops it to completion; the interactive session (createMatchSession) drives it round-by-round and
 * injects per-round coach orders. With no orders, playRound reproduces the original loop exactly
 * (byte-identical output), so the default runMatch / sim-batch are unchanged.
 */
export class MatchEngine {
  private readonly spatial = loadSpatial();
  private readonly weapons = loadWeapons();
  private readonly sq = makeSpatialQuery(this.spatial);
  private readonly maxRounds: number;
  private readonly skillsBySlot: Record<TeamSlot, ReturnType<typeof rosterSkills>>;
  private readonly traitsBySlot: Record<TeamSlot, TacticalTraits[]>;
  private readonly profilesBySlot: Record<TeamSlot, RosterProfile[]>;
  private readonly consistencyBySlot: Record<TeamSlot, number[]>;
  private readonly simTuning: { crossfirePenaltyMs?: number; infoWindowMs?: number; damageCarryover?: number };
  private readonly formSigmaMax: number | undefined;
  /** Per roster index: the player's minimum throw rate (max of team and player entries). */
  private readonly throwFloorsBySlot: Record<TeamSlot, number[]>;
  private readonly abilitiesOn: boolean;
  private readonly abilities: ReturnType<typeof loadAbilityCatalog>;
  private readonly policies: ReturnType<typeof makeSimPolicies>;
  private readonly matchId: string;

  private readonly economy: Record<TeamSlot, TeamEconomy> = { A: newTeamEconomy(), B: newTeamEconomy() };
  private readonly score: Record<TeamSlot, number> = { A: 0, B: 0 };
  private readonly memory: Record<TeamSlot, OpponentMemory> = { A: emptyMemory(), B: emptyMemory() };
  private readonly rounds: RoundRecord[] = [];
  private wentToOvertime = false;
  private roundNumber = 1; // the next round to play

  constructor(private readonly config: MatchConfig, private readonly options: RunMatchOptions = {}) {
    this.maxRounds = config.maxRounds ?? 60;
    this.skillsBySlot = { A: rosterSkills(config.teamA.id, 5), B: rosterSkills(config.teamB.id, 5) };
    this.traitsBySlot = { A: rosterTraits(config.teamA.id, 5), B: rosterTraits(config.teamB.id, 5) };
    this.profilesBySlot = { A: rosterProfiles(config.teamA.id, 5), B: rosterProfiles(config.teamB.id, 5) };
    this.consistencyBySlot = { A: rosterConsistency(config.teamA.id, 5), B: rosterConsistency(config.teamB.id, 5) };
    this.abilitiesOn = config.enableAbilities ?? false;
    this.abilities = this.abilitiesOn ? loadAbilityCatalog() : NO_ABILITIES;
    const abilityEffect = this.abilitiesOn ? (id: string): string | undefined => this.abilities[id]?.effectType : undefined;
    this.policies = makeSimPolicies(this.sq, abilityEffect);
    this.matchId = `${config.teamA.id}-vs-${config.teamB.id}`;
    const { crossfireMsPerBit, infoHalfLifeMs, formSigmaMax, damageCarryover, ...policyTuning } = config.tuning ?? {};
    this.policies.attack.setTuning(policyTuning);
    this.policies.defense.setTuning(policyTuning);
    this.simTuning = {
      ...(crossfireMsPerBit !== undefined ? { crossfirePenaltyMs: crossfireMsPerBit } : {}),
      ...(infoHalfLifeMs !== undefined ? { infoWindowMs: infoHalfLifeMs } : {}),
      ...(damageCarryover !== undefined ? { damageCarryover } : {}),
    };
    this.formSigmaMax = formSigmaMax;
    this.throwFloorsBySlot = { A: this.throwFloors(config.teamA.id), B: this.throwFloors(config.teamB.id) };
  }

  /**
   * This round's mechanical skills: the roster's ratings with each player's consistency-sized form
   * swing, plus the clutch-driven nerve shift when the round is a pressure round.
   */
  private formSkills(slot: TeamSlot, roundSeed: number, pressure: boolean): ReturnType<typeof rosterSkills> {
    return this.skillsBySlot[slot].map((sk, i) => {
      const rng = mulberry32(deriveSeed(roundSeed, `form:${slot}:${i}`));
      return applyRoundForm(
        sk,
        this.consistencyBySlot[slot][i] ?? 0.6,
        rng(),
        rng(),
        pressure ? { clutch: this.traitsBySlot[slot][i]?.clutch ?? 0.6 } : undefined,
        this.formSigmaMax,
      );
    });
  }

  /** Pressure round: overtime, or either team one round from winning the map. */
  private isPressureRound(roundNumber: number): boolean {
    return roundNumber > REGULATION_ROUNDS || this.score.A >= ROUNDS_TO_WIN - 1 || this.score.B >= ROUNDS_TO_WIN - 1;
  }

  private throwFloors(teamId: string): number[] {
    const m = this.config.minThrowRates;
    const team = m?.teams?.[teamId] ?? 0;
    return rosterPlayerIds(teamId, 5).map((pid) => Math.max(team, (pid && m?.players?.[pid]) || 0));
  }

  private floorMap(slot: TeamSlot, prefix: "atk" | "def"): ReadonlyMap<string, number> {
    return new Map(this.throwFloorsBySlot[slot].map((rate, i) => [`${prefix}${i + 1}`, rate]));
  }

  private profileMap(slot: TeamSlot, prefix: "atk" | "def"): ReadonlyMap<string, PlayerProfile> {
    return new Map(this.profilesBySlot[slot].map((pr, i) => {
      const id = `${prefix}${i + 1}`;
      return [id, { playerId: id as PlayerProfile["playerId"], ...pr }];
    }));
  }

  private teamRef(slot: TeamSlot): TeamRef { return slot === "A" ? this.config.teamA : this.config.teamB; }

  /** Round the engine will play next (1-based). */
  get currentRound(): number { return this.roundNumber; }
  /** The attacking team for the next round. */
  get nextAttacker(): TeamSlot { return attackerFor(this.roundNumber); }
  snapshotEconomy(): Record<TeamSlot, TeamEconomy> { return { A: this.economy.A, B: this.economy.B }; }
  snapshotScore(): Record<TeamSlot, number> { return { ...this.score }; }

  isFinished(): boolean {
    return matchWinner(this.score) !== null || this.roundNumber > this.maxRounds;
  }

  /** Play one round. `orders` (optional) are coach orders for THIS round, per team slot. */
  playRound(orders: Partial<Record<TeamSlot, TeamOrder>> = {}): RoundRecord {
    const roundNumber = this.roundNumber;
    const { config, economy, score, memory } = this;

    // --- Credits reset at the half boundary and each OT round ---
    if (roundNumber === ROUNDS_PER_HALF + 1) {
      economy.A = halfReset(economy.A);
      economy.B = halfReset(economy.B);
    }
    if (isOvertime(roundNumber)) {
      this.wentToOvertime = true;
      economy.A = overtimeReset(economy.A);
      economy.B = overtimeReset(economy.B);
    }

    const attacker = attackerFor(roundNumber);
    const defender = other(attacker);
    const pistol = isPistol(roundNumber);

    // --- Buy phase (team-level; an economy call order overrides the pick) ---
    const buyA = decideBuyForCall(economy.A.credits, pistol, orders.A?.economy);
    const buyB = decideBuyForCall(economy.B.credits, pistol, orders.B?.economy);
    economy.A = { ...economy.A, credits: spend(economy.A.credits, buyA.cost) };
    economy.B = { ...economy.B, credits: spend(economy.B.credits, buyB.cost) };
    const buys: Record<TeamSlot, BuyDecision> = { A: buyA, B: buyB };

    // --- Coach orders → policy (attacker's order to the attack policy, defender's to defense) ---
    this.policies.attack.setOrder(toPolicyOrder(orders[attacker]));
    this.policies.defense.setOrder(toPolicyOrder(orders[defender]));

    // --- Run the round through PV-4's runMatchRound (the match-loop seam) ---
    const seed = deriveSeed(config.seed, `${this.matchId}:round:${roundNumber}`);
    const pressure = this.isPressureRound(roundNumber);
    // Real-roster decision profiles, re-keyed to this round's side-named sim ids (atk1.. / def1..).
    this.policies.attack.setProfiles(this.profileMap(attacker, "atk"));
    this.policies.defense.setProfiles(this.profileMap(defender, "def"));
    this.policies.attack.setThrowFloors(this.floorMap(attacker, "atk"));
    this.policies.defense.setThrowFloors(this.floorMap(defender, "def"));
    const attackers: MatchRoundTeam = {
      teamId: this.teamRef(attacker).id,
      economy: toEconomyState(economy[attacker], "attack"),
      players: makeRoster("attack", buys[attacker], this.formSkills(attacker, seed, pressure), this.abilitiesOn, undefined, this.traitsBySlot[attacker]),
    };
    const defSpawns = this.abilitiesOn ? selectDefenseSetup(config.seed, roundNumber).spawns : DEFENDER_SPAWNS;
    const defenders: MatchRoundTeam = {
      teamId: this.teamRef(defender).id,
      economy: toEconomyState(economy[defender], "defense"),
      players: makeRoster("defense", buys[defender], this.formSkills(defender, seed, pressure), this.abilitiesOn, defSpawns, this.traitsBySlot[defender]),
    };
    const out = runMatchRound({
      spatial: this.spatial,
      weapons: this.weapons,
      abilities: this.abilities,
      policies: toSimPolicies(this.policies),
      attackers,
      defenders,
      seed,
      roundNumber,
      ...(this.abilitiesOn ? { spikeCarrierId: "atk4" } : {}),
      mapId: config.map,
      matchId: this.matchId,
      roundId: `r${roundNumber}`,
      config: { recordPerception: config.recordPerception ?? false, ...this.simTuning },
    });
    // Clear orders so they do not leak into the next round (the session re-sets them each round).
    this.policies.attack.setOrder(null);
    this.policies.defense.setOrder(null);
    const result = out.round;

    // --- Resolve outcome onto teams ---
    const winner: TeamSlot = out.winner === "attack" ? attacker : defender;
    const planted = out.events.some((e) => e.kind === "planted");
    const killsOf = (side: Side) => out.players.filter((p) => p.side === side).reduce((s, p) => s + p.kills, 0);
    const kills: Record<TeamSlot, number> = {
      [attacker]: killsOf("attack"),
      [defender]: killsOf("defense"),
    } as Record<TeamSlot, number>;

    economy[attacker] = applyRoundOutcome(economy[attacker], {
      won: winner === attacker, kills: kills[attacker], planted, leftoverCredits: economy[attacker].credits,
    });
    economy[defender] = applyRoundOutcome(economy[defender], {
      won: winner === defender, kills: kills[defender], planted: false, leftoverCredits: economy[defender].credits,
    });

    score[winner] += 1;

    for (const slot of ["A", "B"] as const) {
      const opp = other(slot);
      memory[slot].buyTiers.push(buys[opp].tier);
      if (pistol && memory[slot].pistolWon === null) memory[slot].pistolWon = winner === slot;
      if (winner === slot) memory[slot].roundsWon += 1;
      else memory[slot].roundsLost += 1;
    }

    const record: RoundRecord = {
      roundNumber,
      phase: pistol ? "pistol" : isOvertime(roundNumber) ? "overtime" : "regulation",
      attacker,
      buys,
      winner,
      winnerSide: result.winner,
      reason: result.reason,
      planted,
      kills,
      score: { ...score },
      economy: { A: economy.A, B: economy.B },
      events: result.events,
      replay: toPv6ReplayFormat(result, {
        mapId: config.map,
        mapDisplayName: config.map,
        seed,
        matchId: `${config.teamA.id}-vs-${config.teamB.id}`,
      }),
    };
    this.rounds.push(record);
    this.options.onRound?.(record, { ...score });
    this.roundNumber += 1;
    return record;
  }

  result(): MatchResult {
    const won = matchWinner(this.score);
    const winner: TeamSlot = won ?? (this.score.A >= this.score.B ? "A" : "B");
    return {
      config: this.config,
      winner,
      score: { ...this.score },
      rounds: this.rounds,
      memory: this.memory,
      wentToOvertime: this.wentToOvertime,
    };
  }
}
