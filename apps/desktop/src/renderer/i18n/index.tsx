// Lightweight i18n for the desktop UI. Korean is the default; English is a full
// override set. No library — a key→string dict per language, a React context, and
// a t(key, vars?) with {var} interpolation. Game proper nouns (agents, maps,
// weapons, player handles, team names) are NOT translated by design; see
// docs/GLOSSARY_KO.md. The active language persists in localStorage.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ko } from './ko.ts';
import { en } from './en.ts';

export type Lang = 'ko' | 'en';
const DICTS: Record<Lang, Record<string, string>> = { ko, en };
const STORE_KEY = 'pv-lang';

function initialLang(): Lang {
  try { const v = localStorage.getItem(STORE_KEY); if (v === 'ko' || v === 'en') return v; } catch { /* no storage */ }
  return 'ko';
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; t: TFn }
const Ctx = createContext<LangCtx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORE_KEY, l); } catch { /* no storage */ }
  }, []);
  const t = useCallback<TFn>((key, vars) => {
    let s = DICTS[lang][key] ?? DICTS.ko[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLang must be used within LangProvider');
  return c;
}
export function useT(): TFn { return useLang().t; }

/** Engine strategy IDs (A_EXECUTE, …) → localized label; falls back to the raw id. */
export function strategyLabel(t: TFn, id: string | null | undefined): string {
  if (!id) return '—';
  const k = `strategy.${id}`;
  const v = t(k);
  return v === k ? id : v;
}
