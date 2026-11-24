// What ONE team knows, and what ONE player of that team sees and hears.
//
// The engine exports a single observation per TEAM (PerceptionSnapshot: observed enemies, belief
// zones, sound cues). It does not export a per-player observation, so the monitors re-derive it:
//
//   visible to player P  =  enemies the TEAM snapshot marks currentlyVisible
//                           ∩ the engine's own vision test evaluated for P
//                             (alive, ≤ 4500 uu, inside the 110° cone, same zone or an authored
//                              zone sightline — perception-engine `canSee`)
//                        ∪  the opponent of a duel P is in (a kill only happens between two
//                           players who see each other)
//
// The team snapshot is the upper bound: a monitor can never show an enemy the team does not have.
// Exact per-player data would need the fields listed in the README ("engine fields").
//
// Pure module: type-only imports, so it runs under `node --test`.
import type { PerceptionSnapshot, PerceptionTrack } from '@pv/replay-engine';
import { dist3, type NavModel, type Vec2, type Vec3 } from './nav.ts';
import {
  contactAt, engineFacing, findPlayer, isAlive, logicalAt, activeHop, teamPlayers,
  type PlayerRound, type RoundTimeline, type TeamSlot,
} from './timeline.ts';

/** Mirrors @pv/perception-engine DEFAULT_PARAMS (vision + hearing thresholds). */
export const PERCEPTION = {
  halfFovDeg: 55,
  maxViewDistanceUnits: 4500,
  loudness: { footstep: 0.8, gunfire: 1.0, abilityCast: 0.7, spikePlant: 0.75, spikeDefuse: 0.75 } as Record<string, number>,
  threshold: { footstep: 0.45, gunfire: 0.1, abilityCast: 0.3, spikePlant: 0.25, spikeDefuse: 0.25 } as Record<string, number>,
  /** A remembered sighting older than this is drawn as fully faded (engine half-life 5 s, forget < 0.1). */
  memoryMs: 16000,
} as const;

/** Angle in radians between a facing direction and the direction from → to (world x/y). */
export function facingAngleTo(facing: Vec2, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dmag = Math.hypot(dx, dy), fmag = Math.hypot(facing.x, facing.y);
  if (dmag === 0) return 0;
  if (fmag === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (facing.x * dx + facing.y * dy) / (fmag * dmag))));
}

export interface Seer { readonly pos: Vec3; readonly zone: string; readonly facing: Vec2; readonly alive: boolean }
export interface Seen { readonly pos: Vec3; readonly zone: string; readonly alive: boolean }

/** The engine's deterministic vision test (perception-engine `canSee`, smokes not modelled here). */
export function canSee(nav: NavModel, observer: Seer, target: Seen): boolean {
  if (!observer.alive || !target.alive) return false;
  if (dist3(observer.pos, target.pos) > PERCEPTION.maxViewDistanceUnits) return false;
  if (facingAngleTo(observer.facing, observer.pos, target.pos) > (PERCEPTION.halfFovDeg * Math.PI) / 180) return false;
  return nav.hasSight(observer.zone, target.zone);
}

/** Zones a player is watching: their own zone plus every sightline zone inside the cone and range. */
export function watchedZones(nav: NavModel, observer: Seer): string[] {
  if (!observer.alive) return [];
  const out = [observer.zone];
  for (const id of nav.sightZones(observer.zone)) {
    const z = nav.zone(id);
    if (z && canSee(nav, observer, { pos: z.position, zone: id, alive: true })) out.push(id);
  }
  return out;
}

function seerOf(round: RoundTimeline, p: PlayerRound, tMs: number, nav: NavModel): Seer {
  const l = logicalAt(p, tMs);
  return { pos: l.pos, zone: l.zone, facing: engineFacing(round, p, tMs, nav), alive: isAlive(p, tMs) };
}

// ── team intel ─────────────────────────────────────────────────────────────────────────────

export interface IntelEnemy {
  readonly enemyId: string;
  readonly zone: string;
  readonly pos: Vec3 | null;
  readonly visibleNow: boolean;
  /** Match time the team last had eyes on this enemy (derived — see buildIntel). */
  readonly seenAtMs: number;
}
export interface IntelSound {
  readonly zone: string;
  readonly kind: string;
  readonly ageMs: number;
  /** The engine marked this cue as masked (drowned out by louder gunfire); undefined when it does not say. */
  readonly masked?: boolean;
}
export interface TeamIntel {
  readonly tMs: number;
  readonly enemies: readonly IntelEnemy[];
  readonly sounds: readonly IntelSound[];
  readonly belief: ReadonlyArray<{ zone: string; p: number }>;
}

export interface IntelFrame { readonly tMs: number; readonly enemies: readonly IntelEnemy[]; readonly snap: PerceptionSnapshot }
export interface IntelTrack { readonly frames: readonly IntelFrame[] }

/**
 * Pre-compute, for one team and one round, when each observed enemy was last actually seen.
 * The snapshot's own `lastSeenMsAgo` is always 0 in current engine output, so staleness is
 * derived: an entry is "seen" at the snapshot where it first appears, changes position, or is
 * flagged currentlyVisible — and at any duel between that enemy and one of our players.
 */
export function buildIntel(track: PerceptionTrack | undefined, round: RoundTimeline, team: TeamSlot): IntelTrack {
  const snaps = (track?.snapshots ?? []).filter((s) => s.tMs >= round.startMs && s.tMs <= round.endMs + 1);
  const last = new Map<string, { key: string; seenAtMs: number }>();
  const frames: IntelFrame[] = [];
  const duels = round.kills.filter((k) => k.killerId && k.killerTeam !== k.victimTeam);
  for (const snap of snaps) {
    const present = new Set<string>();
    const enemies: IntelEnemy[] = [];
    for (const e of snap.observedEnemies) {
      if (!e.enemyId) continue;
      present.add(e.enemyId);
      const key = e.pos ? `${Math.round(e.pos.x)},${Math.round(e.pos.y)}` : e.zone;
      const prev = last.get(e.enemyId);
      let seenAtMs = prev?.seenAtMs ?? snap.tMs;
      if (!prev || prev.key !== key || e.currentlyVisible) seenAtMs = snap.tMs - Math.max(0, e.currentlyVisible ? 0 : e.lastSeenMsAgo);
      for (const k of duels) {
        if (k.tMs > snap.tMs) break;
        const enemyInDuel = k.victimTeam === team ? k.killerId : k.victimId;
        if (enemyInDuel === e.enemyId && k.tMs > seenAtMs) seenAtMs = k.tMs;
      }
      last.set(e.enemyId, { key, seenAtMs });
      enemies.push({ enemyId: e.enemyId, zone: e.zone, pos: e.pos ?? null, visibleNow: e.currentlyVisible, seenAtMs });
    }
    for (const id of [...last.keys()]) if (!present.has(id)) last.delete(id); // forgotten → a re-sighting is new
    frames.push({ tMs: snap.tMs, enemies, snap });
  }
  return { frames };
}

function frameAt(track: IntelTrack, tMs: number): IntelFrame | null {
  const f = track.frames;
  let lo = 0, hi = f.length - 1, ans: IntelFrame | null = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (f[mid].tMs <= tMs) { ans = f[mid]; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/** Zones where a footstep cue is explained by our own players (cues carry no source team). */
function ownFootstepZones(round: RoundTimeline, team: TeamSlot, tMs: number): Set<string> {
  const zones = new Set<string>();
  for (const p of teamPlayers(round, team)) {
    if (!isAlive(p, tMs)) continue;
    // The snapshot is sampled up to 500 ms before tMs, so look slightly back as well.
    for (const t of [tMs, tMs - 500]) {
      const hop = activeHop(p, t);
      if (hop) { zones.add(hop.fromZone); zones.add(hop.toZone); }
      zones.add(logicalAt(p, t).zone);
    }
  }
  return zones;
}

/**
 * The team's picture at tMs: remembered/visible enemies (minus the ones the kill feed says are
 * dead), de-duplicated sound cues (minus our own footsteps) and the belief distribution.
 */
export function teamIntelAt(track: IntelTrack, round: RoundTimeline, team: TeamSlot, tMs: number): TeamIntel {
  const frame = frameAt(track, tMs);
  if (!frame) return { tMs, enemies: [], sounds: [], belief: [] };
  const enemies = frame.enemies.filter((e) => {
    const p = findPlayer(round, e.enemyId);
    return !p || isAlive(p, tMs);
  });
  const own = ownFootstepZones(round, team, tMs);
  const byKey = new Map<string, IntelSound>();
  for (const s of frame.snap.sounds ?? []) {
    const kind = s.kind ?? 'other';
    if (kind === 'footstep' && own.has(s.zone)) continue;
    const ageMs = (s.tMsAgo ?? 0) + (tMs - frame.tMs);
    const key = `${s.zone}|${kind}`;
    const prev = byKey.get(key);
    const masked = (s as { masked?: boolean }).masked;
    if (!prev || ageMs < prev.ageMs) byKey.set(key, { zone: s.zone, kind, ageMs, ...(masked !== undefined ? { masked } : {}) });
  }
  return { tMs, enemies, sounds: [...byKey.values()], belief: frame.snap.beliefZones };
}

// ── one player's view ───────────────────────────────────────────────────────────────────────

export interface SeenEnemy {
  readonly enemyId: string;
  /** 'duel' = opponent of a kill event with this player; 'sight' = team-visible and inside this player's vision. */
  readonly via: 'duel' | 'sight';
}
export interface PlayerView {
  readonly enemies: readonly SeenEnemy[];
  readonly sounds: readonly IntelSound[];
  readonly watched: readonly string[];
}

export function canHear(nav: NavModel, listenerZone: string, sound: Pick<IntelSound, 'zone' | 'kind'>): boolean {
  const loud = PERCEPTION.loudness[sound.kind] ?? 0.5;
  const floor = PERCEPTION.threshold[sound.kind] ?? 0.4;
  return loud * nav.audible(sound.zone, listenerZone) >= floor;
}

export function playerViewAt(
  nav: NavModel, round: RoundTimeline, playerId: string, tMs: number, intel: TeamIntel,
): PlayerView {
  const me = findPlayer(round, playerId);
  if (!me || !isAlive(me, tMs)) return { enemies: [], sounds: [], watched: [] };
  const seer = seerOf(round, me, tMs, nav);
  const enemies: SeenEnemy[] = [];

  const duel = contactAt(round, playerId, tMs);
  if (duel) enemies.push({ enemyId: duel.opponentId, via: 'duel' });

  const mates = teamPlayers(round, me.team).filter((p) => isAlive(p, tMs));
  for (const e of intel.enemies) {
    if (!e.visibleNow || enemies.some((x) => x.enemyId === e.enemyId)) continue;
    const target = findPlayer(round, e.enemyId);
    if (!target) continue;
    const tl = logicalAt(target, tMs);
    const seen: Seen = { pos: tl.pos, zone: tl.zone, alive: isAlive(target, tMs) };
    if (canSee(nav, seer, seen)) { enemies.push({ enemyId: e.enemyId, via: 'sight' }); continue;}
    // The team sees this enemy, so somebody does. If the approximated facing rules everyone
    // out, credit the nearest teammate with a zone sightline (cone ignored).
    const anyone = mates.some((m) => canSee(nav, seerOf(round, m, tMs, nav), seen));
    if (!anyone) {
      let best: PlayerRound | null = null; let bestD = Infinity;
      for (const m of mates) {
        const ml = logicalAt(m, tMs);
        if (!nav.hasSight(ml.zone, seen.zone)) continue;
        const d = dist3(ml.pos, seen.pos);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (best?.id === playerId) enemies.push({ enemyId: e.enemyId, via: 'sight' });
    }
  }

  return {
    enemies,
    sounds: intel.sounds.filter((s) => canHear(nav, seer.zone, s)),
    watched: watchedZones(nav, seer),
  };
}
