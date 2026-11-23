// The desktop's career world: one shared World, saved to localStorage after every change and
// loaded on start (a fresh world is built from the dataset fixtures when there is no save).
import { useSyncExternalStore } from 'react';
// When a career is open, every screen reads the CAREER's world instead (career/session.ts).
import { advanceSeason, buildDesktopWorld, loadSavedWorld, serializeWorld, STORE_KEY, type World } from './world.ts';
import { FIXTURES } from './fixtures.ts';
import { activeCareerWorld, subscribeCareer } from './session.ts';

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

/** End the current season: development, retirements, the next intake and signings. */
export function advanceWorld(): void { set(advanceSeason(getWorld())); }

/** Throw the save away and start again from the dataset. */
export function resetWorld(): void { set(buildDesktopWorld(FIXTURES)); }

export function useWorld(): World {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    const off = subscribeCareer(l);
    return () => { listeners.delete(l); off(); };
  }, getWorld, getWorld);
}
