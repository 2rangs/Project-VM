// Navigation debug model for the live match screen (developer view).
//
// It answers, for one instant of a round: where can a body walk (the engine's navigation
// roadmap), which zones the roadmap connects, what each of our players planned to walk (their
// destination and waypoints), what they actually walked (the recorded track), where a path was
// refused or replanned, what was priced into the plan (ground patches, believed-enemy zones) and
// WHY that route was chosen (the order behind it and its route preference).
//
// Everything here is read from engine output — the roadmap JSON the engine loads and the round's
// navigation trace. Nothing is re-planned in the renderer.
//
// Pure module: runs under `node --test`.
import type { NavTraceEvent } from '../../shared/ipc.ts';
import type { Vec3 } from './nav.ts';
import type { PlayerRound, RoundTimeline, TeamSlot } from './timeline.ts';

/** The subset of `<map>.nav.json` this module reads. */
export interface RoadmapData {
  readonly zones: readonly string[];
  /** [x, y, z, clearance, zoneIndex] */
  readonly nodes: ReadonlyArray<readonly number[]>;
  /** [a, b, halfWidth] — walkable both ways */
  readonly edges: ReadonlyArray<readonly number[]>;
  /** [from, to, ...] — one way (a drop) */
  readonly drops: ReadonlyArray<readonly number[]>;
  /** authored one-way links (teleporter, zipline) */
  readonly links: ReadonlyArray<{ readonly from: number; readonly to: number } | readonly number[]>;
  readonly anchors: Readonly<Record<string, number>>;
}

export interface RoadSegment { readonly a: Vec3; readonly b: Vec3; readonly halfWidth: number; readonly kind: 'walk' | 'drop' | 'link' }
export interface RoadNode { readonly pos: Vec3; readonly clearance: number; readonly zone: string }
export interface ZoneConnectivity { readonly id: string; readonly anchor: Vec3 | null; readonly connected: boolean }

export interface Roadmap {
  readonly nodes: readonly RoadNode[];
  readonly segments: readonly RoadSegment[];
  /** Every zone: its standing point on the roadmap and whether a body can walk to it from most of the map. */
  readonly zones: readonly ZoneConnectivity[];
  readonly connectedZones: number;
}

const linkEnds = (l: Roadmap extends never ? never : RoadmapData['links'][number]): [number, number] =>
  Array.isArray(l) ? [l[0] as number, l[1] as number] : [(l as { from: number }).from, (l as { to: number }).to];

/** Build the drawable roadmap and each zone's connectivity (can it be walked to from the rest of the map). */
export function buildRoadmap(data: RoadmapData): Roadmap {
  const nodes: RoadNode[] = data.nodes.map((n) => ({ pos: { x: n[0]!, y: n[1]!, z: n[2]! }, clearance: n[3] ?? 0, zone: data.zones[n[4] ?? -1] ?? '' }));
  const segments: RoadSegment[] = [];
  const out: number[][] = nodes.map(() => []);
  for (const e of data.edges) {
    const a = e[0]!, b = e[1]!;
    if (!nodes[a] || !nodes[b]) continue;
    segments.push({ a: nodes[a].pos, b: nodes[b].pos, halfWidth: e[2] ?? 0, kind: 'walk' });
    out[a]!.push(b); out[b]!.push(a);
  }
  for (const d of data.drops) {
    const a = d[0]!, b = d[1]!;
    if (!nodes[a] || !nodes[b]) continue;
    segments.push({ a: nodes[a].pos, b: nodes[b].pos, halfWidth: 0, kind: 'drop' });
    out[a]!.push(b);
  }
  for (const l of data.links) {
    const [a, b] = linkEnds(l);
    if (!nodes[a] || !nodes[b]) continue;
    segments.push({ a: nodes[a].pos, b: nodes[b].pos, halfWidth: 0, kind: 'link' });
    out[a]!.push(b);
  }
  // A zone is connected when a body can WALK TO it from most of the map: count, for every zone's
  // standing point, how many other zones' standing points reach it (drops and links are one-way,
  // so a ledge you can only drop from is not connected).
  const reach = (from: number): Uint8Array => {
    const seen = new Uint8Array(nodes.length);
    const stack = [from]; seen[from] = 1;
    while (stack.length > 0) { const n = stack.pop()!; for (const m of out[n]!) if (!seen[m]) { seen[m] = 1; stack.push(m); } }
    return seen;
  };
  const anchorIds = Object.entries(data.anchors).filter(([, n]) => nodes[n]);
  const reachedBy = new Map<number, number>();
  for (const [, from] of anchorIds) {
    const seen = reach(from);
    for (const [, to] of anchorIds) if (to !== from && seen[to]) reachedBy.set(to, (reachedBy.get(to) ?? 0) + 1);
  }
  const need = (anchorIds.length - 1) / 2;
  const zones: ZoneConnectivity[] = data.zones.map((id) => {
    const n = data.anchors[id];
    const anchor = n !== undefined && nodes[n] ? nodes[n].pos : null;
    return { id, anchor, connected: !!anchor && (anchorIds.length <= 1 || (reachedBy.get(n!) ?? 0) > need) };
  });
  return { nodes, segments, zones, connectedZones: zones.filter((z) => z.connected).length };
}

export interface NavPlan {
  readonly playerId: string;
  readonly slot: number;
  /** The plan in force (the last planned / replanned path), or null if the last request was refused. */
  readonly event: NavTraceEvent | null;
  /** The request that was refused (path failure), when that is the latest thing that happened. */
  readonly failure: NavTraceEvent | null;
  readonly destination: Vec3 | null;
  /** Waypoints still ahead of the player on the planned path. */
  readonly ahead: readonly Vec3[];
  /** Where the player actually went this round, up to now (recorded positions). */
  readonly trail: readonly Vec3[];
  /** Every replan of this player so far this round (where it stood). */
  readonly replans: readonly Vec3[];
  /** Every refused request so far this round. */
  readonly failures: readonly NavTraceEvent[];
  readonly why: string;
}

export interface NavDebugFrame {
  readonly plans: readonly NavPlan[];
  /** Ground patches priced into any plan in force. */
  readonly hazards: ReadonlyArray<{ x: number; y: number; z: number; radius: number }>;
  readonly counts: { readonly planned: number; readonly replanned: number; readonly failed: number };
}

const INTENT_TEXT: ReadonlyArray<[RegExp, string]> = [
  [/attack-save|postplant-save/, 'saving'],
  [/throw:chase/, 'chasing the exit kill'],
  [/spike-re/, 'recovering the spike'],
  [/defuser-commit/, 'going for the defuse'],
  [/retake-go/, 'retaking'],
  [/retake-stage/, 'staging the retake'],
  [/carrier-commit/, 'carrier going to plant'],
  [/rotate:return/, 'returning to its position'],
  [/rotate/, 'rotating'],
  [/plan:slow/, 'slow approach'],
  [/lurk/, 'lurking'],
  [/plan:/, 'team plan'],
  [/throw:/, 'pushing out'],
];
export function intentText(intent: string | undefined): string {
  if (!intent) return 'order';
  for (const [re, text] of INTENT_TEXT) if (re.test(intent)) return text;
  return intent;
}

const PREFERENCE_TEXT: Readonly<Record<string, string>> = {
  FASTEST: 'fastest route',
  SAFEST: 'safest route',
  STEALTH: 'quiet route',
  TACTICAL: 'tactical route',
};

/** One line saying why this route: what the order is for, the preference, what it avoids, how long. */
export function whyText(e: NavTraceEvent, zoneName: (id: string) => string = (id) => id): string {
  const pref = PREFERENCE_TEXT[e.preference ?? 'FASTEST'] ?? e.preference ?? '';
  if (e.kind === 'blocked' || e.kind === 'unreachable') {
    return `${intentText(e.intent)} → ${zoneName(e.goalZone)}: no path (${e.reason ?? e.kind})`;
  }
  const parts = [`${intentText(e.intent)} → ${zoneName(e.goalZone)}`, pref];
  if (e.avoided && e.avoided.length > 0) parts.push(`avoiding ${e.avoided.slice(0, 3).map((z) => zoneName(z.zoneId)).join(', ')}${e.avoided.length > 3 ? ` +${e.avoided.length - 3}` : ''}`);
  if (e.hazards && e.hazards.length > 0) parts.push(`${e.hazards.length} ground patch${e.hazards.length > 1 ? 'es' : ''} priced`);
  if (e.pathLength != null && e.estimatedTravelMs != null) parts.push(`${(e.pathLength / 100).toFixed(0)} m · ${(e.estimatedTravelMs / 1000).toFixed(1)} s`);
  if (e.kind === 'replanned') parts.push('replanned');
  return parts.join(' · ');
}

/** Recorded positions of a player from the round start to tMs (match timeline). */
export function trailOf(p: PlayerRound, tMs: number): Vec3[] {
  const t = p.deathMs != null ? Math.min(tMs, p.deathMs) : tMs;
  const out: Vec3[] = [p.spawn];
  for (const h of p.hops) {
    if (h.arriveMs <= t) { out.push(h.to); continue; }
    if (h.sampled && t > h.departMs) {
      const u = (t - h.departMs) / Math.max(1, h.arriveMs - h.departMs);
      out.push({ x: h.from.x + (h.to.x - h.from.x) * u, y: h.from.y + (h.to.y - h.from.y) * u, z: h.from.z + (h.to.z - h.from.z) * u });
    }
    break;
  }
  return out;
}

/** The waypoints of a plan that are still ahead of `pos`: from the segment nearest to it onward. */
export function waypointsAhead(waypoints: readonly Vec3[], pos: Vec3): Vec3[] {
  if (waypoints.length < 2) return waypoints.slice();
  let best = 0, bestD = Infinity;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i]!, b = waypoints[i + 1]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 > 0 ? Math.min(1, Math.max(0, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(pos.x - (a.x + dx * u), pos.y - (a.y + dy * u));
    if (d <= bestD) { bestD = d; best = i; } // <=: a path that doubles back resolves to the later segment
  }
  return [pos, ...waypoints.slice(best + 1)];
}

/**
 * The navigation picture of one team at tMs (match timeline): each living player's plan in force,
 * what is left of it, what they walked, and where planning failed or was redone.
 */
export function navDebugAt(
  round: RoundTimeline, team: TeamSlot, tMs: number, positionOf: (p: PlayerRound) => Vec3, zoneName?: (id: string) => string,
): NavDebugFrame {
  const events = round.summary?.nav ?? [];
  const rel = tMs - round.startMs;
  const plans: NavPlan[] = [];
  const hazards = new Map<string, { x: number; y: number; z: number; radius: number }>();
  let planned = 0, replanned = 0, failed = 0;
  for (const p of round.players) {
    if (p.team !== team) continue;
    const mine = events.filter((e) => e.playerId === p.id && e.elapsedMs <= rel);
    for (const e of mine) { if (e.kind === 'planned') planned++; else if (e.kind === 'replanned') replanned++; else failed++; }
    const alive = p.deathMs == null || tMs < p.deathMs;
    const last = mine[mine.length - 1] ?? null;
    const ok = last && (last.kind === 'planned' || last.kind === 'replanned') ? last : null;
    const failure = last && !ok ? last : null;
    const pos = positionOf(p);
    const wps = ok?.waypoints ?? [];
    const destination = wps.length > 0 ? wps[wps.length - 1]! : null;
    const arrived = destination ? Math.hypot(destination.x - pos.x, destination.y - pos.y) < 60 : true;
    if (alive && ok?.hazards) for (const h of ok.hazards) hazards.set(`${h.x},${h.y},${h.radius}`, h);
    plans.push({
      playerId: p.id, slot: p.slot,
      event: alive ? ok : null,
      failure: alive ? failure : null,
      destination: alive ? destination : null,
      ahead: alive && !arrived ? waypointsAhead(wps, pos) : [],
      trail: trailOf(p, tMs),
      replans: mine.filter((e) => e.kind === 'replanned' && e.from).map((e) => e.from!),
      failures: mine.filter((e) => e.kind === 'blocked' || e.kind === 'unreachable'),
      why: !alive ? '' : last ? whyText(last, zoneName) : 'no move ordered yet',
    });
  }
  plans.sort((a, b) => a.slot - b.slot);
  return { plans, hazards: [...hazards.values()], counts: { planned, replanned, failed } };
}
