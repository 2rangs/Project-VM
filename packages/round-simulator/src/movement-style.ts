/**
 * How each player moves (docs/MOVEMENT_STYLE.md).
 *
 * The tactical layer decides WHERE a player goes; the executor (mover.ts) finds a path. Without
 * this module every player walked the single best path of its zone route on one of five fixed
 * lanes, at the same speed, and stopped only when something blocked it — so all ten bodies moved
 * the same way every round. A MovementStyle is the per-player, per-round way of carrying out the
 * same orders, derived from the player's attributes, its role in the round's plan, and the round
 * seed. Nothing here is a flat bonus: every field changes WHERE a body is or WHEN it gets there,
 * and the outcome follows from the positions through the usual sight / duel models.
 *
 * Fields and the formulas behind them (u = a seeded uniform draw per player per round):
 *  - lane          lateral offset share in a corridor: the five-slot lane of the player + 0.5·(u−0.5)
 *  - spacing       follow distance behind a teammate going the same way, × body gap:
 *                  1 + 1.0·trading·(0.75 + 0.5u)  (a trader keeps the gap a refrag needs: ~1 m at 0.6),
 *                  kept only behind a teammate going the same way
 *  - routeSlack    how much slower (share of the best route's time) an alternative zone route may
 *                  be and still be considered: ROLE_ROUTE_SLACK[role]·(0.6 + 0.8u)
 *  - riskAversion  weight on the team's believed threat along a route: 0.5 + gameSense
 *  - routeTempMs   softmax temperature over the routes' scores: 700·(1.2 − gameSense) ms
 *  - checkMs       a stop-and-check at the edge of a zone the team believes may hold an enemy:
 *                  180 + 350·(1 − reaction) + 120u ms; `checks` of them per round:
 *                  round(1 + 2·gameSense·u′)
 *  - quiet         sound discipline: tendency to walk when not hurried (buy phase, a lurk's
 *                  approach): gameSense·(lurker 1.3 | anchor 1.1 | entry 0.6 | other 0.9)
 *  - buy           the buy-phase script (buy-phase.ts): time at the buy spot, idle wanders, how
 *                  early to be set before the barrier drops.
 */
import type { CombatSkills } from "@pv/combat-engine";
import type { PathResult, SpatialEngine } from "@pv/spatial-engine";
import { deriveSeed, mulberry32 } from "./rng.js";
import type { PlayerRole } from "./policy-contract.js";
import type { MovementExecutor } from "./mover.js";
import { barrierAreas } from "./buy-phase.js";
import { AVERAGE_TRAITS, type SimPlayer, type TacticalTraits } from "./types.js";

export interface BuyPhaseStyle {
  /** Time spent at the buy spot before moving off it (ms). */
  readonly buyMs: number;
  /** Idle wanders (short walks to a nearby spot of its own side) before setting up. */
  readonly wanders: number;
  /** How far an idle wander goes (uu). */
  readonly wanderRadius: number;
  /** How long before the barrier drops the player wants to stand on its setup spot (ms). */
  readonly setMarginMs: number;
}

/** Which parts of the style are in force (all by default; a part off moves as the plain executor does). */
export interface MovementStyleParts {
  readonly lanes?: boolean;
  readonly spacing?: boolean;
  readonly routes?: boolean;
  readonly checks?: boolean;
  readonly lurk?: boolean;
}

export interface MovementStyle {
  readonly lane: number;
  readonly spacing: number;
  readonly routeSlack: number;
  readonly riskAversion: number;
  readonly routeTempMs: number;
  readonly checkMs: number;
  readonly checks: number;
  readonly quiet: number;
  readonly buy: BuyPhaseStyle;
}

/** Five lanes so five teammates spread across a corridor (same slots the executor always had). */
const SLOT_LANES = [0, -0.7, 0.7, -0.35, 0.35];
/** Room an alternative zone route may cost, by role, before it is no longer "near-optimal". */
const ROLE_ROUTE_SLACK: Record<PlayerRole | "none", number> = {
  entry: 0.03, support: 0.06, igl: 0.06, anchor: 0.05, rotator: 0.04, lurker: 0.16, none: 0.05,
};
const ROLE_QUIET: Record<PlayerRole | "none", number> = {
  entry: 0.6, support: 0.9, igl: 0.9, anchor: 1.1, rotator: 0.9, lurker: 1.3, none: 0.9,
};
/** Belief threat → ms on a route (the same scale the executor's TACTICAL preference uses). */
const THREAT_MS = 2500;
/** A route zone that sees the goal zone is worth this much (ms) of information to a player with gameSense 1. */
const INFO_MS = 400;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One player's style for one round. Deterministic in (seed, player, role). */
export function movementStyle(p: Pick<SimPlayer, "id" | "skills" | "traits">, slot: number, role: PlayerRole | null, seed: number): MovementStyle {
  const rng = mulberry32(deriveSeed(seed, `style:${p.id}`));
  const u = () => rng();
  const t: TacticalTraits = p.traits ?? AVERAGE_TRAITS;
  const s: CombatSkills = p.skills;
  const r = role ?? "none";
  const lane = clamp(SLOT_LANES[slot % SLOT_LANES.length]! + 0.5 * (u() - 0.5), -0.9, 0.9);
  const spacing = 1 + 1.0 * t.trading * (0.75 + 0.5 * u());
  const routeSlack = ROLE_ROUTE_SLACK[r] * (0.6 + 0.8 * u());
  const riskAversion = 0.5 + t.gameSense;
  const routeTempMs = 700 * Math.max(0.2, 1.2 - t.gameSense);
  const checkMs = 180 + 350 * (1 - s.reaction) + 120 * u();
  const checks = Math.round(1 + 2 * t.gameSense * u());
  const quiet = clamp(t.gameSense * ROLE_QUIET[r], 0, 1);
  // Buy phase: a decisive player buys quickly; a restless one wanders more; a careful one is set early.
  const buyMs = 2500 + 4500 * (1 - t.gameSense) * (0.5 + u());
  const wanders = 1 + Math.floor((1 - quiet) * 2 * u() + u());
  const wanderRadius = 250 + 350 * u();
  const setMarginMs = 1500 + 3500 * t.gameSense * (0.5 + 0.5 * u());
  return { lane, spacing, routeSlack, riskAversion, routeTempMs, checkMs, checks, quiet, buy: { buyMs, wanders, wanderRadius, setMarginMs } };
}

/**
 * The near-optimal zone routes from `from` to `to`: the best route, and the routes found by
 * closing each of its intermediate zones in turn, that cost at most (1 + slack) × the best time.
 * Distinct, best first.
 */
export function nearOptimalRoutes(
  spatial: SpatialEngine, from: string, to: string, mode: "run" | "walk",
  opts: { hazardCosts?: ReadonlyMap<string, number>; blockedZones?: readonly string[]; passableZones?: readonly string[] }, slack: number,
): PathResult[] {
  const best = spatial.findPath(from, to, mode, opts);
  if (!best) return [];
  const out: PathResult[] = [best];
  if (slack <= 0 || best.path.length < 3) return out;
  const seen = new Set([best.path.join(">")]);
  for (let i = 1; i < best.path.length - 1; i++) {
    const r = spatial.findPath(from, to, mode, { ...opts, blockedZones: [...(opts.blockedZones ?? []), best.path[i]!] });
    if (!r || r.timeMs > best.timeMs * (1 + slack)) continue;
    const key = r.path.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Score of a route for a player (ms; lower is better): its travel time, plus the team's believed
 * threat on the zones it passes weighted by the player's risk aversion, minus the information the
 * route offers (zones on the way that look into the goal).
 */
export function routeScoreMs(
  spatial: SpatialEngine, route: PathResult, style: MovementStyle, gameSense: number, threat: (zoneId: string) => number,
): number {
  let risk = 0, info = 0;
  const goal = route.path[route.path.length - 1]!;
  for (let i = 1; i < route.path.length - 1; i++) {
    const z = route.path[i]!;
    risk += threat(z);
    if (spatial.hasLineOfSight(z, goal)) info += 1;
  }
  return route.timeMs + THREAT_MS * style.riskAversion * risk - INFO_MS * gameSense * info;
}

/**
 * Which of the near-optimal routes the player takes: a softmax over the scores at the player's
 * temperature, drawn with a uniform that is fixed for (round, player, from, to) — the same request
 * gets the same route on every replan.
 */
export function pickRoute(scores: readonly number[], tempMs: number, seed: number, key: string): number {
  if (scores.length <= 1) return 0;
  const best = Math.min(...scores);
  const w = scores.map((s) => Math.exp(-(s - best) / Math.max(1, tempMs)));
  const total = w.reduce((a, b) => a + b, 0);
  let x = mulberry32(deriveSeed(seed, `route:${key}`))() * total;
  for (let i = 0; i < w.length; i++) { x -= w[i]!; if (x <= 0) return i; }
  return w.length - 1;
}

/** A zone the team believes this dangerous (threat level) is worth a check before stepping into it. */
export const CHECK_THREAT_MIN = 0.2;
/**
 * The zone graph's run times are about 1.5× what a body actually takes on the roadmap (measured:
 * balance-recovery hand-over, fact 8); enemy reach times are scaled by this to match the movers.
 */
const GRAPH_TO_ROADMAP_TIME = 1 / 1.5;
/** A lurker walks the last stretch of its approach while no shot has been fired (uu from its spot). */
export const LURK_QUIET_UNITS = 1500;

/**
 * The round's styles and the per-round state they need (checks used, zones checked). The simulator
 * holds one per round and asks it at three points: when a route is planned (routeChooser), when a
 * mover reaches a zone's edge (checkPauseMs), and when a move order is carried out (pace).
 */
export class RoundMovementStyles {
  private readonly styles = new Map<string, MovementStyle>();
  readonly roles = new Map<string, PlayerRole>();
  private readonly checksLeft = new Map<string, number>();
  private readonly checked = new Set<string>();

  private readonly parts: Required<MovementStyleParts>;
  constructor(private readonly spatial: SpatialEngine, private readonly seed: number, parts: MovementStyleParts = {}) {
    this.parts = { lanes: true, spacing: true, routes: true, checks: true, lurk: true, ...parts };
  }

  get assigned(): boolean { return this.styles.size > 0; }
  styleOf(id: string): MovementStyle | undefined { return this.styles.get(id); }

  /** Derive every player's style from its attributes and its role in the round's first plan. */
  assign(players: readonly SimPlayer[], decisions: ReadonlyArray<{ readonly roles: ReadonlyArray<{ readonly playerId: string; readonly role: PlayerRole }> }>): void {
    for (const d of decisions) for (const r of d.roles) this.roles.set(String(r.playerId), r.role);
    const slot = new Map<string, number>();
    for (const p of players) {
      const i = slot.get(p.teamId) ?? 0;
      slot.set(p.teamId, i + 1);
      const st = movementStyle(p, i, this.roles.get(p.id) ?? null, this.seed);
      this.styles.set(p.id, st);
      this.checksLeft.set(p.id, st.checks);
    }
  }

  /** Give the executor each player's lane and spacing, and the route chooser. */
  install(mover: MovementExecutor, players: readonly SimPlayer[], threat: (side: SimPlayer["side"], zoneId: string) => number): void {
    for (const p of players) {
      const st = this.styles.get(p.id);
      if (st) mover.setStyle(p.id, { ...(this.parts.lanes ? { lane: st.lane } : {}), ...(this.parts.spacing ? { spacing: st.spacing } : {}) });
    }
    // per-player spacing comes with the crowd rules that keep it from stalling the stack
    if (this.parts.spacing) { mover.followCloseUp = true; mover.crossingByRank = true; }
    if (!this.parts.routes) return;
    mover.routeChooser = (p, goal, mode, opts) => {
      const st = this.styles.get(p.id);
      if (!st) return null;
      const routes = nearOptimalRoutes(this.spatial, p.zoneId, goal.zoneId, mode, opts, st.routeSlack);
      if (routes.length <= 1) return routes[0]?.path ?? null;
      const gs = p.traits?.gameSense ?? AVERAGE_TRAITS.gameSense;
      const scores = routes.map((r) => routeScoreMs(this.spatial, r, st, gs, (z) => threat(p.side, z)));
      return routes[pickRoute(scores, st.routeTempMs, this.seed, `${p.id}|${p.zoneId}|${goal.zoneId}`)]!.path;
    };
  }

  /**
   * A stop-and-check at the edge of `toZone` (ms; 0 = walk on): before any contact, while the spike
   * is not down, into a zone that may hold an enemy — the team's belief says so (threat ≥
   * CHECK_THREAT_MIN), or the enemy could have reached it by now (enemyReachMs ≤ elapsed) — that no
   * teammate already stands in (cleared) and this player has not checked yet, while it has checks left.
   * Only a walking player checks (a slow play, a lurk, a careful approach); a running one is executing.
   */
  checkPauseMs(p: SimPlayer, toZone: string, threat: number, calm: boolean, elapsedMs = 0, cleared = false): number {
    const st = this.styles.get(p.id);
    // a run is an execute or a rotation: nobody stops to clear angles mid-sprint; a walk is a slow play
    if (!st || !this.parts.checks || !calm || cleared || p.moveMode !== "walk") return 0;
    if (threat < CHECK_THREAT_MIN && this.enemyReachMs(p.side, toZone) > elapsedMs) return 0;
    const key = `${p.id}|${toZone}`;
    if (this.checked.has(key)) return 0;
    const left = this.checksLeft.get(p.id) ?? 0;
    if (left <= 0) return 0;
    this.checked.add(key);
    this.checksLeft.set(p.id, left - 1);
    return Math.round(st.checkMs);
  }

  /**
   * The earliest the enemy can be in a zone (ms into the live round), from the map alone: defenders
   * from anywhere behind their barrier (they set up during the buy phase), attackers from their spawn.
   */
  enemyReachMs(side: SimPlayer["side"], zoneId: string): number {
    const key = `${side}|${zoneId}`;
    let v = this.reach.get(key);
    if (v === undefined) {
      const enemyFrom = side === "attack" ? this.defenseArea() : ["attacker-spawn"];
      v = Infinity;
      for (const z of enemyFrom) {
        if (z === zoneId) { v = 0; break; }
        const t = this.spatial.shortestTravelTimeMs(z, zoneId, "run");
        if (t != null) v = Math.min(v, t * GRAPH_TO_ROADMAP_TIME);
      }
      this.reach.set(key, v);
    }
    return v;
  }
  private readonly reach = new Map<string, number>();
  private defArea: string[] | null = null;
  private defenseArea(): string[] {
    if (!this.defArea) this.defArea = [...barrierAreas(this.spatial, []).defense];
    return this.defArea;
  }

  /**
   * A quiet lurker walks the last LURK_QUIET_UNITS of its approach while the round is still calm —
   * its own approach only: not with the spike (the plant waits on it), and not when its order sends
   * it where a teammate is also going (it is joining the execute, not lurking). Measured: walking
   * every lurker move cost the pistol attack 2 pp (plant rate 0.61 → 0.56).
   */
  pace(p: SimPlayer, mode: "run" | "walk", remainingUnits: number, calm: boolean, own: { carrier: boolean; joining: boolean } = { carrier: false, joining: false }): "run" | "walk" {
    if (!this.parts.lurk || mode === "walk" || !calm || own.carrier || own.joining || this.roles.get(p.id) !== "lurker") return mode;
    const st = this.styles.get(p.id);
    return st && st.quiet >= 0.5 && remainingUnits > 0 && remainingUnits < LURK_QUIET_UNITS ? "walk" : mode;
  }
}
