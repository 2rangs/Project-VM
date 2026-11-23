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
//   defender starts five zones: one per site; then the mid anchor (two-site maps only — a third
//                   site takes its place); then one more per site, the sites the attack reaches
//                   soonest first. Listed site by site in letter order, the mid anchor last.
import type { SpatialEngine } from "./engine.js";

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
  /** Which values came from the map's hand-authored file rather than the rules. */
  readonly authored: readonly string[];
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
      return { site, zone, mainEntry, entries: [...(mainEntry ? [mainEntry] : []), ...others], smokes: [...smokes], attackTravelMs: reach, defenseTravelMs: tD(zone) };
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

  return { mapId: engine.mapId, attackerSpawn: ATTACKER_SPAWN, defenderSpawn: DEFENDER_SPAWN, sites, mid, aim, smokes, defenderStarts, authored };
}
