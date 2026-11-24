/**
 * Managed match session (docs/MATCH_MANAGEMENT.md): createMatchSession plus the manager layer —
 * tactical timeouts limited per half, standing shouts, strategy changes for the next rounds, the
 * half-time team talk, the team's state of mind (manager.ts), alerts that should stop auto-play,
 * and a decision log with what followed each decision. The AI manager uses the same levers,
 * driven by its own attributes.
 *
 * It is a superset of MatchSession (same state / callTimeout / setOrders / playNextRound / result),
 * so existing callers keep working. runMatch and createMatchSession are unchanged.
 * Deterministic: the same seed, plans and sequence of manager actions give the same match.
 */
import { ROUND_RULES } from "@pv/game-rules";
import { MatchEngine, attackerFor, type MatchConfig, type RoundRecord, type TeamSlot } from "./match.js";
import type { MatchSession, MatchSessionOptions, MatchSessionResult, MatchSessionState, TimeoutLogEntry } from "./session.js";
import type { StrategyOrder, TeamOrder } from "./orders.js";
import type { TeamMatchInputs } from "./team-inputs.js";
import {
  AVERAGE_MANAGER, NEUTRAL_SHOUTS, TIMEOUT_MODEL, MORALE_MODEL,
  aiManagerDecision, aiTeamTalk, aiTimeoutOrder, alertsAfterRound, mindRoundInputs, moodAfterOpponentBreak,
  moodAfterRound, moodAfterTimeout, roundInvolvement, summarizeMind, talkEffect, talkSituation, teamPersonalities,
  shoutStrategy, withMood,
  type Alert, type ManagerProfile, type PlayerMind, type Shouts, type TalkSituation, type TeamMind, type TeamTalk,
} from "./manager.js";
import { planPending, planShouts, planTeamInputs, type MatchPlan } from "./prep.js";
import type { TeamGameLog } from "./scouting.js";

const TIMEOUTS_PER_MAP = ROUND_RULES.tacticalTimeoutsPerTeam.value;
const ROUNDS_PER_HALF = ROUND_RULES.roundsPerHalf.value;
const REGULATION = ROUNDS_PER_HALF * 2;
const WIN_ROUNDS = ROUND_RULES.roundsToWinRegulation.value;
const SLOTS: readonly TeamSlot[] = ["A", "B"];
const other = (t: TeamSlot): TeamSlot => (t === "A" ? "B" : "A");
const halfOf = (round: number): 1 | 2 | 3 => (round <= ROUNDS_PER_HALF ? 1 : round <= REGULATION ? 2 : 3);
const isPistolRound = (round: number): boolean => round === 1 || round === ROUNDS_PER_HALF + 1;

export type DecisionKind = "timeout" | "orders" | "strategy" | "shouts" | "talk";
export interface ManagerDecision {
  /** The round the decision precedes. */
  readonly round: number;
  readonly team: TeamSlot;
  readonly by: "human" | "ai";
  readonly kind: DecisionKind;
  readonly order?: TeamOrder;
  readonly shouts?: Shouts;
  readonly strategy?: { readonly attack?: StrategyOrder; readonly defense?: StrategyOrder; readonly rounds: number };
  readonly talk?: TeamTalk;
  readonly reason?: string;
  /** Talk: each player's mood change. Timeout: each player's tilt recovered. */
  readonly perPlayer?: ReadonlyArray<{ readonly index: number; readonly handle: string | null; readonly delta: number }>;
  readonly before: { readonly score: Readonly<Record<TeamSlot, number>>; readonly tilt: number; readonly confidence: number };
}

/** What followed a decision — measured, not claimed as caused by it. */
export interface DecisionOutcome extends ManagerDecision {
  /** Rounds the team won of the (up to) 3 rounds before / after the decision. */
  readonly roundsBefore: { readonly won: number; readonly played: number };
  readonly roundsAfter: { readonly won: number; readonly played: number };
  /** Team tilt when the decision was made and 3 rounds later (or at the end). */
  readonly tiltAfter: number;
}

export interface ManagerState {
  readonly half: 1 | 2 | 3;
  readonly timeoutsLeftThisHalf: Readonly<Record<TeamSlot, number>>;
  readonly shouts: Readonly<Record<TeamSlot, Shouts>>;
  readonly minds: Readonly<Record<TeamSlot, TeamMind>>;
  /** Raised after the last round, for the round about to be played. */
  readonly alerts: readonly Alert[];
  /** At half-time: which teams may still give their talk, and the situation each talk meets. */
  readonly halfTime: { readonly pending: Readonly<Record<TeamSlot, boolean>>; readonly situation: Readonly<Record<TeamSlot, TalkSituation>> } | null;
  /** A strategy set for the next rounds (per side), with rounds left. */
  readonly strategy: Readonly<Record<TeamSlot, { readonly attack?: StrategyOrder; readonly defense?: StrategyOrder; readonly roundsLeft: number } | null>>;
  readonly plans: Readonly<Record<TeamSlot, MatchPlan | null>>;
  /** Plan options the engine does not apply yet (shapes from other sessions; see prep.ts). */
  readonly pendingPlanOptions: Readonly<Record<TeamSlot, readonly string[]>>;
}

export interface ManagedSessionState extends MatchSessionState {
  readonly manager: ManagerState;
}

export interface ManagedSessionResult extends MatchSessionResult {
  readonly decisions: readonly DecisionOutcome[];
  readonly minds: Readonly<Record<TeamSlot, TeamMind>>;
  /** Team tilt after every round (index = round − 1). */
  readonly tiltByRound: Readonly<Record<TeamSlot, readonly number[]>>;
}

export interface ManagedSession extends MatchSession {
  state(): ManagedSessionState;
  result(): ManagedSessionResult;
  /** Standing instructions (any time between rounds). */
  setShouts(team: TeamSlot, shouts: Partial<Shouts>): void;
  /** The call for each side for the next `rounds` rounds (any time between rounds). */
  setStrategy(team: TeamSlot, strategy: { readonly attack?: StrategyOrder; readonly defense?: StrategyOrder; readonly rounds?: number } | null): void;
  /** The half-time team talk (only at half-time, once). Returns each player's mood change. */
  teamTalk(team: TeamSlot, talk: TeamTalk): ReadonlyArray<{ index: number; handle: string | null; delta: number }>;
}

export interface ManagedSessionOptions extends MatchSessionOptions {
  /** Manager attributes per team (default league average 0.6 / 0.6). */
  readonly managers?: Partial<Record<TeamSlot, ManagerProfile>>;
  /** Pre-match plans per team (prep.ts). */
  readonly plans?: Partial<Record<TeamSlot, MatchPlan>>;
  /** The opponent's film each team scouted (for plan.useScouting), with the roster uptake. */
  readonly scouting?: Partial<Record<TeamSlot, { readonly logs: readonly TeamGameLog[]; readonly uptake?: number }>>;
}

/** MatchConfig with each plan's match-long inputs merged into its team's inputs. */
function withPlanInputs(config: MatchConfig, options: ManagedSessionOptions): MatchConfig {
  const merged: Partial<Record<TeamSlot, TeamMatchInputs>> = { ...(config.teamInputs ?? {}) };
  let any = false;
  for (const slot of SLOTS) {
    const plan = options.plans?.[slot];
    if (!plan) continue;
    const scout = options.scouting?.[slot];
    const add = planTeamInputs(plan, scout?.logs ?? [], config.map, scout?.uptake ?? 1);
    if (!add.standingPrior && !add.opponentPrior) continue;
    any = true;
    const base = merged[slot] ?? {};
    merged[slot] = {
      ...base,
      ...(add.standingPrior ? { standingPrior: add.standingPrior } : {}),
      ...(add.opponentPrior ? { opponentPrior: add.opponentPrior } : {}),
    };
  }
  return any ? { ...config, teamInputs: merged } : config;
}

export function createManagedSession(config0: MatchConfig, options: ManagedSessionOptions = {}): ManagedSession {
  const config = withPlanInputs(config0, options);
  const engine = new MatchEngine(config, options);
  const aiTeams = new Set<TeamSlot>(options.aiTeams ?? SLOTS);
  const managers: Record<TeamSlot, ManagerProfile> = { A: options.managers?.A ?? AVERAGE_MANAGER, B: options.managers?.B ?? AVERAGE_MANAGER };
  const plans: Record<TeamSlot, MatchPlan | null> = { A: options.plans?.A ?? null, B: options.plans?.B ?? null };
  const ref = { A: config.teamA, B: config.teamB };
  const people = { A: teamPersonalities(ref.A.id, config.rosters?.A), B: teamPersonalities(ref.B.id, config.rosters?.B) };
  const mood: Record<TeamSlot, number[]> = { A: [0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0] };
  const shouts: Record<TeamSlot, Shouts> = { A: planShouts(plans.A ?? undefined), B: planShouts(plans.B ?? undefined) };
  const usedByHalf: Record<TeamSlot, Record<1 | 2 | 3, number>> = { A: { 1: 0, 2: 0, 3: 0 }, B: { 1: 0, 2: 0, 3: 0 } };
  const usedTotal: Record<TeamSlot, number> = { A: 0, B: 0 };
  const timeoutActive: Record<TeamSlot, boolean> = { A: false, B: false };
  const activeOrder: Record<TeamSlot, { order: TeamOrder; roundsLeft: number } | null> = { A: null, B: null };
  const strategy: Record<TeamSlot, { attack?: StrategyOrder; defense?: StrategyOrder; roundsLeft: number } | null> = { A: null, B: null };
  let alerts: Alert[] = [];
  let halfTime: { pending: Record<TeamSlot, boolean>; situation: Record<TeamSlot, TalkSituation> } | null = null;
  const timeoutLog: TimeoutLogEntry[] = [];
  const decisions: ManagerDecision[] = [];
  const records: RoundRecord[] = [];
  const tiltByRound: Record<TeamSlot, number[]> = { A: [], B: [] };

  const mind = (slot: TeamSlot): TeamMind => summarizeMind(people[slot].map((p, i) => withMood(p, mood[slot][i] ?? 0)));
  const timeoutsLeftThisHalf = (slot: TeamSlot): number => {
    const h = halfOf(engine.currentRound);
    return Math.max(0, Math.min(TIMEOUT_MODEL.perHalf - usedByHalf[slot][h], TIMEOUTS_PER_MAP - usedTotal[slot]));
  };
  const snapshot = (slot: TeamSlot) => {
    const m = mind(slot);
    return { score: engine.snapshotScore(), tilt: m.tilt, confidence: m.confidence };
  };
  const by = (slot: TeamSlot): "human" | "ai" => (aiTeams.has(slot) ? "ai" : "human");

  const state = (): ManagedSessionState => ({
    roundNumber: engine.currentRound,
    score: engine.snapshotScore(),
    attacker: engine.nextAttacker,
    economy: engine.snapshotEconomy(),
    // Timeouts that can be called NOW (the per-half limit included), so a UI never offers one the
    // engine would refuse; the per-map total is in the rules (2).
    timeoutsRemaining: { A: timeoutsLeftThisHalf("A"), B: timeoutsLeftThisHalf("B") },
    timeoutActive: { ...timeoutActive },
    finished: engine.isFinished(),
    manager: {
      half: halfOf(engine.currentRound),
      timeoutsLeftThisHalf: { A: timeoutsLeftThisHalf("A"), B: timeoutsLeftThisHalf("B") },
      shouts: { ...shouts },
      minds: { A: mind("A"), B: mind("B") },
      alerts: [...alerts],
      halfTime: halfTime ? { pending: { ...halfTime.pending }, situation: { ...halfTime.situation } } : null,
      strategy: { A: strategy.A ? { ...strategy.A } : null, B: strategy.B ? { ...strategy.B } : null },
      plans: { ...plans },
      pendingPlanOptions: { A: planPending(plans.A ?? undefined), B: planPending(plans.B ?? undefined) },
    },
  });

  const takeTimeout = (team: TeamSlot, actor: "human" | "ai", reason?: string): void => {
    if (engine.isFinished()) throw new Error("match is finished");
    if (timeoutActive[team]) throw new Error(`team ${team} already has an active timeout this round`);
    if (timeoutsLeftThisHalf(team) <= 0) throw new Error(`team ${team} has no tactical timeout left this half`);
    const before = snapshot(team);
    usedByHalf[team][halfOf(engine.currentRound)] += 1;
    usedTotal[team] += 1;
    timeoutActive[team] = true;
    // The break: our tilt recovers by composure and the manager's motivating; their run cools.
    const perPlayer = people[team].map((p, i) => {
      const was = mood[team][i]!;
      mood[team][i] = moodAfterTimeout(was, p.personality.composure, managers[team]);
      return { index: i, handle: p.handle, delta: mood[team][i]! - was };
    });
    if (TIMEOUT_MODEL.coolsOpponent) mood[other(team)] = mood[other(team)].map(moodAfterOpponentBreak);
    decisions.push({ round: engine.currentRound, team, by: actor, kind: "timeout", perPlayer, before, ...(reason ? { reason } : {}) });
  };

  const callTimeout = (team: TeamSlot): void => takeTimeout(team, by(team));

  const setOrders = (team: TeamSlot, order: TeamOrder): void => {
    if (!timeoutActive[team]) throw new Error(`orders for team ${team} are only allowed during that team's timeout`);
    activeOrder[team] = { order, roundsLeft: Math.max(1, order.durationRounds ?? 1) };
    decisions.push({ round: engine.currentRound, team, by: by(team), kind: "orders", order, before: snapshot(team) });
  };

  const setShouts = (team: TeamSlot, s: Partial<Shouts>): void => {
    if (engine.isFinished()) throw new Error("match is finished");
    shouts[team] = { ...shouts[team], ...s };
    decisions.push({ round: engine.currentRound, team, by: by(team), kind: "shouts", shouts: shouts[team], before: snapshot(team) });
  };

  const setStrategy: ManagedSession["setStrategy"] = (team, s) => {
    if (engine.isFinished()) throw new Error("match is finished");
    strategy[team] = s && (s.attack || s.defense) ? { ...(s.attack ? { attack: s.attack } : {}), ...(s.defense ? { defense: s.defense } : {}), roundsLeft: Math.max(1, s.rounds ?? 3) } : null;
    decisions.push({ round: engine.currentRound, team, by: by(team), kind: "strategy", strategy: { ...(s?.attack ? { attack: s.attack } : {}), ...(s?.defense ? { defense: s.defense } : {}), rounds: strategy[team]?.roundsLeft ?? 0 }, before: snapshot(team) });
  };

  const teamTalk: ManagedSession["teamTalk"] = (team, talk) => {
    if (!halfTime || !halfTime.pending[team]) throw new Error(`team ${team} has no team talk to give now (half-time only, once)`);
    const before = snapshot(team);
    const m = mind(team);
    const perPlayer = m.players.map((p) => {
      const delta = talkEffect(talk, halfTime!.situation[team], p, managers[team]);
      mood[team][p.index] = Math.min(1, Math.max(-1, mood[team][p.index]! + delta));
      return { index: p.index, handle: p.handle, delta };
    });
    halfTime.pending[team] = false;
    decisions.push({ round: engine.currentRound, team, by: by(team), kind: "talk", talk, perPlayer, before });
    return perPlayer;
  };

  /** The AI managers act before a round: talk at half-time, then timeout / shouts. */
  const aiActs = (): void => {
    for (const t of SLOTS) {
      if (!aiTeams.has(t)) continue;
      if (halfTime?.pending[t]) teamTalk(t, aiTeamTalk(managers[t], halfTime.situation[t], mind(t)));
      const s = state();
      const eco = s.economy[t];
      const cpp = eco.credits / Math.max(1, eco.players.length);
      const decision = aiManagerDecision(managers[t], {
        slot: t, round: s.roundNumber, score: s.score, lossStreak: eco.consecutiveLosses, mind: s.manager.minds[t],
        read: config.opponentMemory === false ? null : engine.opponentRead(t),
        timeoutsLeftThisHalf: s.manager.timeoutsLeftThisHalf[t], creditsPerPlayer: cpp,
        opponentMatchPoint: s.score[other(t)] === WIN_ROUNDS - 1 && s.score[t] < WIN_ROUNDS - 1,
      });
      const sh = shouts[t];
      if (decision.shouts.tempo !== sh.tempo || decision.shouts.risk !== sh.risk || decision.shouts.defense !== sh.defense) setShouts(t, decision.shouts);
      if (decision.timeout && !timeoutActive[t] && !activeOrder[t]) {
        takeTimeout(t, "ai", decision.reason);
        const order = aiTimeoutOrder(s.attacker === t ? "attack" : "defense", cpp);
        activeOrder[t] = { order, roundsLeft: 1 };
        timeoutLog.push({ round: s.roundNumber, team: t, by: "ai", order });
        decisions.push({ round: s.roundNumber, team: t, by: "ai", kind: "orders", order, before: snapshot(t) });
      }
    }
  };

  /** The order a team plays the next round with: explicit order > strategy change > plan (pistol / eco) > shouts. */
  const orderFor = (t: TeamSlot, round: number): TeamOrder | undefined => {
    const side = attackerFor(round) === t ? "attack" : "defense";
    const explicit = activeOrder[t]?.order;
    const plan = plans[t];
    let strat: StrategyOrder | undefined = explicit?.strategy ?? (side === "attack" ? strategy[t]?.attack : strategy[t]?.defense);
    if (!strat && plan?.pistol && isPistolRound(round)) strat = side === "attack" ? plan.pistol.attack : plan.pistol.defense;
    if (!strat) strat = shoutStrategy(shouts[t], side, config.opponentMemory === false ? null : engine.opponentRead(t), config.seed, round, t);
    let economy = explicit?.economy;
    const pistolLost = (round === 2 || round === ROUNDS_PER_HALF + 2) && records.at(-1)?.phase === "pistol" && records.at(-1)!.winner !== t;
    if (!economy && pistolLost && plan?.afterPistolLoss) economy = plan.afterPistolLoss;
    const out: TeamOrder = { ...(explicit ?? {}), ...(strat ? { strategy: strat } : {}), ...(economy ? { economy } : {}) };
    return Object.keys(out).length ? out : undefined;
  };

  const playNextRound = (): RoundRecord => {
    for (const t of SLOTS) {
      if (timeoutActive[t] && !aiTeams.has(t)) timeoutLog.push({ round: engine.currentRound, team: t, by: "human", order: activeOrder[t]?.order ?? null });
    }
    aiActs();
    const round = engine.currentRound;
    const orders: Partial<Record<TeamSlot, TeamOrder>> = {};
    for (const t of SLOTS) {
      const o = orderFor(t, round);
      if (o) orders[t] = o;
      engine.setRoundInputs(t, mindRoundInputs(mind(t), shouts[t].risk));
    }
    halfTime = null;
    const before = { A: mind("A"), B: mind("B") };
    const credBefore = { A: perPlayerCredits("A"), B: perPlayerCredits("B") };
    const record = engine.playRound(orders);
    records.push(record);

    // State of mind after the round.
    for (const t of SLOTS) {
      const inv = roundInvolvement(record, t);
      mood[t] = people[t].map((p, i) => moodAfterRound(mood[t][i]!, p.personality.composure, record.winner === t, inv[i]!.kills, inv[i]!.died));
      tiltByRound[t].push(mind(t).tilt);
    }
    // Orders and strategies run down; the timeout window closes.
    for (const t of SLOTS) {
      const a = activeOrder[t];
      if (a && --a.roundsLeft <= 0) activeOrder[t] = null;
      const s = strategy[t];
      if (s && --s.roundsLeft <= 0) strategy[t] = null;
      timeoutActive[t] = false;
    }
    // Half-time: the break settles moods one step; each team may give a talk before round 13.
    const next = engine.currentRound;
    const halfTimeNext = next === ROUNDS_PER_HALF + 1 && !engine.isFinished();
    if (halfTimeNext) {
      for (const t of SLOTS) mood[t] = mood[t].map((c) => MORALE_MODEL.decay * c);
      const sc = engine.snapshotScore();
      halfTime = { pending: { A: true, B: true }, situation: { A: talkSituation(sc.A, sc.B), B: talkSituation(sc.B, sc.A) } };
    }
    alerts = engine.isFinished() ? [] : SLOTS.flatMap((t) => alertsAfterRound({
      team: t, nextRound: next, lost: record.winner !== t, streak: engine.snapshotEconomy()[t].consecutiveLosses,
      creditsPerPlayer: perPlayerCredits(t), creditsPerPlayerBefore: credBefore[t], nextIsPistol: isPistolRound(next) || next > REGULATION,
      halfTimeNext, before: before[t], after: mind(t),
    }));
    return record;
  };

  function perPlayerCredits(t: TeamSlot): number {
    const e = engine.snapshotEconomy()[t];
    return e.credits / Math.max(1, e.players.length);
  }

  const result = (): ManagedSessionResult => {
    const base = engine.result();
    const outcomes: DecisionOutcome[] = decisions.map((d) => {
      const i = d.round - 1; // records[i] is the round the decision precedes
      const window = (from: number, to: number) => {
        const rs = records.slice(Math.max(0, from), Math.max(0, to));
        return { won: rs.filter((r) => r.winner === d.team).length, played: rs.length };
      };
      const later = tiltByRound[d.team][Math.min(tiltByRound[d.team].length - 1, i + 2)];
      return { ...d, roundsBefore: window(i - 3, i), roundsAfter: window(i, i + 3), tiltAfter: later ?? d.before.tilt };
    });
    return {
      ...base,
      timeoutLog: [...timeoutLog],
      decisions: outcomes,
      minds: { A: mind("A"), B: mind("B") },
      tiltByRound: { A: [...tiltByRound.A], B: [...tiltByRound.B] },
    };
  };

  return {
    state, callTimeout, setOrders, playNextRound, setShouts, setStrategy, teamTalk,
    isFinished: () => engine.isFinished(),
    result,
  };
}

export type { PlayerMind };
