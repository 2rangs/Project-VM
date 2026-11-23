// PROJECT V — named standing points of a site, DERIVED from the roadmap and the sight table.
//
// Holding spots (where a defender stands to watch a way in, off-angles included) and plant spots
// (default / safe / open) are points, not zones. They are chosen by the same rules on every map
// from two measured quantities per roadmap node:
//   sight(n, E)   how many standing points of zone E node n has line of sight to
//   exposure(n)   how many standing points of OTHER zones have line of sight to n
//
// Holding spots, per entry E of a site (the main entry first):
//   standard      the nodes of the site with the most sight(n, E) per unit of exposure
//                 (sight / (1 + exposure not counting E)) — a wide view of the way in from cover
//   off-angle     among nodes that see E with at most OFF_ANGLE_SHARE of the widest view of E, the
//                 least exposed — a narrow, unexpected line onto the way in
//   Spots are kept MIN_SEPARATION apart; a site gets at least MIN_SPOTS when it has that many
//   distinct nodes that see one of its entries. `cover` grades a spot's exposure against the
//   site's own nodes (lowest third "full", middle "half", highest "open"): it is a ranking of
//   measured exposure, not a measurement of how much of the body a prop hides.
// Plant spots, among the roadmap nodes on the site's plantable area:
//   default       most sight from the main entry's standing points (the attack can watch it from
//                 where it came in), ties to the less exposed
//   safe          least exposed
//   open          most exposed
// Everything is `provenance: "derived"`; nothing here is copied from a guide.
import type { SpatialEngine } from "./engine.js";

export type SpotCover = "full" | "half" | "open";

export interface HoldSpot {
  /** `<site zone>/<entry>/<standard|off-angle>-<k>`. */
  readonly id: string;
  readonly kind: "standard" | "off-angle";
  readonly zone: string;
  readonly node: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** The way in this spot is for. */
  readonly watches: string;
  /** Every entry of the site this spot sees, with how many of its standing points. */
  readonly sees: Readonly<Record<string, number>>;
  /** Standing points of other zones that see this spot (the watched entry included). */
  readonly exposure: number;
  readonly cover: SpotCover;
  readonly provenance: "derived";
}

export interface PlantSpot {
  readonly kind: "default" | "safe" | "open";
  readonly zone: string;
  readonly node: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly exposure: number;
  /** Standing points of the main entry that see this spot. */
  readonly seenFromMainEntry: number;
  readonly provenance: "derived";
}

export interface SiteSpots {
  readonly holdSpots: readonly HoldSpot[];
  readonly plantSpots: readonly PlantSpot[];
}

const MIN_SPOTS = 6;
const STANDARD_PER_ENTRY = 2;
const OFF_ANGLE_SHARE = 0.34;
/** Two spots closer than this (uu) are the same spot. */
const MIN_SEPARATION = 250;

export function deriveSiteSpots(engine: SpatialEngine, zone: string, entries: readonly string[]): SiteSpots {
  const nav = engine.nav;
  if (!nav || !nav.hasVisibility) return { holdSpots: [], plantSpots: [] };
  const nodes = [...nav.zoneNodes(zone)];
  if (nodes.length === 0) return { holdSpots: [], plantSpots: [] };
  const exposure = new Map(nodes.map((n) => [n, nav.exposure(n)] as const));
  const ranked = [...nodes].sort((a, b) => exposure.get(a)! - exposure.get(b)! || a - b);
  const coverOf = (n: number): SpotCover => {
    const r = ranked.indexOf(n) / Math.max(1, ranked.length - 1);
    return r <= 1 / 3 ? "full" : r <= 2 / 3 ? "half" : "open";
  };
  const far = (n: number, chosen: readonly HoldSpot[]): boolean => chosen.every((c) => {
    const p = nav.nodePosition(n);
    return Math.hypot(p.x - c.position.x, p.y - c.position.y) >= MIN_SEPARATION;
  });
  const holdSpots: HoldSpot[] = [];
  const add = (n: number, entry: string, kind: HoldSpot["kind"]): void => {
    const k = holdSpots.filter((s) => s.watches === entry && s.kind === kind).length + 1;
    const sees: Record<string, number> = {};
    for (const e of entries) { const s = nav.sightInto(n, e); if (s > 0) sees[e] = s; }
    holdSpots.push({ id: `${zone}/${entry}/${kind}-${k}`, kind, zone, node: n, position: nav.nodePosition(n), watches: entry, sees, exposure: exposure.get(n)!, cover: coverOf(n), provenance: "derived" });
  };
  const value = (n: number, e: string): number => nav.sightInto(n, e) / (1 + nav.exposure(n, e));
  const byValue = (e: string): number[] => nodes.filter((n) => nav.sightInto(n, e) > 0).sort((a, b) => value(b, e) - value(a, e) || a - b);
  for (const e of entries) {
    const seeing = byValue(e);
    if (seeing.length === 0) continue;
    for (const n of seeing) {
      if (holdSpots.filter((s) => s.watches === e && s.kind === "standard").length >= STANDARD_PER_ENTRY) break;
      if (far(n, holdSpots)) add(n, e, "standard");
    }
    const widest = Math.max(...seeing.map((n) => nav.sightInto(n, e)));
    const narrow = seeing.filter((n) => nav.sightInto(n, e) <= Math.max(1, OFF_ANGLE_SHARE * widest))
      .sort((a, b) => nav.exposure(a, e) - nav.exposure(b, e) || a - b);
    const off = narrow.find((n) => far(n, holdSpots));
    if (off !== undefined) add(off, e, "off-angle");
  }
  // top up to MIN_SPOTS with the next best views, entry by entry
  for (let round = 0; holdSpots.length < MIN_SPOTS && round < nodes.length; round++) {
    let added = false;
    for (const e of entries) {
      if (holdSpots.length >= MIN_SPOTS) break;
      const n = byValue(e).find((c) => far(c, holdSpots));
      if (n !== undefined) { add(n, e, "standard"); added = true; }
    }
    if (!added) break;
  }

  const main = entries[0];
  const area = nodes.filter((n) => engine.plantZoneAt(nav.nodePosition(n))?.zoneId === zone);
  const plantSpots: PlantSpot[] = [];
  if (area.length > 0) {
    const seenFromMain = (n: number): number => (main ? nav.sightInto(n, main) : 0);
    const mk = (kind: PlantSpot["kind"], n: number): PlantSpot => ({ kind, zone, node: n, position: nav.nodePosition(n), exposure: exposure.get(n)!, seenFromMainEntry: seenFromMain(n), provenance: "derived" });
    const by = (f: (n: number) => number): number => [...area].sort((a, b) => f(a) - f(b) || a - b)[0]!;
    plantSpots.push(mk("default", by((n) => -seenFromMain(n) * 1e6 + exposure.get(n)!)));
    plantSpots.push(mk("safe", by((n) => exposure.get(n)!)));
    plantSpots.push(mk("open", by((n) => -exposure.get(n)!)));
  }
  return { holdSpots, plantSpots };
}
