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
import { tendencyLean, type OpponentRead } from "./opponent-model.js";

/** Team bank at/under this is treated as an eco (no full buy). Provisional. */
export const ECO_BANK_THRESHOLD = 2000;

export function profileFor(
  playerId: PlayerId,
  profiles?: ReadonlyMap<string, PlayerProfile>,
): PlayerProfile {
  return profiles?.get(String(playerId)) ?? { playerId, ...NEUTRAL_PROFILE };
}

/** Pistol rounds (first round of each half): both sides are equally poor — not an eco. */
function isPistolRound(view: PolicyView): boolean {
  return view.roundNumber === 1 || view.roundNumber === 13;
}

function isEco(view: PolicyView): boolean {
  return !isPistolRound(view) && view.economy.credits <= ECO_BANK_THRESHOLD;
}

const v2 = (v: Vector3) => ({ x: v.x, y: v.y });

/** ATTACK: site-read lead (in seen-enemy units) that justifies swinging off a stacked site mid-round. */
const ROTATE_EVIDENCE = 2;
/** A heard cue fades to nothing over this long. */
const SOUND_EVIDENCE_WINDOW_MS = 8000;
/** A fully confident heard cue is worth this fraction of an enemy actually seen on the site. */
const SOUND_EVIDENCE_WEIGHT = 0.6;
/** Ceiling on what sound alone can add to a site read (several zones of noise ≈ a seen push). */
const SOUND_EVIDENCE_CAP = 1.2;
/** How far a fully confident opponent tendency can tilt an opening call (multiplier on its weight). */
const TENDENCY_WEIGHT = 3;

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
  // Heard / inferred contact (footsteps, gunfire, tracers): unseen enemies still leave evidence.
  // Per ZONE the firmest cue counts once (several sounds from one spot are not several enemies);
  // noise from several zones of a site adds up — a team massing on a site is louder than one
  // lurker — up to SOUND_EVIDENCE_CAP. Each cue is weighted by confidence and fades over
  // SOUND_EVIDENCE_WINDOW_MS; a single cue is never worth a sighting.
  const heard = { A: new Map<string, number>(), B: new Map<string, number>() };
  for (const s of view.observation.audibleEvents) {
    const zone = spatial.nearestZone(v2(s.approxPosition));
    const site = siteOfZone(zone);
    if (!site) continue;
    const age = Math.max(0, view.observation.timestampMs - s.heardAtMs);
    const w = s.confidence * Math.max(0, 1 - age / SOUND_EVIDENCE_WINDOW_MS);
    heard[site].set(String(zone), Math.max(heard[site].get(String(zone)) ?? 0, w));
  }
  const total = (m: Map<string, number>) => Math.min(SOUND_EVIDENCE_CAP, [...m.values()].reduce((s, w) => s + w, 0) * SOUND_EVIDENCE_WEIGHT);
  bias.A += total(heard.A);
  bias.B += total(heard.B);
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

/**
 * Choose the round's opening strategy. Eco and full buys yield clearly different plans. `read` is
 * what the team has learned about the opponent in earlier rounds (opponent-model.ts): a tendency
 * tilts the weights in proportion to its confidence and never removes an option, so the call stays
 * a sample — a small sample barely moves it, and a team is never fully predictable itself.
 */
export function selectStrategy(view: PolicyView, spatial: SpatialQuery, rng: RandomSource, read?: OpponentRead): TeamStrategy {
  const planted = view.spike.phase === "planted";
  const bias = enemySiteBias(view, spatial);

  if (view.side === "defense") {
    if (planted) return "retake";
    if (isEco(view)) return "defaultHold";
    // Lean toward the site the enemy is showing; otherwise hold or push.
    if (bias.A > bias.B + 0.5) return "stackA";
    if (bias.B > bias.A + 0.5) return "stackB";
    // No read this round yet: fall back on where they have attacked before.
    const leanA = read ? tendencyLean(read.attackSite, "A") : 0;
    return weightedPick(rng, [
      ["defaultHold", 2],
      ["aggroPush", 1],
      ["stackA", TENDENCY_WEIGHT * Math.max(0, leanA)],
      ["stackB", TENDENCY_WEIGHT * Math.max(0, -leanA)],
    ] as const);
  }

  // Attack
  if (isEco(view)) return "default"; // conservative: gather info, play for picks
  // Full buy: commit. Prefer the LESS defended site; fake the more defended one. What we see this
  // round counts first; where their defenders have tended to be is the prior behind it.
  const defA = read ? tendencyLean(read.defenseSite, "A") : 0; // > 0: they favour defending A
  const aWeight = (1 + Math.max(0, bias.B - bias.A)) * (1 + TENDENCY_WEIGHT * Math.max(0, -defA));
  const bWeight = (1 + Math.max(0, bias.A - bias.B)) * (1 + TENDENCY_WEIGHT * Math.max(0, defA));
  return weightedPick(rng, [
    ["aExecute", aWeight],
    ["bExecute", bWeight],
    ["midControl", 0.8],
    ["fakeAtoB", (bias.A > bias.B ? 0.9 : 0.3) * (1 + TENDENCY_WEIGHT * Math.max(0, defA))],
    ["fakeBtoA", (bias.B > bias.A ? 0.9 : 0.3) * (1 + TENDENCY_WEIGHT * Math.max(0, -defA))],
  ] as const);
}

export interface Reconsideration {
  readonly strategy: TeamStrategy;
  readonly changed: boolean;
  readonly reason: string;
}

/**
 * Re-decide mid-round when new information arrives (README §24.1 call changes): defenders
 * call the retake when the spike goes down (their pre-plant rotation is belief-driven, see
 * hit-belief.ts); attackers swing away from a stacked site.
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
  // How decisive the read must be to change the call: two enemies' worth of evidence on one
  // side (two seen, or one seen plus noise). One sighting is a lurker or a fake until proven.
  const strong = ROTATE_EVIDENCE;

  if (view.side === "defense") {
    if (planted && prev !== "retake") {
      return { strategy: "retake", changed: true, reason: "spike planted — retake call" };
    }
    // Where the hit is coming, and how many to send, is not a threshold on a site count any more:
    // the policy keeps a Bayesian belief over hit / fake / nothing (hit-belief.ts) and rotates in
    // proportion to it (TeamDecisionPolicy.commitDefenseRotation), recording each change on the plan.
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

/**
 * Deterministically assign roles to alive teammates (README §23 role understanding).
 *
 * The lurker is DESIGNATED once: the least aggressive player of the whole roster (alive or not).
 * It is not "whoever is last among the living" — otherwise each time the lurker died the next
 * most passive player would peel off the team in turn, and a five-man attack would trickle away
 * one lurker at a time. A dead lurker is not replaced, and a team that is down to three does not
 * keep one (the designated player rejoins as support).
 */
export function assignRoles(
  view: PolicyView,
  strategy: TeamStrategy,
  profiles: ReadonlyMap<string, PlayerProfile> | undefined,
  _rng: RandomSource,
): RoleAssignment[] {
  const byAggression = (a: { id: PlayerId; profile: PlayerProfile }, b: { id: PlayerId; profile: PlayerProfile }) =>
    b.profile.aggression - a.profile.aggression || (a.id < b.id ? -1 : 1);
  const roster = view.teammates.map((p) => ({ id: p.id, alive: p.alive, profile: profileFor(p.id, profiles) })).sort(byAggression);
  const alive = roster.filter((p) => p.alive);
  const designatedLurker = roster.length > 0 ? roster[roster.length - 1]!.id : null;

  const roles: RoleAssignment[] = [];
  const attack = view.side === "attack";
  alive.forEach(({ id }, i) => {
    let role: RoleAssignment["role"];
    if (attack) {
      if (i === 0) role = "entry";
      else if (id === designatedLurker && (strategy.startsWith("lurk") || alive.length >= 4)) role = "lurker";
      else if (i === 1 || i === alive.length - 1) role = "support";
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
