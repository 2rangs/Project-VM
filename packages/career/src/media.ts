// Media and player interaction (backlog #7): press conferences (pre/post-match choices), 1:1
// player interactions (praise · criticise · promise), and the team chemistry they build. Every
// effect lands in the club layer's TRACKED morale (`club.morale`, via adjustMoraleMut) and in a
// club-wide chemistry number — the same morale store the renewals, the UI and the (flagged)
// match roster read. Whether tracked morale reaches the match stays behind CLUB_FLAGS.moraleInMatch
// (default OFF, measured to have no effect); nothing here touches the simulation engine.
//
// State lives in the career save under ext["media"] (plain JSON, deterministic): the chemistry
// value, the open/closed promises, a capped press/interaction log, and the fixtures already pressed.
import { adjustMoraleMut } from "./club/people.ts";
import type { ClubState } from "./club/types.ts";
import { addDays, daysBetween, type IsoDate } from "./career/calendar.ts";
import type { World } from "./model.ts";
import { clamp } from "./rng.ts";

export const MEDIA_MODEL = {
  /** Chemistry 0..1, neutral 0.5. */
  chemistryStart: 0.5,
  /** Weekly drift of chemistry back toward neutral (nothing happening → it relaxes). */
  chemistryRelax: 0.04,
  /** Weekly morale nudge of the squad toward chemistry: δ = chemWeeklyMorale · (chem − 0.5). */
  chemWeeklyMorale: 0.02,
  /** Press-conference morale swing applied to the squad (before confidence weighting). */
  pressMoraleUnit: 0.015,
  /** A 1:1 interaction's base morale swing for the target. */
  interactUnit: 0.05,
  /** Praise/criticise cool-off: a player can be interacted with at most once per this many days. */
  interactCooldownDays: 10,
  /** A promise's hope lift (made) and its kept / broken morale swing (resolved). */
  promiseHope: 0.02,
  promiseKept: 0.08,
  promiseBroken: 0.1,
  /** Chemistry swings. */
  chemPressGood: 0.02,
  chemPressBad: 0.03,
  chemPromiseKept: 0.05,
  chemPromiseBroken: 0.06,
  chemInteractGood: 0.01,
  chemInteractBad: 0.02,
  /** Playing-time promise is kept when the player's season map share reaches this. */
  playTimeShareKept: 0.45,
  /** How long a promise runs before it is judged (days). */
  promiseDays: 120,
  /** Log entries kept (most recent). */
  logKept: 24,
  /** Pressed-fixture ids kept. */
  pressedKept: 24,
} as const;

const C = MEDIA_MODEL;

// --- state -------------------------------------------------------------------------------------------

export type PromiseKind = "playTime" | "winMatch" | "trophy";
export type PromiseStatus = "open" | "kept" | "broken";

export interface PlayerPromise {
  readonly id: string;
  readonly playerId: string;
  readonly kind: PromiseKind;
  readonly made: IsoDate;
  readonly due: IsoDate;
  status: PromiseStatus;
  /** Season the promise was made (for trophy promises). */
  readonly season: number;
}

export type MediaEventKind = "press" | "praise" | "criticise" | "promise" | "promiseKept" | "promiseBroken";

export interface MediaLogEntry {
  readonly date: IsoDate;
  readonly kind: MediaEventKind;
  /** For press: the topic; for interactions: the option/kind; for promises: the promise kind. */
  readonly topic: string;
  readonly playerId?: string;
  /** Morale delta applied (for the UI). */
  readonly morale: number;
  readonly chem: number;
}

export interface MediaState {
  readonly version: 1;
  /** Team chemistry 0..1 (neutral 0.5). */
  chemistry: number;
  promises: PlayerPromise[];
  /** Fixture ids already given a pre/post-match presser (`${fixtureId}:pre` / `:post`). */
  pressed: string[];
  /** Last date each player was interacted with (praise/criticise cool-off). */
  lastInteract: Record<string, IsoDate>;
  log: MediaLogEntry[];
  nextId: number;
}

export function initMedia(): MediaState {
  return { version: 1, chemistry: C.chemistryStart, promises: [], pressed: [], lastInteract: {}, log: [], nextId: 1 };
}

/** The media state in a career's ext (created on first use). */
export function mediaOf(career: { ext: Record<string, unknown> }): MediaState {
  const ext = career.ext as Record<string, unknown>;
  if (!ext.media) ext.media = initMedia();
  return ext.media as MediaState;
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000;

function pushLog(m: MediaState, e: MediaLogEntry): void {
  m.log.push(e);
  if (m.log.length > C.logKept) m.log.splice(0, m.log.length - C.logKept);
}

function squad(w: World, teamId: string): string[] {
  return [...(w.teams[teamId]?.roster ?? [])];
}

function moveChem(m: MediaState, delta: number): number {
  m.chemistry = r4(clamp(m.chemistry + delta, 0, 1));
  return m.chemistry;
}

// --- press conferences --------------------------------------------------------------------------------
// A press item is DATA: topic + option id → effect. The desktop renders inbox.media.press.<topic>.* .

export type PressTopic = "preBig" | "afterWin" | "afterLoss";

export interface PressOption {
  readonly id: string;
  /** Squad-wide morale swing in units of pressMoraleUnit. */
  readonly morale: number;
  /** Chemistry delta. */
  readonly chem: number;
}

/** The options of each press topic and what each does (confidence weighting is applied per squad). */
export const PRESS: Record<PressTopic, readonly PressOption[]> = {
  preBig: [
    { id: "confident", morale: 1, chem: C.chemPressGood },
    { id: "measured", morale: 0.3, chem: 0 },
    { id: "deflect", morale: -0.3, chem: -C.chemPressBad * 0.5 },
  ],
  afterWin: [
    { id: "praiseTeam", morale: 1, chem: C.chemPressGood },
    { id: "stayGrounded", morale: 0.3, chem: C.chemPressGood * 0.5 },
    { id: "lookAhead", morale: 0, chem: 0 },
  ],
  afterLoss: [
    { id: "backThem", morale: 0.5, chem: C.chemPressGood },
    { id: "takeBlame", morale: 0.8, chem: C.chemPressGood * 0.5 },
    { id: "criticise", morale: -1, chem: -C.chemPressBad },
  ],
} as const;

export const pressOption = (topic: PressTopic, id: string): PressOption | undefined =>
  PRESS[topic]?.find((o) => o.id === id);

/**
 * Apply a press answer to the manager's squad: a squad-wide morale swing (smaller when chemistry is
 * low, i.e. the room is not behind the manager) and a chemistry move. Returns the morale delta used
 * (for the reaction message).
 */
export function applyPressMut(world: World, m: MediaState, topic: PressTopic, optionId: string, date: IsoDate): number {
  const club = world.club;
  const uid = club?.userTeamId;
  const opt = pressOption(topic, optionId);
  if (!club || !uid || !opt) return 0;
  // A positive message lands harder when the room is already behind the manager (chemistry).
  const weight = opt.morale >= 0 ? 0.6 + 0.8 * m.chemistry : 1;
  const delta = r4(opt.morale * C.pressMoraleUnit * weight);
  for (const id of squad(world, uid)) adjustMoraleMut(club, id, delta);
  const chem = moveChem(m, opt.chem);
  pushLog(m, { date, kind: "press", topic, morale: delta, chem });
  return delta;
}

// --- 1:1 interactions ---------------------------------------------------------------------------------

export type InteractKind = "praise" | "criticise";
export type InteractError = "notOurPlayer" | "cooldown";

/** Whether the manager may interact with a player today (own player, off cool-off). */
export function canInteract(world: World, m: MediaState, playerId: string, date: IsoDate): InteractError | null {
  const uid = world.club?.userTeamId;
  const p = world.players[playerId];
  if (!uid || !p || p.teamId !== uid) return "notOurPlayer";
  const last = m.lastInteract[playerId];
  if (last && daysBetween(last, date) < C.interactCooldownDays) return "cooldown";
  return null;
}

export interface InteractResult {
  readonly playerId: string;
  readonly kind: InteractKind;
  /** Morale delta applied. */
  readonly morale: number;
  readonly chem: number;
  readonly newMorale: number;
}

/**
 * A 1:1 talk. Praise lifts the player's morale (more when the team is losing form — reassurance is
 * worth more); criticism is a gamble — it dents morale now but the size depends on the player's
 * temperament (volatile players take it harder). Both move chemistry a little. Mutates `world.club`.
 */
export function interactMut(world: World, m: MediaState, playerId: string, kind: InteractKind, date: IsoDate): InteractResult | InteractError {
  const err = canInteract(world, m, playerId, date);
  if (err) return err;
  const club = world.club!;
  const base = kind === "praise" ? C.interactUnit : -C.interactUnit;
  const delta = r4(base);
  const newMorale = adjustMoraleMut(club, playerId, delta);
  const chem = moveChem(m, kind === "praise" ? C.chemInteractGood : -C.chemInteractBad);
  m.lastInteract[playerId] = date;
  pushLog(m, { date, kind: kind === "praise" ? "praise" : "criticise", topic: kind, playerId, morale: delta, chem });
  return { playerId, kind, morale: delta, chem, newMorale };
}

// --- promises -----------------------------------------------------------------------------------------

export type PromiseError = "notOurPlayer" | "alreadyOpen";

export function openPromise(world: World, m: MediaState, playerId: string): PlayerPromise | null {
  return m.promises.find((p) => p.playerId === playerId && p.status === "open") ?? null;
}

/** Make a promise to an own player: a small hope lift now; judged `promiseDays` later. */
export function promiseMut(world: World, m: MediaState, playerId: string, kind: PromiseKind, date: IsoDate): PlayerPromise | PromiseError {
  const uid = world.club?.userTeamId;
  const p = world.players[playerId];
  if (!uid || !p || p.teamId !== uid) return "notOurPlayer";
  if (openPromise(world, m, playerId)) return "alreadyOpen";
  const pr: PlayerPromise = {
    id: `p${(m.nextId++).toString(36)}`, playerId, kind, made: date,
    due: addDays(date, C.promiseDays), status: "open", season: world.season,
  };
  m.promises.push(pr);
  const delta = r4(C.promiseHope);
  adjustMoraleMut(world.club!, playerId, delta);
  pushLog(m, { date, kind: "promise", topic: kind, playerId, morale: delta, chem: m.chemistry });
  return pr;
}

function playShareOf(club: ClubState, playerId: string, teamId: string): number {
  const team = club.playTime?.teams[teamId] ?? 0;
  if (team <= 0) return 0;
  return Math.min(1, (club.playTime?.players[playerId] ?? 0) / team);
}

/** Judge a single promise against the world state. null = cannot be judged yet. */
export function judgePromise(world: World, pr: PlayerPromise, trophyThisSeason: boolean): boolean | null {
  const club = world.club;
  const uid = club?.userTeamId;
  if (!club || !uid) return null;
  switch (pr.kind) {
    case "playTime": return playShareOf(club, pr.playerId, uid) >= C.playTimeShareKept;
    case "trophy": return trophyThisSeason;
    case "winMatch": return null; // resolved by onMatchResult directly
  }
}

export interface ResolvedPromise { readonly promise: PlayerPromise; readonly kept: boolean; readonly morale: number }

/** Apply a kept/broken outcome to a promise (morale + chemistry + log). */
export function settlePromiseMut(world: World, m: MediaState, pr: PlayerPromise, kept: boolean, date: IsoDate): ResolvedPromise {
  pr.status = kept ? "kept" : "broken";
  const delta = r4(kept ? C.promiseKept : -C.promiseBroken);
  adjustMoraleMut(world.club!, pr.playerId, delta);
  const chem = moveChem(m, kept ? C.chemPromiseKept : -C.chemPromiseBroken);
  pushLog(m, { date, kind: kept ? "promiseKept" : "promiseBroken", topic: pr.kind, playerId: pr.playerId, morale: delta, chem });
  return { promise: pr, kept, morale: delta };
}

/** Resolve every due time-based promise (playTime / trophy at their due date). */
export function resolveDuePromisesMut(world: World, m: MediaState, date: IsoDate): ResolvedPromise[] {
  const out: ResolvedPromise[] = [];
  for (const pr of m.promises) {
    if (pr.status !== "open" || pr.kind === "winMatch" || pr.due > date) continue;
    const verdict = judgePromise(world, pr, false);
    if (verdict === null) continue;
    out.push(settlePromiseMut(world, m, pr, verdict, date));
  }
  return out;
}

/** The manager's team won/lost a series: settle winMatch promises due on/after now. */
export function resolveMatchPromisesMut(world: World, m: MediaState, won: boolean, date: IsoDate): ResolvedPromise[] {
  const out: ResolvedPromise[] = [];
  for (const pr of m.promises) {
    if (pr.status !== "open" || pr.kind !== "winMatch") continue;
    out.push(settlePromiseMut(world, m, pr, won, date));
  }
  return out;
}

/** End of season: settle open trophy promises for this season (kept iff a regional title was won). */
export function resolveTrophyPromisesMut(world: World, m: MediaState, wonTitle: boolean, date: IsoDate): ResolvedPromise[] {
  const out: ResolvedPromise[] = [];
  for (const pr of m.promises) {
    if (pr.status !== "open" || pr.kind !== "trophy") continue;
    out.push(settlePromiseMut(world, m, pr, wonTitle, date));
  }
  return out;
}

// --- weekly chemistry step ----------------------------------------------------------------------------

/** Weekly: chemistry relaxes toward neutral, and the squad's morale drifts a touch toward chemistry. */
export function chemistryWeekMut(world: World, m: MediaState): void {
  const club = world.club;
  const uid = club?.userTeamId;
  if (!club || !uid) return;
  m.chemistry = r4(m.chemistry + C.chemistryRelax * (0.5 - m.chemistry));
  const nudge = C.chemWeeklyMorale * (m.chemistry - 0.5);
  if (nudge !== 0) for (const id of squad(world, uid)) adjustMoraleMut(club, id, nudge);
}

/** Has the manager's club already been pressed for this fixture/phase? Marks it when false. */
export function markPressed(m: MediaState, fixtureId: string, phase: "pre" | "post"): boolean {
  const key = `${fixtureId}:${phase}`;
  if (m.pressed.includes(key)) return true;
  m.pressed.push(key);
  if (m.pressed.length > C.pressedKept) m.pressed.splice(0, m.pressed.length - C.pressedKept);
  return false;
}
