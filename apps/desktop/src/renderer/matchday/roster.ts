// Real roster handles for the two teams on the live match screen.
//
// The match-runner fields the FIRST FIVE players of a team's game-data roster, in roster order,
// as engine slots 1..5 (atk1..5 / def1..5 depending on the side). This mirrors that mapping so a
// monitor can say "s0m" instead of "atk3". The roster file is read from @pv/game-data (read-only
// import, so the order always matches the engine); handles come from the desktop's names file.
import rosters from '../../../../../packages/game-data/data/rosters.json';
import playerNames from '../../data/player_names.json';
import agents from '../../../../../packages/game-data/data/agents.json';

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

/**
 * The agent each engine slot plays. Mirrors @pv/match-runner `ASCENT_COMP` (both teams field this
 * fixed comp; slot i plays agent i) — the comp is not exported to the app, so it is repeated here.
 */
export const COMP_SLUGS = ['omen', 'sova', 'kayo', 'killjoy', 'jett'] as const;

export interface SlotAgent { readonly name: string; readonly role: 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel' }
const FALLBACK: Record<string, SlotAgent> = { kayo: { name: 'KAY/O', role: 'Initiator' } };
const agentBySlug = new Map((agents as Array<{ slug: string; name: string; role: string }>).map((a) => [a.slug.replace(/[^a-z]/g, ''), a]));

/** Agent name and role for engine slot 1..5 (name from game-data, never translated). */
export function agentOfSlot(slot: number): SlotAgent | null {
  const slug = COMP_SLUGS[slot - 1];
  if (!slug) return null;
  const a = agentBySlug.get(slug);
  if (a && /^(Duelist|Initiator|Controller|Sentinel)$/.test(a.role)) return { name: a.name, role: a.role as SlotAgent['role'] };
  return FALLBACK[slug] ?? null;
}
