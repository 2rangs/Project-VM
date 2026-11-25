// Where a team's tactics plan lives: in a career, the career save (`career.ext.tactics`, one plan
// per team id, written with the career's autosave); with no career open, the browser's storage
// (per team id too). Both hold a TeamTacticsStore (plan.ts) and the engine flags the manager chose.
import { useSyncExternalStore } from 'react';
import { setCareerExt, subscribeCareer, useCareer } from '../career/session.ts';
import { EMPTY_STORE, readStore, withTeamPlan, type TeamTacticsStore } from './plan.ts';
import type { TacticsFlags, TacticsPlan } from '../../shared/manager.ts';

export const CAREER_EXT_KEY = 'tactics';
const SANDBOX_KEY = 'pv-tactics';

let sandbox: TeamTacticsStore | null = null;
const listeners = new Set<() => void>();
function readSandbox(): TeamTacticsStore {
  if (sandbox) return sandbox;
  try { sandbox = readStore(JSON.parse(globalThis.localStorage?.getItem(SANDBOX_KEY) ?? 'null')); } catch { sandbox = EMPTY_STORE; }
  return sandbox;
}
function writeSandbox(s: TeamTacticsStore): void {
  sandbox = s;
  try { globalThis.localStorage?.setItem(SANDBOX_KEY, JSON.stringify(s)); } catch { /* no storage */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => { listeners.add(l); const off = subscribeCareer(l); return () => { listeners.delete(l); off(); }; };

export interface TeamTactics {
  /** Saved in a career (true) or in this browser (false). */
  inCareer: boolean;
  store: TeamTacticsStore;
  planOf(teamId: string): TacticsPlan;
  savePlan(teamId: string, plan: TacticsPlan): void;
  setFlags(flags: TacticsFlags): void;
}

export function useTeamTactics(): TeamTactics {
  const cs = useCareer();
  const sb = useSyncExternalStore(subscribe, readSandbox, readSandbox);
  const career = cs.career;
  const store = career ? readStore(career.ext[CAREER_EXT_KEY]) : sb;
  const write = (s: TeamTacticsStore) => { if (career) setCareerExt(CAREER_EXT_KEY, s); else writeSandbox(s); };
  return {
    inCareer: !!career,
    store,
    planOf: (teamId) => store.plans[teamId] ?? {},
    savePlan: (teamId, plan) => write(withTeamPlan(store, teamId, plan)),
    setFlags: (flags) => write({ ...store, flags: { ...store.flags, ...flags } }),
  };
}
