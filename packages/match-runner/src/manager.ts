/**
 * In-match management (docs/MATCH_MANAGEMENT.md): the manager's levers between rounds and the
 * team's state of mind they act on — the Football Manager way.
 *
 * Nothing here decides a duel or a round. Every lever becomes either
 *   - a coach ORDER the IGL follows (the existing TeamOrder path: strategy, economy call), or
 *   - per-round VALUES of existing formulas (MatchEngine.setRoundInputs: throw hazard, round-form σ,
 *     trading / gameSense, the retake / save / hero thresholds),
 * and every value is derived from a named, documented formula over player attributes.
 *
 * State of mind (per player i, c_i ∈ [−1, 1]; tilt τ_i = max(0, −c_i), confidence κ_i = max(0, c_i)):
 *
 *     c_i ← ρ·c_i + Δ_i                                      leaky integrator, ρ = 0.75 per round
 *     lost round:  Δ_i = −(1 − k_i)·(0.22 + 0.08·[died without a kill])
 *     won round:   Δ_i = +0.12 + 0.06·[2+ kills]
 *     k_i = composure = (clutch + consistency) / 2            (rated attributes; league average 0.6)
 *
 * Team effects (T = mean τ, K = mean κ), all through existing formulas:
 *     round form σ' = σ · (1 + 0.8·T)                         erratic when tilted
 *     throw hazard λ₀' = λ₀ · exp(2·T − K)                     tilted players force fights; confident ones keep posture
 *     trading' = trading − 0.15·T + 0.05·K                     calls get worse when heads drop
 *     gameSense' = gameSense − 0.10·T
 */
import { getPlayer } from "@pv/game-data";
import { deriveSeed, mulberry32 } from "@pv/round-simulator";
import { tendencyLean, type OpponentRead } from "@pv/team-engine";
import type { RoundRecord, TeamSlot } from "./match.js";
import type { StrategyOrder, TeamOrder } from "./orders.js";
import type { RoundTeamInputs } from "./team-inputs.js";
import { rosterConsistency, rosterPlayerIds, rosterProfiles, rosterSkills, rosterTraits, type RosterPlayer } from "./teams.js";

// ── constants ────────────────────────────────────────────────────────────────────────────────

/** Every constant of the state-of-mind model, named. Design values (no data on players' moods). */
export const MORALE_MODEL = {
  /** ρ: share of last round's mood kept each round (half-life ≈ 2.4 rounds). */
  decay: 0.75,
  lossImpulse: 0.22,
  deathNoKillImpulse: 0.08,
  winImpulse: 0.12,
  multiKillImpulse: 0.06,
  /** Effects on the existing formulas (see the header). */
  formPerTilt: 0.8,
  throwPerTilt: 2,
  throwPerConfidence: 1,
  tradingPerTilt: -0.15,
  tradingPerConfidence: 0.05,
  gameSensePerTilt: -0.1,
  /** A player at or above this tilt is "tilting" (alert). */
  tiltAlert: 0.45,
} as const;

/** Timeouts: per map from the rules, at most this many per half (design; VCT per-half limit unverified). */
export const TIMEOUT_MODEL = {
  perHalf: 1,
  /** A timeout recovers this share of each player's tilt: (base + slope·motivating)·(0.6 + 0.4·k_i). */
  recoveryBase: 0.25,
  recoveryPerMotivating: 0.35,
  /** The break also cools the OPPONENT's run: their positive mood decays one extra step. */
  coolsOpponent: true,
} as const;

/** Risk shout → multipliers on the decision thresholds and the throw hazard. */
export const RISK_MODEL = {
  more: { threshold: 0.6, throw: 1.3 },
  less: { threshold: 1.5, throw: 0.75 },
} as const;

// ── types ────────────────────────────────────────────────────────────────────────────────────

/** Manager attributes (0..1). Human managers default to the league average 0.6. */
export interface ManagerProfile {
  /** Reading the game: when to call a timeout, which shout fits, which talk works. */
  readonly tactical: number;
  /** Getting through to players: how much a timeout or a talk moves their state of mind. */
  readonly motivating: number;
}
export const AVERAGE_MANAGER: ManagerProfile = { tactical: 0.6, motivating: 0.6 };

export type TempoShout = "slow" | "normal" | "fast";
export type RiskShout = "less" | "normal" | "more";
export type DefenseShout = "spread" | "normal" | "stack";
/** Standing instructions the IGL carries until changed. */
export interface Shouts {
  readonly tempo: TempoShout;
  readonly risk: RiskShout;
  readonly defense: DefenseShout;
}
export const NEUTRAL_SHOUTS: Shouts = { tempo: "normal", risk: "normal", defense: "normal" };

export type TeamTalk = "calm" | "encourage" | "demand" | "praise";
export const TEAM_TALKS: readonly TeamTalk[] = ["calm", "encourage", "demand", "praise"];

/** What a player is like, from rated attributes (league average 0.6 when unrated). */
export interface Personality {
  /** (clutch + consistency) / 2 — how much a bad round gets to them. */
  readonly composure: number;
  /** entryAggression — how they take being pushed. */
  readonly drive: number;
}

export interface PlayerMind {
  readonly index: number;
  readonly playerId: string | null;
  readonly handle: string | null;
  readonly personality: Personality;
  /** c ∈ [−1, 1]. */
  readonly mood: number;
  readonly tilt: number;
  readonly confidence: number;
  /** One of the team's two best-rated players. */
  readonly key: boolean;
}

export interface TeamMind {
  readonly players: readonly PlayerMind[];
  /** Mean tilt T and mean confidence K. */
  readonly tilt: number;
  readonly confidence: number;
}

export type AlertKind = "lossRun" | "economyBroken" | "playerTilt" | "halfTime";
export interface Alert {
  readonly kind: AlertKind;
  readonly team: TeamSlot;
  /** Round the alert is raised before (the next round to play). */
  readonly round: number;
  readonly streak?: number;
  readonly creditsPerPlayer?: number;
  readonly player?: { readonly index: number; readonly handle: string | null; readonly tilt: number; readonly key: boolean };
}

// ── personality and the mood update ──────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Personalities, ids, handles and key-player flags of a team's five. */
export function teamPersonalities(teamId: string, override?: readonly RosterPlayer[]): Array<Omit<PlayerMind, "mood" | "tilt" | "confidence">> {
  const traits = rosterTraits(teamId, 5, override);
  const consistency = rosterConsistency(teamId, 5, override);
  const profiles = rosterProfiles(teamId, 5, override);
  const ids = rosterPlayerIds(teamId, 5, override);
  const skills = rosterSkills(teamId, 5, override);
  const rating = skills.map((s) => (s.aim + s.reaction + s.firstBulletAccuracy + s.crosshairPlacement) / 4);
  const top = [...rating.keys()].sort((a, b) => rating[b]! - rating[a]! || a - b).slice(0, 2);
  return ids.map((playerId, i) => ({
    index: i,
    playerId,
    handle: (override?.[i] as { handle?: string } | undefined)?.handle ?? (playerId ? getPlayer(playerId)?.handle ?? null : null),
    personality: { composure: ((traits[i]?.clutch ?? 0.6) + (consistency[i] ?? 0.6)) / 2, drive: profiles[i]?.aggression ?? 0.5 },
    key: top.includes(i),
  }));
}

/** Kills and deaths of each roster index of `slot` in a round (from the public kill events). */
export function roundInvolvement(record: RoundRecord, slot: TeamSlot): Array<{ kills: number; died: boolean }> {
  const prefix = record.attacker === slot ? "atk" : "def";
  const out = Array.from({ length: 5 }, () => ({ kills: 0, died: false }));
  const idx = (id: unknown): number => {
    const s = String(id ?? "");
    return s.startsWith(prefix) ? Number(s.slice(prefix.length)) - 1 : -1;
  };
  for (const e of record.events) {
    if (e.kind !== "kill") continue;
    const k = idx(e.actor);
    const d = idx(e.target);
    if (k >= 0 && out[k]) out[k]!.kills += 1;
    if (d >= 0 && out[d]) out[d]!.died = true;
  }
  return out;
}

/** One round's mood update for one player (header formula). */
export function moodAfterRound(mood: number, composure: number, won: boolean, kills: number, died: boolean): number {
  const m = MORALE_MODEL;
  const delta = won
    ? m.winImpulse + (kills >= 2 ? m.multiKillImpulse : 0)
    : -(1 - clamp(composure, 0, 1)) * (m.lossImpulse + (died && kills === 0 ? m.deathNoKillImpulse : 0));
  return clamp(m.decay * mood + delta, -1, 1);
}

export function summarizeMind(players: readonly PlayerMind[]): TeamMind {
  const n = Math.max(1, players.length);
  return {
    players,
    tilt: players.reduce((s, p) => s + p.tilt, 0) / n,
    confidence: players.reduce((s, p) => s + p.confidence, 0) / n,
  };
}

export function withMood(p: Omit<PlayerMind, "mood" | "tilt" | "confidence">, mood: number): PlayerMind {
  return { ...p, mood, tilt: Math.max(0, -mood), confidence: Math.max(0, mood) };
}

// ── lever → engine inputs ────────────────────────────────────────────────────────────────────

/** The round inputs a team's state of mind and risk shout amount to (null when all neutral). */
export function mindRoundInputs(mind: TeamMind, risk: RiskShout): RoundTeamInputs | null {
  const m = MORALE_MODEL;
  const T = mind.tilt;
  const K = mind.confidence;
  const r = risk === "normal" ? null : RISK_MODEL[risk];
  const throwRateScale = Math.exp(m.throwPerTilt * T - m.throwPerConfidence * K) * (r?.throw ?? 1);
  const formSigmaScale = 1 + m.formPerTilt * T;
  const trading = m.tradingPerTilt * T + m.tradingPerConfidence * K;
  const gameSense = m.gameSensePerTilt * T;
  const neutral = T === 0 && K === 0 && !r;
  if (neutral) return null;
  return {
    throwRateScale,
    formSigmaScale,
    traitDelta: { trading, gameSense },
    ...(r ? { tuning: { retakeMinWinChance: 0.15 * r.threshold, attackSaveMinWinChance: 0.09 * r.threshold, heroMinWinChance: 0.08 * r.threshold } } : {}),
  };
}

/** A timeout's effect on one player's mood: recover a share of the tilt (header of TIMEOUT_MODEL). */
export function moodAfterTimeout(mood: number, composure: number, manager: ManagerProfile): number {
  const t = TIMEOUT_MODEL;
  const tilt = Math.max(0, -mood);
  const share = (t.recoveryBase + t.recoveryPerMotivating * clamp(manager.motivating, 0, 1)) * (0.6 + 0.4 * clamp(composure, 0, 1));
  return clamp(mood + share * tilt, -1, 1);
}

/** The opponent's run cools during a break: positive mood decays one extra step. */
export function moodAfterOpponentBreak(mood: number): number {
  return mood > 0 ? MORALE_MODEL.decay * mood : mood;
}

export type TalkSituation = "leading" | "level" | "trailing";
export function talkSituation(own: number, opp: number): TalkSituation {
  return own - opp >= 2 ? "leading" : opp - own >= 2 ? "trailing" : "level";
}

/**
 * A team talk's effect on one player's mood:   Δ = (0.5 + motivating) · f(talk, situation, player)
 *   calm       f = 0.5·τ                                         takes the edge off a tilted player, nothing else
 *   encourage  f = 0.10 + 0.10·(1 − k)   (leading: 0.05)        helps the fragile most
 *   demand     f = 0.30·(drive − 0.5) − 0.30·τ·(1 − k) + s      driven players respond; a tilted, fragile one cracks
 *              s = +0.08 trailing, −0.04 leading, 0 level
 *   praise     f = leading: 0.05 + 0.12·k;  level: 0.04;  trailing: −0.06 (rings hollow)
 */
export function talkEffect(talk: TeamTalk, situation: TalkSituation, player: { personality: Personality; tilt: number }, manager: ManagerProfile): number {
  const k = clamp(player.personality.composure, 0, 1);
  const tau = player.tilt;
  let f: number;
  switch (talk) {
    case "calm": f = 0.5 * tau; break;
    case "encourage": f = situation === "leading" ? 0.05 : 0.1 + 0.1 * (1 - k); break;
    case "demand": f = 0.3 * (player.personality.drive - 0.5) - 0.3 * tau * (1 - k) + (situation === "trailing" ? 0.08 : situation === "leading" ? -0.04 : 0); break;
    case "praise": f = situation === "leading" ? 0.05 + 0.12 * k : situation === "level" ? 0.04 : -0.06; break;
  }
  return (0.5 + clamp(manager.motivating, 0, 1)) * f;
}

// ── shouts → this round's order ──────────────────────────────────────────────────────────────

/**
 * What the team's standing shouts make of the next round's call, given the team's own read of the
 * opponent (OpponentModel — the same evidence the IGL uses):
 *   attack · fast    an execute; the site drawn by the read, P(site) ∝ 1 + 3·max(0, −lean_defense(site))
 *   attack · slow    "default": slow play — hold lines, use the clock, commit on evidence
 *   defense · stack  stack the site the read says they attack (lean_attack ≥ 0 → A)
 *   defense · spread defaultHold
 *   otherwise        no strategy: the IGL calls the round itself
 * Deterministic: the draw is seeded by (match seed, round, team).
 */
export function shoutStrategy(shouts: Shouts, side: "attack" | "defense", read: OpponentRead | null, seed: number, round: number, slot: TeamSlot): StrategyOrder | undefined {
  if (side === "attack") {
    if (shouts.tempo === "slow") return "default";
    if (shouts.tempo !== "fast") return undefined;
    const defA = read ? tendencyLean(read.defenseSite, "A") : 0;
    const wA = 1 + 3 * Math.max(0, -defA);
    const wB = 1 + 3 * Math.max(0, defA);
    const u = mulberry32(deriveSeed(seed, `shout:${round}:${slot}`))();
    return u * (wA + wB) < wA ? "aExecute" : "bExecute";
  }
  if (shouts.defense === "spread") return "defaultHold";
  if (shouts.defense !== "stack") return undefined;
  const atkA = read ? tendencyLean(read.attackSite, "A") : 0;
  return atkA >= 0 ? "stackA" : "stackB";
}

// ── the AI manager ───────────────────────────────────────────────────────────────────────────

export interface ManagerSituation {
  readonly slot: TeamSlot;
  readonly round: number;
  readonly score: Readonly<Record<TeamSlot, number>>;
  readonly lossStreak: number;
  readonly mind: TeamMind;
  readonly read: OpponentRead | null;
  readonly timeoutsLeftThisHalf: number;
  readonly creditsPerPlayer: number;
  /** The opponent is one round from the map. */
  readonly opponentMatchPoint: boolean;
}

export interface AiDecision {
  readonly timeout: boolean;
  readonly reason?: "lossRun" | "tilt" | "matchPoint";
  readonly shouts: Shouts;
}

/**
 * The AI manager's between-round call, driven by its attributes:
 *   timeout when timeouts are left this half and
 *     loss streak ≥ 3 + [tactical < 0.5]            (a sharp manager stops the run a round earlier)
 *     or team tilt T ≥ 0.25 + 0.2·(1 − tactical)
 *     or the opponent is at match point
 *   risk     trailing by ≥ 4 → more · leading by ≥ 4 → less (tactical ≥ 0.4) · else normal
 *   tempo    after a 3-round loss streak → slow (tactical ≥ 0.5), else normal
 *   defense  stack when the read of their attack is confident: confidence·|lean| ≥ 0.25 (tactical ≥ 0.5)
 */
export function aiManagerDecision(manager: ManagerProfile, s: ManagerSituation): AiDecision {
  const own = s.score[s.slot];
  const opp = s.score[s.slot === "A" ? "B" : "A"];
  const tac = clamp(manager.tactical, 0, 1);
  let reason: AiDecision["reason"];
  if (s.timeoutsLeftThisHalf > 0) {
    if (s.lossStreak >= 3 + (tac < 0.5 ? 1 : 0)) reason = "lossRun";
    else if (s.mind.tilt >= 0.25 + 0.2 * (1 - tac)) reason = "tilt";
    else if (s.opponentMatchPoint) reason = "matchPoint";
  }
  const risk: RiskShout = opp - own >= 4 ? "more" : own - opp >= 4 && tac >= 0.4 ? "less" : "normal";
  const tempo: TempoShout = s.lossStreak >= 3 && tac >= 0.5 ? "slow" : "normal";
  const lean = s.read ? tendencyLean(s.read.attackSite, "A") : 0;
  const defense: DefenseShout = tac >= 0.5 && Math.abs(lean) >= 0.25 ? "stack" : "normal";
  return { timeout: reason !== undefined, ...(reason ? { reason } : {}), shouts: { tempo, risk, defense } };
}

/**
 * The AI manager's half-time talk: a manager with motivating ≥ 0.5 reads the room and picks the
 * talk with the largest summed expected effect over its players; a weaker one always encourages.
 */
export function aiTeamTalk(manager: ManagerProfile, situation: TalkSituation, mind: TeamMind): TeamTalk {
  if (manager.motivating < 0.5) return "encourage";
  let best: TeamTalk = "encourage";
  let bestValue = -Infinity;
  for (const talk of TEAM_TALKS) {
    const v = mind.players.reduce((s, p) => s + talkEffect(talk, situation, p, manager), 0);
    if (v > bestValue + 1e-12) { bestValue = v; best = talk; }
  }
  return best;
}

/** Orders the AI pairs with a timeout: the economy call from its bank, and a reset call by side. */
export function aiTimeoutOrder(side: "attack" | "defense", creditsPerPlayer: number): TeamOrder {
  return { economy: creditsPerPlayer < 2000 ? "save" : "force", strategy: side === "attack" ? "default" : "aggroPush" };
}

// ── alerts ───────────────────────────────────────────────────────────────────────────────────

/** Credits per player below which a team cannot field rifles + armor next round. */
export const BROKEN_ECONOMY_PER_PLAYER = 2400;

/**
 * Alerts raised after a round, for the round about to be played (they pause auto-play):
 *   lossRun        the loss streak just reached 4, 6 or 8
 *   economyBroken  after a loss, credits per player fell below 2,400 (no rifle + armor) — on the
 *                  transition only, and not before a pistol round
 *   playerTilt     a player's tilt crossed 0.45 this round
 *   halfTime       the next round starts the second half
 */
export function alertsAfterRound(args: {
  readonly team: TeamSlot;
  readonly nextRound: number;
  readonly lost: boolean;
  readonly streak: number;
  readonly creditsPerPlayer: number;
  readonly creditsPerPlayerBefore: number;
  readonly nextIsPistol: boolean;
  readonly halfTimeNext: boolean;
  readonly before: TeamMind;
  readonly after: TeamMind;
}): Alert[] {
  const out: Alert[] = [];
  const { team, nextRound: round } = args;
  if (args.lost && [4, 6, 8].includes(args.streak)) out.push({ kind: "lossRun", team, round, streak: args.streak });
  if (args.lost && !args.nextIsPistol && args.creditsPerPlayer < BROKEN_ECONOMY_PER_PLAYER && args.creditsPerPlayerBefore >= BROKEN_ECONOMY_PER_PLAYER) {
    out.push({ kind: "economyBroken", team, round, creditsPerPlayer: Math.round(args.creditsPerPlayer) });
  }
  for (const p of args.after.players) {
    const was = args.before.players[p.index]?.tilt ?? 0;
    if (p.tilt >= MORALE_MODEL.tiltAlert && was < MORALE_MODEL.tiltAlert) {
      out.push({ kind: "playerTilt", team, round, player: { index: p.index, handle: p.handle, tilt: p.tilt, key: p.key } });
    }
  }
  if (args.halfTimeNext) out.push({ kind: "halfTime", team, round });
  return out;
}
