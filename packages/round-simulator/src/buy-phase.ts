/**
 * The buy phase (barrier phase, ROUND_RULES.buyPhaseMs) — docs/MOVEMENT_STYLE.md §2.
 *
 * Before the round goes live both teams move behind their barriers. The round's plan is made at
 * the start of the buy phase (the team policies' first decision); during the phase each player
 * carries out its part of that plan as far as its barrier lets it:
 *  - attackers stay in their spawn: each takes a spot near the exit its first move leaves by,
 *    stacked by role (the entry at the door, the support behind it, a lurker at its own exit);
 *  - defenders move freely on their side up to the barrier and get to their setup — the zone the
 *    plan sets each of them down in (an anchor on site, a retake spot, an early mid presence) — on
 *    a standing spot of their own, looking where their first order points.
 * Before setting up, each player stops at its buy spot for a while and may wander idly; when it
 * leaves for its setup, how early it wants to be set and whether it walks follow from its style
 * (movement-style.ts). Where everyone stands when the barrier drops is the result: the plan's
 * positions as each player reached them.
 *
 * The barrier: the attackers' is the edge of their spawn. The defenders' runs where they are
 * clearly first: a zone is on their side when their run to it takes at most DEFENDER_BARRIER_SHARE
 * of the two spawns' combined run times (d / (a + d) ≤ share), plus every zone a defender was set
 * down in by the match (its planned setup). Zones beyond it are sealed (zone blockers), so paths
 * and wanders stay behind the barrier.
 */
import type { SpatialEngine } from "@pv/spatial-engine";
import { MovementExecutor, type MoveGoal, type MoverHooks } from "./mover.js";
import type { ActionCommand, PolicyDecision, PlayerRole } from "./policy-contract.js";
import type { MovementStyle } from "./movement-style.js";
import { deriveSeed, mulberry32 } from "./rng.js";
import type { Side, SimPlayer, TrackFrame } from "./types.js";

/** A zone is behind the defenders' barrier when d / (a + d) ≤ this (d, a: run times from each spawn). */
export const DEFENDER_BARRIER_SHARE = 0.45;
/** How far behind the exit (uu, along the floor) each role stacks in the attackers' spawn. */
const STACK_DEPTH: Record<PlayerRole | "none", number> = {
  entry: 60, support: 220, igl: 320, lurker: 120, anchor: 260, rotator: 260, none: 260,
};
/** Spread of a player's stack spot (uu) around its role's depth — its own preference this round. */
const STACK_JITTER = 160;
/** An idle wander is a walk of at most this long (ms) — it is never started if it would make the player late. */
const WANDER_BUDGET_MS = 3500;

export const SPAWN_ZONE: Readonly<Record<Side, string>> = { attack: "attacker-spawn", defense: "defender-spawn" };

export interface BuyPhaseInput {
  readonly spatial: SpatialEngine;
  /** The round's players at their match-given start (mutated: they end where the buy phase leaves them). */
  readonly players: SimPlayer[];
  /** The plan each team made at the start of the phase. */
  readonly opening: Readonly<Record<Side, PolicyDecision>>;
  readonly styles: ReadonlyMap<string, MovementStyle>;
  readonly durationMs: number;
  readonly tickMs: number;
  readonly seed: number;
  readonly speeds: { readonly runUnitsPerSec: number; readonly walkUnitsPerSec: number };
  /** Record a frame per tick (negative elapsedMs, ending one tick before the barrier drops). */
  readonly record: boolean;
}

export interface BuyPhaseSetup {
  readonly playerId: string;
  readonly side: Side;
  /** Zone the plan wanted the player in (its first order's target or its planned setup). */
  readonly planZone: string;
  /** Zone it stood in when the barrier dropped. */
  readonly zoneId: string;
}

export interface BuyPhaseResult {
  readonly durationMs: number;
  readonly frames: TrackFrame[];
  readonly setups: BuyPhaseSetup[];
  /** Zones behind each side's barrier. */
  readonly areas: Readonly<Record<Side, readonly string[]>>;
}

type Step = { kind: "stand"; untilMs: number } | { kind: "goto"; goal: MoveGoal; until?: "arrive" };

interface Script {
  readonly p: SimPlayer;
  readonly steps: Step[];
  at: number;
  /** Index of the step whose goal has been handed to the executor (-1: none). */
  started: number;
  /** Where the player looks once set (a point). */
  face: { x: number; y: number } | null;
}

/** Zones behind each side's barrier. */
export function barrierAreas(spatial: SpatialEngine, setupZones: readonly string[]): Record<Side, Set<string>> {
  const attack = new Set([SPAWN_ZONE.attack]);
  const defense = new Set([SPAWN_ZONE.defense, ...setupZones]);
  for (const z of spatial.zones) {
    if (z.id === SPAWN_ZONE.attack || z.id === SPAWN_ZONE.defense) continue;
    const a = spatial.shortestTravelTimeMs(SPAWN_ZONE.attack, z.id, "run");
    const d = spatial.shortestTravelTimeMs(SPAWN_ZONE.defense, z.id, "run");
    if (a == null || d == null) continue;
    if (d / Math.max(1, a + d) <= DEFENDER_BARRIER_SHARE) defense.add(z.id);
  }
  return { attack, defense };
}

const commandOf = (d: PolicyDecision, id: string): ActionCommand | undefined => d.commands.find((c) => c.playerId === id);
const roleOf = (d: PolicyDecision, id: string): PlayerRole | null => d.roles.find((r) => r.playerId === id)?.role ?? null;

export function runBuyPhase(input: BuyPhaseInput): BuyPhaseResult {
  const { spatial, players } = input;
  const nav = spatial.nav!;
  const setupZone = new Map(players.map((p) => [p.id, p.zoneId]));
  const areas = barrierAreas(spatial, players.filter((p) => p.side === "defense").map((p) => p.zoneId));

  // Everyone starts the phase in its spawn (the match may have set defenders down on their setup).
  for (const p of players) {
    const spawn = spatial.getZone(SPAWN_ZONE[p.side]);
    if (!spawn) continue;
    p.zoneId = spawn.id;
    p.position = { ...spawn.position };
  }
  // One executor per side, its barrier sealed: zones outside the side's area are blocked floor.
  const exec: Record<Side, MovementExecutor> = { attack: null!, defense: null! };
  for (const side of ["attack", "defense"] as const) {
    const ex = new MovementExecutor(spatial, input.speeds);
    ex.reset(players.filter((p) => p.side === side));
    for (const z of spatial.zones) if (!areas[side].has(z.id)) ex.addZoneBlocker(`barrier:${z.id}`, z.id);
    for (const p of players) if (p.side === side) ex.setStyle(p.id, { lane: input.styles.get(p.id)?.lane ?? 0 });
    exec[side] = ex;
  }
  const hooksOf = (side: Side): MoverHooks => ({ canEnterZone: (_p, to) => areas[side].has(to) });

  const runMs = (side: Side, p: SimPlayer, to: { x: number; y: number; z: number }): number => {
    const r = nav.findPath({ actorId: p.id, start: p.position, destination: to, movementMode: "run", routePreference: "FASTEST", blockers: exec[side].blockers });
    return r.status === "SUCCESS" ? r.estimatedTravelMs : 0;
  };

  // ---- each player's script ----
  const scripts: Script[] = [];
  const setups: Array<{ p: SimPlayer; planZone: string }> = [];
  for (const p of players) {
    const side = p.side;
    const style = input.styles.get(p.id);
    const rng = mulberry32(deriveSeed(input.seed, `buy:${p.id}`));
    const decision = input.opening[side];
    const cmd = commandOf(decision, p.id);
    const role = roleOf(decision, p.id);
    const ex = exec[side];
    const steps: Step[] = [];
    const buyMs = style?.buy.buyMs ?? 3000;
    steps.push({ kind: "stand", untilMs: buyMs });

    // where the plan wants this player when the barrier drops
    let planZone = side === "defense" ? setupZone.get(p.id)! : SPAWN_ZONE.attack;
    let goal: MoveGoal;
    let face: { x: number; y: number } | null = null;
    if (side === "defense") {
      // the setup the plan gives this defender (the zone the match set it down in — an anchor, a retake
      // spot, the mid presence): it stands there, on its own spot, looking where its first order points.
      // Where the order sends it on from there is the live round's business (measured: walking it all the
      // way during the buy phase put every defender on its angle at 0:00 and cost the attack 3 pp).
      const target = cmd?.targetZone && spatial.getZone(cmd.targetZone) ? cmd.targetZone : planZone;
      const zone = areas.defense.has(planZone) ? planZone : SPAWN_ZONE.defense;
      goal = { zoneId: zone, mode: "run", spot: { kind: "stand" } };
      const watch = cmd?.aimZone && spatial.getZone(cmd.aimZone) ? cmd.aimZone : null;
      const look = spatial.getZone(watch ?? target);
      if (look && look.id !== zone) face = { x: look.position.x, y: look.position.y };
    } else {
      // attackers stack by role at the exit their first move leaves the spawn by
      const target = cmd?.targetZone && spatial.getZone(cmd.targetZone) ? cmd.targetZone : null;
      let exit: { x: number; y: number; z: number } | null = null;
      const anchor = target ? nav.anchorNode(target) : undefined;
      const spawnAnchor = nav.anchorNode(SPAWN_ZONE.attack);
      if (anchor !== undefined && spawnAnchor !== undefined) {
        const r = nav.findPath({ actorId: p.id, start: nav.nodePosition(spawnAnchor), destination: nav.nodePosition(anchor), movementMode: "run", routePreference: "FASTEST" });
        if (r.status === "SUCCESS") {
          for (const w of r.waypoints) if (w.node >= 0 && w.zoneId === SPAWN_ZONE.attack) exit = w.position;
          const after = r.waypoints.find((w) => w.zoneId !== SPAWN_ZONE.attack);
          if (after) face = { x: after.position.x, y: after.position.y };
        }
      }
      const depth = STACK_DEPTH[role ?? "none"] + STACK_JITTER * (rng() - 0.5);
      const spot = exit ? stackSpot(ex, nav, p.id, exit, depth) : -1;
      goal = spot >= 0
        ? { zoneId: SPAWN_ZONE.attack, mode: "run", spot: { kind: "at", position: nav.nodePosition(spot) } }
        : { zoneId: SPAWN_ZONE.attack, mode: "run", spot: { kind: "stand" } };
      if (target) planZone = target;
    }
    setups.push({ p, planZone });

    // when to leave for the setup: as late as being set `setMarginMs` before the barrier drops allows
    const dest = goalPoint(ex, nav, goal);
    const travel = dest ? runMs(side, p, dest) : 0;
    const latest = input.durationMs - (style?.buy.setMarginMs ?? 2500) - travel * (goal.mode === "walk" ? 2 : 1);
    let clock = buyMs;
    // idle wanders while there is time: a short walk to a free spot nearby, a moment there
    const wanders = style?.buy.wanders ?? 0;
    const radius = style?.buy.wanderRadius ?? 300;
    for (let i = 0; i < wanders; i++) {
      if (clock + WANDER_BUDGET_MS > latest) break;
      const near = nav.zoneNodes(p.zoneId).filter((n) => {
        const q = nav.nodePosition(n);
        const d = Math.hypot(q.x - p.position.x, q.y - p.position.y);
        return d > 150 && d < radius && !ex.blockers.nodeBlocked(n);
      });
      if (near.length === 0) break;
      const n = near[Math.floor(rng() * near.length)]!;
      steps.push({ kind: "goto", goal: { zoneId: p.zoneId, mode: "walk", spot: { kind: "at", position: nav.nodePosition(n) } }, until: "arrive" });
      clock += WANDER_BUDGET_MS * (0.5 + 0.5 * rng());
      steps.push({ kind: "stand", untilMs: Math.min(clock, latest) });
    }
    // a quiet player with time to spare walks to its setup
    const walk = (style?.quiet ?? 0) > 0.6 && latest - clock > travel + 1500;
    if (walk) goal = { ...goal, mode: "walk" };
    steps.push({ kind: "stand", untilMs: Math.max(clock, Math.min(latest, input.durationMs - travel * (walk ? 2 : 1) - 500)) });
    steps.push({ kind: "goto", goal });
    scripts.push({ p, steps, at: 0, started: -1, face });
  }

  // ---- run the phase ----
  const frames: TrackFrame[] = [];
  const ticks = Math.round(input.durationMs / input.tickMs);
  const hooks = { attack: hooksOf("attack"), defense: hooksOf("defense") };
  for (let t = 0; t < ticks; t++) {
    const nowMs = t * input.tickMs;
    for (const s of scripts) {
      const ex = exec[s.p.side];
      // advance the script
      for (;;) {
        const step = s.steps[s.at];
        if (!step) break;
        if (step.kind === "stand") { if (nowMs >= step.untilMs) { s.at++; continue; } break; }
        if (s.started !== s.at) {
          ex.stop(s.p);
          ex.setGoal(s.p, step.goal, hooks[s.p.side]);
          s.started = s.at;
        }
        if (step.until === "arrive" && !ex.isMoving(s.p)) { s.at++; continue; } // there (or no way there)
        break;
      }
      const mates = players.filter((q) => q.side === s.p.side);
      ex.step(s.p, input.tickMs, mates, hooks[s.p.side]);
      if (!ex.isMoving(s.p) && s.face && s.at >= s.steps.length - 1) {
        const fx = s.face.x - s.p.position.x, fy = s.face.y - s.p.position.y;
        if (fx !== 0 || fy !== 0) s.p.facing = { x: fx, y: fy };
      }
    }
    if (input.record) {
      frames.push({
        tick: t - ticks, elapsedMs: nowMs - input.durationMs,
        players: players.map((p) => {
          const fm = Math.hypot(p.facing.x, p.facing.y) || 1;
          return { id: p.id, side: p.side, x: p.position.x, y: p.position.y, z: p.position.z, alive: true, facing: { x: p.facing.x / fm, y: p.facing.y / fm }, gaze: exec[p.side].isMoving(p) ? "route" as const : "hold" as const };
        }),
      });
    }
  }
  for (const p of players) p.moveMode = "run";

  return {
    durationMs: input.durationMs,
    frames,
    setups: setups.map(({ p, planZone }) => ({ playerId: p.id, side: p.side, planZone, zoneId: p.zoneId })),
    areas: { attack: [...areas.attack], defense: [...areas.defense].sort() },
  };
}

/** The spawn node at about `depth` uu from the exit that no one has taken yet. */
function stackSpot(ex: MovementExecutor, nav: NonNullable<SpatialEngine["nav"]>, playerId: string, exit: { x: number; y: number; z: number }, depth: number): number {
  let best = -1, bestScore = Infinity;
  for (const n of nav.zoneNodes(SPAWN_ZONE.attack)) {
    if (ex.blockers.nodeBlocked(n) || !ex.spotFree(playerId, n)) continue;
    const q = nav.nodePosition(n);
    if (Math.abs(q.z - exit.z) > 160) continue;
    const sc = Math.abs(Math.hypot(q.x - exit.x, q.y - exit.y) - depth);
    if (sc < bestScore) { bestScore = sc; best = n; }
  }
  if (best >= 0) ex.reserve(playerId, best);
  return best;
}

/** Roughly where a goal will put the player (for the travel-time estimate). */
function goalPoint(ex: MovementExecutor, nav: NonNullable<SpatialEngine["nav"]>, goal: MoveGoal): { x: number; y: number; z: number } | null {
  if (goal.spot?.kind === "at") return goal.spot.position;
  const a = nav.anchorNode(goal.zoneId);
  void ex;
  return a === undefined ? null : nav.nodePosition(a);
}
