// Scouting knowledge — attribute fog for the manager (docs/GENERATED_PEOPLE.md §9).
//
// The manager never sees a player's true attributes unless the player is in their own club. Every
// other player is shown as ranges whose width is set by the club's KNOWLEDGE κ ∈ [0, 1] of that
// player. Knowledge comes from:
//   reputation  κ0 = κ0,min + κ0,span · fame,  fame = min(1, public maps / famousMaps)   (the floor)
//   time        κ ← κ0 + (κ − κ0) · exp(−Δdays / τ)            unrefreshed knowledge fades to κ0
//   scouts      weekly, per assignment:  Δκ = G_kind · e · q(scout) · (1 − κ)
//               q(scout) = qBase + qSpan · judgingAbility       (the scout attribute → knowledge gain)
//               e = exposure of the player to that assignment (rostered / academy / free agent)
//   matches     each map the club plays against or with a player: Δκ = G_map · q_best · (1 − κ)
//   youth trial the season's new prospects of the club's region: Δκ = G_trial · q_best · (1 − κ)
//
// What κ does to the view (all half-widths in attribute units, 0..1):
//   attribute   h = h_min + h_span · (1 − κ) · (1 − accA · judgingAbility_best)
//   CA          h_CA = mean_k h_k              (CA is the mean of the attributes, so its error is too)
//   PA          h_PA = hPa_min + (hPa_span · (1 − κ) + hPa_youth · youth(age)) · (1 − accP · judgingPotential_best)
//   estimate    est = true + h · ½·z,  z ~ N(0,1) clamped to ±2, fixed per (club, player, attribute)
//               → the shown range [est − h, est + h] always contains the true value
//   own players h = hOwn_min + hOwn_span · (1 − coach.development)   (the coaching staff's read)
//
// AI clubs keep the scout-error model in scouting.ts (estimateAbility) — `estimateForTeam` routes
// the manager's club here and every other club there, so AI decisions are unchanged.
//
// INTERFACE for the staff market (club operations): a scout is any WorldStaff with role "scout"
// employed by the club (`teamId`), see `clubScouts`. In: its `attributes.judgingAbility` and
// `attributes.judgingPotential` (0..1). Out: `scoutGain(scout)` — the knowledge gain factor q —
// and the accuracy terms above. Extra scout attributes are ignored.
import { CAREER_MODEL } from "./ability.ts";
import { daysBetween, weekday, type IsoDate } from "./career/calendar.ts";
import { ABILITY_KEYS, type AbilityKey, type World, type WorldPlayer, type WorldStaff } from "./model.ts";
import { estimateAbility, estimateAttributes, teamScout, UNRATED_ABILITY, type AbilityEstimate, type AttributeEstimate } from "./scouting.ts";
import { clamp, normal, streamFor } from "./rng.ts";
import type { Region } from "./regions.ts";

export const KNOWLEDGE_MODEL = {
  /** Reputation floor: κ0 = min + span · fame. */
  priorMin: 0.05,
  priorSpan: 0.45,
  /** Public maps at which a player is fully famous. */
  famousMaps: 150,
  /** Days for unrefreshed knowledge to fade by a factor e toward the reputation floor. */
  decayDays: 120,
  /** Knowledge gain factor of a scout: q = qBase + qSpan · judgingAbility (no scout: qNone). */
  qBase: 0.5,
  qSpan: 0.5,
  qNone: 0.3,
  /** Weekly gain per assignment kind (fraction of the missing knowledge at q = 1). */
  gainPlayer: 0.3,
  gainRegion: 0.04,
  gainLeague: 0.08,
  gainYouth: 0.1,
  /** The league the club plays in is watched anyway (no scout needed). */
  gainPassive: 0.01,
  /** Per map played against / with a player. */
  gainMap: 0.06,
  /** Youth trial for the season's new prospects of the club's region. */
  gainTrial: 0.25,
  /** Exposure of a player to region / league scouting by status. */
  exposureRostered: 1,
  exposureAcademy: 0.6,
  exposureFree: 0.4,
  /** Youth scouting covers players this age and younger. */
  youthMaxAge: 19,
  /** Attribute half-width h = hMin + hSpan · (1 − κ) · (1 − accA · judgingAbility). */
  hMin: 0.01,
  hSpan: 0.16,
  accA: 0.5,
  /** PA half-width: hPaMin + (hPaSpan·(1 − κ) + hPaYouth·youth(age)) · (1 − accP · judgingPotential). */
  hPaMin: 0.01,
  hPaSpan: 0.12,
  hPaYouth: 0.06,
  accP: 0.6,
  /** Own players: hOwn = min + span · (1 − coach.development). */
  hOwnMin: 0.005,
  hOwnSpan: 0.03,
  /**
   * Region / league / youth assignments write up, each week, the players they covered whom the club
   * rates most promising (estimated PA), known at least `reportMinKnowledge`, and not reported in the
   * last `reportEveryDays` days — at most `discoveriesPerWeek` per scout.
   */
  reportMinKnowledge: 0.2,
  reportEveryDays: 56,
  discoveriesPerWeek: 3,
  reportsKept: 8,
  /** Recommendation: "sign" when the estimate beats the weakest starter by signMargin (CA, or PA for ≤ 21). */
  signMargin: 0.02,
} as const;

export type AssignmentKind = "player" | "region" | "league" | "youth";

export interface ScoutAssignment {
  readonly scoutId: string;
  readonly kind: AssignmentKind;
  /** playerId (player), region (region / youth); league: the career league (unused). */
  readonly target: string | null;
  readonly since: IsoDate;
}

export type Recommendation = "sign" | "monitor" | "pass";

export interface ScoutReport {
  readonly date: IsoDate;
  readonly playerId: string;
  readonly scoutId: string | null;
  readonly kind: AssignmentKind | "match" | "trial";
  readonly knowledge: number;
  readonly ca: readonly [number, number];
  readonly pa: readonly [number, number];
  readonly recommendation: Recommendation;
}

export interface KnowledgeEntry {
  /** κ as of `date`. */
  k: number;
  date: IsoDate;
  /** A discovery report has been written. */
  reported?: boolean;
}

export interface ScoutingState {
  readonly version: 1;
  /** The manager's club (whose view this is). */
  readonly teamId: string;
  knowledge: Record<string, KnowledgeEntry>;
  assignments: ScoutAssignment[];
  /** Reports per player, oldest first (at most reportsKept). */
  reports: Record<string, ScoutReport[]>;
  /** Teams of the league the club plays in (watched passively; the league assignment). */
  league: string[];
  /** YYYY-MM-DD of the last weekly tick. */
  lastTick: IsoDate | null;
  /** Reports written since the manager last looked (for the inbox summary). */
  unseen: number;
}

const K = KNOWLEDGE_MODEL;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

// --- scouts (the staff-market interface) ----------------------------------------------------------

/** Every scout a club employs: its scout post plus any other staff with role "scout" at the club. */
export function clubScouts(w: World, teamId: string): WorldStaff[] {
  const post = w.teams[teamId]?.staff.scout;
  const out = Object.values(w.staff).filter((s) => s.role === "scout" && s.teamId === teamId);
  if (post && w.staff[post] && !out.some((s) => s.staffId === post)) out.push(w.staff[post]!);
  return out.sort((a, b) => a.staffId.localeCompare(b.staffId));
}

/** Knowledge gain factor of a scout: q = qBase + qSpan · judgingAbility. */
export function scoutGain(scout: WorldStaff | null | undefined): number {
  return scout ? K.qBase + K.qSpan * clamp(scout.attributes.judgingAbility ?? 0, 0, 1) : K.qNone;
}

/** The club's best judging attributes (they set how accurate the ranges are). */
export function clubJudging(w: World, teamId: string): { ability: number; potential: number; q: number } {
  const scouts = clubScouts(w, teamId);
  return {
    ability: Math.max(0, ...scouts.map((s) => s.attributes.judgingAbility ?? 0)),
    potential: Math.max(0, ...scouts.map((s) => s.attributes.judgingPotential ?? 0)),
    q: Math.max(K.qNone, ...scouts.map(scoutGain)),
  };
}

// --- knowledge ----------------------------------------------------------------------------------------

/** Maps on public record: the dataset's sample (largest nMaps of any rating) plus maps played in this world. */
export function publicMaps(p: WorldPlayer): number {
  let n = 0;
  for (const slot of Object.values(p.attributes ?? {})) {
    const m = (slot as { nMaps?: number }).nMaps;
    if (typeof m === "number" && m > n) n = m;
  }
  return (p.generated ? 0 : n) + p.careerMaps;
}

/** Reputation floor κ0. */
export function priorKnowledge(p: WorldPlayer): number {
  return K.priorMin + K.priorSpan * Math.min(1, publicMaps(p) / K.famousMaps);
}

/** κ of a player for the manager's club on `date` (fade applied). Own players: 1. */
export function knowledgeOf(w: World, p: WorldPlayer, date?: IsoDate): number {
  const sc = w.scouting;
  if (!sc) return 1;
  if (p.teamId === sc.teamId) return 1;
  const k0 = priorKnowledge(p);
  const e = sc.knowledge[p.playerId];
  if (!e) return k0;
  const days = date ? Math.max(0, daysBetween(e.date, date)) : 0;
  return Math.max(k0, k0 + (e.k - k0) * Math.exp(-days / K.decayDays));
}

function setKnowledge(sc: ScoutingState, p: WorldPlayer, k: number, date: IsoDate): void {
  const prev = sc.knowledge[p.playerId];
  sc.knowledge[p.playerId] = { k: r4(clamp(k, 0, 1)), date, ...(prev?.reported ? { reported: true } : {}) };
}

/** Apply Δκ = gain · (1 − κ) to one player (after fading to `date`). */
function learn(w: World, p: WorldPlayer, gain: number, date: IsoDate): number {
  const sc = w.scouting!;
  const k = knowledgeOf(w, p, date);
  const next = k + clamp(gain, 0, 1) * (1 - k);
  setKnowledge(sc, p, next, date);
  return next;
}

// --- the view -----------------------------------------------------------------------------------------

export interface Range { readonly est: number; readonly lo: number; readonly hi: number }

export interface PlayerView {
  /** κ (1 for own players). */
  readonly knowledge: number;
  /** The manager's own player (coaching-staff view). */
  readonly own: boolean;
  /** Per ability / rated attribute (only the ones the player has a value for). */
  readonly attributes: Partial<Record<string, Range>>;
  readonly ca: Range;
  readonly pa: Range;
}

const YOUTH = (age: number): number => {
  const m = CAREER_MODEL;
  return clamp((m.maturityFullAge - age) / (m.maturityFullAge - m.prospectMinAge), 0, 1);
};

function exact(v: number): Range { return { est: v, lo: v, hi: v }; }

/**
 * What the viewing club sees of a player. Without a scouting state (sandbox / AI) the view is
 * exact — the fog belongs to the manager's career.
 */
export function viewPlayer(w: World, p: WorldPlayer, date?: IsoDate): PlayerView {
  const sc = w.scouting;
  const attrs = p.attributes ?? {};
  const rated = Object.entries(attrs).filter(([, s]) => typeof (s as { value: unknown }).value === "number") as Array<[string, { value: number }]>;
  const trueCa = p.ca ?? UNRATED_ABILITY;
  const truePa = p.pa ?? trueCa;
  if (!sc) {
    return { knowledge: 1, own: false, attributes: Object.fromEntries(rated.map(([k, s]) => [k, exact(s.value)])), ca: exact(trueCa), pa: exact(truePa) };
  }
  const own = p.teamId === sc.teamId;
  const kappa = own ? 1 : knowledgeOf(w, p, date ?? sc.lastTick ?? undefined);
  const j = clubJudging(w, sc.teamId);
  const coachId = w.teams[sc.teamId]?.staff.headCoach;
  const coachDev = coachId ? w.staff[coachId]?.attributes.development ?? 0 : 0;
  const hAttr = own ? K.hOwnMin + K.hOwnSpan * (1 - coachDev) : K.hMin + K.hSpan * (1 - kappa) * (1 - K.accA * j.ability);
  const rng = streamFor(w.seed, `fog:${sc.teamId}:${p.playerId}`);
  const z = (): number => normal(rng, 2) / 2; // |z/2| ≤ 1 → the range holds the true value
  const cal = w.calibration;
  const out: Record<string, Range> = {};
  let hSum = 0;
  let estSum = 0;
  let n = 0;
  for (const [k, s] of rated) {
    const lo0 = cal.min[k as AbilityKey] ?? 0;
    const hi0 = cal.max[k as AbilityKey] ?? 1;
    const est = clamp(s.value + hAttr * z(), Math.min(lo0, s.value), Math.max(hi0, s.value));
    out[k] = { est: r4(est), lo: r4(Math.max(0, est - hAttr)), hi: r4(Math.min(1, est + hAttr)) };
    if ((ABILITY_KEYS as readonly string[]).includes(k)) { hSum += hAttr; estSum += est; n += 1; }
  }
  const caEst = n === ABILITY_KEYS.length ? estSum / n : trueCa + hAttr * z();
  const hCa = n ? hSum / n : hAttr;
  const ca: Range = { est: r4(caEst), lo: r4(caEst - hCa), hi: r4(caEst + hCa) };
  const hPa = own
    ? K.hOwnMin + (K.hOwnSpan + K.hPaYouth * YOUTH(p.age)) * (1 - coachDev * K.accP)
    : K.hPaMin + (K.hPaSpan * (1 - kappa) + K.hPaYouth * YOUTH(p.age)) * (1 - K.accP * j.potential);
  const raw = truePa + hPa * z(); // |raw − PA| ≤ hPa
  const paEst = Math.max(ca.est, raw); // PA is never shown below CA
  const pa: Range = { est: r4(paEst), lo: r4(Math.max(ca.lo, raw - hPa)), hi: r4(Math.max(ca.hi, paEst + hPa)) };
  return { knowledge: r4(kappa), own, attributes: out, ca, pa };
}

/**
 * The CA/PA estimate a club decides by: the manager's club → its knowledge view; any other club →
 * its scout's estimate (scouting.ts), unchanged.
 */
export function estimateForTeam(w: World, teamId: string | null | undefined, p: WorldPlayer): AbilityEstimate {
  if (teamId && w.scouting && w.scouting.teamId === teamId) {
    const v = viewPlayer(w, p);
    return { ca: v.ca.est, caLo: v.ca.lo, caHi: v.ca.hi, pa: v.pa.est, paLo: v.pa.lo, paHi: v.pa.hi };
  }
  return estimateAbility(w, teamScout(w, teamId), p);
}

/**
 * Per-attribute ranges as a club sees them ({value, lo, hi}): the manager's club → its knowledge
 * view; any other club → its scout's ranges (scouting.ts estimateAttributes).
 */
export function attributeRangesForTeam(w: World, teamId: string | null | undefined, p: WorldPlayer): Record<string, AttributeEstimate> {
  if (teamId && w.scouting && w.scouting.teamId === teamId) {
    const v = viewPlayer(w, p);
    return Object.fromEntries(Object.entries(v.attributes).map(([k, r]) => [k, { value: r!.est, lo: r!.lo, hi: r!.hi }]));
  }
  return estimateAttributes(w, teamScout(w, teamId), p);
}

// --- reports ------------------------------------------------------------------------------------------

/** The club's weakest starter's CA (true: the club knows its own players). */
function weakestStarter(w: World, teamId: string): number {
  const five = (w.teams[teamId]?.roster ?? []).slice(0, 5).map((id) => w.players[id]?.ca ?? UNRATED_ABILITY);
  return five.length < 5 ? 0 : Math.min(...five);
}

export function recommend(w: World, p: WorldPlayer, v: PlayerView): Recommendation {
  const sc = w.scouting!;
  const bar = weakestStarter(w, sc.teamId);
  if (v.ca.est >= bar + K.signMargin || (p.age <= 21 && v.pa.est >= bar + K.signMargin)) return "sign";
  if (v.pa.hi >= bar) return "monitor";
  return "pass";
}

function writeReport(w: World, p: WorldPlayer, scoutId: string | null, kind: ScoutReport["kind"], date: IsoDate): ScoutReport {
  const sc = w.scouting!;
  const v = viewPlayer(w, p, date);
  const rep: ScoutReport = {
    date, playerId: p.playerId, scoutId, kind, knowledge: v.knowledge,
    ca: [v.ca.lo, v.ca.hi], pa: [v.pa.lo, v.pa.hi], recommendation: recommend(w, p, v),
  };
  const list = (sc.reports[p.playerId] ??= []);
  list.push(rep);
  if (list.length > K.reportsKept) list.splice(0, list.length - K.reportsKept);
  sc.unseen += 1;
  return rep;
}

export function latestReport(w: World, playerId: string): ScoutReport | null {
  const list = w.scouting?.reports[playerId];
  return list && list.length ? list[list.length - 1]! : null;
}

/**
 * How much a report can still be trusted TODAY (0..1): the knowledge it was written with, faded by
 * how long ago it was written (the same decay the player's live knowledge uses). A fresh, well-known
 * report is near 1; an old one decays toward 0 even if it looked confident when written. This is the
 * "report confidence" the scouting screen shows next to the knowledge the report was taken at.
 */
export function reportConfidence(report: Pick<ScoutReport, "date" | "knowledge">, today?: IsoDate): number {
  const days = today ? Math.max(0, daysBetween(report.date, today)) : 0;
  return r4(clamp(report.knowledge * Math.exp(-days / K.decayDays), 0, 1));
}

export interface RegionCoverage {
  readonly region: Region;
  /** Rated players of the region not on the manager's club. */
  readonly players: number;
  /** Of those, how many the club knows at least `reportMinKnowledge`. */
  readonly known: number;
  /** Mean live knowledge (with decay) over those players, 0..1. */
  readonly meanKnowledge: number;
  /** A scout is currently assigned to this region (region or youth). */
  readonly scouted: boolean;
}

/**
 * Per-region scouting coverage for the manager's club on `date`: how many players the club knows
 * and how well, with live (decayed) knowledge. Lets the manager see where their scouting is strong
 * and where it is fading, to decide where to send scouts. O(players) — call it on demand, not per tick.
 */
export function regionCoverage(w: World, date?: IsoDate): RegionCoverage[] {
  const sc = w.scouting;
  if (!sc) return [];
  const assigned = new Set(sc.assignments.filter((a) => (a.kind === "region" || a.kind === "youth") && a.target).map((a) => a.target as string));
  const by = new Map<Region, { n: number; known: number; sum: number }>();
  for (const p of Object.values(w.players)) {
    if (!p.hasRatings || p.teamId === sc.teamId) continue;
    const region = p.region as Region | undefined;
    if (!region) continue;
    const k = knowledgeOf(w, p, date);
    const e = by.get(region) ?? { n: 0, known: 0, sum: 0 };
    e.n += 1; e.sum += k; if (k >= K.reportMinKnowledge) e.known += 1;
    by.set(region, e);
  }
  return [...by.entries()].map(([region, e]) => ({
    region, players: e.n, known: e.known,
    meanKnowledge: r4(e.n ? e.sum / e.n : 0), scouted: assigned.has(region),
  })).sort((a, b) => a.region.localeCompare(b.region));
}

/** All players' latest reports, newest first. */
export function reportList(w: World): ScoutReport[] {
  const out = Object.values(w.scouting?.reports ?? {}).map((l) => l[l.length - 1]!).filter(Boolean);
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.playerId.localeCompare(b.playerId));
}

// --- state, assignments, ticks ------------------------------------------------------------------------

export function initScouting(w: World, teamId: string, date: IsoDate, league: readonly string[] = []): void {
  w.scouting = { version: 1, teamId, knowledge: {}, assignments: [], reports: {}, league: [...league].sort(), lastTick: date, unseen: 0 };
  // Every scout starts on the club's own region.
  const region = w.teams[teamId]?.region ?? null;
  for (const s of clubScouts(w, teamId)) w.scouting.assignments.push({ scoutId: s.staffId, kind: "region", target: region, since: date });
}

export type AssignError = "notOurScout" | "badTarget";

/** Give a scout an assignment (replaces their current one). */
export function assignScoutMut(w: World, scoutId: string, kind: AssignmentKind, target: string | null, date: IsoDate): AssignError | null {
  const sc = w.scouting;
  if (!sc || !clubScouts(w, sc.teamId).some((s) => s.staffId === scoutId)) return "notOurScout";
  if (kind === "player" && (!target || !w.players[target])) return "badTarget";
  if ((kind === "region" || kind === "youth") && !target) return "badTarget";
  sc.assignments = sc.assignments.filter((a) => a.scoutId !== scoutId);
  sc.assignments.push({ scoutId, kind, target, since: date });
  return null;
}

export function assignScout(world: World, scoutId: string, kind: AssignmentKind, target: string | null, date: IsoDate): World {
  const w = JSON.parse(JSON.stringify(world)) as World;
  return assignScoutMut(w, scoutId, kind, target, date) ? world : w;
}

function exposure(p: WorldPlayer): number {
  return p.status === "rostered" ? K.exposureRostered : p.status === "academy" ? K.exposureAcademy : K.exposureFree;
}

/** Who an assignment covers this week and how strongly (gain before q). */
function coverage(w: World, a: ScoutAssignment): Array<[WorldPlayer, number]> {
  const sc = w.scouting!;
  const others = Object.values(w.players).filter((p) => p.teamId !== sc.teamId);
  switch (a.kind) {
    case "player": {
      const p = a.target ? w.players[a.target] : undefined;
      return p && p.teamId !== sc.teamId ? [[p, K.gainPlayer]] : [];
    }
    case "region": return others.filter((p) => p.region === (a.target as Region)).map((p) => [p, K.gainRegion * exposure(p)]);
    case "league": {
      const teams = new Set(sc.league);
      return others.filter((p) => p.teamId && teams.has(p.teamId)).map((p) => [p, K.gainLeague]);
    }
    case "youth": return others.filter((p) => p.region === (a.target as Region) && p.age <= K.youthMaxAge && p.status !== "rostered").map((p) => [p, K.gainYouth * exposure(p) / K.exposureAcademy]);
  }
}

/**
 * The weekly scouting step (Mondays): every assignment adds knowledge, the league the club plays in
 * is watched passively, and reports are written (player assignments every week; discoveries
 * when a region / league / youth assignment lifts a player past `discoverAt`). Returns the reports.
 */
export function scoutingWeekMut(w: World, date: IsoDate): ScoutReport[] {
  const sc = w.scouting;
  if (!sc) return [];
  const out: ScoutReport[] = [];
  // Passive: the league the club plays in.
  const league = new Set(sc.league);
  for (const p of Object.values(w.players)) {
    if (p.teamId && league.has(p.teamId) && p.teamId !== sc.teamId) learn(w, p, K.gainPassive, date);
  }
  const scouts = new Map(clubScouts(w, sc.teamId).map((s) => [s.staffId, s]));
  sc.assignments = sc.assignments.filter((a) => scouts.has(a.scoutId));
  for (const a of [...sc.assignments].sort((x, y) => x.scoutId.localeCompare(y.scoutId))) {
    const q = scoutGain(scouts.get(a.scoutId));
    const candidates: Array<[WorldPlayer, number]> = [];
    for (const [p, g] of coverage(w, a)) {
      const after = learn(w, p, g * q, date);
      if (a.kind === "player") { out.push(writeReport(w, p, a.scoutId, a.kind, date)); continue; }
      const last = latestReport(w, p.playerId);
      if (after >= K.reportMinKnowledge && (!last || daysBetween(last.date, date) >= K.reportEveryDays)) candidates.push([p, viewPlayer(w, p, date).pa.est]);
    }
    // The most promising players this assignment covered (by the club's own PA estimate) get written up.
    candidates.sort((x, y) => y[1] - x[1] || x[0].playerId.localeCompare(y[0].playerId));
    for (const [p] of candidates.slice(0, K.discoveriesPerWeek)) {
      sc.knowledge[p.playerId]!.reported = true;
      out.push(writeReport(w, p, a.scoutId, a.kind, date));
    }
  }
  sc.lastTick = date;
  return out;
}

/** The club played (or watched) maps with these players on the field. */
export function watchMatchMut(w: World, playerIds: readonly string[], maps: number, date: IsoDate): void {
  const sc = w.scouting;
  if (!sc || maps <= 0) return;
  const q = clubJudging(w, sc.teamId).q;
  const g = 1 - Math.pow(1 - K.gainMap * q, maps);
  for (const id of playerIds) {
    const p = w.players[id];
    if (p && p.teamId !== sc.teamId) learn(w, p, g, date);
  }
}

/** Youth trial: the season's new prospects of the club's region are seen at the trial day. */
export function youthTrialMut(w: World, prospectIds: readonly string[], date: IsoDate): ScoutReport[] {
  const sc = w.scouting;
  if (!sc) return [];
  const region = w.teams[sc.teamId]?.region;
  const q = clubJudging(w, sc.teamId).q;
  const seen = prospectIds.map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p && p.region === region && p.teamId !== sc.teamId);
  for (const p of seen) learn(w, p, K.gainTrial * q, date);
  seen.sort((a, b) => viewPlayer(w, b, date).pa.est - viewPlayer(w, a, date).pa.est || a.playerId.localeCompare(b.playerId));
  return seen.slice(0, K.discoveriesPerWeek).map((p) => {
    sc.knowledge[p.playerId]!.reported = true;
    return writeReport(w, p, null, "trial", date);
  });
}

/** Mondays from the last tick up to `date` (the career calls this every day). */
export function scoutingOnDayMut(w: World, date: IsoDate): ScoutReport[] {
  const sc = w.scouting;
  if (!sc || weekday(date) !== 1 || sc.lastTick === date) return [];
  return scoutingWeekMut(w, date);
}


