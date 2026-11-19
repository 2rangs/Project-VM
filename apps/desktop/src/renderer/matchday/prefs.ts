// Persisted viewer preferences for the live match screen (localStorage; safe without storage).
export type ViewMode = 'tactical' | 'cams';
export type Tempo = 'auto' | 1 | 2 | 4 | 8;

export interface MatchPrefs { mode: ViewMode; tempo: Tempo; belief: boolean }

const KEY = 'pv-matchday-view';
export const DEFAULT_PREFS: MatchPrefs = { mode: 'tactical', tempo: 'auto', belief: false };
const TEMPOS: readonly Tempo[] = ['auto', 1, 2, 4, 8];

/** Parse a stored value; anything unexpected falls back to the default for that field. */
export function parsePrefs(raw: string | null | undefined): MatchPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(raw) as Partial<MatchPrefs>;
    return {
      mode: v.mode === 'cams' || v.mode === 'tactical' ? v.mode : DEFAULT_PREFS.mode,
      tempo: TEMPOS.includes(v.tempo as Tempo) ? (v.tempo as Tempo) : DEFAULT_PREFS.tempo,
      belief: typeof v.belief === 'boolean' ? v.belief : DEFAULT_PREFS.belief,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function loadPrefs(): MatchPrefs {
  try { return parsePrefs(globalThis.localStorage?.getItem(KEY)); } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p: MatchPrefs): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* no storage */ }
}
