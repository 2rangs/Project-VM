// Persisted viewer preferences for the live match screen (localStorage; safe without storage).
import { HIGHLIGHT_LEVELS, isHighlightLevel, type HighlightLevel } from './highlights.ts';

export type ViewMode = 'tactical' | 'cams';
/** Playback speed. Real time (1×) is the default: a round is watched from start to end. */
export type Tempo = 0.5 | 1 | 2 | 4 | 8;

export interface MatchPrefs { mode: ViewMode; tempo: Tempo; belief: boolean; detail: HighlightLevel }

const KEY = 'pv-matchday-view';
// 'extended' default: every event is shown, but dead travel time is skipped — a good balance that
// already lightens the render on a weak machine without hiding anything.
export const DEFAULT_PREFS: MatchPrefs = { mode: 'tactical', tempo: 1, belief: false, detail: 'extended' };
export const TEMPOS: readonly Tempo[] = [0.5, 1, 2, 4, 8];
export { HIGHLIGHT_LEVELS };
export type { HighlightLevel };

/** Parse a stored value; anything unexpected falls back to the default for that field. */
export function parsePrefs(raw: string | null | undefined): MatchPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(raw) as Partial<MatchPrefs>;
    return {
      mode: v.mode === 'cams' || v.mode === 'tactical' ? v.mode : DEFAULT_PREFS.mode,
      tempo: TEMPOS.includes(v.tempo as Tempo) ? (v.tempo as Tempo) : DEFAULT_PREFS.tempo,
      belief: typeof v.belief === 'boolean' ? v.belief : DEFAULT_PREFS.belief,
      detail: isHighlightLevel(v.detail) ? v.detail : DEFAULT_PREFS.detail,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function loadPrefs(): MatchPrefs {
  try { return parsePrefs(globalThis.localStorage?.getItem(KEY)); } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p: MatchPrefs): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(p)); } catch { /* no storage */ }
}
