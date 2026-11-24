// PROJECT V — per-map tactical data, DERIVED from the map.
//
// What a team needs to know about a map before it can play it — where the sites are, which way the
// attack comes into each, what a defender on a site watches, where five defenders start — used to
// be tables of Ascent zone ids inside the policy. Here it is computed from the map's own zone
// graph, travel times and sightlines, by rules that are the same for every map, so a map needs no
// code of its own. A map may still carry a small hand-authored `<map>.tactics.json` that replaces
// individual derived values (Ascent keeps its mid anchor and its smoke list that way).
//
// Rules (ATK / DEF = the two spawns; t(a→b) = the travel time the engine plans with):
//   site            every plantable zone of type "site"; its letter is `zone.site`, else the
//                   super-region, else the callout id's prefix ("c-site" → C)
//   main entry      the zone before the site on the attackers' fastest route ATK → site — the
//                   choke the attack comes through (the round simulator's default hold direction)
//   entries         every neighbour of the site the attack reaches before the site itself
//                   (t(ATK→n) < t(ATK→site)), the main entry first, the rest by arrival time
//   aim             what a defender standing on a zone watches: the main entry of that zone
//   smokes          the main entry, then up to two zones on the defenders' side
//                   (t(DEF→z) < t(ATK→z)) that see the site, nearest to the site first
//   mid anchor      among zones of type "mid" that the defenders reach first (t(DEF→z) ≤ t(ATK→z)):
//                   the one the attack reaches soonest after them (least t(ATK→z) − t(DEF→z)) —
//                   the forward edge of what the defense can hold. If the defenders are first to
//                   none, the zone where the two arrive closest to together, but only if the
//                   defenders are at most MID_LATE_MS behind; otherwise the map has no mid anchor
//   hold / plant    named standing points per site (standard and off-angle holding spots per entry;
//   spots           default / safe / open plant points) — see spots.ts
//   defender starts five zones: one per site; then the mid anchor (two-site maps only — a third
//                   site takes its place); then one more per site, the sites the attack reaches
//                   soonest first. Listed site by site in letter order, the mid anchor last.
import type { SpatialEngine } from "./engine.js";
import { deriveSiteSpots, type HoldSpot, type PlantSpot } from "./spots.js";

export interface SiteTactics {
  /** Site letter: "A", "B", "C". */
  readonly site: string;
  /** The plantable site zone. */
  readonly zone: string;
  /** The choke the attack comes through (null if the site cannot be reached from the attacker spawn). */
  readonly mainEntry: string | null;
  /** Every way the attack comes in, the main entry first. */
  readonly entries: readonly string[];
  /** Zones worth smoking for an execute onto this site, in order. */
  readonly smokes: readonly string[];
  /** Attackers' and defenders' fastest run to the site (ms); null if unreachable. */
  readonly attackTravelMs: number | null;
  readonly defenseTravelMs: number | null;
  /** Named holding spots (standard and off-angle) per entry, as points (spots.ts); empty without a sight table. */
  readonly holdSpots: readonly HoldSpot[];
  /** Default / safe / open plant points on the site's plantable area (spots.ts). */
  readonly plantSpots: readonly PlantSpot[];
}

export interface MapTactics {
  readonly mapId: string;
  readonly attackerSpawn: string;
  readonly defenderSpawn: string;
  readonly sites: readonly SiteTactics[];
  /** The defenders' mid position and what it watches, or null on a map without a mid. */
  readonly mid: { readonly zone: string; readonly aim: string | null } | null;
  /** What a defender standing on a zone watches (sites and the mid anchor). */
  readonly aim: Readonly<Record<string, string>>;
  /** Zones to smoke per objective zone (sites and the mid anchor). */
  readonly smokes: Readonly<Record<string, readonly string[]>>;
  /** Where the five defenders start, by roster index. */
  readonly defenderStarts: readonly string[];
  /**
   * Ground the attack holds first: zones the attackers reach from their spawn before the defenders
   * reach them from theirs (spawns and sites excluded).
   */
  readonly attackerGround: readonly string[];
  /**
   * Which site a zone leads the attack to, for zones whose name does not say (mid, bridges, ...):
   * the zone lies on the attackers' way to that site (a detour of at most APPROACH_DETOUR_MS from
   * their fastest route) and is at least APPROACH_MARGIN_MS further out of the way to every other
   * site. A defender who hears or sees the attack there reads it as coming for that site.
   */
  readonly approachSide: Readonly<Record<string, string>>;
  /** The map's middle: its zones, chokes and what holding it opens (null = the map has no mid). */
  readonly midArea: MidArea | null;
  /** Which values came from the map's hand-authored file rather than the rules. */
  readonly authored: readonly string[];
}

/** A mid zone with a way out of mid, and what that way leads to. */
export interface MidChoke {
  /** The mid zone. */
  readonly zone: string;
  /** The zone outside mid it opens onto. */
  readonly onto: string;
  /** The site that way leads to (the site itself, a zone named for it, or a zone the attack takes to it), or null. */
  readonly leadsTo: string | null;
  /** Which side reaches the mid zone first. */
  readonly first: "attack" | "defense";
}

/** A way from mid onto a site that does not use the site's main entry: the second lane of a split. */
export interface MidSiteLink {
  /** The mid zone it leaves from. */
  readonly from: string;
  /** Zones from `from` to the site, both included. */
  readonly path: readonly string[];
  /** The zone it enters the site from. */
  readonly entry: string;
  readonly travelMs: number;
}

/**
 * The middle of a map, derived from its zones (rules at deriveMidArea). Mid is the ground between
 * the sites that belongs to neither: who stands on it can reach either site, sees the other side
 * change position, and sits on the defenders' short way between sites.
 */
export interface MidArea {
  /** Every mid zone. */
  readonly zones: readonly string[];
  /** The mid zone each side reaches first from its spawn, and after how long. */
  readonly attackEntry: string;
  readonly attackMs: number;
  readonly defenseEntry: string;
  readonly defenseMs: number;
  /** Where the two sides meet: the mid zone with the smallest gap between their arrivals. */
  readonly contest: string;
  readonly chokes: readonly MidChoke[];
  /** Per site letter: the way from mid onto the site past its main entry, or null when mid opens none. */
  readonly siteLinks: Readonly<Record<string, MidSiteLink | null>>;
  /** The attack changing sites (main entry to main entry), through mid and without it; null = no such way. */
  readonly attackSwitch: ReadonlyArray<{ readonly from: string; readonly to: string; readonly throughMs: number | null; readonly aroundMs: number | null }>;
  /** The defence rotating between sites, through mid and without it (its own spawn is open to it). */
  readonly defenseRotate: ReadonlyArray<{ readonly from: string; readonly to: string; readonly throughMs: number | null; readonly aroundMs: number | null }>;
  /**
   * What mid is worth to the attack on this map, 0..1: the share of the site switch it saves,
   * (around − through) / around, the largest over the site pairs (1 when there is no way round).
   */
  readonly attackValue: number;
  /** The same for the defence's rotation. */
  readonly defenseValue: number;
}

/** The hand-authored part of a map's tactics (`<map>.tactics.json`); every key is optional. */
export interface MapTacticsOverrides {
  /** The defenders' mid zone (null = this map has none). */
  readonly midAnchor?: string | null;
  /** Smoke targets per objective zone, replacing the derived list for that zone. */
  readonly smokes?: Readonly<Record<string, readonly string[]>>;
  /** What a defender on a zone watches, replacing the derived aim for that zone. */
  readonly aim?: Readonly<Record<string, string>>;
  /** The five defender start zones. */
  readonly defenderStarts?: readonly string[];
}

const ATTACKER_SPAWN = "attacker-spawn";
const DEFENDER_SPAWN = "defender-spawn";
const DEFENDERS = 5;
const SMOKE_ANGLES = 2;
/** A zone is on the attackers' way to a site when passing through it costs them at most this much. */
const APPROACH_DETOUR_MS = 2000;
/** ...and it speaks for that site alone when every other site is at least this much further out of the way. */
const APPROACH_MARGIN_MS = 4000;
/** A mid position the defenders reach this much after the attackers can still be contested; later than that it cannot. */
const MID_LATE_MS = 4000;

/** Site letter of a zone: its `site`, else its super-region, else the callout id's prefix. */
export function siteLetterOf(zone: { id: string; site?: string | null; superRegion?: string | null }): string | null {
  const named = zone.site ?? zone.superRegion ?? null;
  if (named && /^[A-Z]$/.test(named)) return named;
  const m = /^([a-z])-/.exec(zone.id);
  return m ? m[1]!.toUpperCase() : null;
}

export function deriveMapTactics(engine: SpatialEngine, overrides: MapTacticsOverrides = {}): MapTactics {
  const authored: string[] = [];
  const has = (z: string): boolean => engine.getZone(z) !== undefined;
  const tA = (z: string): number | null => (z === ATTACKER_SPAWN ? 0 : engine.shortestTravelTimeMs(ATTACKER_SPAWN, z));
  const tD = (z: string): number | null => (z === DEFENDER_SPAWN ? 0 : engine.shortestTravelTimeMs(DEFENDER_SPAWN, z));
  const before = (z: string): string | null => {
    const path = engine.findPath(ATTACKER_SPAWN, z)?.path;
    return path && path.length >= 2 ? path[path.length - 2]! : null;
  };
  const neighbours = (z: string): string[] => engine.zones.map((q) => q.id).filter((q) => q !== z && engine.edgeTraversal(q, z) !== null);
  const smokesFor = (zone: string, mainEntry: string | null): string[] => {
    const angles = engine.visibleZonesFrom(zone)
      .filter((z) => z !== zone && z !== mainEntry && z !== DEFENDER_SPAWN)
      .filter((z) => { const a = tA(z), d = tD(z); return d !== null && (a === null || d < a); })
      .map((z) => ({ z, t: engine.shortestTravelTimeMs(z, zone) ?? Infinity }))
      .sort((p, q) => p.t - q.t || (p.z < q.z ? -1 : 1))
      .slice(0, SMOKE_ANGLES)
      .map((p) => p.z);
    return [...(mainEntry ? [mainEntry] : []), ...angles];
  };

  const sites: SiteTactics[] = engine.zonesByType("site")
    .filter((z) => engine.isPlantableZone(z.id))
    .map((z) => ({ zone: z.id, site: siteLetterOf(z as { id: string; site?: string | null; superRegion?: string | null }) }))
    .filter((s): s is { zone: string; site: string } => s.site !== null)
    .sort((p, q) => (p.site < q.site ? -1 : p.site > q.site ? 1 : 0))
    .filter((s, i, all) => all.findIndex((o) => o.site === s.site) === i)
    .map(({ zone, site }) => {
      const mainEntry = before(zone);
      const reach = tA(zone);
      const others = neighbours(zone)
        .filter((n) => n !== mainEntry && n !== ATTACKER_SPAWN)
        .map((n) => ({ n, t: tA(n) }))
        .filter((p): p is { n: string; t: number } => p.t !== null && reach !== null && p.t < reach)
        .sort((p, q) => p.t - q.t || (p.n < q.n ? -1 : 1))
        .map((p) => p.n);
      const smokes = overrides.smokes?.[zone] ?? smokesFor(zone, mainEntry);
      if (overrides.smokes?.[zone]) authored.push(`smokes.${zone}`);
      const entries = [...(mainEntry ? [mainEntry] : []), ...others];
      return { site, zone, mainEntry, entries, smokes: [...smokes], attackTravelMs: reach, defenseTravelMs: tD(zone), ...deriveSiteSpots(engine, zone, entries) };
    });

  // the defenders' mid position
  let midZone: string | null = null;
  if (overrides.midAnchor !== undefined) {
    midZone = overrides.midAnchor && has(overrides.midAnchor) ? overrides.midAnchor : null;
    authored.push("midAnchor");
  } else {
    const mids = engine.zonesByType("mid")
      .map((z) => ({ z: z.id, a: tA(z.id), d: tD(z.id) }))
      .filter((m): m is { z: string; a: number; d: number } => m.a !== null && m.d !== null)
      .map((m) => ({ z: m.z, gap: m.a - m.d }))
      .sort((p, q) => Math.abs(p.gap) - Math.abs(q.gap) || (p.z < q.z ? -1 : 1));
    midZone = (mids.find((m) => m.gap >= 0) ?? mids.find((m) => -m.gap <= MID_LATE_MS))?.z ?? null;
  }
  const mid = midZone ? { zone: midZone, aim: before(midZone) } : null;

  const aim: Record<string, string> = {};
  for (const s of sites) if (s.mainEntry) aim[s.zone] = s.mainEntry;
  if (mid?.aim) aim[mid.zone] = mid.aim;
  for (const [zone, target] of Object.entries(overrides.aim ?? {})) if (has(zone) && has(target)) { aim[zone] = target; authored.push(`aim.${zone}`); }

  const smokes: Record<string, readonly string[]> = {};
  for (const s of sites) smokes[s.zone] = s.smokes;
  if (mid) {
    smokes[mid.zone] = overrides.smokes?.[mid.zone] ?? (mid.aim ? [mid.aim] : []);
    if (overrides.smokes?.[mid.zone]) authored.push(`smokes.${mid.zone}`);
  }

  // five defenders
  let defenderStarts: string[];
  if (overrides.defenderStarts && overrides.defenderStarts.length === DEFENDERS && overrides.defenderStarts.every(has)) {
    defenderStarts = [...overrides.defenderStarts];
    authored.push("defenderStarts");
  } else {
    const count = new Map<string, number>(sites.map((s) => [s.zone, 1]));
    const useMid = mid !== null && sites.length <= 2;
    let left = DEFENDERS - sites.length - (useMid ? 1 : 0);
    const soonest = [...sites].sort((p, q) => (p.attackTravelMs ?? Infinity) - (q.attackTravelMs ?? Infinity) || (p.site < q.site ? -1 : 1));
    for (let i = 0; left > 0 && soonest.length > 0; i++, left--) {
      const z = soonest[i % soonest.length]!.zone;
      count.set(z, (count.get(z) ?? 0) + 1);
    }
    defenderStarts = sites.flatMap((s) => Array.from({ length: count.get(s.zone) ?? 0 }, () => s.zone));
    if (useMid) defenderStarts.push(mid!.zone);
    while (defenderStarts.length < DEFENDERS) defenderStarts.push(DEFENDER_SPAWN);
    defenderStarts = defenderStarts.slice(0, DEFENDERS);
  }

  // ground the attack holds first
  const siteZones = new Set(sites.map((s) => s.zone));
  const attackerGround = engine.zones.map((z) => z.id as string)
    .filter((z) => z !== ATTACKER_SPAWN && z !== DEFENDER_SPAWN && !siteZones.has(z))
    .filter((z) => { const a = tA(z), d = tD(z); return a !== null && d !== null && a < d; })
    .sort();

  // which site a zone without a site letter leads the attack to
  const approachSide: Record<string, string> = {};
  for (const z of engine.zones.map((q) => q.id as string)) {
    if (z === ATTACKER_SPAWN || z === DEFENDER_SPAWN || siteZones.has(z)) continue;
    const named = /^([a-z])-/.exec(z)?.[1]?.toUpperCase();
    if (named && sites.some((s) => s.site === named)) continue; // the name says it
    const a = tA(z);
    if (a === null) continue;
    const detours = sites
      .map((s) => ({ site: s.site, d: s.attackTravelMs === null ? null : (engine.shortestTravelTimeMs(z, s.zone) ?? Infinity) + a - s.attackTravelMs }))
      .filter((p): p is { site: string; d: number } => p.d !== null)
      .sort((p, q) => p.d - q.d);
    const best = detours[0];
    if (best && best.d <= APPROACH_DETOUR_MS && (detours.length < 2 || detours[1]!.d - best.d >= APPROACH_MARGIN_MS)) approachSide[z] = best.site;
  }

  const midArea = deriveMidArea(engine, sites, approachSide);

  return { mapId: engine.mapId, attackerSpawn: ATTACKER_SPAWN, defenderSpawn: DEFENDER_SPAWN, sites, mid, aim, smokes, defenderStarts, attackerGround, approachSide, midArea, authored };
}

/**
 * The map's mid area.
 *   zones        every zone of type "mid" or whose id starts "mid-" that both sides can reach
 *   entries      the mid zone each side reaches first from its spawn
 *   contest      the mid zone with the smallest gap between the two arrivals
 *   chokes       each (mid zone, neighbour outside mid) pair, spawns excluded
 *   site links   per site: the fastest way from a mid zone onto the site with the site's main
 *                entry, the other sites and both spawns shut — the second lane of a split
 *   switch       main entry to main entry for the attack (its own spawn open), with and without
 *                the mid zones and the sites; site to site for the defence likewise
 * A map without such zones has no mid (null): Bind, Fracture and Lotus today.
 */
function deriveMidArea(engine: SpatialEngine, sites: readonly SiteTactics[], approachSide: Readonly<Record<string, string>>): MidArea | null {
  const tA = (z: string): number | null => engine.shortestTravelTimeMs(ATTACKER_SPAWN, z);
  const tD = (z: string): number | null => engine.shortestTravelTimeMs(DEFENDER_SPAWN, z);
  const typed = new Set(engine.zonesByType("mid").map((z) => z.id as string));
  const zones = engine.zones.map((z) => z.id as string)
    .filter((z) => typed.has(z) || z.startsWith("mid-"))
    .filter((z) => tA(z) !== null && tD(z) !== null)
    .sort();
  if (zones.length === 0 || sites.length < 2) return null;
  const mids = new Set(zones);
  const siteZones = sites.map((s) => s.zone);
  const letterOfZone = (z: string): string | null => {
    const site = sites.find((s) => s.zone === z);
    if (site) return site.site;
    const named = /^([a-z])-/.exec(z)?.[1]?.toUpperCase();
    if (named && sites.some((s) => s.site === named)) return named;
    return approachSide[z] ?? null;
  };
  const byTime = (t: (z: string) => number | null) => [...zones].sort((p, q) => t(p)! - t(q)! || (p < q ? -1 : 1))[0]!;
  const attackEntry = byTime(tA);
  const defenseEntry = byTime(tD);
  const contest = [...zones].sort((p, q) => Math.abs(tA(p)! - tD(p)!) - Math.abs(tA(q)! - tD(q)!) || (p < q ? -1 : 1))[0]!;

  const chokes: MidChoke[] = [];
  for (const z of zones) {
    for (const n of engine.zones.map((q) => q.id as string)) {
      if (n === z || mids.has(n) || n === ATTACKER_SPAWN || n === DEFENDER_SPAWN) continue;
      if (engine.edgeTraversal(z, n) === null && engine.edgeTraversal(n, z) === null) continue;
      chokes.push({ zone: z, onto: n, leadsTo: letterOfZone(n), first: tA(z)! < tD(z)! ? "attack" : "defense" });
    }
  }
  chokes.sort((p, q) => (p.zone < q.zone ? -1 : p.zone > q.zone ? 1 : p.onto < q.onto ? -1 : 1));

  const siteLinks: Record<string, MidSiteLink | null> = {};
  for (const s of sites) {
    const shut = [...siteZones.filter((z) => z !== s.zone), ...(s.mainEntry && !mids.has(s.mainEntry) ? [s.mainEntry] : []), ATTACKER_SPAWN, DEFENDER_SPAWN];
    let best: MidSiteLink | null = null;
    for (const m of zones) {
      const r = engine.findPath(m, s.zone, "run", { blockedZones: shut });
      if (!r || r.path.length < 2) continue;
      // the link starts where the path leaves mid for the last time
      let k = 0;
      for (let i = 0; i < r.path.length; i++) if (mids.has(r.path[i]!)) k = i;
      const path = r.path.slice(k);
      const ms = path.slice(0, -1).reduce((sum, z, i) => sum + (engine.shortestTravelTimeMs(z, path[i + 1]!) ?? 0), 0);
      if (!best || ms < best.travelMs || (ms === best.travelMs && path[0]! < best.from)) best = { from: path[0]!, path, entry: path[path.length - 2]!, travelMs: ms };
    }
    siteLinks[s.site] = best;
  }

  const pairs = sites.flatMap((a, i) => sites.slice(i + 1).map((b) => [a, b] as const));
  const timeOf = (from: string, to: string, own: string, blocked: readonly string[]): number | null =>
    engine.findPath(from, to, "run", { passableZones: [own], blockedZones: blocked.filter((z) => z !== from && z !== to) })?.timeMs ?? null;
  const attackSwitch = pairs.filter(([a, b]) => a.mainEntry && b.mainEntry).map(([a, b]) => ({
    from: a.site, to: b.site,
    throughMs: timeOf(a.mainEntry!, b.mainEntry!, ATTACKER_SPAWN, [DEFENDER_SPAWN]),
    aroundMs: timeOf(a.mainEntry!, b.mainEntry!, ATTACKER_SPAWN, [...zones, ...siteZones, DEFENDER_SPAWN]),
  }));
  const defenseRotate = pairs.map(([a, b]) => ({
    from: a.site, to: b.site,
    throughMs: timeOf(a.zone, b.zone, DEFENDER_SPAWN, [ATTACKER_SPAWN]),
    aroundMs: timeOf(a.zone, b.zone, DEFENDER_SPAWN, [...zones, ATTACKER_SPAWN]),
  }));
  const value = (rows: ReadonlyArray<{ throughMs: number | null; aroundMs: number | null }>): number =>
    rows.reduce((best, r) => Math.max(best, r.throughMs === null ? 0 : r.aroundMs === null ? 1 : Math.max(0, (r.aroundMs - r.throughMs) / r.aroundMs)), 0);

  return {
    zones, attackEntry, attackMs: tA(attackEntry)!, defenseEntry, defenseMs: tD(defenseEntry)!, contest, chokes, siteLinks,
    attackSwitch, defenseRotate, attackValue: value(attackSwitch), defenseValue: value(defenseRotate),
  };
}
