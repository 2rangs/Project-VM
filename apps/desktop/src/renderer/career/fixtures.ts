// The dataset fixtures a desktop career world is built from (copied from @pv/game-data).
import playerRatings from '../../data/player_ratings.json';
import playerNames from '../../data/player_names.json';
import teamNames from '../../data/team_names.json';
import rosters from '../../data/rosters.json';
import reservedHandles from '../../data/reserved_handles.json';
import type { DesktopFixtures } from './world.ts';

export const FIXTURES = {
  ratings: playerRatings, names: playerNames, teams: teamNames, rosters, reservedHandles,
} as unknown as DesktopFixtures;
