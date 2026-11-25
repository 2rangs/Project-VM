// Pure logic of the tactics screen (screens/tactics/TacticsPlanner.tsx): editing the plant /
// post-plant / retake / mid parts of a MatchPlan immutably, keeping only what the manager set
// ("auto" and empty objects are dropped — the engine reads a missing field as "auto"), saying
// which parts play under the current engine flags, and storing a plan per team (career / sandbox).
// Unit-tested in test/tactics-plan.test.ts.
import type {
  MatchPlan, MidPlan, MidSidePlan, PlantChoice, PlantSpotKind, PostPlantPlan, RetakePlan, TacticsField, TacticsFlags, TacticsMapView, TacticsPlan,
} from '../../shared/manager.ts';
import { ASCENT_TRANSFORM } from '../../shared/ascent-transform.ts';

export const SPOT_KINDS: PlantSpotKind[] = ['default', 'safe', 'open', 'cover', 'near'];
export const ROLES = ['entry', 'lurker', 'support', 'rotator', 'anchor'] as const;

// ── which parts play ─────────────────────────────────────────────────────────────────────────
/** The engine flag each tactics part needs (engine match-runner TACTICS_FLAGS). */
export const FLAG_OF: Record<TacticsField, keyof TacticsFlags> = {
  plantPreference: 'plantTactics', postPlantPlans: 'plantTactics', retakePlans: 'plantTactics', midPlans: 'midControl',
};
/** Whether a part is PLAYED under these flags ("on") or only recorded ("off"). */
export const flagState = (field: TacticsField, flags: TacticsFlags): 'on' | 'off' => (flags[FLAG_OF[field]] ? 'on' : 'off');

/** The parts a plan sets (anything other than auto / empty) — same rule as match-runner planTactics. */
export function setParts(plan: TacticsPlan): TacticsField[] {
  const out: TacticsField[] = [];
  if (plan.plantPreference && Object.values(plan.plantPreference).some((v) => v && v !== 'auto')) out.push('plantPreference');
  if (plan.postPlantPlans && Object.values(plan.postPlantPlans).some((s) => Object.keys(s).length)) out.push('postPlantPlans');
  if (plan.retakePlans && Object.values(plan.retakePlans).some((s) => Object.keys(s).length)) out.push('retakePlans');
  if (plan.midPlans && Object.values(plan.midPlans).some((m) => m.attack || m.defense)) out.push('midPlans');
  return out;
}
/** Parts set but not played under these flags (the UI labels them "recorded, not played"). */
export const recordedOnly = (plan: TacticsPlan, flags: TacticsFlags): TacticsField[] => setParts(plan).filter((f) => flagState(f, flags) === 'off');

// ── immutable edits that keep the plan minimal ───────────────────────────────────────────────
function prune<T extends object>(o: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === 'auto') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !('spotId' in v) && !('players' in v) && !('roles' in v) && !('maxManDeficit' in v) && !('minSpareMs' in v)) {
      const inner = prune(v as object);
      if (inner) out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}
function withField<K extends TacticsField>(plan: MatchPlan, key: K, value: TacticsPlan[K] | undefined): MatchPlan {
  const next = { ...plan } as Record<string, unknown>;
  const v = value ? prune(value as object) : undefined;
  if (v) next[key] = v; else delete next[key];
  return next as MatchPlan;
}

export const plantChoiceOf = (plan: TacticsPlan, site: string): PlantChoice => plan.plantPreference?.[site] ?? 'auto';
export function setPlantChoice(plan: MatchPlan, site: string, choice: PlantChoice): MatchPlan {
  return withField(plan, 'plantPreference', { ...(plan.plantPreference ?? {}), [site]: choice });
}

/** The spot key a post-plant plan is written under for a plant choice: "*" for auto, the kind, or the spot id. */
export function spotKeyOf(choice: PlantChoice): string {
  if (choice === 'auto') return '*';
  return typeof choice === 'string' ? choice : choice.spotId;
}
export const postPlantOf = (plan: TacticsPlan, site: string, key: string): PostPlantPlan => plan.postPlantPlans?.[site]?.[key] ?? {};
export function setPostPlant(plan: MatchPlan, site: string, key: string, patch: Partial<PostPlantPlan>): MatchPlan {
  const sitePlans = plan.postPlantPlans?.[site] ?? {};
  return withField(plan, 'postPlantPlans', { ...(plan.postPlantPlans ?? {}), [site]: { ...sitePlans, [key]: { ...(sitePlans[key] ?? {}), ...patch } } });
}
export const retakeOf = (plan: TacticsPlan, site: string, key: string): RetakePlan => plan.retakePlans?.[site]?.[key] ?? {};
export function setRetake(plan: MatchPlan, site: string, key: string, patch: Partial<RetakePlan>): MatchPlan {
  const sitePlans = plan.retakePlans?.[site] ?? {};
  const merged: Record<string, unknown> = { ...(sitePlans[key] ?? {}), ...patch };
  if (merged.entry === '' ) delete merged.entry;
  return withField(plan, 'retakePlans', { ...(plan.retakePlans ?? {}), [site]: { ...sitePlans, [key]: merged as RetakePlan } });
}
export const midOf = (plan: TacticsPlan, mapKey: string, side: 'attack' | 'defense'): MidSidePlan => plan.midPlans?.[mapKey]?.[side] ?? {};
export function setMid(plan: MatchPlan, mapKey: string, side: 'attack' | 'defense', patch: Partial<MidSidePlan>): MatchPlan {
  const m: MidPlan = plan.midPlans?.[mapKey] ?? {};
  return withField(plan, 'midPlans', { ...(plan.midPlans ?? {}), [mapKey]: { ...m, [side]: { ...(m[side] ?? {}), ...patch } } });
}
/** Only the tactics parts of a plan. */
export function tacticsOnly(plan: TacticsPlan): TacticsPlan {
  return {
    ...(plan.plantPreference ? { plantPreference: plan.plantPreference } : {}),
    ...(plan.postPlantPlans ? { postPlantPlans: plan.postPlantPlans } : {}),
    ...(plan.retakePlans ? { retakePlans: plan.retakePlans } : {}),
    ...(plan.midPlans ? { midPlans: plan.midPlans } : {}),
  };
}

// ── save rule in plain words (RetakePlan.save) ───────────────────────────────────────────────
export type SaveMode = 'auto' | 'never' | 'custom';
export const saveModeOf = (r: RetakePlan): SaveMode => (r.save === undefined || r.save === 'auto' ? 'auto' : r.save === 'never' ? 'never' : 'custom');

// ── the minimap ──────────────────────────────────────────────────────────────────────────────
/** World units → 0..1 minimap coordinates (the live view's projection, MatchStage.ts). */
export function project(x: number, y: number): { u: number; v: number } {
  const t = ASCENT_TRANSFORM;
  return { u: y * t.xMultiplier + t.xScalarToAdd, v: x * t.yMultiplier + t.yScalarToAdd };
}
/** The box (0..1) around a site's spots, padded, so the site fills the picker. */
export function siteBox(site: TacticsMapView['sites'][number], pad = 0.04): { u0: number; v0: number; u1: number; v1: number } {
  const pts = site.candidates.map((c) => project(c.x, c.y));
  if (!pts.length) return { u0: 0, v0: 0, u1: 1, v1: 1 };
  const u0 = Math.min(...pts.map((p) => p.u)) - pad, u1 = Math.max(...pts.map((p) => p.u)) + pad;
  const v0 = Math.min(...pts.map((p) => p.v)) - pad, v1 = Math.max(...pts.map((p) => p.v)) + pad;
  const side = Math.max(u1 - u0, v1 - v0);
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { u0: cu - side / 2, v0: cv - side / 2, u1: cu + side / 2, v1: cv + side / 2 };
}
/** A spot id in readable form: "a-site/plant/cover-a-heaven" → "cover · a-heaven". */
export function spotLabel(id: string): string {
  const tail = id.split('/plant/')[1] ?? id;
  const [kind, ...rest] = tail.split('-');
  return rest.length ? `${kind} · ${rest.join('-')}` : kind!;
}

// ── a plan per team (career ext / sandbox) ───────────────────────────────────────────────────
export interface TeamTacticsStore { plans: Record<string, TacticsPlan>; flags: TacticsFlags }
export const EMPTY_STORE: TeamTacticsStore = { plans: {}, flags: {} };
/** Read the store from a career's `ext.tactics` (or a sandbox JSON), tolerating anything malformed. */
export function readStore(raw: unknown): TeamTacticsStore {
  const r = raw as Partial<TeamTacticsStore> | null | undefined;
  if (!r || typeof r !== 'object') return EMPTY_STORE;
  return { plans: r.plans && typeof r.plans === 'object' ? r.plans : {}, flags: r.flags && typeof r.flags === 'object' ? r.flags : {} };
}
export function withTeamPlan(store: TeamTacticsStore, teamId: string, plan: TacticsPlan): TeamTacticsStore {
  const plans = { ...store.plans };
  const t = tacticsOnly(plan);
  if (setParts(t).length) plans[teamId] = t; else delete plans[teamId];
  return { ...store, plans };
}
