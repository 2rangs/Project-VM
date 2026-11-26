// The open career in the renderer: one CareerState (@pv/career), the save slot it belongs to, and
// the Continue loop. AI fixtures are played according to the WORLD SIM DEPTH setting (FM style):
// `quick` (default) — the calibrated quick estimate for every AI series; `league` — the full engine
// (another process: bridge.careerSimulate → scripts/career-sim.mts) for the manager's own league,
// quick for the other regions and the international events; `full` — the engine for everything.
// A failed engine batch falls back to the quick estimate for that day.
// The career autosaves into its slot whenever Continue stops and after the manager's own match.
import { useSyncExternalStore } from 'react';
import { bridge, runtime } from '../platform.ts';
import type { CareerSimProgress, CareerSimRequest, SaveSlot } from '../../shared/career.ts';
import {
  answerInbox, buildDesktopWorld, drainClubOutbox, matchRoster, setLineup, syncClubInbox, type World, continueCareer, deserializeCareer, markRead, newCareer, quickSeries,
  recordResult, serializeCareer, setMapRecords, usesEngine, SIM_DEPTHS, type BatchSimulator, type CareerState, type ContinueResult, type Outcome,
  type SeriesOutcome, type SeriesRequest, type SimDepth, type DifficultyId,
  mediaOf, interactMut, promiseMut, type InteractKind, type InteractResult, type InteractError, type PromiseKind, type PlayerPromise, type PromiseError,
} from './world.ts';
import { FIXTURES } from './fixtures.ts';
import teamMaps from '../../data/team_maps.json';

// The quick estimate's map pools: real map records since 2025 ([games, wins] per team and map).
setMapRecords((teamMaps as unknown as { teams: Record<string, Record<string, [number, number]>> }).teams);

export type { SimDepth };
const DEPTH_KEY = 'pv-career-depth';

/**
 * The world sim depth: how many of the other teams' series the full engine plays (the manager's
 * own match is always played for real). The default is `league` (engine for the manager's own
 * league; the calibrated-but-not-settled quick estimate only for the other regions and the
 * international events); without the engine process (plain browser) it is `quick`. `quick` plays a
 * whole season in about a second; `full` puts everything through the engine (~36 min a season).
 */
export const DEFAULT_SIM_DEPTH: SimDepth = 'league';
export function simDepth(): SimDepth {
  const fallback: SimDepth = runtime === 'electron' ? DEFAULT_SIM_DEPTH : 'quick';
  try { const v = localStorage.getItem(DEPTH_KEY); return (SIM_DEPTHS as readonly string[]).includes(v ?? '') ? (v as SimDepth) : fallback; } catch { return fallback; }
}
export function setSimDepth(d: SimDepth): void {
  try { localStorage.setItem(DEPTH_KEY, d); } catch { /* no storage */ }
  notify();
}

export interface CareerBusy {
  kind: 'continue' | 'save' | 'load' | 'create';
  /** The engine batch in flight (background simulation of AI fixtures). */
  sim?: CareerSimProgress;
  /** The day being processed. */
  date?: string;
}

export interface CareerSnapshot {
  career: CareerState | null;
  slot: SaveSlot | null;
  /** Bumped on every change (the CareerState is mutated in place). */
  version: number;
  busy: CareerBusy | null;
  lastStop: ContinueResult | null;
  /** Set when an engine batch failed and the quick estimate stood in. */
  notice: string | null;
  error: string | null;
  simDepth: SimDepth;
}

let snap: CareerSnapshot = { career: null, slot: null, version: 0, busy: null, lastStop: null, notice: null, error: null, simDepth: simDepth() };
const listeners = new Set<() => void>();

function notify(patch: Partial<CareerSnapshot> = {}): void {
  snap = { ...snap, ...patch, version: snap.version + 1, simDepth: simDepth() };
  for (const l of listeners) l();
}

export function subscribeCareer(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
export const careerSnapshot = (): CareerSnapshot => snap;
export const activeCareerWorld = () => snap.career?.world ?? null;
export const activeCareer = (): CareerState | null => snap.career;

export function useCareer(): CareerSnapshot {
  return useSyncExternalStore(subscribeCareer, careerSnapshot, careerSnapshot);
}

// --- saves ------------------------------------------------------------------------------------------

async function writeSlot(): Promise<void> {
  if (!snap.career || !snap.slot) return;
  await bridge.saveWrite(snap.slot, serializeCareer(snap.career));
}

export async function saveCareer(): Promise<void> {
  notify({ busy: { kind: 'save' } });
  try { await writeSlot(); notify({ busy: null }); } catch (e) { notify({ busy: null, error: (e as Error).message }); }
}

export async function loadCareer(slot: SaveSlot): Promise<boolean> {
  notify({ busy: { kind: 'load' }, error: null });
  try {
    const text = await bridge.saveRead(slot);
    if (!text) throw new Error('empty slot');
    notify({ career: deserializeCareer(text), slot, busy: null, lastStop: null, notice: null });
    return true;
  } catch (e) { notify({ busy: null, error: (e as Error).message }); return false; }
}

export interface NewCareerInput {
  managerName: string;
  nationality: string;
  teamId: string;
  slot: SaveSlot;
  seed: number;
  difficulty?: DifficultyId;
}

export async function startNewCareer(input: NewCareerInput): Promise<void> {
  notify({ busy: { kind: 'create' }, error: null });
  // Let the "generating world" state paint before the synchronous world build.
  await new Promise((r) => setTimeout(r, 30));
  try {
    const world = buildDesktopWorld(FIXTURES, input.seed);
    const career = newCareer(world, { seed: input.seed, manager: { name: input.managerName.trim(), nationality: input.nationality }, userTeamId: input.teamId, ...(input.difficulty ? { difficulty: input.difficulty } : {}) });
    snap = { ...snap, career, slot: input.slot, lastStop: null, notice: null };
    await writeSlot();
    notify({ busy: null });
  } catch (e) { notify({ busy: null, error: (e as Error).message }); }
}

export function closeCareer(): void { notify({ career: null, slot: null, lastStop: null, notice: null, error: null, busy: null }); }

// --- simulation ---------------------------------------------------------------------------------------

function toSimRequest(career: CareerState, r: SeriesRequest): CareerSimRequest {
  // Today's five with readiness applied (fatigue, sharpness) and the team's map practice.
  const side = (s: SeriesRequest['home']) => ({
    teamId: s.teamId, name: s.name, analyst: s.analyst,
    roster: matchRoster(career, s.lineup),
    practice: career.world.club?.training.mapPractice[s.teamId] ?? {},
  });
  return { fixtureId: r.fixtureId, seed: r.seed, format: r.format, home: side(r.home), away: side(r.away) };
}

const quickBatch: BatchSimulator = (reqs, career) => reqs.map((r) => quickSeries(r, career));

/** Engine for the series the depth says, the quick estimate for the rest (one batch, results in order). */
const depthBatch = (depth: SimDepth): BatchSimulator => async (reqs, career) => {
  const out: Outcome[] = reqs.map((r) => (usesEngine(depth, r.scope) ? (null as unknown as Outcome) : quickSeries(r, career)));
  const idx = reqs.map((_, i) => i).filter((i) => usesEngine(depth, reqs[i]!.scope));
  if (idx.length === 0) return out;
  try {
    const outs = await bridge.careerSimulate(idx.map((i) => toSimRequest(career, reqs[i]!)), (p) => notify({ busy: { kind: 'continue', date: career.date, sim: p } }));
    idx.forEach((i, k) => { const o = outs[k]!; out[i] = { winner: o.winner, mapsWon: o.mapsWon, maps: o.maps, source: 'engine' }; });
  } catch (e) {
    notify({ notice: (e as Error).message });
    for (const i of idx) out[i] = quickSeries(reqs[i]!, career);
  }
  return out;
};

/** FM's Continue. Resolves with where it stopped. */
export async function continueGame(): Promise<ContinueResult | null> {
  const career = snap.career;
  if (!career || snap.busy) return null;
  notify({ busy: { kind: 'continue', date: career.date }, error: null, notice: null });
  const sim = runtime === 'electron' && simDepth() !== 'quick' ? depthBatch(simDepth()) : quickBatch;
  try {
    const res = await continueCareer(career, sim, {
      onDayEnd: async (s) => { notify({ busy: { kind: 'continue', date: s.date } }); await new Promise((r) => setTimeout(r, 0)); },
    });
    await writeSlot();
    notify({ busy: null, lastStop: res });
    return res;
  } catch (e) {
    notify({ busy: null, error: (e as Error).message });
    return null;
  }
}

/** A club action on the career's world (pure: World in, World out); messages reach the inbox. */
export function updateCareerWorld(fn: (w: World) => World): void {
  const c = snap.career;
  if (!c) return;
  c.world = fn(c.world);
  drainClubOutbox(c);
  syncClubInbox(c);
  notify();
  void writeSlot();
}

/** The manager's starting five for the next match. */
export function chooseLineup(ids: string[]): void {
  if (!snap.career) return;
  setLineup(snap.career, ids);
  notify();
  void writeSlot();
}

export function answer(itemId: string, option: string): void {
  if (!snap.career) return;
  answerInbox(snap.career, itemId, option);
  notify();
  void writeSlot();
}

export function readItem(itemId: string): void {
  if (!snap.career) return;
  markRead(snap.career, itemId);
  notify();
}

/** The manager's own series is over: record it (standings, minutes, form) and autosave. */
export async function recordUserSeries(fixtureId: string, outcome: SeriesOutcome): Promise<void> {
  if (!snap.career) return;
  recordResult(snap.career, fixtureId, outcome);
  notify({ lastStop: null });
  await writeSlot();
}

// --- media: 1:1 player interactions and promises (backlog #7) ----------------------------------------

/** Praise or criticise an own player. Returns the result (morale/chemistry change) or an error code. */
export function talkToPlayer(playerId: string, kind: InteractKind): InteractResult | InteractError | null {
  const c = snap.career;
  if (!c) return null;
  const res = interactMut(c.world, mediaOf(c), playerId, kind, c.date);
  notify();
  void writeSlot();
  return res;
}

/** Promise an own player something (playing time / a win / a trophy). */
export function promisePlayer(playerId: string, kind: PromiseKind): PlayerPromise | PromiseError | null {
  const c = snap.career;
  if (!c) return null;
  const res = promiseMut(c.world, mediaOf(c), playerId, kind, c.date);
  notify();
  void writeSlot();
  return res;
}
