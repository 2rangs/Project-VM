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
  RoundSimulator,
  makeSyntheticRound,
  deriveSeed,
  toPv6ReplayFormat,
  type RoundResult,
  type RoundEndReason,
  type SimEvent,
  type Pv6SimEventLog,
} from "@pv/round-simulator";
import {
  loadSpatial,
  loadWeapons,
  makeSpatialQuery,
  NO_ABILITIES,
  makeSimPolicies,
} from "./setup.js";
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
import { teamSkills } from "./teams.js";

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

/**
 * Run a full match. Pure given its config: no I/O, no clock — only the seeded RNG.
 */
export function runMatch(config: MatchConfig, options: RunMatchOptions = {}): MatchResult {
  const spatial = loadSpatial();
  const weapons = loadWeapons();
  const sq = makeSpatialQuery(spatial);
  const maxRounds = config.maxRounds ?? 60;

  // Real per-team combat skills from game-data ratings (team-aggregate; AVERAGE fallback).
  const skillsBySlot: Record<TeamSlot, ReturnType<typeof teamSkills>> = {
    A: teamSkills(config.teamA.id),
    B: teamSkills(config.teamB.id),
  };

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

    // --- Run the round through the round-simulator, PV-3 policy both sides ---
    const seed = deriveSeed(config.seed, `${config.teamA.id}:${config.teamB.id}:round:${roundNumber}`);
    const base = makeSyntheticRound(spatial, {
      matchId: `${config.teamA.id}-vs-${config.teamB.id}`,
      roundId: `r${roundNumber}`,
      attackerWeapon: buys[attacker].weapon,
      defenderWeapon: buys[defender].weapon,
    });
    // Override each player's skills with their real team's aggregate profile (makeSyntheticRound
    // applies one skill set to all; we re-key by side so both teams play to their own ratings).
    const state = {
      ...base,
      players: base.players.map((p) => ({
        ...p,
        skills: p.side === "attack" ? skillsBySlot[attacker] : skillsBySlot[defender],
      })),
    };
    const result: RoundResult = new RoundSimulator({
      spatial,
      weapons,
      abilities: NO_ABILITIES,
      policies: makeSimPolicies(sq),
      config: { seed, recordPerception: config.recordPerception ?? false },
    }).runRound(state);

    // --- Resolve outcome onto teams ---
    const winner: TeamSlot = result.winner === "attack" ? attacker : defender;
    const planted = result.events.some((e) => e.kind === "planted");
    // Kills a team scored = opponents eliminated = 5 − surviving opponents.
    const attackerKills = 5 - result.survivors.defense.length;
    const defenderKills = 5 - result.survivors.attack.length;
    const kills: Record<TeamSlot, number> = {
      [attacker]: attackerKills,
      [defender]: defenderKills,
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
