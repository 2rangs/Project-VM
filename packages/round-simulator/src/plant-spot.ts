// PROJECT V — where the spike goes down (docs/ENGINE_TRUTH.md §12).
//
// The spot is a decision with consequences: it sets how exposed the defuser is, which angles the
// retake has to clear, how long the retake takes to reach it, and where the attack can watch it
// from. This module derives a site's candidate spots from the map, measures those four things for
// each, and chooses one — by the carrier's game sense times the situation, or by the manager's
// pre-match preference.
//
// Candidates (all on the site's plant area, roadmap nodes; derived, never authored):
//   default / safe / open   spatial-engine spots.ts (most seen from the attack's main entry /
//                           least exposed / most exposed)
//   cover-<R>               per retake entry R (a neighbour of the site the defenders reach first):
//                           the plant-area node R's standing points see least (ties: less exposed)
//                           — the spike behind cover from that way in, so the retake coming
//                           through R has to walk onto the site to see the defuser
//   near-<E>                per attack entry E: the plant-area node nearest E's anchor — the quick
//                           plant for an attack coming in through E
//   Candidates on the same node are one spot (the first kind listed keeps it).
//
// Measured per candidate c at node n:
//   retakeSight(c, R)  standing points of retake entry R that see n (sightInto(n, R))
//   guardSight(c)      standing points of the attack's entries (tactics.entries) that see n — where
//                      the attack can watch the defuser from without standing on the site
//   retakeReachMs(c, R) run time defender-spawn → R, then R's anchor → n in a straight line
//
// Choice (auto), for the carrier p with gameSense g ∈ [0,1], over candidates C:
//   U(c) = g · ( (1−λ)·hidden(c) + λ·support(c) + delay(c) ) / 2  −  reach(c) / slack
//     λ          = A / (A + D), living attackers and defenders: with the numbers the spike goes
//                  where the team can crossfire it, short-handed where the retake cannot see it
//     hidden(c)  = 1 − Σ_R w_R · retakeSight(c, R) / max_C Σ_R w_R · retakeSight      (defuser unseen from the retake)
//     support(c) = share of living teammates with line of sight to n; when no teammate sees any
//                  candidate yet, guardSight(c) / max_C guardSight                   (crossfire on the defuser)
//     delay(c)   = min_R retakeReachMs(c, R) / max_C min_R retakeReachMs             (retake arrives later)
//     w_R        = retake likelihood of R: (t_min / t_R) + believed threat in R, normalised
//     reach(c)   = carrier's straight-line run time to n
//     slack      = the plant window: time left on the round clock minus the plant itself, capped
//                  by the soonest the retake reaches any candidate (min_C min_R retakeReachMs)
//   So a carrier with the clock running out plants where it stands; a carrier with time and game
//   sense plants for the post-plant. No term is a flat bonus: each is a measured share times g.
// Manager preference (MatchConfig teamInputs plantPreference, per site letter):
//   "auto" / absent → U;  "default" | "safe" | "open" | "cover" | "near" → the best-U candidate of that kind;
//   a spot id → that candidate. A preferred spot the carrier cannot reach and plant before the
//   round clock runs out (reach > slack) falls back to U.
import { deriveMapTactics, type SpatialEngine } from "@pv/spatial-engine";

import type { PlantChoice, PlantPreferences, PlantSpotKind } from "@pv/shared-types";
export type { PlantChoice, PlantPreferences, PlantSpotKind };

export interface PlantCandidate {
  /** `<site zone>/plant/<kind>` or `<site zone>/plant/cover-<retake entry>`. */
  readonly id: string;
  readonly kind: PlantSpotKind;
  readonly site: string;
  readonly zone: string;
  readonly node: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** For a cover spot: the retake entry it hides from; for a near spot: the attack entry it is nearest. */
  readonly hiddenFrom?: string;
  readonly exposure: number;
  /** Standing points of each retake entry that see the spot. */
  readonly retakeSight: Readonly<Record<string, number>>;
  /** Standing points of the attack's entries that see the spot. */
  readonly guardSight: number;
  /** Run time from defender spawn to the spot through each retake entry (ms). */
  readonly retakeReachMs: Readonly<Record<string, number>>;
}

export interface SitePlantSpots {
  readonly site: string;
  readonly zone: string;
  /** Neighbours of the site the defenders reach first: the ways a retake comes in. */
  readonly retakeEntries: readonly string[];
  /** The ways the attack comes in (tactics.entries). */
  readonly attackEntries: readonly string[];
  readonly candidates: readonly PlantCandidate[];
}

const RUN_UNITS_PER_MS = 0.675; // 6.75 m/s × 100 uu/m (game-rules run speed)

const cache = new WeakMap<SpatialEngine, ReadonlyMap<string, SitePlantSpots>>();

/** Every site's plant candidates, by site zone (empty without a roadmap and sight table). Cached per engine. */
export function plantSpotsOf(spatial: SpatialEngine): ReadonlyMap<string, SitePlantSpots> {
  const hit = cache.get(spatial);
  if (hit) return hit;
  const out = new Map<string, SitePlantSpots>();
  const nav = spatial.nav;
  if (nav && nav.hasVisibility) {
    const tactics = deriveMapTactics(spatial);
    const tD = (z: string): number | null => (z === "defender-spawn" ? 0 : spatial.shortestTravelTimeMs("defender-spawn", z, "run"));
    const tA = (z: string): number | null => (z === "attacker-spawn" ? 0 : spatial.shortestTravelTimeMs("attacker-spawn", z, "run"));
    for (const s of tactics.sites) {
      const zone = s.zone;
      const neighbours = spatial.zones.map((q) => q.id).filter((q) => q !== zone && spatial.edgeTraversal(q, zone) !== null);
      const retakeEntries = neighbours.filter((n) => {
        if (s.entries.includes(n) || n === "attacker-spawn") return false;
        const d = tD(n), a = tA(n);
        return d !== null && (a === null || d <= a);
      });
      // a site whose every neighbour the attack reaches first still has a retake: through the
      // neighbours the defenders reach soonest
      const retake = retakeEntries.length > 0 ? retakeEntries
        : neighbours.filter((n) => n !== "attacker-spawn" && tD(n) !== null).sort((a, b) => tD(a)! - tD(b)!).slice(0, 1);
      const area = nav.zoneNodes(zone).filter((n) => spatial.plantZoneAt(nav.nodePosition(n))?.zoneId === zone);
      if (area.length === 0) continue;
      const measure = (n: number) => {
        const p = nav.nodePosition(n);
        const retakeSight: Record<string, number> = {}, retakeReachMs: Record<string, number> = {};
        for (const r of retake) {
          retakeSight[r] = nav.sightInto(n, r);
          const rz = spatial.getZone(r);
          const base = tD(r) ?? Infinity;
          retakeReachMs[r] = base + (rz ? Math.hypot(rz.position.x - p.x, rz.position.y - p.y) / RUN_UNITS_PER_MS : 0);
        }
        const guardSight = s.entries.reduce((acc, e) => acc + nav.sightInto(n, e), 0);
        return { position: p, exposure: nav.exposure(n), retakeSight, retakeReachMs, guardSight };
      };
      const candidates: PlantCandidate[] = [];
      const add = (kind: PlantSpotKind, n: number, hiddenFrom?: string): void => {
        if (candidates.some((c) => c.node === n)) return;
        candidates.push({ id: `${zone}/plant/${hiddenFrom ? `${kind}-${hiddenFrom}` : kind}`, kind, site: s.site, zone, node: n, ...(hiddenFrom ? { hiddenFrom } : {}), ...measure(n) });
      };
      for (const ps of s.plantSpots) add(ps.kind, ps.node);
      for (const r of retake) {
        const n = [...area].sort((a, b) => nav.sightInto(a, r) - nav.sightInto(b, r) || nav.exposure(a) - nav.exposure(b) || a - b)[0]!;
        add("cover", n, r);
      }
      for (const e of s.entries) {
        const ez = spatial.getZone(e);
        if (!ez) continue;
        const d = (n: number): number => { const q = nav.nodePosition(n); return Math.hypot(q.x - ez.position.x, q.y - ez.position.y); };
        add("near", [...area].sort((a, b) => d(a) - d(b) || a - b)[0]!, e);
      }
      out.set(zone, { site: s.site, zone, retakeEntries: retake, attackEntries: s.entries, candidates });
    }
  }
  cache.set(spatial, out);
  return out;
}

export interface PlantSituation {
  /** The carrier's position. */
  readonly from: { readonly x: number; readonly y: number; readonly z: number };
  /** The carrier's game sense (0..1). */
  readonly gameSense: number;
  /** Round clock left minus the plant itself (ms). */
  readonly slackMs: number;
  /** Living teammates' roadmap nodes (the carrier excluded); null entries are off the roadmap. */
  readonly teammateNodes: readonly (number | null)[];
  /** Believed threat per zone (attack's belief), 0..1. */
  readonly threat?: ReadonlyMap<string, number>;
  /** Living enemies (the kill feed is public); absent = as many as the carrier's side. */
  readonly enemiesAlive?: number;
}

export interface PlantDecision {
  readonly candidate: PlantCandidate;
  readonly by: "auto" | "manager";
  /** The utility of every candidate (diagnostics). */
  readonly utilities: Readonly<Record<string, number>>;
}

/** Retake likelihood weight of each entry: nearer for the defenders and believed more threatening → heavier (sums to 1). */
function retakeWeights(site: SitePlantSpots, c: PlantCandidate, threat?: ReadonlyMap<string, number>): Record<string, number> {
  const t = site.retakeEntries.map((r) => c.retakeReachMs[r] ?? Infinity);
  const tmin = Math.min(...t);
  const raw = site.retakeEntries.map((r, i) => (Number.isFinite(t[i]!) ? tmin / t[i]! : 0) + (threat?.get(r) ?? 0));
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(site.retakeEntries.map((r, i) => [r, raw[i]! / sum]));
}

/** Choose a plant spot on a site (see the header for the formula). Null when the site has no candidates. */
export function choosePlantSpot(spatial: SpatialEngine, site: SitePlantSpots, sit: PlantSituation, pref?: PlantChoice): PlantDecision | null {
  const cs = site.candidates;
  if (cs.length === 0) return null;
  const nav = spatial.nav!;
  const sightW = cs.map((c) => { const w = retakeWeights(site, c, sit.threat); return site.retakeEntries.reduce((a, r) => a + w[r]! * (c.retakeSight[r] ?? 0), 0); });
  const reachR = cs.map((c) => Math.min(...site.retakeEntries.map((r) => c.retakeReachMs[r] ?? Infinity)));
  const maxSight = Math.max(1e-9, ...sightW), maxGuard = Math.max(1e-9, ...cs.map((c) => c.guardSight));
  const finiteReach = reachR.filter(Number.isFinite);
  const maxReach = Math.max(1e-9, ...finiteReach);
  const mates = sit.teammateNodes.filter((n): n is number => n !== null && n >= 0);
  // The carrier's time budget is the plant window: the round clock left, but no more than the
  // retake needs to reach the site (the soonest any candidate is reached from defender spawn) —
  // a walk across the site is paid in that window, not against the whole clock.
  const window = Math.min(...reachR.filter(Number.isFinite), Infinity);
  const slack = Math.max(100, Math.min(sit.slackMs, window));
  const g = Math.min(1, Math.max(0, sit.gameSense));
  // numbers: with the man advantage the spike goes where the team can crossfire it, short-handed
  // where the retake cannot see it (λ = A / (A + D); docs/research/PLANT_POSTPLANT.md P3)
  const A = mates.length + 1, D = sit.enemiesAlive ?? A;
  const lam = A / (A + Math.max(0, D));
  const reachMs = (c: PlantCandidate): number => Math.hypot(c.position.x - sit.from.x, c.position.y - sit.from.y) / RUN_UNITS_PER_MS;
  const seers = cs.map((c) => mates.filter((m) => nav.nodesVisible(m, c.node)).length);
  const anySeen = seers.some((k) => k > 0);
  const U = cs.map((c, i) => {
    const hidden = 1 - sightW[i]! / maxSight;
    const support = anySeen ? seers[i]! / mates.length : c.guardSight / maxGuard;
    const delay = Number.isFinite(reachR[i]!) ? reachR[i]! / maxReach : 0;
    return g * ((1 - lam) * hidden + lam * support + delay) / 2 - reachMs(c) / slack;
  });
  const utilities = Object.fromEntries(cs.map((c, i) => [c.id, U[i]!]));
  const best = (idx: number[]): number => idx.reduce((b, i) => (U[i]! > U[b]! ? i : b), idx[0]!);
  const all = cs.map((_, i) => i);
  if (pref && pref !== "auto") {
    const idx = typeof pref === "string" ? all.filter((i) => cs[i]!.kind === pref) : all.filter((i) => cs[i]!.id === pref.spotId);
    const reachable = idx.filter((i) => reachMs(cs[i]!) <= slack);
    if (reachable.length > 0) return { candidate: cs[best(reachable)]!, by: "manager", utilities };
  }
  return { candidate: cs[best(all)]!, by: "auto", utilities };
}

/** The candidate a planted spike's position is (within `toleranceUnits`), else null — an off-list spot. */
export function plantSpotAt(site: SitePlantSpots | undefined, position: { x: number; y: number; z: number }, toleranceUnits = 150): PlantCandidate | null {
  if (!site) return null;
  let best: PlantCandidate | null = null, bestD = toleranceUnits;
  for (const c of site.candidates) {
    const d = Math.hypot(c.position.x - position.x, c.position.y - position.y);
    if (d <= bestD) { bestD = d; best = c; }
  }
  return best;
}
