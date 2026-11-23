// The desktop's career world: one shared World, saved to localStorage after every change and
// loaded on start (a fresh world is built from the dataset fixtures when there is no save).
import { useSyncExternalStore } from 'react';
import playerRatings from '../../data/player_ratings.json';
import playerNames from '../../data/player_names.json';
import teamNames from '../../data/team_names.json';
import rosters from '../../data/rosters.json';
import reservedHandles from '../../data/reserved_handles.json';
import { advanceSeason, buildDesktopWorld, loadSavedWorld, serializeWorld, STORE_KEY, type DesktopFixtures, type World } from './world.ts';

const FIXTURES = {
  ratings: playerRatings, names: playerNames, teams: teamNames, rosters, reservedHandles,
} as unknown as DesktopFixtures;

let world: World | null = null;
const listeners = new Set<() => void>();

function readSave(): World | null {
  try { return loadSavedWorld(globalThis.localStorage?.getItem(STORE_KEY)); } catch { return null; }
}
function writeSave(w: World): void {
  try { globalThis.localStorage?.setItem(STORE_KEY, serializeWorld(w)); } catch { /* no storage / full */ }
}

export function getWorld(): World {
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
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getWorld, getWorld);
}
