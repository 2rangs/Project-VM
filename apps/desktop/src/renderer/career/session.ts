// The open career in the renderer: one CareerState (@pv/career), the save slot it belongs to, and
// the Continue loop. AI fixtures are played by the full engine in another process
// (bridge.careerSimulate → scripts/career-sim.mts) when the manager chose it in Settings; by
// default the calibrated quick estimate plays them; a failed engine batch falls back to the quick estimate for that day.
// The career autosaves into its slot whenever Continue stops and after the manager's own match.
import { useSyncExternalStore } from 'react';
import { bridge, runtime } from '../platform.ts';
import type { CareerSimProgress, CareerSimRequest, SaveSlot } from '../../shared/career.ts';
import {
  answerInbox, buildDesktopWorld, drainClubOutbox, matchRoster, setLineup, syncClubInbox, type World, continueCareer, deserializeCareer, markRead, newCareer, quickSeries,
  recordResult, serializeCareer, type BatchSimulator, type CareerState, type ContinueResult, type Outcome,
  type SeriesOutcome, type SeriesRequest,
} from './world.ts';
import { FIXTURES } from './fixtures.ts';

export type SimMode = 'engine' | 'quick';
const SIM_KEY = 'pv-career-sim';

/**
 * How other teams' series are played: the calibrated quick estimate by default (a whole season of
 * AI series in seconds), the full engine when the manager chooses it in Settings (~20 min/season).
 */
export function simMode(): SimMode {
  try { return localStorage.getItem(SIM_KEY) === 'engine' ? 'engine' : 'quick'; } catch { return 'quick'; }
}
export function setSimMode(m: SimMode): void {
  try { localStorage.setItem(SIM_KEY, m); } catch { /* no storage */ }
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
  simMode: SimMode;
}

let snap: CareerSnapshot = { career: null, slot: null, version: 0, busy: null, lastStop: null, notice: null, error: null, simMode: simMode() };
const listeners = new Set<() => void>();

function notify(patch: Partial<CareerSnapshot> = {}): void {
  snap = { ...snap, ...patch, version: snap.version + 1, simMode: simMode() };
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
}

export async function startNewCareer(input: NewCareerInput): Promise<void> {
  notify({ busy: { kind: 'create' }, error: null });
  // Let the "generating world" state paint before the synchronous world build.
  await new Promise((r) => setTimeout(r, 30));
  try {
    const world = buildDesktopWorld(FIXTURES, input.seed);
    const career = newCareer(world, { seed: input.seed, manager: { name: input.managerName.trim(), nationality: input.nationality }, userTeamId: input.teamId });
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

const engineBatch: BatchSimulator = async (reqs, career) => {
  try {
    const outs = await bridge.careerSimulate(reqs.map((r) => toSimRequest(career, r)), (p) => notify({ busy: { kind: 'continue', date: career.date, sim: p } }));
    return outs.map((o): Outcome => ({ winner: o.winner, mapsWon: o.mapsWon, maps: o.maps, source: 'engine' }));
  } catch (e) {
    notify({ notice: (e as Error).message });
    return quickBatch(reqs, career);
  }
};

/** FM's Continue. Resolves with where it stopped. */
export async function continueGame(): Promise<ContinueResult | null> {
  const career = snap.career;
  if (!career || snap.busy) return null;
  notify({ busy: { kind: 'continue', date: career.date }, error: null, notice: null });
  const sim = runtime === 'electron' && simMode() === 'engine' ? engineBatch : quickBatch;
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
