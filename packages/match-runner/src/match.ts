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
  NO_ABILITIES,
} from "./setup.js";
import { loadAbilityCatalog, agentAbilityLoadout, ASCENT_COMP } from "./abilities.js";
import {
  newTeamEconomy,
  decideBuy,
  applyRoundOutcome,
  halfReset,
  overtimeReset,
  spend,
  type TeamEconomy,
  type BuyDecision,
} from "./economy.js";
import { rosterSkills } from "./teams.js";
import { selectDefenseSetup } from "./defense-setups.js";

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
function makeRoster(side: Side, buy: BuyDecision, skills: readonly ReturnType<typeof rosterSkills>[number][], withAbilities: boolean, defenderSpawns: readonly string[] = DEFENDER_SPAWNS): MatchRoundPlayer[] {
  const prefix = side === "attack" ? "atk" : "def";
  const armor = armorFor(buy.tier);
  return Array.from({ length: 5 }, (_, i): MatchRoundPlayer => {
    const comp = COMP_LOADOUTS[i]!;
    return {
      id: `${prefix}${i + 1}`,
      agentId: comp.agent,
      skills: skills[i],
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
  const spatial = loadSpatial();
  const weapons = loadWeapons();
  const sq = makeSpatialQuery(spatial);
  const maxRounds = config.maxRounds ?? 60;

  // Real per-player combat skills from game-data ratings (AVERAGE fallback), 5 per team.
  const skillsBySlot: Record<TeamSlot, ReturnType<typeof rosterSkills>> = {
    A: rosterSkills(config.teamA.id, 5),
    B: rosterSkills(config.teamB.id, 5),
  };
  const abilitiesOn = config.enableAbilities ?? false;
  const abilities = abilitiesOn ? loadAbilityCatalog() : NO_ABILITIES;
  // Give the policy an abilityId → effectType lookup so it can coordinate entry utility.
  const abilityEffect = abilitiesOn ? (id: string): string | undefined => abilities[id]?.effectType : undefined;
  const policies = makeSimPolicies(sq, abilityEffect);
  const matchId = `${config.teamA.id}-vs-${config.teamB.id}`;
  const teamRef = (slot: TeamSlot): TeamRef => (slot === "A" ? config.teamA : config.teamB);

  const economy: Record<TeamSlot, TeamEconomy> = { A: newTeamEconomy(), B: newTeamEconomy() };
  const score: Record<TeamSlot, number> = { A: 0, B: 0 };
  const memory: Record<TeamSlot, OpponentMemory> = { A: emptyMemory(), B: emptyMemory() };
  const rounds: RoundRecord[] = [];
  let wentToOvertime = false;

  for (let roundNumber = 1; roundNumber <= maxRounds; roundNumber++) {
    // --- Credits reset at the half boundary and each OT round ---
    if (roundNumber === ROUNDS_PER_HALF + 1) {
      economy.A = halfReset(economy.A);
      economy.B = halfReset(economy.B);
    }
    if (isOvertime(roundNumber)) {
      wentToOvertime = true;
      economy.A = overtimeReset(economy.A);
      economy.B = overtimeReset(economy.B);
    }

    const attacker = attackerFor(roundNumber);
    const defender = other(attacker);
    const pistol = isPistol(roundNumber);

    // --- Buy phase (team-level) ---
    const buyA = decideBuy(economy.A.credits, pistol);
    const buyB = decideBuy(economy.B.credits, pistol);
    economy.A = { ...economy.A, credits: spend(economy.A.credits, buyA.cost) };
    economy.B = { ...economy.B, credits: spend(economy.B.credits, buyB.cost) };
    const buys: Record<TeamSlot, BuyDecision> = { A: buyA, B: buyB };

    // --- Run the round through PV-4's runMatchRound (the match-loop seam) ---
    const seed = deriveSeed(config.seed, `${matchId}:round:${roundNumber}`);
    const attackers: MatchRoundTeam = {
      teamId: teamRef(attacker).id,
      economy: toEconomyState(economy[attacker], "attack"),
      players: makeRoster("attack", buys[attacker], skillsBySlot[attacker], abilitiesOn),
    };
    // Diversified VCT defender setup (PV-2) chosen per round — breaks the vacant-site 5v2.
    // Applied only with abilities ON: forward holds (a-main/b-main) need utility/crossfire to be
    // viable; abilities-off they just feed (attack 0.62→0.75), so off keeps the balanced 2-2-1.
    const defSpawns = abilitiesOn ? selectDefenseSetup(config.seed, roundNumber).spawns : DEFENDER_SPAWNS;
    const defenders: MatchRoundTeam = {
      teamId: teamRef(defender).id,
      economy: toEconomyState(economy[defender], "defense"),
      players: makeRoster("defense", buys[defender], skillsBySlot[defender], abilitiesOn, defSpawns),
    };
    const out = runMatchRound({
      spatial,
      weapons,
      abilities,
      policies,
      attackers,
      defenders,
      seed,
      roundNumber,
      mapId: config.map,
      matchId,
      roundId: `r${roundNumber}`,
      config: { recordPerception: config.recordPerception ?? false },
    });
    const result = out.round;

    // --- Resolve outcome onto teams ---
    const winner: TeamSlot = out.winner === "attack" ? attacker : defender;
    const planted = out.events.some((e) => e.kind === "planted");
    // Kills a team scored, from per-player outcomes (dead players' guns drop next round).
    const killsOf = (side: Side) => out.players.filter((p) => p.side === side).reduce((s, p) => s + p.kills, 0);
    const kills: Record<TeamSlot, number> = {
      [attacker]: killsOf("attack"),
      [defender]: killsOf("defense"),
    } as Record<TeamSlot, number>;

    // Between-round economy (mirror of economy-engine's advanceMatchEconomy; SWAP TARGET in
    // economy.ts). leftoverCredits = post-buy credits; plant award goes to the attacking team.
    economy[attacker] = applyRoundOutcome(economy[attacker], {
      won: winner === attacker,
      kills: kills[attacker],
      planted,
      leftoverCredits: economy[attacker].credits,
    });
    economy[defender] = applyRoundOutcome(economy[defender], {
      won: winner === defender,
      kills: kills[defender],
      planted: false,
      leftoverCredits: economy[defender].credits,
    });

    score[winner] += 1;

    // --- IGL opponent memory: each team records what the OTHER showed ---
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
    rounds.push(record);
    options.onRound?.(record, { ...score });

    const won = matchWinner(score);
    if (won) {
      return { config, winner: won, score: { ...score }, rounds, memory, wentToOvertime };
    }
  }

  // Hit the safety cap without a 2-round lead — return the current leader (draw → A).
  const leader: TeamSlot = score.A >= score.B ? "A" : "B";
  return { config, winner: leader, score: { ...score }, rounds, memory, wentToOvertime };
}
