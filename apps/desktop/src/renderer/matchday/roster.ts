// Real roster handles for the two teams on the live match screen.
//
// The match-runner fields the FIRST FIVE players of a team's game-data roster, in roster order,
// as engine slots 1..5 (atk1..5 / def1..5 depending on the side). This mirrors that mapping so a
// monitor can say "s0m" instead of "atk3". The roster file is read from @pv/game-data (read-only
// import, so the order always matches the engine); handles come from the desktop's names file.
import rosters from '../../../../../packages/game-data/data/rosters.json';
import playerNames from '../../data/player_names.json';

const handleById = new Map<string, string>(
  (playerNames as { players: Array<{ playerId: string; handle: string }> }).players.map((p) => [p.playerId, p.handle]),
);

/** Handles for engine slots 1..5 of a team (falls back to P1..P5 for unknown teams/players). */
export function rosterHandles(teamId: string | undefined): string[] {
  const roster = teamId ? (rosters as Record<string, Array<{ playerId: string }>>)[teamId] : undefined;
  return Array.from({ length: 5 }, (_, i) => {
    const id = roster?.[i]?.playerId;
    return (id && handleById.get(id)) || `P${i + 1}`;
  });
}
