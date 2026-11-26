// Media / player-interaction views for the desktop (pure helpers over @pv/career's media state).
// The screen (screens/career/MediaScreen.tsx) draws team chemistry, the squad's morale and the
// 1:1 interaction buttons, open promises and the recent media log. docs/CAREER_MODE.md (media).
import {
  canInteract, mediaOf, moraleOf, openPromise, MEDIA_MODEL,
  type CareerState, type MediaLogEntry, type PlayerPromise, type World, type WorldPlayer,
} from './world.ts';

export interface SquadMoraleRow {
  readonly player: WorldPlayer;
  readonly morale: number;        // 0..100
  /** Can be praised/criticised today (off cool-off). */
  readonly canTalk: boolean;
  /** Days until praise/criticise is available again (0 when ready). */
  readonly cooldown: number;
  readonly promise: PlayerPromise | null;
}

export interface MediaView {
  readonly chemistry: number;     // 0..100
  readonly squad: SquadMoraleRow[];
  readonly promises: Array<{ readonly promise: PlayerPromise; readonly handle: string }>;
  readonly log: MediaLogEntry[];
}

const pct = (v: number): number => Math.round(v * 100);

function daysUntil(from: string | undefined, date: string, span: number): number {
  if (!from) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const gone = Math.floor((b - a) / 86400000);
  return Math.max(0, span - gone);
}

export function mediaView(c: CareerState): MediaView {
  const w: World = c.world;
  const m = mediaOf(c);
  const uid = w.club?.userTeamId ?? c.userTeamId;
  const roster = w.teams[uid]?.roster ?? [];
  const squad: SquadMoraleRow[] = roster
    .map((id) => w.players[id])
    .filter((p): p is WorldPlayer => !!p)
    .map((player) => ({
      player,
      morale: pct(moraleOf(w.club, player.playerId)),
      canTalk: canInteract(w, m, player.playerId, c.date) === null,
      cooldown: daysUntil(m.lastInteract[player.playerId], c.date, MEDIA_MODEL.interactCooldownDays),
      promise: openPromise(w, m, player.playerId),
    }));
  const promises = m.promises
    .filter((p) => p.status === 'open')
    .map((promise) => ({ promise, handle: w.players[promise.playerId]?.handle ?? promise.playerId }));
  return {
    chemistry: pct(m.chemistry),
    squad,
    promises,
    log: [...m.log].reverse(),
  };
}

export type { PlayerPromise, MediaLogEntry };
