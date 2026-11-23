// Icon set for the live match view. ORIGINAL glyphs — drawn for this project, not traced or
// copied from any game's icons.
//
// The construction rules follow the kind of iconography guide tactical-shooter UIs use, so the
// set reads as one family:
//   · a 24 × 24 grid with its two diagonals; shapes are built from the grid lines and 45° cuts
//   · solid fills only (no outlines), one colour (`currentColor`) — colour carries team / state
//   · sharp terminals, cut at 45°; no rounded corners (the one exception is the "controller"
//     role, a ring, the way a guide allows round forms only in its abstract grid)
//   · a "function" modifier (a small × / + / ! in the lower-right quarter) may be combined with
//     a primary glyph, never drawn alone at that size
// Every icon is decorative next to a text label unless a `title` is passed.
import type { CSSProperties } from 'react';

const PATHS = {
  // ── navigation / transport ──
  back: 'M15 2l4 4-6 6 6 6-4 4-10-10z',
  play: 'M6 3l15 9-15 9z',
  pause: 'M5 3h5v18l-5-3z M14 3h5v15l-5 3z',
  prev: 'M12 3v6l8-6v18l-8-6v6L2 12z',
  next: 'M12 3v6l-8-6v18l8-6v6l10-9z',
  end: 'M3 3l12 9-12 9z M17 3h4v18h-4z',
  // ── match state ──
  spike: 'M12 1l9 5.5v11L12 23l-9-5.5v-11z M12 7l-4.5 5 4.5 5 4.5-5z',
  kill: 'M11 1h2v6h-2z M11 17h2v6h-2z M1 11h6v2H1z M17 11h6v2h-6z M12 8l4 4-4 4-4-4z',
  timeout: 'M4 2h16v4l-5.5 6 5.5 6v4H4v-4l5.5-6L4 6z M8 5l4 4.5L16 5z',
  attack: 'M12 1l6 9h-4v7l-2 6-2-6v-7H6z',
  defense: 'M3 2h18v10l-9 11-9-11z M12 6v11l5-6V6z',
  credits: 'M12 2l9 7-9 13L3 9z M12 6.5L7.5 10l4.5 6.5 4.5-6.5z',
  ult: 'M12 1l3 8 8 3-8 3-3 8-3-8-8-3 8-3z',
  // ── intel ──
  eye: 'M1 12l7-7h8l7 7-7 7H8z M12 8l4 4-4 4-4-4z',
  lastSeen: 'M12 2l10 10-10 10L2 12z M12 6.5L6.5 12l5.5 5.5 5.5-5.5z',
  footstep: 'M5 3l5 1.5-1 9-5-1.5z M14 9l5 1.5-1 9-5-1.5z',
  gunfire: 'M12 1l2 7 6-4-4 6 7 2-7 2 4 6-6-4-2 7-2-7-6 4 4-6-7-2 7-2-4-6 6 4z',
  // ── player state ──
  hold: 'M3 3h7v3H6v4H3z M14 3h7v7h-3V6h-4z M3 14h3v4h4v3H3z M18 14h3v7h-7v-3h4z M10 10h4v4h-4z',
  move: 'M2 9h10V3l10 9-10 9v-6H2z',
  fight: 'M3 3h4l5 6 5-6h4v4l-6 5 6 5v4h-4l-5-6-5 6H3v-4l6-5-6-5z',
  dead: 'M4 2l8 8 8-8 2 2-8 8 8 8-2 2-8-8-8 8-2-2 8-8-8-8z',
  // ── destinations (home screen tiles) ──
  home: 'M12 2l10 9h-3v11h-5v-7h-4v7H5V11H2z',
  tactics: 'M2 2h20v20H2z M5 5v14h14V5z M7 16l4-4 2 2 4-6v8z',
  squad: 'M12 1l4 4-4 4-4-4z M4 12l4 4-4 4-4-4z M20 12l4 4-4 4-4-4z M12 11l4 4-4 4-4-4z',
  series: 'M2 3h9v4H6v3h5v4H6v3h5v4H2z M13 9h9v6h-9z',
  info: 'M10 2h4v4h-4z M10 9h4v13h-4z',
  // ── roles (our own glyphs: blade / pulse / ring / wall) ──
  duelist: 'M19 2h3v3L9 18l-3-3z M2 17l3-3 5 5-3 3z M4 4l5 5-2 2-3-4z',
  initiator: 'M12 1l3 6-3 3-3-3z M23 12l-6 3-3-3 3-3z M12 23l-3-6 3-3 3 3z M1 12l6-3 3 3-3 3z',
  controller: 'M12 2a10 10 0 1 0 10 10h-4a6 6 0 1 1-6-6z M14 2v8h8z',
  sentinel: 'M2 3h20v4H2z M4 9h7v12H4z M13 9h7v12h-7z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14, className, title, style }: { name: IconName; size?: number; className?: string; title?: string; style?: CSSProperties }) {
  return (
    <svg className={`mdx-icon ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={style}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Icon for a monitor / roster state. */
export const STATE_ICON: Record<string, IconName> = {
  holding: 'hold', moving: 'move', fighting: 'fight', planting: 'spike', defusing: 'spike', dead: 'dead',
};

export const ROLE_ICON: Record<string, IconName> = {
  Duelist: 'duelist', Initiator: 'initiator', Controller: 'controller', Sentinel: 'sentinel',
};
