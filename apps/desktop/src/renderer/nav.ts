// Left-nav structure. `soon` = placeholder (DECISION-001: club ops come later);
// `dev` = developer-only tooling; `career` = only while a career is open (hidden in the Quick
// Match sandbox). `group`/item labels are i18n keys resolved in the view (nav.group.*,
// nav.<id>), so the menu localizes with the active language.
export interface NavItem { id: string; icon: string; soon?: boolean; dev?: boolean; career?: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: 'CAREER',
    items: [
      { id: 'home', icon: '⌂', career: true }, // the Continue hub (screens/career/HomeScreen.tsx)
      { id: 'inbox', icon: '✉', career: true },
      { id: 'schedule', icon: '▦', career: true },
      { id: 'standings', icon: '≡', career: true },
    ],
  },
  {
    label: 'MATCH',
    items: [
      { id: 'match-day', icon: '▶' },
      { id: 'tactics', icon: '◈' },
      { id: 'agents', icon: '✦' },
      { id: 'veto', icon: '⊘' }, // [series] series + map veto (screens/series/SeriesScreen.tsx)
    ],
  },
  {
    label: 'TEAM',
    items: [
      { id: 'squad', icon: '👥' },
      { id: 'opponent', icon: '◎' },
    ],
  },
  {
    label: 'CLUB',
    items: [
      { id: 'finance', icon: '$', career: true }, // club ops: budget, ledger, wage list (screens/club/FinanceScreen.tsx)
      { id: 'transfers', icon: '⇄', career: true }, // club ops: search, offers, window (screens/club/TransfersScreen.tsx)
      { id: 'training', icon: '◳', career: true }, // club ops: weekly + individual focus (screens/club/TrainingScreen.tsx)
      { id: 'board', icon: '♜', career: true }, // club ops: board confidence, objectives, requests (screens/club/BoardScreen.tsx)
      { id: 'staff', icon: '☷', career: true }, // club ops: staff market (screens/club/StaffScreen.tsx)
      { id: 'scouting', icon: '🔍' }, // career world: new prospects, free agents, staff (screens/ScoutingScreen.tsx)
    ],
  },
  {
    label: 'DEV',
    items: [
      { id: 'dev-debugger', icon: '⚙', dev: true },
      { id: 'about', icon: 'ⓘ' },
    ],
  },
];
