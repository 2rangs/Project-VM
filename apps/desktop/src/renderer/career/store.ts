// The desktop's career world: one shared World, saved to localStorage after every change and
// loaded on start (a fresh world is built from the dataset fixtures when there is no save).
import { useSyncExternalStore } from 'react';
import playerRatings from '../../data/player_ratings.json';
import playerNames from '../../data/player_names.json';
import teamNames from '../../data/team_names.json';
import rosters from '../../data/rosters.json';
import reservedHandles from '../../data/reserved_handles.json';
import { buildDesktopWorld, loadSavedWorld, serializeWorld, STORE_KEY, type DesktopFixtures, type World } from './world.ts';
import { advanceClubDays, clubSeasonEnd, withClub } from './club.ts';

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
    // Club operations start with the world (contracts, finances); older saves get them on load.
    world = withClub(readSave() ?? buildDesktopWorld(FIXTURES));
    writeSave(world);
  }
  return world;
}

function set(w: World): void {
  world = w;
  writeSave(w);
  for (const l of listeners) l();
}

/**
 * End the current season: prize money, contract expiry, development (with the season's training
 * focus), retirements, the next intake and signings, the new budgets.
 */
export function advanceWorld(): void { set(clubSeasonEnd(getWorld())); }

/** Throw the save away and start again from the dataset. */
export function resetWorld(): void { set(withClub(buildDesktopWorld(FIXTURES))); }

/** Apply a club action (offer, plan change, …) and save. */
export function updateWorld(fn: (w: World) => World): void { set(fn(getWorld())); }

/**
 * Advance the club calendar by days (local driver: onDay, onMonth, season end). Temporary until
 * the career shell's calendar drives the hooks (docs/CLUB_OPERATIONS.md §7).
 */
export function advanceDays(n: number): void { set(advanceClubDays(getWorld(), n)); }

export function useWorld(): World {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, getWorld, getWorld);
}
