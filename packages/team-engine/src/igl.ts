/**
 * IGL — team strategy selection, role assignment, and mid-round re-decision
 * (README §24.1, Handoff §16). Pure and deterministic given the view, profiles and RNG.
 *
 * Reads only the team-observable view (own players + observation/belief); never enemy
 * ground truth. Strategy depends on economy (eco vs full → different plans), spike state,
 * and where the team BELIEVES enemies are (not where they truly are).
 */
import type {
  PlayerId,
  PlayerProfile,
  PolicyView,
  RandomSource,
  RoleAssignment,
  SpatialQuery,
  TeamStrategy,
  Vector3,
  ZoneId,
} from "@pv/shared-types";
import { NEUTRAL_PROFILE } from "@pv/shared-types";

/** Team bank at/under this is treated as an eco (no full buy). Provisional. */
export const ECO_BANK_THRESHOLD = 2000;

export function profileFor(
  playerId: PlayerId,
  profiles?: ReadonlyMap<string, PlayerProfile>,
): PlayerProfile {
  return profiles?.get(String(playerId)) ?? { playerId, ...NEUTRAL_PROFILE };
}

function isEco(view: PolicyView): boolean {
  return view.economy.credits <= ECO_BANK_THRESHOLD;
}

const v2 = (v: Vector3) => ({ x: v.x, y: v.y });

/** Which half (A/B) a zone belongs to, by id prefix; mid/other → null. */
function siteOfZone(zone: ZoneId): "A" | "B" | null {
  const s = String(zone);
  if (s.startsWith("a-")) return "A";
  if (s.startsWith("b-")) return "B";
  return null;
}

/** Believed/observed enemy bias toward each site, from observation + belief zones. */
export function enemySiteBias(view: PolicyView, spatial: SpatialQuery): { A: number; B: number } {
  const bias = { A: 0, B: 0 };
  for (const e of view.observation.visibleEnemies) {
    const site = siteOfZone(spatial.nearestZone(v2(e.lastSeenPosition)));
    if (site) bias[site] += 1;
  }
  for (const b of view.belief.enemyPositionBeliefs) {
    for (const h of b.hypotheses) {
      const site = siteOfZone(spatial.nearestZone(v2(h.position)));
      if (site) bias[site] += h.weight * 0.5;
    }
  }
  return bias;
}

function weightedPick<T>(rng: RandomSource, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return entries[0]![0];
  let r = rng.nextFloat() * total;
  for (const [value, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

/** Choose the round's opening strategy. Eco and full buys yield clearly different plans. */
export function selectStrategy(view: PolicyView, spatial: SpatialQuery, rng: RandomSource): TeamStrategy {
  const planted = view.spike.phase === "planted";
  const bias = enemySiteBias(view, spatial);

  if (view.side === "defense") {
    if (planted) return "retake";
    if (isEco(view)) return "defaultHold";
    // Lean toward the site the enemy is showing; otherwise hold or push.
    if (bias.A > bias.B + 0.5) return "stackA";
    if (bias.B > bias.A + 0.5) return "stackB";
    return weightedPick(rng, [
      ["defaultHold", 2],
      ["aggroPush", 1],
    ] as const);
  }

  // Attack
  if (isEco(view)) return "default"; // conservative: gather info, play for picks
  // Full buy: commit. Prefer the LESS defended site; fake the more defended one.
  const aWeight = 1 + Math.max(0, bias.B - bias.A); // A looks safer when enemies lean B
  const bWeight = 1 + Math.max(0, bias.A - bias.B);
  return weightedPick(rng, [
    ["aExecute", aWeight],
    ["bExecute", bWeight],
    ["midControl", 0.8],
    ["fakeAtoB", bias.A > bias.B ? 0.9 : 0.3],
    ["fakeBtoA", bias.B > bias.A ? 0.9 : 0.3],
  ] as const);
}

export interface Reconsideration {
  readonly strategy: TeamStrategy;
  readonly changed: boolean;
  readonly reason: string;
}

/**
 * Re-decide mid-round when new information arrives (README §24.1 call changes). If the
 * enemy is now clearly committed to a site, defenders rotate/stack toward it (or retake a
 * planted site); attackers swing away from a stacked site.
 */
export function reconsider(
  view: PolicyView,
  spatial: SpatialQuery,
  prev: TeamStrategy,
  rng: RandomSource,
): Reconsideration {
  const planted = view.spike.phase === "planted";
  const bias = enemySiteBias(view, spatial);
  const lean = bias.A - bias.B;
  const strong = 1; // how decisive the read must be to change the call

  if (view.side === "defense") {
    if (planted && prev !== "retake") {
      return { strategy: "retake", changed: true, reason: "spike planted — retake call" };
    }
    if (lean >= strong && prev !== "stackA") {
      return { strategy: "stackA", changed: true, reason: "enemies reading A — rotate/stack A" };
    }
    if (-lean >= strong && prev !== "stackB") {
      return { strategy: "stackB", changed: true, reason: "enemies reading B — rotate/stack B" };
    }
    return { strategy: prev, changed: false, reason: "no decisive new info" };
  }

  // Attack: swing off a site that is now heavily defended (per belief/observation).
  if (prev === "aExecute" && lean >= strong) {
    return { strategy: "bExecute", changed: true, reason: "A is stacked — swing to B" };
  }
  if (prev === "bExecute" && -lean >= strong) {
    return { strategy: "aExecute", changed: true, reason: "B is stacked — swing to A" };
  }
  return { strategy: prev, changed: false, reason: "committing to plan" };
}

/** Deterministically assign roles to alive teammates (README §23 role understanding). */
export function assignRoles(
  view: PolicyView,
  strategy: TeamStrategy,
  profiles: ReadonlyMap<string, PlayerProfile> | undefined,
  _rng: RandomSource,
): RoleAssignment[] {
  const alive = view.teammates
    .filter((p) => p.alive)
    .map((p) => ({ id: p.id, profile: profileFor(p.id, profiles) }))
    .sort((a, b) => b.profile.aggression - a.profile.aggression || (a.id < b.id ? -1 : 1));

  const roles: RoleAssignment[] = [];
  const attack = view.side === "attack";
  alive.forEach(({ id }, i) => {
    let role: RoleAssignment["role"];
    if (attack) {
      if (i === 0) role = "entry";
      else if (i === alive.length - 1) role = strategy.startsWith("lurk") || alive.length >= 4 ? "lurker" : "support";
      else if (i === 1) role = "support";
      else role = "rotator";
    } else {
      if (i === 0 && strategy === "aggroPush") role = "entry";
      else if (i <= 1) role = "anchor";
      else role = "rotator";
    }
    roles.push({ playerId: id, role });
  });
  return roles;
}
