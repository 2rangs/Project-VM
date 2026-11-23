// The desktop's career world: one shared World, saved to localStorage after every change and
// loaded on start (a fresh world is built from the dataset fixtures when there is no save).
import { useSyncExternalStore } from 'react';
// When a career is open, every screen reads the CAREER's world instead (career/session.ts).
import { buildDesktopWorld, loadSavedWorld, serializeWorld, STORE_KEY, type World } from './world.ts';
import { FIXTURES } from './fixtures.ts';
import { activeCareerWorld, subscribeCareer } from './session.ts';
import { updateCareerWorld } from './session.ts';
import { advanceSeason } from './world.ts';

let world: World | null = null;
const listeners = new Set<() => void>();

function readSave(): World | null {
  try { return loadSavedWorld(globalThis.localStorage?.getItem(STORE_KEY)); } catch { return null; }
}
function writeSave(w: World): void {
  try { globalThis.localStorage?.setItem(STORE_KEY, serializeWorld(w)); } catch { /* no storage / full */ }
}

export function getWorld(): World {
  const cw = activeCareerWorld();
  if (cw) return cw;
  if (!world) {
    world = readSave() ?? buildDesktopWorld(FIXTURES);
    writeSave(world);
  }
  return world;
}

function set(w: World): void {
  world = w;
  writeSave(w);
  for (const l of listeners) l();
}

/** Sandbox (no career): end the season of the standalone world. */
export function advanceWorld(): void { set(advanceSeason(getWorld())); }

/** Sandbox: throw the standalone world away and start again from the dataset. */
export function resetWorld(): void { set(buildDesktopWorld(FIXTURES)); }

/**
 * Apply a club action (offer, plan change, release, …). In a career it changes the CAREER's world
 * (its messages go to the career inbox and the career autosaves); otherwise the sandbox world.
 */
export function updateWorld(fn: (w: World) => World): void {
  if (activeCareerWorld()) { updateCareerWorld(fn); return; }
  set(fn(getWorld()));
}

export function useWorld(): World {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    const off = subscribeCareer(l);
    return () => { listeners.delete(l); off(); };
  }, getWorld, getWorld);
}
