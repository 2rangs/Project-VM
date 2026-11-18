/**
 * Teamwork (README §24.2) — minimal coordination over independently chosen commands:
 *   - utility before entry: ability casts fire first (executeAtMs 0), entries follow,
 *   - staggered entry: entry leads, support trails,
 *   - trade positioning: a support's move snaps to the entry's target so they can trade.
 * Timing tightness scales with each player's teamwork stat (higher → smaller offsets).
 * Deterministic (no RNG): execution timing is a function of role + teamwork.
 */
import type { ActionCommand, PlayerProfile, PlayerRole } from "@pv/shared-types";

const ABILITY_LEAD_MS = 800;
const SUPPORT_TRAIL_MS = 1200;
const DEFAULT_OFFSET_MS = 500;

export interface TeamworkEntry {
  readonly command: ActionCommand;
  readonly role: PlayerRole;
  readonly profile: PlayerProfile;
}

export function applyTeamwork(entries: readonly TeamworkEntry[]): ActionCommand[] {
  const entry = entries.find((e) => e.role === "entry");
  const entryZone = entry?.command.targetZone;

  return entries.map((e) => {
    const tighten = Math.max(0.3, 1.5 - e.profile.teamwork); // better teamwork → tighter timing
    const cmd = e.command;
    if (cmd.kind === "useAbility") {
      return { ...cmd, executeAtMs: 0 };
    }
    if (e.role === "entry") {
      return { ...cmd, executeAtMs: Math.round(ABILITY_LEAD_MS * tighten) };
    }
    if (e.role === "support" && cmd.kind === "move" && entryZone) {
      // Trade: follow the entry to the same zone, slightly behind.
      return { ...cmd, targetZone: entryZone, executeAtMs: Math.round(SUPPORT_TRAIL_MS * tighten) };
    }
    return { ...cmd, executeAtMs: Math.round(DEFAULT_OFFSET_MS * tighten) };
  });
}
