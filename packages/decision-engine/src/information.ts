/**
 * Information layer — each player knows only what they sensed; the team knows what was CALLED;
 * the IGL decides on what it has combined (docs/INFORMATION_LAYER.md).
 *
 *   sense  (per player)  sightings, sounds, utility, damage taken, spike sounds — each with the
 *                        time it was sensed and a confidence set by HOW it was sensed and the
 *                        player's awareness.
 *   comms  (per player)  one voice, one callout at a time: lethal info first; delay, accuracy and
 *                        completeness from communication / awareness / composure and load (in a
 *                        fight, blinded, several things at once). Reports can be late, partial or
 *                        wrong. A player who dies makes one last call, then is silent.
 *   minimap (team)       an enemy in a teammate's sight is spotted on every minimap (the game
 *                        rule), and recon reveals likewise — the IGL takes it in after a glance.
 *   fusion  (IGL)        the team picture is built from reports + minimap + the IGL's own senses.
 *                        Each claim is weighed recency × confidence × trust^q, trust being the
 *                        reporter's track record this match on a role/attribute prior, q the IGL's
 *                        call quality; the IGL also takes time to act on a delivered call.
 *
 * Everything is deterministic: every draw is a hash of (round, reporter, item, time), so the
 * layer never consumes the policy's RandomSource and one report's luck never shifts another's.
 *
 * TYPE BOUNDARY (DECISION-004): input is the team's own players + its observations only.
 */
import type {
  BeliefState,
  EnemyPositionBelief,
  ObservationState,
  ObservedEnemy,
  PlayerId,
  PlayerState,
  SoundKind,
  SoundObservation,
  SpatialQuery,
  TeamReport,
  Vector3,
  ZoneId,
} from "@pv/shared-types";
import { buildBeliefState } from "./belief.js";

// ───────────────────────────── attributes ─────────────────────────────

/** The information attributes of one player, each 0..1 (match-runner derives them from ratings). */
export interface InfoProfile {
  /** Stable identity across rounds and sides (the real player id) — keys the match trust ledger. */
  readonly key: string;
  /** How fast, clearly and completely a player calls what they know. */
  readonly communication: number;
  /** How well a player reads what reaches them: sound localisation, the minimap, distance. */
  readonly awareness: number;
  /** How much load (a fight, a flash, a burst of info) degrades the player's calls. */
  readonly composure: number;
  /** Shot-calling: how fast and how well the player, as IGL, re-plans on what reaches them. */
  readonly callQuality: number;
}

/** League-average information attributes (an unrated player). */
export const AVERAGE_INFO_PROFILE: Omit<InfoProfile, "key"> = {
  communication: 0.6,
  awareness: 0.6,
  composure: 0.6,
  callQuality: 0.6,
};

// ───────────────────────────── named formulas ─────────────────────────────
// Coefficients are the shape of each formula (manual approximations, documented in
// docs/INFORMATION_LAYER.md); outcomes vary only through the attributes and the situation.

/** Sight confidence: c = 1 − SIGHT_RANGE_DOUBT·(d/D)²·(1 − awareness). */
const SIGHT_RANGE_DOUBT = 0.4;
/** Visual range the doubt is scaled to (perception maxViewDistanceUnits). */
const VIEW_RANGE_UNITS = 4500;
/** Heard confidence: c = cue·(HEAR_FLOOR + (1 − HEAR_FLOOR)·awareness). */
const HEAR_FLOOR = 0.6;
/** Damage taken localises the shooter: c = DAMAGE_FLOOR + (1 − DAMAGE_FLOOR)·awareness. */
const DAMAGE_FLOOR = 0.7;
/** A sighting this close (units) is lethal information — called before anything else. */
const LETHAL_RANGE_UNITS = 1500;

/** Load L = FIGHT_LOAD·inFight + FLASH_LOAD·blinded + BURST_LOAD·(items − 1). */
const FIGHT_LOAD = 0.8;
const FLASH_LOAD = 0.6;
const BURST_LOAD = 0.25;

/** Callout reaction: t = (REACT_BASE + REACT_SKILL·(1 − comm))·(1 + L·(1 − composure)). */
const REACT_BASE_MS = 200;
const REACT_SKILL_MS = 500;
/** Speaking one callout: t = SPEECH_MS[kind]·(SPEECH_SLOW − SPEECH_SKILL·comm). */
const SPEECH_SLOW = 1.25;
const SPEECH_SKILL = 0.5;
const SPEECH_MS: Readonly<Record<InfoKind, number>> = {
  sighting: 450, footstep: 600, gunfire: 450, utility: 550, spike: 500, damage: 400, sound: 550, lastCall: 800,
};
/** Breath between two callouts by the same player. */
const SPEECH_GAP_MS = 100;
/** A call that cannot START within this long of the sensing is never made (it went stale). */
const STALE_CALL_MS = 3000;

/** Accuracy: P(wrong) = ERR_SKILL·(1 − (comm + awareness)/2) + ERR_LOAD·L·(1 − composure). */
const ERR_SKILL = 0.2;
const ERR_LOAD = 0.15;
/** Completeness: P(partial) = PARTIAL_LOAD·L·(1 − comm). */
const PARTIAL_LOAD = 0.4;

/** IGL processing of a delivered call: t = (PROC_BASE + PROC_SKILL·(1 − q))·(1 + L·(1 − composure)). */
const PROC_BASE_MS = 150;
const PROC_SKILL_MS = 600;
/** IGL notices a minimap spot: t = (GLANCE_BASE + GLANCE_SKILL·(1 − awareness))·(1 + L). */
const GLANCE_BASE_MS = 300;
const GLANCE_SKILL_MS = 1200;

/** Trust prior mean m0 = TRUST_BASE + TRUST_SKILL·(comm + awareness)/2 + ROLE_TRUST[role]; strength K. */
const TRUST_BASE = 0.5;
const TRUST_SKILL = 0.4;
const TRUST_PRIOR_STRENGTH = 6;
/** Players posted alone to watch ground (lurker, anchor): their calls are about the ground they hold. */
const ROLE_TRUST: Readonly<Record<string, number>> = { lurker: 0.05, anchor: 0.05 };
/** A report is judged against a minimap/own sighting of the same enemy within this window. */
const CONFIRM_WINDOW_MS = 1500;
/** A sound contact is confirmed by a sighting in the same / an adjacent zone within this window. */
const SOUND_CONFIRM_WINDOW_MS = 3000;

/** Recency: weight halves every HALF_LIFE (perception memory half-life). */
const RECENCY_HALF_LIFE_MS = 5000;
/** A claim is dropped from the team picture below this recency (perception forget threshold). */
const FORGET_BELOW = 0.1;
/** A footstep call is "current" this long; other sounds stay in the picture for the cue window. */
const FOOTSTEP_HOLD_MS = 3000;
const SOUND_HOLD_MS = 10_000;
/** A player re-calls an unchanged item after this long ("still two B main"). */
const REFRESH_MS: Readonly<Record<InfoKind, number>> = {
  sighting: 4000, footstep: 2000, gunfire: 3000, utility: 4000, spike: 4000, damage: 2000, sound: 3000, lastCall: Infinity,
};
/** The same item is never re-called sooner than this (a moving enemy is not narrated zone by zone). */
const MIN_RECALL_MS = 1000;
/** Comms priority: lethal info first. */
const PRIORITY: Readonly<Record<InfoKind, number>> = {
  lastCall: 5, damage: 4, sighting: 2, spike: 2, gunfire: 1.5, footstep: 1, utility: 1, sound: 0.5,
};
const LETHAL_PRIORITY = 3;

// ───────────────────────────── types ─────────────────────────────

export type InfoKind = "sighting" | "footstep" | "gunfire" | "utility" | "spike" | "damage" | "sound" | "lastCall";
export type CallAccuracy = "exact" | "wrongZone" | "wrongCount" | "partial";

/** One piece of knowledge a player holds. Times are on the round clock (ms since round start). */
export interface KnowledgeItem {
  readonly key: string;
  readonly kind: InfoKind;
  readonly soundKind: SoundKind | null;
  readonly enemyId: string | null;
  readonly zone: string;
  readonly position: Vector3;
  readonly count: number;
  readonly sensedAtMs: number;
  readonly confidence: number;
  readonly lethal: boolean;
  readonly live: boolean;
}

/** One callout: what a player said, when, and how it compares with what they knew. */
export interface CommsEvent {
  readonly id: number;
  readonly from: string;
  readonly kind: InfoKind;
  readonly key: string;
  readonly enemyId: string | null;
  /** What was said. */
  readonly zone: string;
  readonly count: number | null;
  /** What the caller actually knew. */
  readonly knownZone: string;
  readonly knownCount: number;
  readonly sensedAtMs: number;
  readonly startedAtMs: number;
  readonly deliveredAtMs: number;
  /** When the IGL has taken it in and acts on it (null: the IGL made it, or it was never said). */
  readonly iglAtMs: number | null;
  readonly accuracy: CallAccuracy;
  readonly confidence: number;
  readonly lethal: boolean;
  readonly lastCall: boolean;
  readonly dropped: boolean;
}

export interface InformationTrace {
  /** Who held the call, from when. */
  readonly igl: ReadonlyArray<{ readonly atMs: number; readonly playerId: string }>;
  /** Each player's knowledge as it formed (new or changed items). */
  readonly knowledge: Readonly<Record<string, readonly KnowledgeItem[]>>;
  /** Every callout, including the dropped (never said) ones. */
  readonly comms: readonly CommsEvent[];
  /** Minimap spots and reveals, with when the IGL noticed them. */
  readonly minimap: ReadonlyArray<{ readonly enemyId: string; readonly zone: string; readonly spottedAtMs: number; readonly noticedAtMs: number }>;
  /** Trust in each reporter at the end of the round (0..1). */
  readonly trust: Readonly<Record<string, number>>;
}

/** Track record of each player's calls this match (shared by both side policies). */
export class CommsLedger {
  private readonly record = new Map<string, { confirmed: number; refuted: number }>();
  get(key: string): { confirmed: number; refuted: number } {
    return this.record.get(key) ?? { confirmed: 0, refuted: 0 };
  }
  note(key: string, confirmed: boolean): void {
    const r = this.get(key);
    this.record.set(key, confirmed ? { ...r, confirmed: r.confirmed + 1 } : { ...r, refuted: r.refuted + 1 });
  }
}

/** Trust in a reporter: Beta posterior on a prior from attributes and role, updated by the ledger. */
export function reporterTrust(profile: Omit<InfoProfile, "key">, role: string | undefined, record: { confirmed: number; refuted: number }): number {
  const m0 = Math.min(0.95, TRUST_BASE + TRUST_SKILL * ((profile.communication + profile.awareness) / 2) + (role ? ROLE_TRUST[role] ?? 0 : 0));
  return (TRUST_PRIOR_STRENGTH * m0 + record.confirmed) / (TRUST_PRIOR_STRENGTH + record.confirmed + record.refuted);
}

/** Load on a player right now (0 = calm). */
export function callLoad(inFight: boolean, blinded: boolean, items: number): number {
  return FIGHT_LOAD * (inFight ? 1 : 0) + FLASH_LOAD * (blinded ? 1 : 0) + BURST_LOAD * Math.max(0, items - 1);
}

/** Time from sensing to starting to speak. */
export function callReactionMs(p: Omit<InfoProfile, "key">, load: number): number {
  return (REACT_BASE_MS + REACT_SKILL_MS * (1 - p.communication)) * (1 + load * (1 - p.composure));
}

/** Time to say one callout. */
export function speechMs(p: Omit<InfoProfile, "key">, kind: InfoKind): number {
  return SPEECH_MS[kind] * (SPEECH_SLOW - SPEECH_SKILL * p.communication);
}

/** P(the call is wrong) and P(the call is partial). */
export function callErrorChance(p: Omit<InfoProfile, "key">, load: number): { wrong: number; partial: number } {
  return {
    wrong: Math.min(0.9, ERR_SKILL * (1 - (p.communication + p.awareness) / 2) + ERR_LOAD * load * (1 - p.composure)),
    partial: Math.min(0.9, PARTIAL_LOAD * load * (1 - p.communication)),
  };
}

/** IGL time to take in a delivered call and act on it. */
export function iglProcessingMs(igl: Omit<InfoProfile, "key">, load: number): number {
  return (PROC_BASE_MS + PROC_SKILL_MS * (1 - igl.callQuality)) * (1 + load * (1 - igl.composure));
}

/** IGL time to notice a minimap spot. */
export function minimapGlanceMs(igl: Omit<InfoProfile, "key">, load: number): number {
  return (GLANCE_BASE_MS + GLANCE_SKILL_MS * (1 - igl.awareness)) * (1 + load);
}

/** Claim weight: recency × confidence × trust^q. */
export function claimWeight(ageMs: number, confidence: number, trust: number, callQuality: number): number {
  return Math.pow(0.5, Math.max(0, ageMs) / RECENCY_HALF_LIFE_MS) * confidence * Math.pow(trust, callQuality);
}

/** Deterministic hash draw in [0,1). */
export function hashDraw(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // final avalanche (murmur3 fmix32)
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ───────────────────────────── the layer ─────────────────────────────

interface Claim {
  readonly from: string; // reporter id, "minimap" or the IGL's own id
  readonly zone: string;
  readonly position: Vector3;
  readonly sensedAt: number;
  readonly confidence: number;
  readonly live: boolean;
  readonly reportId: number | null;
  judged: boolean;
  readonly ground: boolean; // minimap / own sight — what reports are judged against
}
interface Contact {
  readonly kind: SoundKind;
  readonly infoKind: InfoKind;
  readonly zone: string;
  readonly position: Vector3;
  readonly count: number;
  readonly sensedAt: number;
  readonly confidence: number;
  readonly from: string;
  readonly reportId: number | null;
  judged: boolean;
}
interface Mind {
  readonly known: Map<string, KnowledgeItem>;
  readonly said: Map<string, { zone: string; count: number; sensedAt: number }>;
  speakerFreeAt: number;
  lastHealth: number;
  alive: boolean;
  lastCallMade: boolean;
}
interface PendingCall {
  ev: CommsEvent;
  readonly item: KnowledgeItem;
  readonly said: { zone: string; position: Vector3; count: number | null; enemyId: string | null };
  ingested: boolean;
}

export interface InformationLayerOptions {
  /** Centre of a zone (same frame as positions) — lets a wrong-zone call point somewhere. */
  readonly zoneCentre?: (zoneId: string) => Vector3 | undefined;
  /** Test hook: replace the hash draw (u in [0,1)) for a given salt string. */
  readonly draw?: (salt: string) => number;
}

export interface InformationInput {
  readonly view: {
    readonly contextId: string;
    readonly timeRemainingMs: number;
    readonly spike: { readonly detonationInMs: number | null };
    readonly teammates: readonly PlayerState[];
    readonly observation: ObservationState;
    readonly perPlayerObservation?: Readonly<Record<string, ObservationState>>;
    readonly belief: BeliefState;
  };
  /** Per-player info attributes (sim id → profile); missing → league average. */
  readonly profiles?: ReadonlyMap<string, InfoProfile>;
  /** Roles of the last decision (sim id → role), for the trust prior. */
  readonly roles?: ReadonlyMap<string, string>;
}

export interface InformationOutput {
  /** The team picture the IGL decides on. */
  readonly observation: ObservationState;
  readonly belief: BeliefState;
  /** Current caller. */
  readonly iglId: string | null;
}

const v2 = (v: Vector3) => ({ x: v.x, y: v.y });
const dist = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

function infoKindOf(kind: SoundKind): InfoKind {
  switch (kind) {
    case "footstep":
    case "landing":
      return "footstep";
    case "gunfire":
      return "gunfire";
    case "abilityCast":
      return "utility";
    case "spikePlant":
    case "spikeDefuse":
      return "spike";
    default:
      return "sound";
  }
}

/**
 * The stateful per-team information layer. One instance per side policy; it resets itself on a
 * new round (new context id or the clock jumping back up) and keeps the match ledger across rounds.
 */
export class InformationLayer {
  private ledger: CommsLedger = new CommsLedger();
  private roundKey = "";
  private lastRemaining = Infinity;
  private lastDet: number | null = null;
  private clock = 0;
  private started = false;
  private minds = new Map<string, Mind>();
  private claims = new Map<string, Claim[]>();
  private contacts = new Map<string, Contact[]>();
  private calls: PendingCall[] = [];
  private spotSince = new Map<string, number>();
  private nextId = 1;
  private prevBelief: BeliefState | null = null;
  private prevAt: number | null = null;
  private iglId: string | null = null;
  // trace
  private iglLog: Array<{ atMs: number; playerId: string }> = [];
  private knowledgeLog = new Map<string, KnowledgeItem[]>();
  private minimapLog: Array<{ enemyId: string; zone: string; spottedAtMs: number; noticedAtMs: number }> = [];
  private readonly neighbourCache = new Map<string, readonly string[]>();
  private lastProfiles: ReadonlyMap<string, InfoProfile> | undefined;
  private lastRoles: ReadonlyMap<string, string> | undefined;

  constructor(private readonly spatial: SpatialQuery, private readonly options: InformationLayerOptions = {}) {}

  /** Share one track-record ledger across both side policies of a match. */
  setLedger(ledger: CommsLedger): void {
    this.ledger = ledger;
  }

  /** The round's information trace so far (per-player knowledge, comms, minimap, trust). */
  trace(): InformationTrace {
    const trust: Record<string, number> = {};
    for (const id of this.minds.keys()) trust[id] = this.trustOf(id);
    return {
      igl: this.iglLog.slice(),
      knowledge: Object.fromEntries([...this.knowledgeLog].map(([k, v]) => [k, v.slice()])),
      comms: this.calls.map((c) => c.ev),
      minimap: this.minimapLog.slice(),
      trust,
    };
  }

  /** Round clock (ms since the layer's first decision this round). */
  nowMs(): number {
    return this.clock;
  }

  private draw(salt: string): number {
    return this.options.draw ? this.options.draw(salt) : hashDraw(`${this.roundKey}|${salt}`);
  }

  private profileOf(id: string): InfoProfile {
    return this.lastProfiles?.get(id) ?? { key: id, ...AVERAGE_INFO_PROFILE };
  }

  private trustOf(id: string): number {
    const p = this.profileOf(id);
    return reporterTrust(p, this.lastRoles?.get(id), this.ledger.get(p.key));
  }

  private zoneOf(v: Vector3): string {
    return String(this.spatial.nearestZone(v2(v)));
  }

  private neighbours(zone: string): readonly string[] {
    const hit = this.neighbourCache.get(zone);
    if (hit) return hit;
    const out: string[] = [];
    for (const z of this.spatial.allZones()) {
      if (String(z) === zone) continue;
      const p = this.spatial.findPath(zone as ZoneId, z, "run");
      if (p && p.path.length === 2) out.push(String(z));
    }
    out.sort();
    this.neighbourCache.set(zone, out);
    return out;
  }

  private adjacent(a: string, b: string): boolean {
    return a === b || this.neighbours(a).includes(b);
  }

  private resetRound(contextId: string): void {
    this.roundKey = contextId;
    this.clock = 0;
    this.minds = new Map();
    this.claims = new Map();
    this.contacts = new Map();
    this.calls = [];
    this.spotSince = new Map();
    this.prevBelief = null;
    this.prevAt = null;
    this.iglId = null;
    this.iglLog = [];
    this.knowledgeLog = new Map();
    this.minimapLog = [];
  }

  private advanceClock(view: InformationInput["view"]): void {
    const r = view.timeRemainingMs;
    const d = view.spike.detonationInMs;
    const newRound = !this.started || view.contextId !== this.roundKey || r > this.lastRemaining;
    if (newRound) {
      this.resetRound(view.contextId);
      this.started = true;
    } else {
      const dR = Math.max(0, this.lastRemaining - r);
      const dD = this.lastDet !== null && d !== null ? Math.max(0, this.lastDet - d) : 0;
      this.clock += Math.max(dR, dD);
    }
    this.lastRemaining = r;
    this.lastDet = d;
  }

  /** Run one decision's worth of sensing, calling and fusion; return the team picture. */
  step(input: InformationInput): InformationOutput {
    const { view } = input;
    this.lastProfiles = input.profiles;
    this.lastRoles = input.roles;
    this.advanceClock(view);
    const now = this.clock;
    const obsNow = view.observation.timestampMs;
    const clockOf = (remainingStamp: number) => now - Math.max(0, obsNow - remainingStamp);
    const perPlayer = view.perPlayerObservation ?? {};
    const mates = view.teammates;

    for (const p of mates) {
      if (!this.minds.has(String(p.id))) {
        this.minds.set(String(p.id), { known: new Map(), said: new Map(), speakerFreeAt: 0, lastHealth: p.health, alive: p.alive, lastCallMade: !p.alive });
      }
    }

    // The caller: the living player with the best call quality (ties: id).
    const alive = mates.filter((p) => p.alive);
    const igl = alive.slice().sort((a, b) => this.profileOf(String(b.id)).callQuality - this.profileOf(String(a.id)).callQuality || (String(a.id) < String(b.id) ? -1 : 1))[0];
    const iglId = igl ? String(igl.id) : null;
    if (iglId !== this.iglId) {
      this.iglId = iglId;
      if (iglId) this.iglLog.push({ atMs: now, playerId: iglId });
    }

    // ── 1. sense ──
    const fresh = new Map<string, KnowledgeItem[]>(); // per player: items sensed this step
    const inFight = new Map<string, boolean>();
    const pooledCues = view.observation.audibleEvents.filter((e) => e.kind === "gunfire" || e.kind === "abilityCast");
    const add = (id: string, item: KnowledgeItem) => {
      const mind = this.minds.get(id)!;
      const prev = mind.known.get(item.key);
      mind.known.set(item.key, item);
      (fresh.get(id) ?? fresh.set(id, []).get(id)!).push(item);
      if (!prev || prev.zone !== item.zone || prev.count !== item.count) {
        (this.knowledgeLog.get(id) ?? this.knowledgeLog.set(id, []).get(id)!).push(item);
      }
    };
    const seenByAnyone = new Map<string, { enemy: ObservedEnemy; by: string }>();

    for (const p of alive) {
      const id = String(p.id);
      const prof = this.profileOf(id);
      const obs = perPlayer[id];
      let fight = false;
      if (obs) {
        for (const e of obs.visibleEnemies) {
          if (!e.currentlyVisible) continue;
          fight = true;
          const d = dist(p.position, e.lastSeenPosition);
          const conf = 1 - SIGHT_RANGE_DOUBT * Math.min(1, (d / VIEW_RANGE_UNITS) ** 2) * (1 - prof.awareness);
          add(id, {
            key: `enemy:${e.playerId}`, kind: "sighting", soundKind: null, enemyId: String(e.playerId),
            zone: this.zoneOf(e.lastSeenPosition), position: { ...e.lastSeenPosition }, count: 1, sensedAtMs: now,
            confidence: conf, lethal: d <= LETHAL_RANGE_UNITS, live: true,
          });
          if (!seenByAnyone.has(String(e.playerId))) seenByAnyone.set(String(e.playerId), { enemy: e, by: id });
        }
        // sounds: one item per (kind, zone), count = distinct sources heard there
        const groups = new Map<string, SoundObservation[]>();
        for (const s of obs.audibleEvents) {
          const k = `${infoKindOf(s.kind)}:${this.zoneOf(s.approxPosition)}`;
          (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
        }
        for (const [key, list] of groups) {
          const s0 = list.reduce((b, s) => (s.confidence > b.confidence ? s : b), list[0]!);
          const kind = infoKindOf(s0.kind);
          add(id, {
            key, kind, soundKind: s0.kind, enemyId: null, zone: key.slice(key.indexOf(":") + 1), position: { ...s0.approxPosition },
            count: kind === "footstep" ? list.length : 1, sensedAtMs: clockOf(Math.max(...list.map((s) => s.heardAtMs))),
            confidence: Math.min(1, s0.confidence * (HEAR_FLOOR + (1 - HEAR_FLOOR) * prof.awareness)), lethal: false, live: false,
          });
        }
      }
      inFight.set(id, fight);
    }

    // Shot / ability cues reach the team observation without a listener: the closest living
    // teammate (run time to the cue's zone) is the one who heard it best and calls it.
    for (const s of pooledCues) {
      const zone = this.zoneOf(s.approxPosition);
      let best: PlayerState | undefined;
      let bestT = Infinity;
      for (const p of alive) {
        const t = this.spatial.shortestTravelTimeMs(this.zoneOf(p.position) as ZoneId, zone as ZoneId, "run") ?? Infinity;
        if (t < bestT || (t === bestT && best && String(p.id) < String(best.id))) { best = p; bestT = t; }
      }
      if (!best) continue;
      const id = String(best.id);
      const kind = infoKindOf(s.kind);
      const key = `${kind}:${zone}`;
      const sensedAt = clockOf(s.heardAtMs);
      const prev = this.minds.get(id)!.known.get(key);
      if (prev && prev.sensedAtMs >= sensedAt) continue; // nothing newer
      const prof = this.profileOf(id);
      add(id, {
        key, kind, soundKind: s.kind, enemyId: null, zone, position: { ...s.approxPosition }, count: 1, sensedAtMs: sensedAt,
        confidence: Math.min(1, s.confidence * (HEAR_FLOOR + (1 - HEAR_FLOOR) * prof.awareness)), lethal: false, live: false,
      });
    }

    // Damage taken: the hit player knows a gun is on them, and roughly from where.
    for (const p of alive) {
      const id = String(p.id);
      const mind = this.minds.get(id)!;
      if (p.health < mind.lastHealth) {
        inFight.set(id, true);
        const myZone = this.zoneOf(p.position);
        let src: SoundObservation | undefined;
        let srcT = Infinity;
        for (const s of pooledCues) {
          if (s.kind !== "gunfire") continue;
          const t = this.spatial.shortestTravelTimeMs(myZone as ZoneId, this.zoneOf(s.approxPosition) as ZoneId, "run") ?? Infinity;
          if (t < srcT) { src = s; srcT = t; }
        }
        const seen = (fresh.get(id) ?? []).find((k) => k.kind === "sighting");
        if (seen) {
          mind.known.set(seen.key, { ...seen, lethal: true });
          const list = fresh.get(id)!;
          list[list.indexOf(seen)] = { ...seen, lethal: true };
        } else {
          const prof = this.profileOf(id);
          const where = src ? src.approxPosition : p.position;
          const zone = src ? this.zoneOf(src.approxPosition) : myZone;
          add(id, {
            key: `damage:${zone}`, kind: "damage", soundKind: "gunfire", enemyId: null, zone, position: { ...where }, count: 1,
            sensedAtMs: now, confidence: DAMAGE_FLOOR + (1 - DAMAGE_FLOOR) * prof.awareness, lethal: true, live: false,
          });
        }
      }
      mind.lastHealth = p.health;
    }

    // ── 2. comms: each living player calls what is new, lethal first ──
    for (const p of alive) {
      const id = String(p.id);
      const mind = this.minds.get(id)!;
      const prof = this.profileOf(id);
      const items = (fresh.get(id) ?? []).filter((it) => {
        const s = mind.said.get(it.key);
        if (!s) return true;
        const since = it.sensedAtMs - s.sensedAt;
        // more news (moved, or more of them) is called again; the same news only once it is going stale
        return since >= REFRESH_MS[it.kind] || (since >= MIN_RECALL_MS && (s.zone !== it.zone || it.count > s.count));
      });
      if (items.length === 0) continue;
      const blinded = ((p as unknown as { blindRemainingMs?: number }).blindRemainingMs ?? 0) > 0;
      const load = callLoad(inFight.get(id) ?? false, blinded, items.length);
      items.sort((a, b) => this.priority(b) - this.priority(a) || a.sensedAtMs - b.sensedAtMs || (a.key < b.key ? -1 : 1));
      for (const it of items) this.schedule(id, prof, mind, it, load, false, iglId);
    }

    // A player who died since the last decision: in-flight calls finish, queued ones are lost,
    // and they make one last call — then nothing more.
    for (const p of mates) {
      const id = String(p.id);
      const mind = this.minds.get(id)!;
      if (p.alive || mind.lastCallMade) { mind.alive = p.alive; continue; }
      mind.alive = false;
      mind.lastCallMade = true;
      for (const c of this.calls) {
        if (c.ev.from === id && !c.ev.dropped && c.ev.startedAtMs > now) {
          c.ev = { ...c.ev, dropped: true, iglAtMs: null };
        }
      }
      const prof = this.profileOf(id);
      const recent = [...mind.known.values()].filter((k) => now - k.sensedAtMs <= STALE_CALL_MS);
      recent.sort((a, b) => this.priority(b) - this.priority(a) || b.sensedAtMs - a.sensedAtMs);
      const top = recent[0];
      const deathZone = this.zoneOf(p.position);
      const enemiesKnown = new Set(recent.filter((k) => k.enemyId).map((k) => k.enemyId)).size;
      const item: KnowledgeItem = top
        ? { ...top, key: `last:${top.key}`, kind: top.kind === "sighting" ? "sighting" : "lastCall", count: Math.max(1, enemiesKnown, top.count), lethal: true, sensedAtMs: now }
        : { key: `last:${deathZone}`, kind: "lastCall", soundKind: "gunfire", enemyId: null, zone: deathZone, position: { ...p.position }, count: 1, sensedAtMs: now, confidence: 0.6, lethal: true, live: false };
      mind.speakerFreeAt = Math.min(mind.speakerFreeAt, now);
      this.schedule(id, prof, mind, item, callLoad(true, false, 1), true, iglId);
    }

    // ── 3. the IGL's picture ──
    const iglProf = iglId ? this.profileOf(iglId) : { key: "", ...AVERAGE_INFO_PROFILE };
    const iglLoad = iglId ? callLoad(inFight.get(iglId) ?? false, false, 1) : 0;
    // (a) what the IGL senses themself is known at once
    if (iglId) {
      for (const it of fresh.get(iglId) ?? []) this.ingest(it, iglId, null, true);
    }
    // (b) minimap: every enemy in a teammate's sight is spotted for the team; the IGL notices it
    // after a glance and then tracks it while it stays spotted. Recon reveals arrive the same way.
    const glance = minimapGlanceMs(iglProf, iglLoad);
    for (const id of [...this.spotSince.keys()]) if (!seenByAnyone.has(id)) this.spotSince.delete(id);
    for (const [enemyId, { enemy }] of seenByAnyone) {
      if (!this.spotSince.has(enemyId)) {
        this.spotSince.set(enemyId, now);
        this.minimapLog.push({ enemyId, zone: this.zoneOf(enemy.lastSeenPosition), spottedAtMs: now, noticedAtMs: now + glance });
      }
      if (now >= this.spotSince.get(enemyId)! + glance) {
        this.addClaim(enemyId, { from: "minimap", zone: this.zoneOf(enemy.lastSeenPosition), position: { ...enemy.lastSeenPosition }, sensedAt: now, confidence: 1, live: true, reportId: null, judged: true, ground: true });
      }
    }
    const perPlayerIds = new Set<string>();
    for (const o of Object.values(perPlayer)) for (const e of o.visibleEnemies) perPlayerIds.add(String(e.playerId));
    for (const e of view.observation.visibleEnemies) {
      const enemyId = String(e.playerId);
      if (perPlayerIds.has(enemyId) || e.currentlyVisible) continue; // a reveal: nobody's own sight
      const at = clockOf(e.lastSeenAtMs);
      const known = this.claims.get(enemyId)?.some((c) => c.from === "minimap" && c.sensedAt >= at);
      if (known || now < at + glance) continue;
      this.addClaim(enemyId, { from: "minimap", zone: this.zoneOf(e.lastSeenPosition), position: { ...e.lastSeenPosition }, sensedAt: at, confidence: 1, live: false, reportId: null, judged: true, ground: true });
      this.minimapLog.push({ enemyId, zone: this.zoneOf(e.lastSeenPosition), spottedAtMs: at, noticedAtMs: at + glance });
    }
    // (c) calls the IGL has taken in by now
    for (const c of this.calls) {
      if (c.ingested || c.ev.dropped || c.ev.iglAtMs === null || c.ev.iglAtMs > now) continue;
      c.ingested = true;
      this.ingestCall(c);
    }

    // ── 4. judge reports against ground claims (the trust ledger) ──
    this.judge(now);

    // ── 5. fuse ──
    const observation = this.fuse(view, iglProf.callQuality, now);
    const dt = this.prevBelief ? Math.max(0, now - (this.prevAt ?? now)) : 0;
    let belief = buildBeliefState(this.prevBelief, observation, this.spatial, dt);
    belief = this.withConflicts(belief, iglProf.callQuality, now);
    this.prevBelief = belief;
    this.prevAt = now;
    return { observation, belief, iglId };
  }

  private priority(it: KnowledgeItem): number {
    return Math.max(PRIORITY[it.kind], it.lethal ? LETHAL_PRIORITY : 0);
  }

  private schedule(id: string, prof: InfoProfile, mind: Mind, it: KnowledgeItem, load: number, lastCall: boolean, iglId: string | null): void {
    const kind: InfoKind = lastCall ? "lastCall" : it.kind;
    const start = Math.max(it.sensedAtMs + (lastCall ? 0 : callReactionMs(prof, load)), mind.speakerFreeAt);
    const dropped = !lastCall && start - it.sensedAtMs > STALE_CALL_MS;
    const dur = speechMs(prof, kind);
    const delivered = start + dur;
    // accuracy
    const err = callErrorChance(prof, load);
    const u = this.draw(`acc|${id}|${it.key}|${Math.round(it.sensedAtMs)}`);
    let accuracy: CallAccuracy = "exact";
    let zone = it.zone;
    let position = it.position;
    let count: number | null = it.count;
    let enemyId = it.enemyId;
    if (u < err.wrong) {
      const u2 = this.draw(`err|${id}|${it.key}|${Math.round(it.sensedAtMs)}`);
      const nb = this.neighbours(it.zone);
      const centre = nb.length > 0 ? this.options.zoneCentre?.(nb[Math.floor(u2 * nb.length) % nb.length]!) : undefined;
      const countable = it.kind === "footstep" || lastCall;
      if (centre && (!countable || u2 < 0.5)) {
        accuracy = "wrongZone";
        zone = nb[Math.floor(u2 * nb.length) % nb.length]!;
        position = { ...centre };
      } else if (countable) {
        accuracy = "wrongCount";
        count = Math.max(1, it.count + (u2 < 0.75 ? 1 : -1));
      }
    } else if (u < err.wrong + err.partial) {
      accuracy = "partial";
      count = null; // "they're B" — no number
      if (it.kind === "sighting") enemyId = null; // a body, not who
    }
    const iglAt = dropped || iglId === null || iglId === id ? null : delivered + iglProcessingMs(this.profileOf(iglId), 0);
    const ev: CommsEvent = {
      id: this.nextId++, from: id, kind, key: it.key, enemyId, zone, count, knownZone: it.zone, knownCount: it.count,
      sensedAtMs: it.sensedAtMs, startedAtMs: start, deliveredAtMs: delivered, iglAtMs: iglAt, accuracy, confidence: it.confidence,
      lethal: it.lethal, lastCall, dropped,
    };
    this.calls.push({ ev, item: it, said: { zone, position, count, enemyId }, ingested: false });
    if (!dropped) {
      mind.speakerFreeAt = delivered + SPEECH_GAP_MS;
      mind.said.set(it.key, { zone: it.zone, count: it.count, sensedAt: it.sensedAtMs });
    }
  }

  /** The IGL's own sensing, straight into the picture. */
  private ingest(it: KnowledgeItem, from: string, reportId: number | null, ground: boolean): void {
    if (it.kind === "sighting" && it.enemyId) {
      this.addClaim(it.enemyId, { from, zone: it.zone, position: it.position, sensedAt: it.sensedAtMs, confidence: it.confidence, live: it.live, reportId, judged: ground, ground });
    } else {
      this.addContact({ kind: it.soundKind ?? "other", infoKind: it.kind, zone: it.zone, position: it.position, count: it.count, sensedAt: it.sensedAtMs, confidence: it.confidence, from, reportId, judged: ground });
    }
  }

  private ingestCall(c: PendingCall): void {
    const { ev, item, said } = c;
    if ((item.kind === "sighting") && said.enemyId) {
      this.addClaim(said.enemyId, { from: ev.from, zone: said.zone, position: said.position, sensedAt: item.sensedAtMs, confidence: item.confidence, live: false, reportId: ev.id, judged: false, ground: false });
      return;
    }
    const kind: SoundKind = item.kind === "sighting" ? "other" : item.soundKind ?? (ev.lastCall ? "gunfire" : "other");
    const infoKind: InfoKind = item.kind === "sighting" ? "sound" : item.kind === "lastCall" ? "gunfire" : item.kind;
    this.addContact({ kind, infoKind, zone: said.zone, position: said.position, count: said.count ?? 1, sensedAt: item.sensedAtMs, confidence: item.confidence, from: ev.from, reportId: ev.id, judged: false });
  }

  private addClaim(enemyId: string, c: Claim): void {
    const list = this.claims.get(enemyId) ?? [];
    // one claim per source: the newest replaces the older one from the same source
    const i = list.findIndex((x) => x.from === c.from);
    if (i >= 0) {
      if (list[i]!.sensedAt > c.sensedAt) return;
      list[i] = c;
    } else list.push(c);
    this.claims.set(enemyId, list);
  }

  private addContact(c: Contact): void {
    const key = `${c.kind}:${c.zone}`;
    const list = this.contacts.get(key) ?? [];
    const i = list.findIndex((x) => x.from === c.from);
    if (i >= 0) {
      if (list[i]!.sensedAt > c.sensedAt) return;
      list[i] = c;
    } else list.push(c);
    this.contacts.set(key, list);
  }

  private judge(now: number): void {
    const ground: Array<{ enemyId: string; c: Claim }> = [];
    for (const [enemyId, list] of this.claims) for (const c of list) if (c.ground) ground.push({ enemyId, c });
    if (ground.length === 0) return;
    for (const [enemyId, list] of this.claims) {
      for (const c of list) {
        if (c.judged || c.ground) continue;
        const g = ground.find((x) => x.enemyId === enemyId && Math.abs(x.c.sensedAt - c.sensedAt) <= CONFIRM_WINDOW_MS);
        if (!g) {
          if (now - c.sensedAt > CONFIRM_WINDOW_MS) c.judged = true; // nothing to judge it by
          continue;
        }
        c.judged = true;
        this.ledger.note(this.profileOf(c.from).key, this.adjacent(c.zone, g.c.zone));
      }
    }
    for (const list of this.contacts.values()) {
      for (const c of list) {
        if (c.judged || c.reportId === null) continue;
        const g = ground.find((x) => this.adjacent(c.zone, x.c.zone) && Math.abs(x.c.sensedAt - c.sensedAt) <= SOUND_CONFIRM_WINDOW_MS);
        if (g) {
          c.judged = true;
          this.ledger.note(this.profileOf(c.from).key, true);
        } else if (now - c.sensedAt > SOUND_CONFIRM_WINDOW_MS) c.judged = true; // a sound unseen is not a lie
      }
    }
  }

  private sourceTrust(from: string): number {
    return from === "minimap" || from === this.iglId ? 1 : this.trustOf(from);
  }

  private fuse(view: InformationInput["view"], q: number, now: number): ObservationState {
    const remOf = (c: number) => view.timeRemainingMs - (now - c);
    const visibleEnemies: ObservedEnemy[] = [];
    for (const [enemyId, list] of [...this.claims].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const live = list.filter((c) => Math.pow(0.5, (now - c.sensedAt) / RECENCY_HALF_LIFE_MS) >= FORGET_BELOW);
      if (live.length === 0) continue;
      const best = live.reduce((b, c) => (claimWeight(now - c.sensedAt, c.confidence, this.sourceTrust(c.from), q) > claimWeight(now - b.sensedAt, b.confidence, this.sourceTrust(b.from), q) ? c : b), live[0]!);
      visibleEnemies.push({
        playerId: enemyId as PlayerId, agentId: null, lastSeenPosition: { ...best.position }, lastSeenAtMs: remOf(best.sensedAt),
        healthBand: "unknown", observedWeaponId: null, currentlyVisible: best.live && best.sensedAt === now,
      });
    }
    const audibleEvents: SoundObservation[] = [];
    for (const key of [...this.contacts.keys()].sort()) {
      const list = this.contacts.get(key)!;
      const hold = list[0]!.infoKind === "footstep" ? FOOTSTEP_HOLD_MS : SOUND_HOLD_MS;
      const current = list.filter((c) => now - c.sensedAt <= hold);
      if (current.length === 0) continue;
      // several callers on one spot are one spot: the freshest call, the largest count heard
      const best = current.reduce((b, c) => (c.sensedAt > b.sensedAt || (c.sensedAt === b.sensedAt && c.confidence > b.confidence) ? c : b), current[0]!);
      const count = best.infoKind === "footstep" ? Math.max(...current.map((c) => c.count)) : 1;
      const confidence = Math.min(1, best.confidence * Math.pow(this.sourceTrust(best.from), q));
      for (let k = 0; k < count; k++) audibleEvents.push({ kind: best.kind, approxPosition: { ...best.position }, heardAtMs: remOf(best.sensedAt), confidence });
    }
    const teammateReports: TeamReport[] = this.calls
      .filter((c) => !c.ev.dropped && c.ev.deliveredAtMs <= now && now - c.ev.deliveredAtMs <= SOUND_HOLD_MS)
      .map((c) => ({ fromPlayerId: c.ev.from as PlayerId, aboutEnemy: (c.said.enemyId as PlayerId | null) ?? null, approxPosition: { ...c.said.position }, reportedAtMs: remOf(c.ev.deliveredAtMs) }));
    return {
      observerId: view.observation.observerId,
      teamId: view.observation.teamId,
      timestampMs: view.observation.timestampMs,
      visibleEnemies,
      audibleEvents,
      teammateReports,
      knownMapChanges: view.observation.knownMapChanges,
    };
  }

  /** Enemies with conflicting claims keep every live claim as a weighted hypothesis. */
  private withConflicts(belief: BeliefState, q: number, now: number): BeliefState {
    const out: EnemyPositionBelief[] = belief.enemyPositionBeliefs.map((b) => {
      const list = (this.claims.get(String(b.enemyId)) ?? []).filter((c) => Math.pow(0.5, (now - c.sensedAt) / RECENCY_HALF_LIFE_MS) >= FORGET_BELOW);
      const zones = new Set(list.map((c) => c.zone));
      if (zones.size < 2) return b;
      const ws = list.map((c) => ({ c, w: claimWeight(now - c.sensedAt, c.confidence, this.sourceTrust(c.from), q) }));
      const total = ws.reduce((s, x) => s + x.w, 0);
      if (total <= 0) return b;
      return { ...b, hypotheses: ws.map((x) => ({ position: { ...x.c.position }, weight: x.w / total })), staleness: b.staleness };
    });
    return { ...belief, enemyPositionBeliefs: out };
  }
}
