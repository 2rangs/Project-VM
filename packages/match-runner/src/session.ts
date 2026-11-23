/**
 * Interactive match session (tactical timeouts). Wraps the MatchEngine and drives it one round at
 * a time, so a UI (PV-6 desktop) or an AI can call timeouts between rounds and issue coach orders
 * that the IGL follows. The non-interactive `runMatch` is unchanged and byte-identical.
 *
 * Rules (@pv/game-rules): each team has `tacticalTimeoutsPerTeam` timeouts per map (VCT: 2 each,
 * 4 total), callable only between rounds (before the buy phase). Deterministic: the same seed plus
 * the same timeout/order log yields the same result; the order log is recorded in the result.
 */
import { ROUND_RULES } from "@pv/game-rules";
import { MatchEngine, type MatchConfig, type MatchResult, type RoundRecord, type TeamSlot, type RunMatchOptions } from "./match.js";
import type { TeamEconomy } from "./economy.js";
import type { TeamOrder } from "./orders.js";

const TIMEOUTS_PER_TEAM = ROUND_RULES.tacticalTimeoutsPerTeam.value;
const ROUNDS_PER_HALF = ROUND_RULES.roundsPerHalf.value;
const WIN_ROUNDS = ROUND_RULES.roundsToWinRegulation.value;

export interface MatchSessionState {
  /** The round the session will play next (1-based). */
  readonly roundNumber: number;
  readonly score: Readonly<Record<TeamSlot, number>>;
  /** Attacking team for the next round. */
  readonly attacker: TeamSlot;
  readonly economy: Readonly<Record<TeamSlot, TeamEconomy>>;
  readonly timeoutsRemaining: Readonly<Record<TeamSlot, number>>;
  /** Teams that have an active (unplayed) timeout this between-rounds window — orders are settable. */
  readonly timeoutActive: Readonly<Record<TeamSlot, boolean>>;
  readonly finished: boolean;
}

export interface TimeoutLogEntry {
  /** The round the timeout precedes. */
  readonly round: number;
  readonly team: TeamSlot;
  readonly by: "human" | "ai";
  readonly order: TeamOrder | null;
}

export interface MatchSessionResult extends MatchResult {
  readonly timeoutLog: readonly TimeoutLogEntry[];
}

export interface MatchSession {
  state(): MatchSessionState;
  /** Call a tactical timeout for a team (between rounds only). Throws if none remain. */
  callTimeout(team: TeamSlot): void;
  /** Set the coach order for a team — only while that team has an active timeout this window. */
  setOrders(team: TeamSlot, order: TeamOrder): void;
  /** Play the next round (applying any active orders + AI timeouts) and return its record. */
  playNextRound(): RoundRecord;
  isFinished(): boolean;
  /** Final result once finished, including the timeout/order log. */
  result(): MatchSessionResult;
}

export interface MatchSessionOptions extends RunMatchOptions {
  /** Teams the AI drives (calls timeouts + sets orders for). Default: both. */
  readonly aiTeams?: readonly TeamSlot[];
}

const SLOTS: readonly TeamSlot[] = ["A", "B"];

export function createMatchSession(config: MatchConfig, options: MatchSessionOptions = {}): MatchSession {
  const engine = new MatchEngine(config, options);
  const aiTeams = new Set<TeamSlot>(options.aiTeams ?? SLOTS);
  const timeoutsRemaining: Record<TeamSlot, number> = { A: TIMEOUTS_PER_TEAM, B: TIMEOUTS_PER_TEAM };
  const timeoutActive: Record<TeamSlot, boolean> = { A: false, B: false };
  // Active order per team with its remaining duration (set during a timeout; persists durationRounds).
  const activeOrder: Record<TeamSlot, { order: TeamOrder; roundsLeft: number } | null> = { A: null, B: null };
  const timeoutLog: TimeoutLogEntry[] = [];

  const other = (t: TeamSlot): TeamSlot => (t === "A" ? "B" : "A");

  const state = (): MatchSessionState => ({
    roundNumber: engine.currentRound,
    score: engine.snapshotScore(),
    attacker: engine.nextAttacker,
    economy: engine.snapshotEconomy(),
    timeoutsRemaining: { ...timeoutsRemaining },
    timeoutActive: { ...timeoutActive },
    finished: engine.isFinished(),
  });

  const callTimeout = (team: TeamSlot): void => {
    if (engine.isFinished()) throw new Error("match is finished");
    if (timeoutsRemaining[team] <= 0) throw new Error(`team ${team} has no tactical timeouts remaining`);
    if (timeoutActive[team]) throw new Error(`team ${team} already has an active timeout this round`);
    timeoutsRemaining[team] -= 1;
    timeoutActive[team] = true;
  };

  const setOrders = (team: TeamSlot, order: TeamOrder): void => {
    if (!timeoutActive[team]) throw new Error(`orders for team ${team} are only allowed during that team's timeout`);
    activeOrder[team] = { order, roundsLeft: Math.max(1, order.durationRounds ?? 1) };
  };

  /** Deterministic AI timeout: on a ≥3 loss streak or at match point, change the plan. No RNG. */
  const aiMaybeTimeout = (team: TeamSlot): void => {
    if (!aiTeams.has(team) || timeoutActive[team] || activeOrder[team] || timeoutsRemaining[team] <= 0) return;
    const s = state();
    const eco = s.economy[team];
    const opp = other(team);
    const matchPoint = s.score[opp] === WIN_ROUNDS - 1; // opponent one round from the map
    const losingStreak = eco.consecutiveLosses >= 3;
    if (!losingStreak && !matchPoint) return;
    // Change the plan: save when broke, else force; switch strategy by side.
    const attacking = s.attacker === team;
    const call = eco.credits / eco.players.length < 2000 ? "save" : "force"; // mean credits per player
    const order: TeamOrder = {
      economy: call,
      strategy: attacking ? "default" : "aggroPush", // regroup on attack, apply pressure on defense
      tempo: "slow",
    };
    callTimeout(team);
    activeOrder[team] = { order, roundsLeft: 1 };
    timeoutLog.push({ round: s.roundNumber, team, by: "ai", order });
  };

  const playNextRound = (): RoundRecord => {
    // Log human timeouts taken this window (orders already stored).
    for (const t of SLOTS) {
      if (timeoutActive[t]) timeoutLog.push({ round: engine.currentRound, team: t, by: "human", order: activeOrder[t]?.order ?? null });
    }
    // AI opponent timeouts (for AI teams that have no active human timeout this window).
    for (const t of SLOTS) aiMaybeTimeout(t);

    const orders: Partial<Record<TeamSlot, TeamOrder>> = {};
    for (const t of SLOTS) if (activeOrder[t]) orders[t] = activeOrder[t]!.order;

    const record = engine.playRound(orders);

    // Decrement order durations; clear expired; reset the timeout window.
    for (const t of SLOTS) {
      const a = activeOrder[t];
      if (a) {
        a.roundsLeft -= 1;
        if (a.roundsLeft <= 0) activeOrder[t] = null;
      }
      timeoutActive[t] = false;
    }
    return record;
  };

  return {
    state,
    callTimeout,
    setOrders,
    playNextRound,
    isFinished: () => engine.isFinished(),
    result: () => ({ ...engine.result(), timeoutLog: [...timeoutLog] }),
  };
}
