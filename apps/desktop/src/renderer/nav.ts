// Left-nav structure. `soon` = placeholder (DECISION-001: club ops come later);
// `dev` = developer-only tooling.
export interface NavItem { id: string; label: string; icon: string; soon?: boolean; dev?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'MATCH',
    items: [
      { id: 'match-day', label: 'Match Day', icon: '▶' },
      { id: 'tactics', label: 'Tactics', icon: '◈' },
      { id: 'agents', label: 'Agent Select', icon: '✦' },
      { id: 'veto', label: 'Map Veto', icon: '⊘', soon: true },
    ],
  },
  {
    label: 'TEAM',
    items: [
      { id: 'squad', label: 'Squad', icon: '👥' },
      { id: 'opponent', label: 'Opponent Report', icon: '◎' },
      { id: 'inbox', label: 'Inbox', icon: '✉', soon: true },
      { id: 'schedule', label: 'Schedule', icon: '▦', soon: true },
    ],
  },
  {
    label: 'CLUB',
    items: [
      { id: 'finance', label: 'Finance', icon: '$', soon: true },
      { id: 'transfers', label: 'Transfers', icon: '⇄', soon: true },
      { id: 'training', label: 'Training', icon: '◳', soon: true },
      { id: 'scouting', label: 'Scouting', icon: '🔍', soon: true },
    ],
  },
  {
    label: 'DEV',
    items: [
      { id: 'dev-debugger', label: 'Decision Debugger', icon: '⚙', dev: true },
      { id: 'about', label: 'About', icon: 'ⓘ' },
    ],
  },
];
