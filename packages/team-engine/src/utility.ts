/**
 * Utility decisions — when, where and why a team spends an ability.
 *
 * This is the only place utility is decided. The rule it enforces is simple: NO CAST WITHOUT A
 * PURPOSE THAT THE TEAM'S OWN OBSERVATION SUPPORTS. A cast is produced by one of four purposes,
 * each a general mechanism (none is an agent script — they are written against effect families and
 * the map, so any ability of the family is used the same way):
 *
 *   stall   Deny the door the enemy is coming through: fire / a slow field / a smoke on a zone
 *           next to one the team holds, when the team's evidence (seen enemies, heard footsteps,
 *           shots and casts — the same evidence the IGL's site read uses) says enemies are there.
 *           It costs the pusher health, time or sight; it does not decide the fight.
 *   cover   Hide a teammate's approach: a smoke on the zone a teammate is about to step into, when
 *           that zone is in open sight of a contested zone further along its route.
 *   blind   A flash on the zone a teammate is about to be exposed to — TIMED from the teammate's
 *           arrival so the blind still holds when it appears. This is what turns walking out of a
 *           smoke from a gamble into a play.
 *   scout   A recon on that same zone, late enough that the call is still fresh at contact.
 *
 * Everything an individual player or another part of the policy proposes (`useAbility` commands
 * already in the list) is treated as a REQUEST and has to pass the same purpose test; a request
 * with no target, or with a target that serves none of the purposes, is turned back into a hold.
 *
 * All functions are pure and deterministic: they read the PolicyView (no world state, no enemy
 * ground truth) and draw no random numbers. With no ability knowledge (abilities off) `planUtility`
 * returns the commands untouched.
 *
 * Numbers that are modelling assumptions rather than catalog facts are marked manual-approx.
 */
import type { ActionCommand, PolicyView, SpatialQuery, TeamStrategy, ZoneId } from "@pv/shared-types";

// ---------------------------------------------------------------------------------------------
// What the policy may know (optional view extensions the round-simulator provides)
// ---------------------------------------------------------------------------------------------

/** Public parameters of an ability the team carries (catalog facts; null = not catalogued). */
export interface UtilityAbilityFact {
  readonly effectType: string;
  readonly durationMs?: number | null;
  readonly flashDurationMs?: number | null;
  /** Catalogued throw range (world units); null/absent = not catalogued (reach then goes by the map, `withinReach`). */
  readonly rangeUnits?: number | null;
}

/**
 * Where a teammate is going: remaining waypoints (next first) and time until it enters the next.
 * `waitingAtEdge`: it is standing at the edge of a fire and will go when the fire is out —
 * `nextArrivalMs` is then the burn time left.
 */
export interface UtilityTransit {
  readonly path: readonly string[];
  readonly nextZone: string;
  readonly nextArrivalMs: number;
  readonly waitingAtEdge?: boolean;
}

/** An active effect the team knows of (its own, or an enemy one it can see). */
export interface UtilityKnownEffect {
  readonly zoneId: string;
  readonly effectType: string;
  readonly own: boolean;
  readonly remainingMs: number;
}

/** The PolicyView plus the optional fields this module reads when the simulator supplies them. */
export type UtilityView = PolicyView & {
  readonly abilityFacts?: Readonly<Record<string, UtilityAbilityFact>>;
  readonly visibleEffects?: readonly UtilityKnownEffect[];
};
type Teammate = PolicyView["teammates"][number] & { readonly transit?: UtilityTransit };

/** Ability effect lookup (abilityId → primary effect type), the fallback when the view carries no facts. */
export type EffectLookup = (abilityId: string) => string | undefined;

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** A remembered sighting fades to nothing over this long (same window as heard evidence). */
export const SEEN_EVIDENCE_WINDOW_MS = 8000;
/** A heard cue fades to nothing over this long (mirrors the IGL site read, igl.ts). */
export const SOUND_EVIDENCE_WINDOW_MS = 8000;
/** A fully confident heard cue is worth this fraction of an enemy actually seen (mirrors igl.ts). */
export const SOUND_EVIDENCE_WEIGHT = 0.6;
/**
 * Least evidence (in seen-enemy units) at the door that is worth one piece of utility: a running
 * footstep heard there (hearing threshold 0.45 × 0.6 = 0.27) already qualifies; a rotation needs
 * 2.0 (igl.ts). Spending one ability is a much smaller commitment than moving the team.
 */
export const STALL_EVIDENCE_MIN = 0.25;
/**
 * The blind must still hold one decision step after the entry appears (decisions come every
 * 500 ms): a flash is thrown when the teammate's exposure is at most (blind − this) away.
 */
export const FLASH_HOLD_MARGIN_MS = 500;
/** Blind assumed for a flash whose duration is not known to the policy (manual-approx). */
export const DEFAULT_BLIND_MS = 2000;
/**
 * A cover smoke goes up when the first teammate is at most this far from stepping into view: late
 * enough not to advertise the approach early, early enough to be standing before it arrives
 * (one decision step + a deploy time of about a second; manual-approx).
 */
export const SMOKE_CAST_LEAD_MS = 1500;
/**
 * A recon is thrown when contact is at most this far away, so the call is younger than one info
 * half-life (2000 ms, round-simulator infoWindowMs) when the teammate appears.
 */
export const RECON_LEAD_MS = 1500;

export type UtilityFamily = "flash" | "ground" | "vision" | "recon";
export type UtilityPurpose = "stall" | "cover" | "blind" | "scout";

const FAMILY_OF: Readonly<Record<string, UtilityFamily>> = {
  flash: "flash", concuss: "flash",
  molly: "ground", slow: "ground",
  smoke: "vision", wall: "vision",
  recon: "recon",
};
/** Order wants are served in: the time-critical ones first. */
const FAMILY_PRIORITY: Readonly<Record<UtilityFamily, number>> = { flash: 0, ground: 1, vision: 2, recon: 3 };

/** One thing the team wants an ability for, with the observation behind it. */
export interface UtilityWant {
  readonly purpose: UtilityPurpose;
  readonly family: UtilityFamily;
  readonly target: ZoneId;
  /** vision: the smoke must last at least this long to be worth throwing. */
  readonly minDurationMs?: number;
  /** blind: the teammate's exposure is this far away (a flash must outlast it). */
  readonly etaMs?: number;
  /** stall: other families that would serve when this one is not available, in order. */
  readonly fallback?: readonly UtilityFamily[];
  /**
   * cover: the zone (the team's lane) the smoke is there to hide from `target` (where the holders
   * are). Sent as the command's `screenZone`: the round simulator lands it where it cuts the most of
   * `target`'s view of the lane while keeping off the walkway (round-simulator screenPoint).
   */
  readonly screen?: ZoneId;
  readonly reason: string;
}

// ---------------------------------------------------------------------------------------------
// Reading the view
// ---------------------------------------------------------------------------------------------

const v2 = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });

/**
 * Enemy evidence per zone, in seen-enemy units: an enemy in sight counts 1, a remembered one fades
 * linearly over SEEN_EVIDENCE_WINDOW_MS, and heard cues (footsteps, gunfire, tracers, casts, seen
 * deployed utility) add their confidence × SOUND_EVIDENCE_WEIGHT, the firmest per zone counted once.
 * Zone-level and observation-only — the same quantities the IGL's site read is built from.
 */
export function enemyEvidenceByZone(view: PolicyView, spatial: SpatialQuery): Map<string, number> {
  const out = new Map<string, number>();
  const now = view.observation.timestampMs;
  for (const e of view.observation.visibleEnemies) {
    const zone = String(spatial.nearestZone(v2(e.lastSeenPosition)));
    const w = e.currentlyVisible ? 1 : Math.max(0, 1 - Math.abs(now - e.lastSeenAtMs) / SEEN_EVIDENCE_WINDOW_MS);
    if (w > 0) out.set(zone, (out.get(zone) ?? 0) + w);
  }
  const heard = new Map<string, number>();
  for (const s of view.observation.audibleEvents) {
    const zone = String(spatial.nearestZone(v2(s.approxPosition)));
    const age = Math.max(0, now - s.heardAtMs);
    const w = s.confidence * Math.max(0, 1 - age / SOUND_EVIDENCE_WINDOW_MS) * SOUND_EVIDENCE_WEIGHT;
    if (w > (heard.get(zone) ?? 0)) heard.set(zone, w);
  }
  for (const [zone, w] of heard) out.set(zone, (out.get(zone) ?? 0) + w);
  return out;
}

interface Carried {
  readonly abilityId: string;
  readonly family: UtilityFamily;
  readonly effectType: string;
  readonly durationMs: number | null;
  readonly blindMs: number;
  readonly rangeUnits: number | null;
}

interface Ctx {
  readonly view: UtilityView;
  readonly spatial: SpatialQuery;
  readonly alive: readonly Teammate[];
  readonly zoneOf: ReadonlyMap<string, ZoneId>;
  readonly evidence: ReadonlyMap<string, number>;
  readonly effects: readonly UtilityKnownEffect[];
  /** Sightline pairs currently cut by a smoke / wall the team knows of. */
  readonly smokedPairs: ReadonlyArray<readonly [ZoneId, ZoneId]>;
  /** Zones with a living teammate standing in them (not on a route). */
  readonly held: ReadonlySet<string>;
  /** Zones with any living teammate in them. */
  readonly occupied: ReadonlySet<string>;
  /** Zones a living teammate is on its way through (remaining route waypoints). */
  readonly routed: ReadonlySet<string>;
  readonly carried: (p: Teammate) => Carried[];
}

function buildCtx(view: UtilityView, spatial: SpatialQuery, effectOf?: EffectLookup): Ctx | null {
  const facts = view.abilityFacts;
  const factOf = (id: string): UtilityAbilityFact | undefined => {
    const f = facts?.[id];
    if (f) return f;
    const e = effectOf?.(id);
    return e ? { effectType: e } : undefined;
  };
  const alive = view.teammates.filter((p) => p.alive) as Teammate[];
  const carried = (p: Teammate): Carried[] => {
    const slots = [...p.abilities.basic, ...(p.abilities.signature ? [p.abilities.signature] : [])];
    const out: Carried[] = [];
    for (const a of slots) {
      if (a.charges <= 0) continue;
      const f = factOf(String(a.abilityId));
      const family = f ? FAMILY_OF[f.effectType] : undefined;
      if (!f || !family) continue;
      out.push({
        abilityId: String(a.abilityId), family, effectType: f.effectType,
        durationMs: f.durationMs ?? null,
        blindMs: f.flashDurationMs ?? f.durationMs ?? DEFAULT_BLIND_MS,
        rangeUnits: f.rangeUnits ?? null,
      });
    }
    return out;
  };
  // Abilities off (or no knowledge of what any ability does): nothing to decide.
  if (!effectOf && (!facts || Object.keys(facts).length === 0)) return null;

  const zoneOf = new Map<string, ZoneId>();
  const held = new Set<string>();
  const occupied = new Set<string>();
  const routed = new Set<string>();
  for (const p of alive) {
    const z = spatial.nearestZone(v2(p.position));
    zoneOf.set(String(p.id), z);
    occupied.add(String(z));
    if (!p.transit || p.transit.waitingAtEdge) held.add(String(z));
    for (const w of p.transit?.path ?? []) routed.add(String(w));
  }
  const effects = view.visibleEffects ?? [];
  const smokedPairs: Array<readonly [ZoneId, ZoneId]> = [];
  for (const e of effects) {
    if (e.effectType !== "smoke" && e.effectType !== "wall") continue;
    for (const n of spatial.visibleZonesFrom(e.zoneId as ZoneId)) smokedPairs.push([e.zoneId as ZoneId, n]);
  }
  return { view, spatial, alive, zoneOf, evidence: enemyEvidenceByZone(view, spatial), effects, smokedPairs, held, occupied, routed, carried };
}

/** Throw reach by the map: the caster's own zone, a zone next to it, or one it has a sightline onto. */
export function withinReach(spatial: SpatialQuery, from: ZoneId, to: ZoneId): boolean {
  if (from === to) return true;
  if (spatial.hasLineOfSight(from, to)) return true;
  return spatial.findPath(from, to, "run")?.path.length === 2;
}

/** Run speed in world units per ms (VALORANT base move speed 6.75 m/s). */
const RUN_UNITS_PER_MS = 0.675;

/**
 * Whether an ability reaches `to` from `from`: by the map (withinReach), or — when the catalog gives
 * a range — when the zones are surely within it. The run-route length (travel time × run speed) is
 * never shorter than the straight line, so a route that fits inside the range is a throw that does.
 */
export function abilityReaches(spatial: SpatialQuery, from: ZoneId, to: ZoneId, rangeUnits: number | null): boolean {
  if (withinReach(spatial, from, to)) return true;
  if (rangeUnits == null) return false;
  const t = spatial.shortestTravelTimeMs(from, to, "run");
  return t !== null && t * RUN_UNITS_PER_MS <= rangeUnits;
}

/** A zone the team does not hold and has a reason to expect enemies in. */
function contested(ctx: Ctx, zone: ZoneId): boolean {
  if (ctx.occupied.has(String(zone))) return false;
  if ((ctx.evidence.get(String(zone)) ?? 0) > 0) return true;
  const phase = ctx.view.spike.phase;
  // The side that has to take a zone assumes it is defended: the attack a plant site before the
  // plant, the defense the planted site after it.
  if (ctx.view.side === "attack" && (phase === "carried" || phase === "dropped")) return ctx.spatial.isPlantableZone(zone);
  if (ctx.view.side === "defense" && (phase === "planted" || phase === "defusing") && ctx.view.spike.position) {
    return ctx.spatial.nearestZone(v2(ctx.view.spike.position)) === zone;
  }
  return false;
}

const prePlantPhase = (v: PolicyView): boolean => v.spike.phase === "carried" || v.spike.phase === "dropped" || v.spike.phase === "planting";
const openSight = (ctx: Ctx, a: ZoneId, b: ZoneId): boolean => ctx.spatial.hasLineOfSight(a, b, { smokedPairs: ctx.smokedPairs });
const hasOwn = (ctx: Ctx, zone: ZoneId, family: UtilityFamily): boolean =>
  ctx.effects.some((e) => e.own && e.zoneId === zone && FAMILY_OF[e.effectType] === family);

// ---------------------------------------------------------------------------------------------
// Purposes → wants
// ---------------------------------------------------------------------------------------------

/**
 * STALL. A zone qualifies when (a) the team's evidence of enemies in it is at least
 * STALL_EVIDENCE_MIN, (b) it is at the team's door — next to, or in sight of, a zone a teammate is
 * standing in — (c) no teammate is in it, and (d) the team is not already denying it. One denial
 * at a time: when it burns out and the evidence is still there, the next one goes, so several
 * abilities chain into a longer delay instead of being stacked on one moment.
 */
export function stallWants(ctx: Ctx): UtilityWant[] {
  const wants: UtilityWant[] = [];
  for (const [zone, ev] of [...ctx.evidence.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ev < STALL_EVIDENCE_MIN) continue;
    const z = zone as ZoneId;
    if (ctx.occupied.has(zone)) continue;
    // Never deny a zone the team itself has to go through: one a teammate is routed through, or —
    // for the attack before the plant — a site it has to take.
    if (ctx.routed.has(zone)) continue;
    if (ctx.view.side === "attack" && prePlantPhase(ctx.view) && ctx.spatial.isPlantableZone(z)) continue;
    const atDoor = [...ctx.held].some((h) => withinReach(ctx.spatial, h as ZoneId, z));
    if (!atDoor) continue;
    if (hasOwn(ctx, z, "ground") || hasOwn(ctx, z, "vision")) continue;
    wants.push({
      purpose: "stall", family: "ground", fallback: ["vision"], target: z,
      reason: `enemy evidence ${ev.toFixed(2)} at ${zone}, next to a zone we hold`,
    });
  }
  return wants;
}

/** Where and when a teammate on a route becomes visible to a contested zone. */
interface Exposure {
  readonly moverId: string;
  /** Zone whose occupants will see the mover. */
  readonly watchedFrom: ZoneId;
  readonly etaMs: number;
}

function exposures(ctx: Ctx): Exposure[] {
  const out: Exposure[] = [];
  for (const p of ctx.alive) {
    const t = p.transit;
    if (!t || t.path.length === 0) continue;
    const next = t.nextZone as ZoneId;
    // On arrival, whoever is in that zone sees the mover. (A mover held up at a fire's edge
    // arrives when the fire is out — its ETA is the burn time left, so utility is re-timed to that.)
    if (contested(ctx, next)) out.push({ moverId: String(p.id), watchedFrom: next, etaMs: t.nextArrivalMs });
    // Stepping into `next` also puts the mover in open sight of the zone after it.
    const after = t.path[1] as ZoneId | undefined;
    if (after && contested(ctx, after) && openSight(ctx, next, after)) out.push({ moverId: String(p.id), watchedFrom: after, etaMs: t.nextArrivalMs });
  }
  return out;
}

/**
 * COVER. A teammate is about to step into a zone that lies in open sight of the contested zone
 * after it on its route. The smoke is thrown INTO the contested zone, to screen the step zone off
 * from it (`target` = where the watchers are, `screen` = the lane): the round simulator puts it
 * where it cuts the most of the watchers' view of the lane while keeping off the walkway, so the
 * team walks into the site beside the smoke rather than out of it into a held angle. Thrown only
 * when the smoke would still stand when the teammate reaches the far side (duration ≥ time to the
 * zone + the crossing).
 */
export function coverWants(ctx: Ctx): UtilityWant[] {
  const best = new Map<string, UtilityWant>();
  for (const p of ctx.alive) {
    const t = p.transit;
    if (!t || t.waitingAtEdge || t.path.length < 2) continue;
    const step = t.nextZone as ZoneId;
    const far = t.path[1] as ZoneId;
    if (t.nextArrivalMs > SMOKE_CAST_LEAD_MS) continue;
    if (!contested(ctx, far) || !openSight(ctx, step, far)) continue;
    // Only a smokeable sightline can be cut.
    if (ctx.spatial.hasLineOfSight(step, far, { smokedPairs: [[step, far]] })) continue;
    const cross = ctx.spatial.shortestTravelTimeMs(step, far, "run") ?? 0;
    const need = t.nextArrivalMs + cross;
    const prev = best.get(step);
    if (!prev || need > (prev.minDurationMs ?? 0)) {
      best.set(step, {
        purpose: "cover", family: "vision", target: far, screen: step, minDurationMs: need,
        reason: `${String(p.id)} steps into ${step} in ${Math.round(t.nextArrivalMs)}ms, in open sight of ${far}`,
      });
    }
  }
  return [...best.values()];
}

/**
 * BLIND and SCOUT. For each contested zone a teammate is about to become visible to, the soonest
 * exposure sets the clock: a flash goes when the exposure is within (blind − FLASH_HOLD_MARGIN_MS),
 * a recon when it is within RECON_LEAD_MS. Neither is repeated on a zone the team is already
 * flashing / has already revealed.
 */
export function entryWants(ctx: Ctx): UtilityWant[] {
  const soonest = new Map<string, Exposure>();
  for (const e of exposures(ctx)) {
    const prev = soonest.get(e.watchedFrom);
    if (!prev || e.etaMs < prev.etaMs || (e.etaMs === prev.etaMs && e.moverId < prev.moverId)) soonest.set(e.watchedFrom, e);
  }
  const wants: UtilityWant[] = [];
  for (const [zone, e] of [...soonest.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const z = zone as ZoneId;
    if (!hasOwn(ctx, z, "flash")) {
      wants.push({ purpose: "blind", family: "flash", target: z, etaMs: e.etaMs, reason: `${e.moverId} is exposed to ${zone} in ${Math.round(e.etaMs)}ms` });
    }
    const seenNow = ctx.view.observation.visibleEnemies.some((o) => o.currentlyVisible && ctx.spatial.nearestZone(v2(o.lastSeenPosition)) === z);
    if (e.etaMs <= RECON_LEAD_MS && !seenNow && !hasOwn(ctx, z, "recon")) {
      wants.push({ purpose: "scout", family: "recon", target: z, reason: `${e.moverId} is exposed to ${zone} in ${Math.round(e.etaMs)}ms with no eyes on it` });
    }
  }
  return wants;
}

/**
 * DENY THE DEFUSE. Attack after the plant: when a defuse has started, or the team has evidence of
 * defenders in the spike's zone, fire / a slow field onto the spike (the simulator lands a ground
 * ability thrown into the spike's zone on the spike itself). One at a time, like a stall.
 */
export function defuseDenyWants(ctx: Ctx): UtilityWant[] {
  const v = ctx.view;
  if (v.side !== "attack" || !(v.spike.phase === "planted" || v.spike.phase === "defusing") || !v.spike.position) return [];
  const z = ctx.spatial.nearestZone(v2(v.spike.position));
  const contact = v.spike.phase === "defusing" || (ctx.evidence.get(String(z)) ?? 0) >= STALL_EVIDENCE_MIN;
  if (!contact || hasOwn(ctx, z, "ground")) return [];
  return [{ purpose: "stall", family: "ground", target: z, reason: `deny the defuse at ${String(z)}` }];
}

/** Everything the team wants an ability for right now, most time-critical first. */
export function utilityWants(view: PolicyView, spatial: SpatialQuery, effectOf?: EffectLookup): UtilityWant[] {
  const ctx = buildCtx(view as UtilityView, spatial, effectOf);
  return ctx ? orderedWants(ctx) : [];
}

function orderedWants(ctx: Ctx): UtilityWant[] {
  return [...entryWants(ctx), ...stallWants(ctx), ...coverWants(ctx)].sort(
    (a, b) => FAMILY_PRIORITY[a.family] - FAMILY_PRIORITY[b.family] || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  );
}

// ---------------------------------------------------------------------------------------------
// Wants → casts
// ---------------------------------------------------------------------------------------------

/** The ability of `family` this player would use for `want`, or null when it has none that serves. */
function abilityFor(ctx: Ctx, p: Teammate, want: UtilityWant, family: UtilityFamily): Carried | null {
  let best: Carried | null = null;
  for (const a of ctx.carried(p)) {
    if (a.family !== family) continue;
    if (family === "flash") {
      // The blind has to outlast the wait for the teammate to appear, with a margin.
      if ((want.etaMs ?? 0) > a.blindMs - FLASH_HOLD_MARGIN_MS) continue;
      if (!best || a.blindMs > best.blindMs) best = a;
    } else if (family === "vision") {
      if (want.minDurationMs !== undefined && a.durationMs !== null && a.durationMs < want.minDurationMs) continue;
      // Cover: the shortest smoke that is long enough (keep the long one). Stall: the longest.
      const d = a.durationMs ?? Number.POSITIVE_INFINITY;
      const bd = best ? best.durationMs ?? Number.POSITIVE_INFINITY : null;
      if (bd === null || (want.purpose === "cover" ? d < bd : d > bd)) best = a;
    } else if (family === "ground") {
      // Fire before a slow field; the longer-lasting of a kind first.
      const rank = (c: Carried) => (c.effectType === "molly" ? 1e9 : 0) + (c.durationMs ?? 0);
      if (!best || rank(a) > rank(best)) best = a;
    } else if (!best) best = a;
  }
  return best;
}

/**
 * Turn the commands the rest of the policy produced into the commands the team will issue:
 *  1. every `useAbility` already in the list is a request — one with a target and a movement /
 *     non-placed effect is left alone, every other one is dropped back to a hold unless a want
 *     below re-issues it;
 *  2. each want is given the teammate best placed to serve it (in reach, not in a fight, not
 *     planting / defusing / carrying the spike before the plant) — for a flash, the one whose own
 *     exposure is furthest away, so the thrower is not the one walking out with its gun down.
 * One cast per player and one per (zone, family) per decision.
 */
export function planUtility(
  view: PolicyView,
  strategy: TeamStrategy,
  commands: readonly ActionCommand[],
  spatial: SpatialQuery,
  effectOf?: EffectLookup,
  opts: { readonly groundReserve?: number; readonly denyDefuse?: boolean } = {},
): ActionCommand[] {
  const ctx = buildCtx(view as UtilityView, spatial, effectOf);
  if (!ctx) return commands.slice();
  const factOf = (id: string): string | undefined => (view as UtilityView).abilityFacts?.[id]?.effectType ?? effectOf?.(id);

  // 1. Requests: keep only what is not a placement decision of ours.
  const out: ActionCommand[] = commands.map((c) => {
    if (c.kind !== "useAbility") return c;
    const effect = c.abilityId ? factOf(String(c.abilityId)) : undefined;
    const placed = effect !== undefined && FAMILY_OF[effect] !== undefined;
    if (!placed && c.targetZone) return c; // a targeted dash / other effect: not ours to judge
    return { playerId: c.playerId, kind: "hold", executeAtMs: 0, sourceActionId: "utility:no-purpose" };
  });
  if (strategy === "save") return out; // a saving team spends nothing

  // 2. Wants → casters.
  const fighting = (zone: ZoneId): boolean =>
    view.observation.visibleEnemies.some((e) => e.currentlyVisible && spatial.nearestZone(v2(e.lastSeenPosition)) === zone);
  const holderId = view.spike.holderId ? String(view.spike.holderId) : null;
  const prePlant = view.spike.phase === "carried" || view.spike.phase === "dropped" || view.spike.phase === "planting";
  const busy = new Set<string>();
  for (const c of out) if (c.kind === "plant" || c.kind === "defuse") busy.add(String(c.playerId));
  if (holderId && view.side === "attack" && prePlant) busy.add(holderId);
  const ownExposure = new Map<string, number>();
  for (const e of exposures(ctx)) ownExposure.set(e.moverId, Math.min(ownExposure.get(e.moverId) ?? Infinity, e.etaMs));

  // ATTACK before the plant: ground charges the post-plant plan keeps for the spike
  // (PostPlantPlan.utility; opts.groundReserve) are not spent now.
  let groundLeft = ctx.alive.reduce((n, p) => n + ctx.carried(p).filter((c) => c.family === "ground").length, 0);
  const reserve = view.side === "attack" && prePlant ? opts.groundReserve ?? 0 : 0;
  const served = new Set<string>();
  for (const want of [...orderedWants(ctx), ...(opts.denyDefuse ? defuseDenyWants(ctx) : [])]) {
    const key = `${want.target}`;
    if (want.purpose !== "blind" && want.purpose !== "scout" && served.has(key)) continue; // one denial / cover per zone
    let pick: { p: Teammate; a: Carried; score: number } | null = null;
    for (const family of [want.family, ...(want.fallback ?? [])]) {
      for (const p of ctx.alive) {
        const id = String(p.id);
        if (busy.has(id)) continue;
        const pz = ctx.zoneOf.get(id)!;
        if (fighting(pz)) continue; // reach is checked per ability below (abilityReaches)
        if (family === "ground" && groundLeft - 1 < reserve) continue;
        const a = abilityFor(ctx, p, want, family);
        if (!a || !abilityReaches(spatial, pz, want.target, a.rangeUnits)) continue;
        // Flash: the caster whose own exposure is furthest off. Otherwise: the nearest one.
        const score = family === "flash"
          ? -(ownExposure.get(id) ?? Number.POSITIVE_INFINITY)
          : pz === want.target ? 0 : spatial.shortestTravelTimeMs(pz, want.target, "run") ?? Number.POSITIVE_INFINITY;
        if (!pick || score < pick.score || (score === pick.score && id < String(pick.p.id))) pick = { p, a, score };
      }
      if (pick) break;
    }
    if (!pick) continue;
    if (pick.a.family === "ground") groundLeft--;
    busy.add(String(pick.p.id));
    if (want.purpose !== "blind" && want.purpose !== "scout") served.add(key);
    const cmd: ActionCommand = {
      playerId: pick.p.id, kind: "useAbility", abilityId: pick.a.abilityId as ActionCommand["abilityId"], targetZone: want.target,
      ...(want.screen ? { screenZone: want.screen } : {}),
      executeAtMs: 0, sourceActionId: `utility:${want.purpose}:${pick.a.effectType}`,
    };
    const idx = out.findIndex((c) => String(c.playerId) === String(pick!.p.id));
    if (idx >= 0) out[idx] = cmd;
    else out.push(cmd);
  }
  return out;
}
